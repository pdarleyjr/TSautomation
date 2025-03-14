import { resourceManager, executeWithResourceManagement, executeMultipleWithResourceManagement } from './resource-integration';
import { login, navigateToCourse, completeCourse } from './index';
import { logger } from './logger';
import { CourseInfo } from './utils';

/**
 * Example of using resource management to complete a single course
 * @param courseId Course ID
 * @param courseName Course name
 */
async function completeSingleCourseWithResourceManagement(courseId: string, courseName: string): Promise<void> {
  logger.info(`Starting completion of course ${courseName} (${courseId}) with resource management`);
  
  try {
    await executeWithResourceManagement(
      courseId,
      courseName,
      async (page) => {
        // Login to the system
        await login(page);
        
        // Navigate to the course
        const courseInfo = await navigateToCourse(page, courseId) || { id: courseId, name: courseName };
        
        // Complete the course
        await completeCourse(page, courseInfo, true);
        
        return true;
      }
    );
    
    logger.info(`Successfully completed course ${courseName} (${courseId})`);
  } catch (error) {
    logger.error(`Error completing course ${courseName} (${courseId})`, error);
  }
}

/**
 * Example of using resource management to complete multiple courses
 * @param courses Array of course information objects
 * @param maxConcurrent Maximum number of concurrent courses
 */
async function completeMultipleCoursesWithResourceManagement(
  courses: Array<{ id: string; name: string }>,
  maxConcurrent: number = 2
): Promise<void> {
  logger.info(`Starting completion of ${courses.length} courses with resource management (max concurrent: ${maxConcurrent})`);
  
  try {
    const results = await executeMultipleWithResourceManagement(
      courses,
      (courseId, courseName) => async (page) => {
        // Login to the system
        await login(page);
        
        // Navigate to the course
        const courseInfo = await navigateToCourse(page, courseId) || { id: courseId, name: courseName };
        
        // Complete the course
        await completeCourse(page, courseInfo, true);
        
        return true;
      },
      maxConcurrent
    );
    
    // Log results
    logger.info('\n===== RESOURCE MANAGED EXECUTION SUMMARY =====');
    logger.info(`Total courses processed: ${results.length}`);
    
    const successful = results.filter(r => r.result !== null);
    const failed = results.filter(r => r.error !== null);
    
    logger.info(`Successfully completed: ${successful.length}`);
    logger.info(`Failed: ${failed.length}`);
    
    failed.forEach(f => logger.error(`- ${f.courseName} (${f.courseId}): ${f.error?.message}`));
  } catch (error) {
    logger.error('Error completing multiple courses', error);
  } finally {
    // Shutdown resource manager
    await resourceManager.shutdown();
  }
}

/**
 * Main function to demonstrate resource management
 */
async function main(): Promise<void> {
  // Example course data
  const courses = [
    { id: '12345', name: 'Example Course 1' },
    { id: '67890', name: 'Example Course 2' },
    { id: '24680', name: 'Example Course 3' }
  ];
  
  // Get max concurrent from command line or use default
  const args = process.argv.slice(2);
  const maxConcurrentIndex = args.indexOf('--max-concurrent');
  const maxConcurrent = maxConcurrentIndex !== -1 && args.length > maxConcurrentIndex + 1 ? 
    parseInt(args[maxConcurrentIndex + 1], 10) || 2 : 2;
  
  // Check for single course mode
  const singleCourseIndex = args.indexOf('--single');
  const singleCourse = singleCourseIndex !== -1;
  
  if (singleCourse) {
    // Complete a single course
    await completeSingleCourseWithResourceManagement(courses[0].id, courses[0].name);
  } else {
    // Complete multiple courses
    await completeMultipleCoursesWithResourceManagement(courses, maxConcurrent);
  }
}

// Run the example if this file is executed directly
if (require.main === module) {
  main().catch(error => {
    logger.error('Unhandled error in main', error);
    process.exit(1);
  });
}

// Export functions for testing or external use
export {
  completeSingleCourseWithResourceManagement,
  completeMultipleCoursesWithResourceManagement
};