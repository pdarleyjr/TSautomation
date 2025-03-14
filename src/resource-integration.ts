import { Browser, Page } from 'playwright';
import { ResourceManager } from './resource-manager';
import { logger } from './logger';
import config from './config';

/**
 * Global resource manager instance
 */
export const resourceManager = new ResourceManager({
  maxConcurrentBrowsers: config.parallel?.maxConcurrent || 2,
  dataStorageDir: './data',
  dataExpirationMs: 3600000, // 1 hour
  persistData: true,
  monitorResources: true,
  resourceCheckIntervalMs: 30000 // 30 seconds
});

/**
 * Execute a course completion task with resource management
 * @param courseId Course ID
 * @param courseName Course name
 * @param task Task function that takes a page and returns a promise
 * @param priority Priority of the request (higher number = higher priority)
 * @returns Promise resolving to the result of the task
 */
export async function executeWithResourceManagement<T>(
  courseId: string,
  courseName: string,
  task: (page: Page) => Promise<T>,
  priority: number = 0
): Promise<T> {
  logger.info(`Executing task for course ${courseName} (${courseId}) with resource management`);
  
  // Start timer for course completion
  const stopTimer = resourceManager.startTimer('course_completion_time', { 
    courseId, 
    courseName 
  });
  
  try {
    // Execute the task with resource management
    const result = await resourceManager.executeWithPage(
      async (page) => {
        try {
          // Record the start of the task
          resourceManager.recordMetric('course_started', 1, 'count', { courseId, courseName });
          
          // Execute the task
          const taskResult = await task(page);
          
          // Record successful completion
          resourceManager.recordMetric('course_completed', 1, 'count', { courseId, courseName });
          
          // Store completion data
          await resourceManager.storeAssignmentData(courseId, 'completion', {
            completed: true,
            timestamp: Date.now(),
            courseName
          });
          
          return taskResult;
        } catch (error) {
          // Record failure
          resourceManager.recordMetric('course_failed', 1, 'count', { courseId, courseName });
          
          // Store failure data
          await resourceManager.storeAssignmentData(courseId, 'failure', {
            completed: false,
            timestamp: Date.now(),
            courseName,
            error: error instanceof Error ? error.message : String(error)
          });
          
          throw error;
        }
      },
      `course_${courseId}`,
      priority
    );
    
    // Stop timer
    stopTimer();
    
    return result;
  } catch (error) {
    // Stop timer in case of error
    stopTimer();
    
    // Re-throw the error
    throw error;
  } finally {
    // Clean up any stored data for this course
    await resourceManager.deleteAssignmentData(courseId);
  }
}

/**
 * Execute multiple course completion tasks in parallel with resource management
 * @param courses Array of course information objects
 * @param taskFactory Function that creates a task for a course
 * @param maxConcurrent Maximum number of concurrent tasks
 * @returns Promise resolving to an array of results
 */
export async function executeMultipleWithResourceManagement<T>(
  courses: Array<{ id: string; name: string }>,
  taskFactory: (courseId: string, courseName: string) => (page: Page) => Promise<T>,
  maxConcurrent: number = 2
): Promise<Array<{ courseId: string; courseName: string; result: T | null; error: Error | null }>> {
  logger.info(`Executing ${courses.length} courses with resource management (max concurrent: ${maxConcurrent})`);
  
  // Update resource manager max concurrent browsers
  resourceManager.setMaxConcurrentBrowsers(maxConcurrent);
  
  // Create results array
  const results: Array<{ courseId: string; courseName: string; result: T | null; error: Error | null }> = [];
  
  // Process courses sequentially to avoid overwhelming the system
  for (const course of courses) {
    try {
      // Execute the task for this course
      const result = await executeWithResourceManagement(
        course.id,
        course.name,
        taskFactory(course.id, course.name)
      );
      
      // Add to results
      results.push({
        courseId: course.id,
        courseName: course.name,
        result,
        error: null
      });
    } catch (error) {
      // Add error to results
      results.push({
        courseId: course.id,
        courseName: course.name,
        result: null,
        error: error instanceof Error ? error : new Error(String(error))
      });
    }
  }
  
  return results;
}

/**
 * Register shutdown handlers for clean resource management
 */
export function registerShutdownHandlers(): void {
  // Register shutdown handler for SIGINT (Ctrl+C)
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down resource manager...');
    await resourceManager.shutdown();
    process.exit(0);
  });
  
  // Register shutdown handler for SIGTERM
  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down resource manager...');
    await resourceManager.shutdown();
    process.exit(0);
  });
  
  // Register shutdown handler for uncaught exceptions
  process.on('uncaughtException', async (error) => {
    logger.error('Uncaught exception, shutting down resource manager...', error);
    await resourceManager.shutdown();
    process.exit(1);
  });
  
  // Register shutdown handler for unhandled promise rejections
  process.on('unhandledRejection', async (reason) => {
    logger.error('Unhandled promise rejection, shutting down resource manager...', reason);
    await resourceManager.shutdown();
    process.exit(1);
  });
}

// Register shutdown handlers
registerShutdownHandlers();

// Export default
export default resourceManager;