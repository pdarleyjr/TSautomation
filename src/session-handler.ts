import { Page } from 'playwright';
import { logger } from './logger';
import { CourseInfo, formatTime, sleep, randomDelay } from './utils';
import { answerQuestion } from './langchain-integration';
import { PageNavigator } from './page-navigator';
import { TimeTracker } from './time-tracker';
import { WorkflowManager } from './workflow-manager';

/**
 * Session state interface
 */
export interface SessionState {
  courseId: string;
  courseName: string;
  currentSection: number;
  totalSections: number;
  videosWatched: number;
  questionsAnswered: number;
  startTime: Date;
  lastActivityTime: Date;
  isComplete: boolean;
  errors: Error[];
  examCompleted: boolean;
  timeRequirementMet: boolean;
}

/**
 * Video state interface
 */
export interface VideoState {
  isPlaying: boolean;
  duration: number;
  currentTime: number;
  isComplete: boolean;
}

/**
 * Session handler class for managing course progression
 */
export class SessionHandler {
  private page: Page;
  private state: SessionState;
  private courseContent: string;
  private maxRetries: number;
  private timeoutMs: number;
  private timeTracker: TimeTracker | null = null;
  private workflowManager: WorkflowManager | null = null;
  private pageNavigator: PageNavigator;

  /**
   * Create a new session handler
   * @param page Playwright page object
   * @param courseInfo Course information
   * @param maxRetries Maximum number of retries for operations
   * @param timeoutMs Timeout in milliseconds
   * @param workflowManager Optional workflow manager instance
   */
  constructor(page: Page, courseInfo: CourseInfo, maxRetries: number = 3, timeoutMs: number = 30000, workflowManager?: WorkflowManager) {
    this.page = page;
    this.courseContent = '';
    this.maxRetries = maxRetries;
    this.timeoutMs = timeoutMs;
    this.workflowManager = workflowManager || null;
    this.pageNavigator = new PageNavigator(page, '');
    
    // Initialize session state
    this.state = {
      courseId: courseInfo.id,
      courseName: courseInfo.name,
      currentSection: 0,
      totalSections: 0, // Will be determined during course navigation
      videosWatched: 0,
      questionsAnswered: 0,
      startTime: new Date(),
      lastActivityTime: new Date(),
      isComplete: false,
      errors: [],
      examCompleted: false,
      timeRequirementMet: false
    };
    
    logger.info(`Session started for course: ${courseInfo.name} (ID: ${courseInfo.id})`);
    
    // Initialize time tracker
    this.initializeTimeTracker(courseInfo);
  }

  /**
   * Initialize the time tracker for this session
   */
  private initializeTimeTracker(courseInfo: CourseInfo): void {
    // Determine course type from course name (could be more sophisticated)
    let courseType = 'default';
    const courseName = courseInfo.name.toLowerCase();
    
    if (courseName.includes('safety') || courseName.includes('hazard')) {
      courseType = 'safety';
    } else if (courseName.includes('compliance') || courseName.includes('regulation')) {
      courseType = 'compliance';
    } else if (courseName.includes('hr') || courseName.includes('human resources')) {
      courseType = 'hr';
    }
    
    // Create time tracker
    this.timeTracker = new TimeTracker(courseInfo.id, courseInfo.name, courseType);
    logger.info(`Time tracker initialized with course type: ${courseType}`);
  }

  /**
   * Get the current session state
   * @returns Session state
   */
  getState(): SessionState {
    return { ...this.state };
  }

  /**
   * Update the course content
   * @param content New course content
   */
  updateCourseContent(content: string): void {
    this.courseContent = content;
    logger.debug(`Updated course content (${content.length} characters)`);
    
    // Update the page navigator's course content as well
    this.pageNavigator.updateCourseContent(content);
    
    // Save content to file
    if (content.length > 0) {
      logger.saveCourseContent(content, this.state.currentSection);
    }
  }

