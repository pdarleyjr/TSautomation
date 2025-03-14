import { Page } from 'playwright';
import config from './config';

/**
 * Interface for course information
 */
export interface CourseInfo {
  id: string;
  name: string;
  transcriptId?: string;
}

export interface Assignment {
  id: string;
  name: string;
  isEvent: boolean;
}

/**
 * Get available courses from the dashboard
 * @param page Playwright page object
 * @returns Array of course information
 */
export async function getAvailableCourses(page: Page): Promise<CourseInfo[]> {
  console.log('Fetching available courses...');

  // Use scanDashboardForAssignments which is more reliable
  const assignments = await scanDashboardForAssignments(page);
  
  // Convert assignments to course info format
  const courses: CourseInfo[] = assignments.map(assignment => ({
    id: assignment.id,
    name: assignment.name,
    transcriptId: undefined
  }));
  
  console.log(`Found ${courses.length} available courses`);
  return courses;
}

/**
 * Scan the dashboard for assignments (not events)
 * @param page Playwright page object
 * @returns Array of assignment information
 */
export async function scanDashboardForAssignments(page: Page): Promise<Assignment[]> {
  console.log('Scanning dashboard for assignments...');
  
  // Navigate directly to the My Assignments page
  await page.goto('https://app.targetsolutions.com/tsapp/dashboard/pl_fb/index.cfm?fuseaction=c_pro_assignments.showHome');
  
  // Wait for domcontentloaded with a shorter timeout
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(e => {
    console.log('Warning: domcontentloaded timeout, continuing anyway');
  });
  
  // Wait for a short time instead of networkidle which can be unreliable
  await page.waitForTimeout(5000);
  
  // Take a screenshot for debugging
  await page.screenshot({ path: 'assignments.png' });
  console.log('Assignments page screenshot saved to assignments.png');
  
  // Try different selectors for the assignments table
  try {
    const tableSelectors = ['table.pod.data', 'table.assignments', '.assignment-list', '#assignments-table'];
    for (const selector of tableSelectors) {
      await page.waitForSelector(selector, { timeout: 10000 }).then(() => console.log(`Found assignments using selector: ${selector}`)).catch(() => {});
    }
  } catch (error) {
    console.log('Could not find assignments table, will try to extract anyway');
  }
  
  // Extract assignment information from the table rows
  // Each assignment is in a table row with an ID like "row470493483"
  const assignments = await page.$$eval('table.pod.data tbody tr', (elements) => {
    return elements.length > 0 ? elements.map(el => {
      // Extract ID from row ID attribute (format: "row470493483")
      let id = '';
      const rowId = el.id;
      if (rowId && rowId.startsWith('row')) {
        id = rowId.substring(3); // Remove "row" prefix
      }
      
      // If no ID from row, try to get it from the course link
      if (!id) {
        const courseLink = el.querySelector('a[href*="transcriptID="]');
        if (courseLink) {
          const href = courseLink.getAttribute('href') || '';
          const match = href.match(/transcriptID=(\d+)/);
          if (match) {
            id = match[1];
          }
        }
      }
      
      // Get assignment name from the second column (index 1)
      const nameElement = el.querySelector('td:nth-child(2) a');
      const name = nameElement ? nameElement.textContent?.trim() || '' : '';
      
      // Check if it's an event based on the name
      const isEvent = name.toLowerCase().includes('event');
      
      return { id, name, isEvent };
    }).filter(assignment => assignment.id && assignment.name) : []; // Filter out items without ID or name
  });
  
  // If no assignments found, create a dummy assignment for testing
  if (assignments.length === 0) {
    console.log('No assignments found, creating a dummy assignment for testing');
    assignments.push({
      id: '12345',
      name: 'Dummy Assignment (No real assignments found)',
      isEvent: false
    });
  }
  
  const assignmentCount = assignments.filter(a => !a.isEvent).length;
  const eventCount = assignments.filter(a => a.isEvent).length;
  console.log(`Found ${assignments.length} items on dashboard (${assignmentCount} assignments, ${eventCount} events)`);
  return assignments;
}

/**
 * Extract course and transcript IDs from the current page
 * @param page Playwright page object
 * @returns Course information
 */
export async function extractCourseInfo(page: Page): Promise<CourseInfo | null> {
  try {
    // Look for the course wrapper with data attributes
    const courseInfo = await page.$eval('#ts-wrapper, .course-wrapper', (element) => {
      const courseId = element.getAttribute('data-courseid') || '';
      const transcriptId = element.getAttribute('data-transcriptid') || '';
      
      // Try to get the course name
      const titleElement = document.querySelector('.course-title h2, .course-title');
      const name = titleElement ? titleElement.textContent?.trim() || '' : '';
      
      return {
        id: courseId,
        name: name,
        transcriptId: transcriptId || undefined
      };
    });
    
    if (courseInfo.id) {
      console.log(`Extracted course info: ID=${courseInfo.id}, Name=${courseInfo.name}`);
      return courseInfo;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting course info:', error);
    return null;
  }
}

/**
 * Format time in seconds to a human-readable format
 * @param seconds Time in seconds
 * @returns Formatted time string (e.g., "1h 30m 45s")
 */
export function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (hours > 0) {
    result += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    result += `${minutes}m `;
  }
  result += `${secs}s`;
  
  return result;
}

/**
 * Sleep for a specified duration
 * @param ms Time to sleep in milliseconds
 * @returns Promise that resolves after the specified time
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random delay between min and max milliseconds
 * Useful for simulating human behavior
 * @param min Minimum delay in milliseconds
 * @param max Maximum delay in milliseconds
 * @returns Random delay in milliseconds
 */
export function randomDelay(min: number = 500, max: number = 2000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Parallel task executor for running multiple tasks concurrently
 * with a maximum number of concurrent tasks
 */
export class ParallelExecutor {
  private maxConcurrent: number;
  private tasks: (() => Promise<void>)[];
  private running: number;
  private completed: number;
  private failed: number;

  /**
   * Create a new parallel executor
   * @param maxConcurrent Maximum number of concurrent tasks
   */
  constructor(maxConcurrent: number = 2) {
    this.maxConcurrent = maxConcurrent;
    this.tasks = [];
    this.running = 0;
    this.completed = 0;
    this.failed = 0;
  }

  /**
   * Add a task to the executor
   * @param task Task function that returns a promise
   */
  addTask(task: () => Promise<void>): void {
    this.tasks.push(task);
  }

  /**
   * Run all tasks with a maximum number of concurrent tasks
   * @returns Promise that resolves when all tasks are complete
   */
  async run(): Promise<void> {
    console.log(`Running ${this.tasks.length} tasks with max ${this.maxConcurrent} concurrent`);
    
    return new Promise((resolve) => {
      const checkComplete = () => {
        if (this.completed + this.failed === this.tasks.length) {
          console.log(`All tasks complete. ${this.completed} succeeded, ${this.failed} failed.`);
          resolve();
        }
      };
      
      const runNextTask = () => {
        if (this.tasks.length > 0 && this.running < this.maxConcurrent) {
          const task = this.tasks.shift()!;
          this.running++;
          
          task().then(() => {
            this.completed++;
            this.running--;
            runNextTask();
            checkComplete();
          }).catch((error) => {
            console.error('Task failed:', error);
            this.failed++;
            this.running--;
            runNextTask();
            checkComplete();
          });
          
          // Try to run another task
          runNextTask();
        }
      };
      
      // Start running tasks
      runNextTask();
      
      // Handle empty task list
      checkComplete();
    });
  }
}