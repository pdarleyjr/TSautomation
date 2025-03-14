import { Page } from 'playwright';
import { logger } from './logger';
import { TimeTracker, TimeTrackingEvent } from './time-tracker';
import { Assignment, getAvailableCourses, scanDashboardForAssignments, sleep, randomDelay } from './utils';
import config from './config';

/**
 * Assignment priority interface
 */
export interface AssignmentPriority {
  id: string;
  priority: number;
  dueDate?: Date;
}

/**
 * Workflow state interface
 */
export interface WorkflowState {
  currentAssignmentId: string | null;
  currentAssignmentName: string | null;
  completedAssignments: string[];
  failedAssignments: string[];
  priorityQueue: AssignmentPriority[];
  isProcessing: boolean;
  lastNavigationTime: Date;
}

/**
 * Workflow manager class for handling assignment progression
 */
export class WorkflowManager {
  private page: Page;
  private state: WorkflowState;
  private timeTracker: TimeTracker | null = null;
  private assignmentCompletionCallback: ((success: boolean) => Promise<void>) | null = null;

  /**
   * Create a new workflow manager
   * @param page Playwright page object
   */
  constructor(page: Page) {
    this.page = page;
    
    // Initialize state
    this.state = {
      currentAssignmentId: null,
      currentAssignmentName: null,
      completedAssignments: [],
      failedAssignments: [],
      priorityQueue: [],
      isProcessing: false,
      lastNavigationTime: new Date()
    };
    
    logger.info('Workflow manager initialized');
  }

  /**
   * Set the assignment completion callback
   * @param callback Callback function to call when an assignment is completed
   */
  public setAssignmentCompletionCallback(callback: (success: boolean) => Promise<void>): void {
    this.assignmentCompletionCallback = callback;
  }

  /**
   * Start a new assignment
   * @param assignmentId Assignment ID
   * @param assignmentName Assignment name
   * @param courseType Course type for time requirements
   * @returns Promise resolving to true if the assignment was started
   */
  public async startAssignment(assignmentId: string, assignmentName: string, courseType: string = 'default'): Promise<boolean> {
    if (this.state.isProcessing) {
      logger.warn('Cannot start a new assignment while processing another one');
      return false;
    }
    
    logger.info(`Starting assignment: ${assignmentName} (ID: ${assignmentId})`);
    
    // Update state
    this.state.currentAssignmentId = assignmentId;
    this.state.currentAssignmentName = assignmentName;
    this.state.isProcessing = true;
    this.state.lastNavigationTime = new Date();
    
    // Create a new time tracker
    this.timeTracker = new TimeTracker(assignmentId, assignmentName, courseType);
    
    // Set up event listeners
    this.timeTracker.on(TimeTrackingEvent.TIME_INSUFFICIENT, this.handleInsufficientTime.bind(this));
    
    return true;
  }

  /**
   * Handle insufficient time event
   * @param state Time tracker state
   */
  private async handleInsufficientTime(state: any): Promise<void> {
    logger.warn(`Time requirement not met for assignment: ${this.state.currentAssignmentName}`);
    
    // Add to failed assignments
    if (this.state.currentAssignmentId && !this.state.failedAssignments.includes(this.state.currentAssignmentId)) {
      this.state.failedAssignments.push(this.state.currentAssignmentId);
    }
    
    // Wait for the calculated retry delay
    const retryDelayMs = state.nextRetryDelayMs;
    logger.info(`Waiting ${retryDelayMs / 1000} seconds before retrying...`);
    await sleep(retryDelayMs);
    
    // Restart the assignment
    await this.restartCurrentAssignment();
  }