  /**
   * Handle a video on the current page
   * @returns Promise resolving to true if a video was found and handled
   */
  async handleVideo(): Promise<boolean> {
    logger.info('Checking for video content...');
    const startTime = Date.now();

    try {
      // Multiple detection strategies for videos
      const videoDetectionStrategies = [
        async () => {
          const elements = await this.page.$$('#mediaspace, video, iframe[src*="vimeo"], iframe[src*="youtube"]');
          return elements.length > 0;
        },
        async () => {
          const elements = await this.page.$$('.video-player, .media-player, .ts-video-player');
          return elements.length > 0;
        },
        async () => {
          const elements = await this.page.$$('.video-container, .media-container');
          return elements.length > 0;
        },
        async () => {
          const elements = await this.page.$$('.video-controls, .media-controls, .vjs-control-bar');
          return elements.length > 0;
        }
      ];

      // Try each detection strategy
      let videoDetected = false;
      let detectionMethod = '';

      for (const [index, strategy] of videoDetectionStrategies.entries()) {
        videoDetected = await strategy();
        if (videoDetected) {
          detectionMethod = `strategy ${index + 1}`;
          break;
        }
      }

      if (!videoDetected) {
        logger.info('No video found on this page');
        return false;
      }

      logger.info(`Video detected using ${detectionMethod}. Waiting for it to complete...`);

      // Approach 1: Wait for the "Next Section" modal to appear
      try {
        await this.page.waitForSelector('#dialog_next_slide', { timeout: this.timeoutMs * 5 }); // 5x normal timeout for videos

        const watchTime = (Date.now() - startTime) / 1000;
        logger.info(`Video completed after ${formatTime(watchTime)}! "Next" button detected`);

        // Click the next button
        await this.page.click('#dialog_next_slide .btn-primary, .next-button, .continue-button');
        this.state.videosWatched++;
        this.state.lastActivityTime = new Date();
        return true;
      } catch (e) {
        logger.debug('Next button not found after timeout, trying alternative approaches');
      }

      // Approach 2: Check for completion indicators
      try {
        const completionIndicators = [
          '.video-completed',
          '.video-complete',
          '.completion-indicator',
          '.video-progress-100',
          '[data-state="ended"]',
          '.vjs-ended'
        ];

        for (const indicator of completionIndicators) {
          const isVisible = await this.page.isVisible(indicator);
          if (isVisible) {
            logger.info(`Video completion detected: ${indicator} found`);
            
            // Try to find and click next button
            const nextButtonSelectors = [
              '.btn-next',
              '.btn-continue',
              '.next-button',
              '.continue-button',
              'button:has-text("Next")',
              'button:has-text("Continue")'
            ];

            for (const selector of nextButtonSelectors) {
              const isButtonVisible = await this.page.isVisible(selector);
              if (isButtonVisible) {
                await this.page.click(selector);
                const watchTime = (Date.now() - startTime) / 1000;
                logger.info(`Video completed after ${formatTime(watchTime)}! Clicked ${selector}`);
                this.state.videosWatched++;
                this.state.lastActivityTime = new Date();
                return true;
              }
            }
          }
        }
      } catch (e) {
        logger.debug('Error checking for completion indicators', e);
      }

      // Approach 3: Monitor video progress (most reliable but requires HTML5 video)
      try {
        // Wait for video to load
        await this.page.waitForSelector('video', { timeout: this.timeoutMs });

        // Get video duration and simulate watching
        const videoDuration = await this.page.$eval('video', video => video.duration);

        if (videoDuration) {
          logger.info(`Video duration: ${videoDuration} seconds`);

          // Monitor video progress
          let isComplete = false;
          let lastProgress = 0;
          let progressCheckInterval = 5000; // Start with 5 second interval
          let stallCounter = 0;

          while (!isComplete) {
            // Check current time
            const currentTime = await this.page.$eval('video', video => video.currentTime);

            // If progress is being made, update last activity time
            if (currentTime > lastProgress) {
              this.state.lastActivityTime = new Date();
              lastProgress = currentTime;
              stallCounter = 0;

              // Adapt check interval based on progress
              if (currentTime / videoDuration > 0.8) {
                progressCheckInterval = 2000; // Check more frequently near the end
              }
            } else {
              stallCounter++;
            }

            // Calculate progress percentage
            const progress = Math.floor((currentTime / videoDuration) * 100);

            // Log progress every 10%
            if (progress % 10 === 0 && progress > 0 && progress > Math.floor((lastProgress / videoDuration) * 100)) {
              logger.debug(`Video progress: ${progress}%`);
            }

            // Check if video is complete or nearly complete (some videos end slightly before duration)
            if (currentTime >= videoDuration - 1 || progress >= 95) {
              isComplete = true;
            }

            // Check for inactivity
            if (stallCounter >= 3 && lastProgress > 0) { // 3 checks without progress
              const inactivityTime = stallCounter * (progressCheckInterval / 1000);
              logger.warn(`Video playback appears stalled (${inactivityTime.toFixed(0)}s of inactivity)`);

              // Try to resume playback
              try {
                await this.page.$eval('video', video => {
                  if (video.paused) video.play();
                  // Try to skip ahead slightly if stuck
                  if (video.currentTime === lastProgress) {
                    video.currentTime += 1.0;
                  }
                });
                logger.info('Attempted to resume video playback');
              } catch (e) {
                logger.error('Failed to resume video playback', e);
              }
            }

            // Check for next button appearance during playback
            const nextButtonAppeared = await this.page.$('.btn-next, .btn-continue, .next-button, button:has-text("Next")');
            if (nextButtonAppeared) {
              logger.info('Next button appeared during video playback');
              isComplete = true;
            }

            // Wait before checking again
            await sleep(progressCheckInterval);
          }

          const watchTime = (Date.now() - startTime) / 1000;
          logger.info(`Video completed after ${formatTime(watchTime)}`);
          this.state.videosWatched++;

          // Try to click next button after completion
          try {
            const nextButtonSelectors = [
              '.btn-next',
              '.btn-continue',
              '.next-button',
              'button:has-text("Next")',
              'button:has-text("Continue")'
            ];

            for (const selector of nextButtonSelectors) {
              const isButtonVisible = await this.page.isVisible(selector);
              if (isButtonVisible) {
                await this.page.click(selector);
                logger.info(`Clicked ${selector} after video completion`);
                break;
              }
            }
          } catch (e) {
            logger.debug('Error clicking next button after completion', e);
          }

          return true;
        }
      } catch (e) {
        logger.warn('Could not monitor video progress, using adaptive wait time', e);

        // Adaptive wait time if we can't determine the video length
        logger.info('Using adaptive wait time with periodic checks for completion indicators');

        // Start with a minimum wait time
        const minWaitTime = 60000; // 1 minute minimum
        const maxWaitTime = 300000; // 5 minutes maximum
        let elapsedTime = 0;
        const checkInterval = 15000; // Check every 15 seconds

        while (elapsedTime < maxWaitTime) {
          await sleep(checkInterval);
          elapsedTime += checkInterval;

          // Check for completion indicators
          const completionIndicators = [
            '.video-completed',
            '.video-complete',
            '.completion-indicator',
            '.btn-next',
            '.btn-continue',
            '.next-button',
            'button:has-text("Next")',
            'button:has-text("Continue")'
          ];

          for (const indicator of completionIndicators) {
            const isVisible = await this.page.isVisible(indicator);
            if (isVisible) {
              logger.info(`Video completion indicator found: ${indicator}`);
              
              // If it's a button, click it
              if (indicator.includes('btn') || indicator.includes('button')) {
                await this.page.click(indicator);
                logger.info(`Clicked ${indicator} after waiting ${elapsedTime / 1000} seconds`);
              }
              
              this.state.videosWatched++;
              this.state.lastActivityTime = new Date();
              return true;
            }
          }

          // Log progress
          if (elapsedTime >= minWaitTime) {
            logger.debug(`Still waiting for video completion (${elapsedTime / 1000}s elapsed)`);
          }
        }

        logger.info(`Waited maximum time (${maxWaitTime / 1000}s) for video completion`);
        this.state.videosWatched++;
        this.state.lastActivityTime = new Date();
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error handling video', error);
      this.state.errors.push(error as Error);
      return false;
    }
  }

  /**
   * Handle questions on the current page
   * @returns Promise resolving to true if questions were found and handled
   */
  async handleQuestions(): Promise<boolean> {
    logger.info('Checking for questions...');
    
    try {
      // Check if there are questions on the page
      const hasQuestions = await this.page.$$eval('.question, input[type="radio"], input[type="checkbox"]', 
        elements => elements.length > 0);
      
      if (!hasQuestions) {
        logger.info('No questions found on this page');
        return false;
      }
      
      logger.info('Questions detected. Processing...');
      
      // Get all question text
      const questions = await this.page.$$eval('.question, .question-text', 
        elements => elements.map(el => el.textContent?.trim()));
      
      logger.info(`Found ${questions.length} questions`);
      
      // For each question, generate an AI response
      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        if (!question) continue;
        
        logger.info(`Processing question ${i+1}: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);
        
        // Generate AI response using LangChain
        const aiResponse = await answerQuestion(question, this.courseContent);
        logger.debug(`AI Response: ${aiResponse}`);
        
        // Find and select the correct answer based on AI response
        // For radio buttons (single choice)
        const radioButtons = await this.page.$$('input[type="radio"]');
        if (radioButtons.length > 0) {
          // Get all label text for radio buttons
          const options = await this.page.$$eval('input[type="radio"] + label, label:has(input[type="radio"])', 
            elements => elements.map(el => el.textContent?.trim()));
          
          // Find the best match between AI response and available options
          let bestMatchIndex = 0;
          let bestMatchScore = 0;
          
          for (let j = 0; j < options.length; j++) {
            const option = options[j] || "";
            const score = this.calculateSimilarity(aiResponse, option);
            
            if (score > bestMatchScore) {
              bestMatchScore = score;
              bestMatchIndex = j;
            }
          }
          
          // Select the best matching option
          await radioButtons[bestMatchIndex].click();
          logger.info(`Selected option: ${options[bestMatchIndex]}`);
        }
        
        // For checkboxes (multiple choice)
        const checkboxes = await this.page.$$('input[type="checkbox"]');
        if (checkboxes.length > 0) {
          // Get all label text for checkboxes
          const options = await this.page.$$eval('input[type="checkbox"] + label, label:has(input[type="checkbox"])', 
            elements => elements.map(el => el.textContent?.trim()));
          
          // For each option, check if it's likely to be correct based on AI response
          for (let j = 0; j < options.length; j++) {
            const option = options[j] || "";
            const score = this.calculateSimilarity(aiResponse, option);
            
            // If similarity score is above threshold, select this option
            if (score > 0.3) { // Threshold can be adjusted
              await checkboxes[j].click();
              logger.info(`Selected checkbox option: ${option}`);
            }
          }
        }
        
        // For text input questions
        const textInputs = await this.page.$$('input[type="text"], textarea');
        if (textInputs.length > 0) {
          await textInputs[0].fill(aiResponse);
          logger.info('Filled text input with AI response');
        }
        
        this.state.questionsAnswered++;
        this.state.lastActivityTime = new Date();
        
        // Add a small delay between questions to simulate human behavior
        await sleep(randomDelay(1000, 2000));
      }
      
      // Submit the answers
      const submitButton = await this.page.$('.submit-button, #submit, button[type="submit"]');
      if (submitButton) {
        await submitButton.click();
        logger.info('Submitted answers');
        await this.page.waitForTimeout(2000); // Wait for submission to process
      }
      
      return true;
    } catch (error) {
      logger.error('Error handling questions', error);
      this.state.errors.push(error as Error);
      return false;
    }
  }

  /**
   * Navigate to the next section
   * @returns Promise resolving to true if navigation was successful
   */
  async goToNextSection(): Promise<boolean> {
    // If we're on the final exam page, don't try to navigate to the next section
    logger.info('Attempting to navigate to next section...');
    
    try {
      // Look for next buttons with various selectors
      const nextButtonSelectors = [
        '#nextPager', 
        '.next-button', 
        '.continue-button', 
        'button:has-text("Next")', 
        'a:has-text("Next")'
      ];
      
      for (const selector of nextButtonSelectors) {
        const hasNextButton = await this.page.$(selector) !== null;
        
        if (hasNextButton) {
          logger.info(`Found next button with selector: ${selector}`);
          // Try to click the anchor inside the nextPager div or the element itself
          try {
            await this.page.click(`${selector} a`);
          } catch (e) {
            // If clicking the anchor fails, try clicking the element directly
            await this.page.click(selector);
          }
          
          // Wait for navigation
          await this.page.waitForTimeout(2000);
          
          // Update session state
          this.state.currentSection++;
          this.state.lastActivityTime = new Date();
          
          return true;
        }
      }
      
      // Check for course completion indicators
      const completionIndicators = [
        '.course-complete', 
        '.completion-message', 
        'text=Course Complete', 
        'text=Congratulations'
      ];
      
      for (const indicator of completionIndicators) {
        const hasCompletionIndicator = await this.page.$(indicator) !== null;
        
        if (hasCompletionIndicator) {
          logger.info(`Found course completion indicator: ${indicator}`);
          this.state.isComplete = true;
          return false;
        }
      }
      
      logger.warn('No next button or completion indicator found');
      return false;
    } catch (error) {
      logger.error('Error navigating to next section', error);
      this.state.errors.push(error as Error);
      return false;
    }
  }

  /**
   * Extract course content from the current page
   * @returns Promise resolving to the extracted content
   */
  async extractCourseContent(): Promise<string> {
    logger.info('Extracting course content...');
    
    try {
      // Get text from the course content area
      const contentSelector = '#lesson-content, .course-content, .content-area';
      await this.page.waitForSelector(contentSelector, { timeout: this.timeoutMs });
      
      const courseText = await this.page.locator(contentSelector).innerText();
      
      logger.info(`Extracted ${courseText.length} characters of content`);
      this.updateCourseContent(courseText);
      
      return courseText;
    } catch (error) {
      logger.error('Error extracting course content', error);
      this.state.errors.push(error as Error);
      return '';
    }
  }

  /**
   * Handle a timeout or error by implementing recovery mechanisms
   * @param error Error that occurred
   * @returns Promise resolving to true if recovery was successful
   */
  async handleError(error: Error): Promise<boolean> {
    logger.error('Handling error', error);
    this.state.errors.push(error);
    
    // Check if page is still responsive
    try {
      await this.page.evaluate(() => document.title);
    } catch (e) {
      logger.error('Page is not responsive, attempting to reload');
      await this.page.reload();
      await this.page.waitForLoadState('networkidle');
      return true;
    }
    
    // Check for session timeout
    const timeoutIndicators = [
      'text=session has expired', 
      'text=session timeout', 
      'text=login again',
      'input[type="password"]'
    ];
    
    for (const indicator of timeoutIndicators) {
      const hasTimeoutIndicator = await this.page.$(indicator) !== null;
      
      if (hasTimeoutIndicator) {
        logger.warn('Session timeout detected, need to log in again');
        return false; // Signal that we need to log in again
      }
    }
    
    // Try clicking any dialog close buttons or overlays
    const dialogCloseSelectors = [
      '.dialog-close', 
      '.close-button', 
      '.modal-close', 
      'button:has-text("Close")',
      'button:has-text("OK")',
      'button:has-text("Continue")'
    ];
    
    for (const selector of dialogCloseSelectors) {
      const hasCloseButton = await this.page.$(selector) !== null;
      
      if (hasCloseButton) {
        logger.info(`Found dialog close button: ${selector}`);
        await this.page.click(selector);
        await this.page.waitForTimeout(1000);
        return true;
      }
    }
    
    // If all else fails, try refreshing the page
    logger.warn('No specific error recovery mechanism found, refreshing page');
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');
    
    return true;
  }

  /**
   * Check if a course review page is present and handle it
   * @returns Promise resolving to true if a review page was handled
   */
  private async handleCourseReview(): Promise<boolean> {
    try {
      // Check if this is a course review page
      const isReviewPage = await this.pageNavigator.isCourseReviewPage();
      
      if (isReviewPage) {
        logger.info('Course review page detected, handling...');
        return await this.pageNavigator.handleCourseReview();
      }
      
      return false;
    } catch (error) {
      logger.error('Error handling course review', error);
      return false;
    }
  }

  /**
   * Complete the course
   * @returns Promise resolving when the course is complete
   */
  async completeCourse(): Promise<void> {
    logger.info(`Starting completion process for course: ${this.state.courseName} (ID: ${this.state.courseId})`);
    
    // Check if we're starting with an agreement page
    try {
      const isAgreementPage = await this.pageNavigator.isAgreementPage();
      if (isAgreementPage) {
        logger.info('Course starts with an agreement page, handling it first');
        await this.pageNavigator.handleAgreementPage();
        await this.page.waitForTimeout(3000); // Wait for page to load after agreement
      }
    } catch (error) {
      logger.warn('Error checking for initial agreement page', error);
    }
    
    // If we have a workflow manager, start the assignment
    if (this.workflowManager) {
      await this.workflowManager.startAssignment(this.state.courseId, this.state.courseName);
      logger.info('Assignment started in workflow manager');
    }
    
    let hasNextSection = true;
    let retryCount = 0;
    
    // Add a small delay to ensure the page is fully loaded
    await sleep(randomDelay(1000, 2000));
    
    // Main course completion loop
    while (hasNextSection && !this.state.isComplete && retryCount < this.maxRetries) {
      try {
        logger.info(`Processing section ${this.state.currentSection + 1}...`);
        
        // Extract content for processing
        await this.extractCourseContent().catch(e => logger.warn('Could not extract course text', e));
        
        // Check if this is a lesson page that needs navigation
        const isLessonPage = await this.pageNavigator.isLessonPage();
        if (isLessonPage) {
          logger.info('Lesson page detected, handling navigation');
          const navigated = await this.pageNavigator.handleLessonPage();
          if (navigated) {
            logger.info('Successfully navigated lesson page');
            await this.page.waitForTimeout(2000);
            continue;
          }
        }
        
        // Check if this is an agreement page that needs handling
        const isAgreementPage = await this.pageNavigator.isAgreementPage();
        if (isAgreementPage) {
          logger.info('Agreement page detected during course progression, handling it');
          const handled = await this.pageNavigator.handleAgreementPage();
          if (handled) {
            logger.info('Successfully handled agreement page');
            await this.page.waitForTimeout(3000);
            continue;
          }
        }
        
        // Check if this is a course review page
        const reviewHandled = await this.handleCourseReview();
        if (reviewHandled) {
          logger.info('Course review handled, continuing...');
          continue;
        }
        
        // Check if we're on the final assignment page
        const isFinalPage = await this.pageNavigator.isFinalAssignmentPage();
        if (isFinalPage) {
          logger.info('Final assignment page detected');
          
          // Check if the allotted time has been completed
          const isTimeCompleted = await this.pageNavigator.isAllottedTimeCompleted();
          if (isTimeCompleted) {
            // Verify time requirement if we have a time tracker
            if (this.timeTracker) {
              const isTimeSufficient = await this.timeTracker.verifyTimeRequirement();
              this.state.timeRequirementMet = isTimeSufficient;
              
              if (!isTimeSufficient) {
                logger.warn('Time requirement not met, waiting before proceeding...');
                await sleep(30000); // Wait 30 seconds before checking again
                continue;
              }
            }
            
            logger.info('Allotted time completed, proceeding to exam');
            
            // Click the Next button to proceed to the exam agreement page
            await this.goToNextSection();
            await this.page.waitForTimeout(3000);
            
            // Check if we're on the exam agreement page
            const isAgreementPage = await this.pageNavigator.isExamAgreementPage();
            if (isAgreementPage) {
              logger.info('Exam agreement page detected');
              await this.pageNavigator.handleExamAgreement();
              await this.page.waitForTimeout(3000);
            }
          } else {
            logger.info('Allotted time not yet completed, waiting...');
            await sleep(30000); // Wait 30 seconds before checking again
            continue;
          }
        }
        
        // Check if we're on the final exam page
        const isExamPage = await this.pageNavigator.isExamPage();
        if (isExamPage) {
          logger.info('Final exam page detected');
          const examCompleted = await this.pageNavigator.answerExam();
          if (examCompleted) {
            logger.info('Exam completed successfully');
            this.state.examCompleted = true;
            this.state.timeRequirementMet = true;
            this.state.isComplete = true;
            break;
          } else {
            logger.warn('Failed to complete exam');
            retryCount++;
            continue;
          }
        }
        
        // Try to navigate the page using the PageNavigator for other page types
        try {
          const navigated = await this.pageNavigator.navigatePage();
          if (navigated) {
            logger.info('Page successfully navigated using PageNavigator');
            
            // If we just navigated from the final page to the exam agreement page,
            // we need to handle it immediately
            const isAgreementPage = await this.pageNavigator.isExamAgreementPage();
            if (isAgreementPage) {
              logger.info('Exam agreement page detected after navigation');
              await this.pageNavigator.handleExamAgreement();
              await this.page.waitForTimeout(3000);
              
              // After handling the agreement, check if we're on the exam page
              const isExamPage = await this.pageNavigator.isExamPage();
              if (isExamPage) {
                logger.info('Final exam page detected after agreement');
                const examCompleted = await this.pageNavigator.answerExam();
                if (examCompleted) {
                  logger.info('Exam completed successfully');
                  this.state.examCompleted = true;
                  this.state.timeRequirementMet = true;
                  this.state.isComplete = true;
                  break;
                }
              }
            }
          }
        } catch (e) {
          logger.warn('Error using PageNavigator, falling back to standard methods', e);
        }
        
        // Handle videos if present
        await this.handleVideo().catch(e => logger.warn('Error in video handling', e));
        
        // Handle questions if present
        await this.handleQuestions().catch(e => logger.warn('Error in question answering', e));
        
        // Try to go to next section
        hasNextSection = await this.goToNextSection().catch(e => {
          logger.error('Error navigating to next section', e);
          return false;
        });
        
        // Reset retry count on successful progression
        retryCount = 0;
        
        // If we couldn't find a next button and the course isn't marked complete, try to detect completion
        if (!hasNextSection && !this.state.isComplete) {
          // Look for completion indicators again
          const completionText = await this.page.innerText('body');
          if (completionText.includes('Complete') || completionText.includes('Congratulations')) {
            logger.info('Course completion detected based on page content');
            this.state.isComplete = true;
          }
        }
        
        // Wait for the next page to load
        await this.page.waitForTimeout(3000);
      } catch (error) {
        logger.error(`Error during course completion (attempt ${retryCount + 1}/${this.maxRetries})`, error);
        
        retryCount++;
        
        // Try to recover from the error
        const recovered = await this.handleError(error as Error);
        
        if (!recovered && retryCount >= this.maxRetries) {
          logger.error(`Failed to recover after ${this.maxRetries} attempts, aborting course completion`);
          break;
        }
        
        // Wait before retrying
        await sleep(5000);
      }
    }
    
    // Calculate completion time
    const completionTime = (new Date().getTime() - this.state.startTime.getTime()) / 1000;
    
    // Stop time tracking
    if (this.timeTracker) {
      this.timeTracker.stopTracking();
    }
    
    // Notify workflow manager of completion
    if (this.workflowManager) {
      const success = this.state.isComplete && this.state.timeRequirementMet;
      await this.workflowManager.completeAssignment(success);
      logger.info(`Notified workflow manager of assignment completion (success: ${success})`);
    }
    
    if (this.state.examCompleted) {
      logger.info('Course and final exam completed successfully!');
      this.state.isComplete = true;
    }
    
    if (this.state.isComplete) {
      logger.info(`Course completed successfully! Processed ${this.state.currentSection + 1} sections.`);
    } else if (retryCount >= this.maxRetries) {
      logger.warn(`Course completion aborted after ${this.maxRetries} failed attempts.`);
    } else {
      logger.info(`Course processing finished. Processed ${this.state.currentSection + 1} sections.`);
    }
    
    logger.info(`Total completion time: ${formatTime(completionTime)}`);
    
    // Check for course review page after completion
    try {
      logger.info('Checking for course review page after completion...');
      const reviewHandled = await this.handleCourseReview();
      if (reviewHandled) {
        logger.info('Post-completion course review handled');
      }
    } catch (e) {
      logger.warn('Error checking for post-completion course review', e);
    }
  }

  /**
   * Simple text similarity function
   * @param text1 First text
   * @param text2 Second text
   * @returns Similarity score between 0 and 1
   */
  private calculateSimilarity(text1: string, text2: string): number {
    const set1 = new Set(String(text1).toLowerCase().split(' '));
    const set2 = new Set(String(text2).toLowerCase().split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
}

export default SessionHandler;