  /**
   * Restart the current assignment
   * @returns Promise resolving when the assignment is restarted
   */
  private async restartCurrentAssignment(): Promise<void> {
    if (!this.state.currentAssignmentId || !this.state.currentAssignmentName) {
      logger.error('No current assignment to restart');
      return;
    }
    
    logger.info(`Restarting assignment: ${this.state.currentAssignmentName}`);
    
    try {
      // Navigate to the assignments dashboard
      await this.navigateToDashboard();
      
      // Find and click on the current assignment
      const assignmentSelector = `[data-assignmentid="${this.state.currentAssignmentId}"], a[href*="assignmentid=${this.state.currentAssignmentId}"]`;
      const hasAssignment = await this.page.$(assignmentSelector) !== null;
      
      if (hasAssignment) {
        logger.info('Found assignment on dashboard, clicking to restart');
        await this.page.click(assignmentSelector);
        await this.page.waitForLoadState('networkidle');
        
        // Reset the time tracker
        if (this.timeTracker) {
          this.timeTracker.reset();
        }
        
        logger.info('Assignment restarted successfully');
      } else {
        logger.warn('Could not find assignment on dashboard');
        
        // Try to find it in the assignments list
        await this.navigateToAssignmentsList();
        
        const listAssignmentSelector = `[data-assignmentid="${this.state.currentAssignmentId}"], a[href*="assignmentid=${this.state.currentAssignmentId}"]`;
        const hasListAssignment = await this.page.$(listAssignmentSelector) !== null;
        
        if (hasListAssignment) {
          logger.info('Found assignment in assignments list, clicking to restart');
          await this.page.click(listAssignmentSelector);
          await this.page.waitForLoadState('networkidle');
          
          // Reset the time tracker
          if (this.timeTracker) {
            this.timeTracker.reset();
          }
          
          logger.info('Assignment restarted successfully');
        } else {
          logger.error('Could not find assignment in assignments list');
          
          // Call the completion callback with failure
          if (this.assignmentCompletionCallback) {
            await this.assignmentCompletionCallback(false);
          }
        }
      }
    } catch (error) {
      logger.error('Error restarting assignment', error);
      
      // Call the completion callback with failure
      if (this.assignmentCompletionCallback) {
        await this.assignmentCompletionCallback(false);
      }
    }
  }

  /**
   * Complete the current assignment
   * @param success Whether the assignment was completed successfully
   * @returns Promise resolving when the assignment is completed
   */
  public async completeAssignment(success: boolean): Promise<void> {
    if (!this.state.currentAssignmentId || !this.state.currentAssignmentName) {
      logger.warn('No current assignment to complete');
      return;
    }
    
    // Verify time requirement if successful
    if (success && this.timeTracker) {
      const isTimeSufficient = await this.timeTracker.verifyTimeRequirement();
      
      if (!isTimeSufficient) {
        // Time requirement not met, the handler will restart the assignment
        return;
      }
    }
    
    logger.info(`Completing assignment: ${this.state.currentAssignmentName} (success: ${success})`);
    
    // Update state
    if (success) {
      this.state.completedAssignments.push(this.state.currentAssignmentId);
    } else {
      this.state.failedAssignments.push(this.state.currentAssignmentId);
    }
    
    // Stop time tracking
    if (this.timeTracker) {
      this.timeTracker.stopTracking();
      this.timeTracker.removeAllListeners();
      this.timeTracker = null;
    }
    
    // Reset current assignment
    this.state.currentAssignmentId = null;
    this.state.currentAssignmentName = null;
    this.state.isProcessing = false;
    
    // Call the completion callback
    if (this.assignmentCompletionCallback) {
      await this.assignmentCompletionCallback(success);
    }
  }

  /**
   * Handle course review page
   * @returns Promise resolving to true if a course review page was detected and handled
   */
  public async handleCourseReview(): Promise<boolean> {
    try {
      logger.info('Checking for course review page...');
      
      // Check for indicators of a course review page
      const reviewPageIndicators = [
        'h1:has-text("Course Review")',
        'h1:has-text("Course Evaluation")',
        'form.review-form',
        'form.evaluation-form',
        '.course-review',
        '.course-evaluation',
        'button:has-text("Submit Review")',
        'button:has-text("Skip Review")'
      ];
      
      for (const indicator of reviewPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Course review page detected (matched indicator: ${indicator})`);
          
          // Look for a skip button first
          const skipButtonSelectors = [
            'button:has-text("Skip")',
            'a:has-text("Skip")',
            'button:has-text("Skip Review")',
            'a:has-text("Skip Review")',
            'button:has-text("No Thanks")',
            'a:has-text("No Thanks")'
          ];
          
          for (const skipSelector of skipButtonSelectors) {
            const hasSkipButton = await this.page.$(skipSelector) !== null;
            if (hasSkipButton) {
              logger.info(`Found skip button: ${skipSelector}`);
              await this.page.click(skipSelector);
              await this.page.waitForTimeout(2000);
              return true;
            }
          }
          
          // If no skip button, look for a submit button
          const submitButtonSelectors = [
            'button:has-text("Submit")',
            'input[type="submit"]',
            'button[type="submit"]',
            'button:has-text("Submit Review")',
            'button:has-text("Complete Review")'
          ];
          
          for (const submitSelector of submitButtonSelectors) {
            const hasSubmitButton = await this.page.$(submitSelector) !== null;
            if (hasSubmitButton) {
              logger.info(`Found submit button: ${submitSelector}`);
              
              // Fill in any required fields with default values
              const requiredFields = await this.page.$$('input[required], textarea[required], select[required]');
              
              for (const field of requiredFields) {
                const tagName = await field.evaluate(el => el.tagName.toLowerCase());
                const type = await field.evaluate(el => (el as HTMLInputElement).type?.toLowerCase());
                
                if (tagName === 'select') {
                  // Select the first non-empty option
                  await field.evaluate(select => {
                    const options = Array.from((select as HTMLSelectElement).options);
                    const firstNonEmpty = options.find(opt => opt.value !== '');
                    if (firstNonEmpty) {
                      (select as HTMLSelectElement).value = firstNonEmpty.value;
                    }
                  });
                } else if (tagName === 'textarea') {
                  await field.fill('No additional comments.');
                } else if (type === 'radio') {
                  await field.check();
                } else if (type === 'checkbox') {
                  await field.check();
                } else if (type === 'text' || type === 'email') {
                  await field.fill('test@example.com');
                }
              }
              
              // Click the submit button
              await this.page.click(submitSelector);
              await this.page.waitForTimeout(2000);
              return true;
            }
          }
          
          // If we found indicators but no buttons, try to navigate away
          logger.warn('Could not find skip or submit buttons on review page');
          
          // Try to navigate to the dashboard as a fallback
          await this.navigateToDashboard();
          return true;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Error handling course review', error);
      return false;
    }
  }

  /**
   * Navigate to the dashboard
   * @returns Promise resolving when navigation is complete
   */
  public async navigateToDashboard(): Promise<void> {
    try {
      logger.info('Navigating to dashboard...');
      
      // Click on the dashboard link or logo
      const dashboardSelectors = [
        'a[href*="dashboard"]',
        '.dashboard-link',
        '.navbar-brand',
        '.logo',
        'a:has-text("Dashboard")',
        'a:has-text("Home")'
      ];
      
      for (const selector of dashboardSelectors) {
        const hasDashboardLink = await this.page.$(selector) !== null;
        if (hasDashboardLink) {
          logger.info(`Found dashboard link: ${selector}`);
          await this.page.click(selector);
          await this.page.waitForLoadState('networkidle');
          this.state.lastNavigationTime = new Date();
          return;
        }
      }
      
      // If no dashboard link found, try navigating directly
      logger.info('No dashboard link found, navigating directly');
      await this.page.goto('https://app.targetsolutions.com/tsapp/dashboard/pl_fb/index.cfm?fuseaction=c_pro.showHome');
      await this.page.waitForLoadState('networkidle');
      this.state.lastNavigationTime = new Date();
    } catch (error) {
      logger.error('Error navigating to dashboard', error);
    }
  }

  /**
   * Navigate to the assignments list
   * @returns Promise resolving when navigation is complete
   */
  public async navigateToAssignmentsList(): Promise<void> {
    try {
      logger.info('Navigating to assignments list...');
      
      // Click on the assignments link
      const assignmentsSelectors = [
        'a[href*="assignments"]',
        '.assignments-link',
        'a:has-text("Assignments")',
        'a:has-text("My Assignments")'
      ];
      
      for (const selector of assignmentsSelectors) {
        const hasAssignmentsLink = await this.page.$(selector) !== null;
        if (hasAssignmentsLink) {
          logger.info(`Found assignments link: ${selector}`);
          await this.page.click(selector);
          await this.page.waitForLoadState('networkidle');
          this.state.lastNavigationTime = new Date();
          return;
        }
      }
      
      // If no assignments link found, try navigating directly
      logger.info('No assignments link found, navigating directly');
      await this.page.goto('https://app.targetsolutions.com/training/assignments/my_assignments.cfm');
      await this.page.waitForLoadState('networkidle');
      this.state.lastNavigationTime = new Date();
    } catch (error) {
      logger.error('Error navigating to assignments list', error);
    }
  }

  /**
   * Find and start the next assignment
   * @returns Promise resolving to true if a new assignment was started
   */
  public async findAndStartNextAssignment(): Promise<boolean> {
    try {
      logger.info('Finding next assignment to start...');
      
      // Navigate to the dashboard
      await this.navigateToDashboard();
      
      // Scan for assignments
      const assignments = await scanDashboardForAssignments(this.page);
      
      // Filter out events and already completed/failed assignments
      const availableAssignments = assignments.filter(a => 
        !a.isEvent && 
        !this.state.completedAssignments.includes(a.id) && 
        !this.state.failedAssignments.includes(a.id)
      );
      
      if (availableAssignments.length === 0) {
        logger.info('No available assignments found on dashboard, checking assignments list');
        
        // Try the assignments list
        await this.navigateToAssignmentsList();
        
        // Get available courses
        const courses = await getAvailableCourses(this.page);
        
        // Filter out already completed/failed courses
        const availableCourses = courses.filter(c => 
          !this.state.completedAssignments.includes(c.id) && 
          !this.state.failedAssignments.includes(c.id)
        );
        
        if (availableCourses.length === 0) {
          logger.info('No available assignments found in assignments list');
          return false;
        }
        
        // Start the first available course
        const nextCourse = availableCourses[0];
        logger.info(`Starting next course from assignments list: ${nextCourse.name} (ID: ${nextCourse.id})`);
        
        // Click on the course
        const courseSelector = `[data-courseid="${nextCourse.id}"], a[href*="courseid=${nextCourse.id}"]`;
        await this.page.click(courseSelector);
        await this.page.waitForLoadState('networkidle');
        
        // Start tracking the assignment
        await this.startAssignment(nextCourse.id, nextCourse.name);
        return true;
      }
      
      // Start the first available assignment
      const nextAssignment = availableAssignments[0];
      logger.info(`Starting next assignment from dashboard: ${nextAssignment.name} (ID: ${nextAssignment.id})`);
      
      // Click on the assignment
      const assignmentSelector = `[data-assignmentid="${nextAssignment.id}"], a[href*="assignmentid=${nextAssignment.id}"]`;
      await this.page.click(assignmentSelector);
      await this.page.waitForLoadState('networkidle');
      
      // Start tracking the assignment
      await this.startAssignment(nextAssignment.id, nextAssignment.name);
      return true;
    } catch (error) {
      logger.error('Error finding and starting next assignment', error);
      return false;
    }
  }

  /**
   * Get the current state
   * @returns Current state
   */
  public getState(): WorkflowState {
    return { ...this.state };
  }
}

export default WorkflowManager;