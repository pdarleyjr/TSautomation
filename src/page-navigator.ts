import { Page } from 'playwright';
import { logger } from './logger';
import { answerQuestion, selectBestMultipleChoiceAnswer, answerExamQuestions } from './langchain-integration';
import { sleep, randomDelay } from './utils';
import DynamicSkyvernBridge from './dynamic-skyvern';

/**
 * Interface for quiz question data
 */
export interface QuizQuestion {
  questionText: string;
  options: string[];
  feedbackTexts: string[];
}

/**
 * Interface for exam question data
 */
export interface ExamQuestion {
  questionNumber: number;
  questionText: string;
  options: string[];
}

/**
 * Page type enum for different types of pages in Target Solutions LMS
 */
export enum PageType {
  QUIZ = 'quiz',
  FINAL_ASSIGNMENT = 'final_assignment',
  LESSON_PAGE = 'lesson_page',
  AGREEMENT_PAGE = 'agreement_page',
  EXAM_AGREEMENT = 'exam_agreement',
  EXAM = 'exam',
  COURSE_REVIEW = 'course_review',
  UNKNOWN = 'unknown'
}

/**
 * Page Navigator class for handling different types of pages in Target Solutions LMS
 * Particularly focused on quiz/knowledge check pages
 */
export class PageNavigator {
  private page: Page;
  private courseContent: string;
  private skyvernBridge: DynamicSkyvernBridge;
  private failedAttempts: Map<string, number> = new Map();
  private lastDetectedPageType: PageType = PageType.UNKNOWN;

  /**
   * Create a new page navigator
   * @param page Playwright page object
   * @param courseContent Course content for context (used for answering questions)
   */
  constructor(page: Page, courseContent: string = '') {
    this.page = page;
    this.courseContent = courseContent;
    this.skyvernBridge = new DynamicSkyvernBridge(page);
  }

  /**
   * Update the course content
   * @param content New course content
   */
  updateCourseContent(content: string): void {
    this.courseContent = content;
    logger.debug(`Updated page navigator course content (${content.length} characters)`);
    this.skyvernBridge.updateCourseContent(content);
  }

  /**
   * Get the last detected page type
   * @returns Last detected page type
   */
  public getLastDetectedPageType(): PageType {
    return this.lastDetectedPageType;
  }

  /**
   * Check if we should use Skyvern for a specific operation
   * @param operation The operation to check
   * @returns True if Skyvern should be used
   */
  private shouldUseSkyvern(operation: string): boolean {
    // Get the number of failed attempts for this operation
    const attempts = this.failedAttempts.get(operation) || 0;
    
    // Use Skyvern if we've failed multiple times
    if (attempts >= 2) {
      logger.info(`Using Skyvern for ${operation} after ${attempts} failed attempts`);
      return true;
    }
    return false;
  }

  // Page type detection methods

  /**
   * Detect if the current page is a regular lesson page
   * @returns Promise resolving to true if the page is a lesson page
   */
  async isLessonPage(): Promise<boolean> {
    try {
      // Check for common lesson page indicators
      const lessonPageIndicators = [
        // Check for the wrapper div
        '#ts-wrapper',
        // Check for navigation elements
        '#nextPager',
        '#prevPager',
        // Check for the sidebar menu
        '.ts-sidebar',
        // Check for the course title
        '.course-title',
        // Check for the page counter
        '.page-counter'
      ];

      for (const indicator of lessonPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Lesson page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.LESSON_PAGE;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting lesson page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is a course agreement page
   * @returns Promise resolving to true if the page is an agreement page
   */
  async isAgreementPage(): Promise<boolean> {
    try {
      // Check for indicators of an agreement page
      const agreementPageIndicators = [
        // Check for agreement form
        '#agreementForm',
        // Check for agreement buttons
        '#agree',
        'input[value="I Agree"]',
        'button:has-text("I Agree")',
        // Check for agreement title
        'h1:has-text("User Agreement")',
        'h1:has-text("Agreement")'
      ];

      for (const indicator of agreementPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Agreement page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.AGREEMENT_PAGE;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting agreement page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is a quiz page
   * @returns Promise resolving to true if the page is a quiz page
   */
  async isQuizPage(): Promise<boolean> {
    try {
      // Check for common quiz page indicators
      const quizIndicators = [
        // Check for "Knowledge Check" heading
        'h1:has-text("Knowledge Check")',
        // Check for quiz panel
        '.panel-heading:has(h5)',
        // Check for answer choices
        '.list-group-item[data-toggle="modal"]',
        // Check for feedback modals
        '#correctModal, #incorrectModal'
      ];

      for (const indicator of quizIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Quiz page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.QUIZ;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting quiz page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is the final assignment page
   * @returns Promise resolving to true if the page is the final assignment page
   */
  async isFinalAssignmentPage(): Promise<boolean> {
    try {
      // Check for indicators of the final assignment page
      const finalPageIndicators = [
        // Check for "Summary" heading
        'h1:has-text("Summary")',
        // Check for page counter showing last page
        '.page-counter:has-text("35/35")',
        // Check for references section
        '.references-modal',
        // Check for specific content that appears on the final page
        'text=References'
      ];

      for (const indicator of finalPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Final assignment page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.FINAL_ASSIGNMENT;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting final assignment page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is the exam agreement page
   * @returns Promise resolving to true if the page is the exam agreement page
   */
  async isExamAgreementPage(): Promise<boolean> {
    try {
      // Check for indicators of the exam agreement page
      const agreementPageIndicators = [
        // Check for "Exam Agreement" heading
        '.header:has-text("Exam Agreement")',
        // Check for agreement checkbox
        '#iAgree',
        // Check for continue button
        '#saveBtn'
      ];

      for (const indicator of agreementPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Exam agreement page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.EXAM_AGREEMENT;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting exam agreement page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is the final exam page
   * @returns Promise resolving to true if the page is the final exam page
   */
  async isExamPage(): Promise<boolean> {
    try {
      // Check for indicators of the final exam page
      const examPageIndicators = [
        // Check for "EXAMINATION" heading
        'h1.header:has-text("EXAMINATION")',
        // Check for exam form
        'form[name="DataForm"]',
        // Check for exam questions
        '.examQuestion',
        // Check for submit button
        '#TestSubmit'
      ];

      for (const indicator of examPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Final exam page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.EXAM;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting final exam page', error);
      return false;
    }
  }

  /**
   * Detect if the current page is a course review page
   * @returns Promise resolving to true if the page is a course review page
   */
  async isCourseReviewPage(): Promise<boolean> {
    try {
      // Check for indicators of a course review page
      const reviewPageIndicators = [
        'h1:has-text("Course Review")',
        'h1:has-text("Course Evaluation")',
        'form.review-form',
        'form.evaluation-form',
        '.course-review',
        '.course-evaluation',
        'button:has-text("Submit Review")',
        'button:has-text("Skip Review")',
        // Additional indicators for different review page formats
        'text=Please rate your experience',
        'text=How would you rate this course',
        '.rating-stars',
        '.course-feedback'
      ];

      for (const indicator of reviewPageIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Course review page detected (matched indicator: ${indicator})`);
          this.lastDetectedPageType = PageType.COURSE_REVIEW;
          return true;
        }
      }

      return false;
    } catch (error) {
      logger.error('Error detecting course review page', error);
      return false;
    }
  }

  // Data extraction methods

  /**
   * Extract quiz question and options from the page
   * @returns Promise resolving to quiz question data
   */
  async extractQuizData(): Promise<QuizQuestion | null> {
    try {
      logger.info('Extracting quiz data...');

      // Extract question text from panel heading
      const questionText = await this.page.$eval('.panel-heading h5', 
        (el) => el.textContent?.trim() || '');
      
      if (!questionText) {
        logger.warn('Could not extract question text');
        return null;
      }

      logger.info(`Question: ${questionText}`);

      // Extract options and their feedback texts
      const options: string[] = [];
      const feedbackTexts: string[] = [];

      // Get all option buttons
      const optionElements = await this.page.$$('.list-group-item[data-toggle="modal"]');
      
      for (const optionEl of optionElements) {
        // Get option text (including the letter choice)
        const optionText = await optionEl.innerText();
        options.push(optionText);

        // Get feedback text from data-feedback attribute
        const feedback = await optionEl.getAttribute('data-feedback') || '';
        feedbackTexts.push(feedback);
      }

      logger.info(`Found ${options.length} options`);

      return {
        questionText,
        options,
        feedbackTexts
      };
    } catch (error) {
      logger.error('Error extracting quiz data', error);
      return null;
    }
  }

  /**
   * Determine the correct answer for a quiz
   * @param quizData Quiz question data
   * @returns Promise resolving to the index of the correct answer
   */
  async determineCorrectAnswer(quizData: QuizQuestion): Promise<number> {
    try {
      logger.info('Determining correct answer...');

      // Method 1: Check if any option triggers the correctModal
      // This is the most reliable method if we can detect it from the HTML
      const correctOptionIndex = await this.findCorrectOptionFromHTML(quizData);
      if (correctOptionIndex !== -1) {
        logger.info(`Determined correct answer from HTML: Option ${correctOptionIndex + 1}`);
        return correctOptionIndex;
      }

      // Method 2: Use AI to select the best answer based on course content
      if (this.courseContent) {
        logger.info('Using AI to determine the best answer based on course content');
        
        // Extract just the text part of each option (remove the letter prefix)
        const cleanOptions = quizData.options.map(opt => {
          // Remove the letter choice prefix (e.g., "A) " or "B) ")
          return opt.replace(/^[A-Z]\)\s+/, '');
        });
        
        const bestAnswerIndex = await selectBestMultipleChoiceAnswer(
          quizData.questionText,
          cleanOptions,
          this.courseContent
        );
        
        logger.info(`AI selected Option ${bestAnswerIndex + 1} as the best answer`);
        return bestAnswerIndex;
      }

      // Method 3: Fallback - check feedback texts for clues
      logger.info('Checking feedback texts for clues about the correct answer');
      for (let i = 0; i < quizData.feedbackTexts.length; i++) {
        const feedback = quizData.feedbackTexts[i].toLowerCase();
        // Look for positive indicators in feedback
        if (feedback.includes('correct') || 
            feedback.includes('right') || 
            feedback.includes('yes') || 
            feedback.includes('good job')) {
          logger.info(`Feedback suggests Option ${i + 1} is correct`);
          return i;
        }
      }

      // If all else fails, return the first option
      logger.warn('Could not determine correct answer, defaulting to first option');
      return 0;
    } catch (error) {
      logger.error('Error determining correct answer', error);
      return 0; // Default to first option
    }
  }

  /**
   * Find the correct option by examining the HTML structure
   * @param quizData Quiz question data
   * @returns Index of the correct option, or -1 if not found
   */
  private async findCorrectOptionFromHTML(quizData: QuizQuestion): Promise<number> {
    try {
      // Check each option to see which one triggers the correctModal
      const optionElements = await this.page.$$('.list-group-item[data-toggle="modal"]');
      
      for (let i = 0; i < optionElements.length; i++) {
        const targetModal = await optionElements[i].getAttribute('data-target');
        if (targetModal === '#correctModal') {
          return i;
        }
      }

      return -1; // Not found
    } catch (error) {
      logger.error('Error finding correct option from HTML', error);
      return -1;
    }
  }

  // Page handling methods

  /**
   * Handle a regular lesson page
   * @returns Promise resolving to true if the lesson page was successfully handled
   */
  async handleLessonPage(): Promise<boolean> {
    try {
      logger.info('Handling lesson page...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'handleLessonPage';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle lesson page after multiple failures');
        return await this.skyvernBridge.handleNavigation();
      }

      // Check if there's a video on the page
      const hasVideo = await this.page.$$eval('#mediaspace, video, iframe[src*="vimeo"], iframe[src*="youtube"]', 
        elements => elements.length > 0);

      if (hasVideo) {
        logger.info('Video detected on lesson page');
        
        // Check if there's a video completion modal
        const hasVideoModal = await this.page.$('#dialog_next_slide') !== null;
        
        if (hasVideoModal) {
          logger.info('Video completion modal detected, clicking next button');
          await this.page.click('#dialog_next_slide .btn-primary, .next-button, .continue-button');
          await this.page.waitForTimeout(2000);
          return true;
        }
        
        // If no modal, wait for a short time to simulate watching part of the video
        logger.info('No video completion modal detected, waiting briefly...');
        await this.page.waitForTimeout(5000);
      }

      // Look for next button and click it
      const nextButtonSelectors = [
        '#nextPager a', 
        '#nextA',
        '.navLink:has-text("Next")', 
        'a:has-text("Next")'
      ];
      
      for (const selector of nextButtonSelectors) {
        const hasNextButton = await this.page.$(selector) !== null;
        
        if (hasNextButton) {
          logger.info(`Found next button with selector: ${selector}`);
          await this.page.click(selector);
          await this.page.waitForTimeout(2000);
          return true;
        }
      }

      // Increment failed attempts for this operation
      const attempts = (this.failedAttempts.get(operation) || 0) + 1;
      this.failedAttempts.set(operation, attempts);
      logger.warn(`No next button found on lesson page (attempt ${attempts})`);
      return false;
    } catch (error) {
      logger.error('Error handling lesson page', error);
      return false;
    }
  }

  /**
   * Handle a course agreement page
   * @returns Promise resolving to true if the agreement page was successfully handled
   */
  async handleAgreementPage(): Promise<boolean> {
    try {
      logger.info('Handling course agreement page...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'handleAgreementPage';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle agreement page after multiple failures');
        return await this.skyvernBridge.handleNavigation();
      }

      // Look for the "I Agree" button
      const agreeButtonSelectors = [
        '#agree',
        'input[value="I Agree"]',
        'button:has-text("I Agree")'
      ];

      for (const selector of agreeButtonSelectors) {
        const hasAgreeButton = await this.page.$(selector) !== null;
        
        if (hasAgreeButton) {
          logger.info(`Found "I Agree" button with selector: ${selector}`);
          await this.page.click(selector);
          await this.page.waitForTimeout(3000); // Wait longer for page load after agreement
          return true;
        }
      }

      // If no button found, try to submit the form directly
      const hasAgreementForm = await this.page.$('#agreementForm') !== null;
      if (hasAgreementForm) {
        logger.info('Found agreement form, attempting to submit it');
        await this.page.evaluate(() => {
          const form = document.getElementById('agreementForm') as HTMLFormElement;
          if (form) form.submit();
        });
        await this.page.waitForTimeout(3000);
        return true;
      }

      // Increment failed attempts for this operation
      const attempts = (this.failedAttempts.get(operation) || 0) + 1;
      this.failedAttempts.set(operation, attempts);
      logger.warn(`No agreement button or form found (attempt ${attempts})`);
      return false;
    } catch (error) {
      logger.error('Error handling agreement page', error);
      return false;
    }
  }

  /**
   * Answer a quiz question
   * @returns Promise resolving to true if the quiz was successfully answered
   */
  async answerQuiz(): Promise<boolean> {
    try {
      logger.info('Attempting to answer quiz...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'answerQuiz';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle quiz after multiple failures');
        return await this.skyvernBridge.handleQuiz();
      }

      // Extract quiz data
      const quizData = await this.extractQuizData();
      if (!quizData) {
        logger.warn('Could not extract quiz data');
        return false;
      }

      // Determine the correct answer
      const correctAnswerIndex = await this.determineCorrectAnswer(quizData);
      
      // Get all option buttons
      const optionElements = await this.page.$$('.list-group-item[data-toggle="modal"]');
      
      if (correctAnswerIndex >= 0 && correctAnswerIndex < optionElements.length) {
        // Click the selected option
        logger.info(`Clicking option ${correctAnswerIndex + 1}`);
        await optionElements[correctAnswerIndex].click();
        
        // Wait for modal to appear
        await this.page.waitForSelector('.modal-dialog', { timeout: 5000 });
        
        // Check if we got it right
        const isCorrect = await this.page.$('#correctModal') !== null;
        
        if (isCorrect) {
          logger.info('Answer was correct!');
          
          // Click the Continue button in the correct modal
          await this.page.click('#correctModal .btn-success');
          
          // Wait for navigation
          await this.page.waitForTimeout(2000);
          return true;
        } else {
          logger.warn('Answer was incorrect, trying again');
          
          // Click the Try Again button
          await this.page.click('#incorrectModal .btn-danger');
          
          // Wait a moment and try again with the next best option
          await this.page.waitForTimeout(1000);
          
          // Try the next option (circular if we reach the end)
          const nextOptionIndex = (correctAnswerIndex + 1) % optionElements.length;
          logger.info(`Trying next option: ${nextOptionIndex + 1}`);
          
          // Refresh option elements as the DOM might have changed
          const refreshedOptions = await this.page.$$('.list-group-item[data-toggle="modal"]');
          await refreshedOptions[nextOptionIndex].click();
          
          // Wait for modal again
          await this.page.waitForSelector('.modal-dialog', { timeout: 5000 });
          
          // Check if we got it right this time
          const isCorrectNow = await this.page.$('#correctModal') !== null;
          
          if (isCorrectNow) {
            logger.info('Second attempt was correct!');
            await this.page.click('#correctModal .btn-success');
            await this.page.waitForTimeout(2000);
            return true;
          } else {
            // Keep trying all options if needed
            logger.warn('Second attempt was also incorrect');
            await this.page.click('#incorrectModal .btn-danger');
            
            // Try remaining options systematically
            for (let i = 0; i < optionElements.length; i++) {
              // Skip the options we've already tried
              if (i !== correctAnswerIndex && i !== nextOptionIndex) {
                await this.page.waitForTimeout(1000);
                logger.info(`Trying option ${i + 1}`);
                
                const finalOptions = await this.page.$$('.list-group-item[data-toggle="modal"]');
                await finalOptions[i].click();
                
                await this.page.waitForSelector('.modal-dialog', { timeout: 5000 });
                const finalCorrect = await this.page.$('#correctModal') !== null;
                
                if (finalCorrect) {
                  logger.info(`Found correct answer: Option ${i + 1}`);
                  await this.page.click('#correctModal .btn-success');
                  await this.page.waitForTimeout(2000);
                  return true;
                } else {
                  await this.page.click('#incorrectModal .btn-danger');
                }
              }
            }
            
            // Increment failed attempts for this operation
            const attempts = (this.failedAttempts.get(operation) || 0) + 1;
            this.failedAttempts.set(operation, attempts);
            logger.error(`Could not find correct answer after trying all options (attempt ${attempts})`);
            return false;
          }
        }
      } else {
        logger.error('Invalid answer index');
        return false;
      }
    } catch (error) {
      logger.error('Error answering quiz', error);
      return false;
    }
  }

  /**
   * Handle the exam agreement page by checking the agreement checkbox and clicking continue
   * @returns Promise resolving to true if the agreement was successfully handled
   */
  async handleExamAgreement(): Promise<boolean> {
    try {
      logger.info('Handling exam agreement page...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'handleExamAgreement';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle exam agreement after multiple failures');
        return await this.skyvernBridge.handleExamAgreement();
      }

      // Check if the agreement checkbox exists
      const agreementCheckbox = await this.page.$('#iAgree');
      if (!agreementCheckbox) {
        logger.warn('Could not find agreement checkbox');
        return false;
      }

      // Check the agreement checkbox
      await agreementCheckbox.check();
      logger.info('Checked "I understand and agree" checkbox');

      // Wait a moment to simulate human behavior
      await this.page.waitForTimeout(1000);

      // Click the continue button
      const continueButton = await this.page.$('#saveBtn');
      if (!continueButton) {
        // Increment failed attempts for this operation
        const attempts = (this.failedAttempts.get(operation) || 0) + 1;
        this.failedAttempts.set(operation, attempts);
        logger.warn(`Could not find continue button (attempt ${attempts})`);
        return false;
      }

      await continueButton.click();
      logger.info('Clicked continue button');

      // Wait for navigation to the exam page
      await this.page.waitForTimeout(3000);
      return true;
    } catch (error) {
      logger.error('Error handling exam agreement', error);
      return false;
    }
  }

  /**
   * Handle a course review page by skipping it or submitting default values
   * @returns Promise resolving to true if the review was successfully handled
   */
  async handleCourseReview(): Promise<boolean> {
    try {
      logger.info('Handling course review page...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'handleCourseReview';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle course review after multiple failures');
        return await this.skyvernBridge.handleNavigation();
      }

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

      // Increment failed attempts for this operation
      const attempts = (this.failedAttempts.get(operation) || 0) + 1;
      this.failedAttempts.set(operation, attempts);
      logger.warn(`Could not find skip or submit buttons on review page (attempt ${attempts})`);
      return false;
    } catch (error) {
      logger.error('Error handling course review', error);
      return false;
    }
  }

  /**
   * Extract exam questions and options from the page
   * @returns Promise resolving to an array of exam questions
   */
  async extractExamQuestions(): Promise<ExamQuestion[]> {
    try {
      logger.info('Extracting exam questions...');

      // Get all question elements
      const questionElements = await this.page.$$('.examQuestion');
      if (questionElements.length === 0) {
        logger.warn('No exam questions found');
        return [];
      }

      logger.info(`Found ${questionElements.length} exam questions`);
      const examQuestions: ExamQuestion[] = [];

      // Process each question
      for (let i = 0; i < questionElements.length; i++) {
        // Get question text
        const questionText = await questionElements[i].innerText();
        
        // Get question number from the text (usually starts with a number followed by a period)
        const questionNumberMatch = questionText.match(/^(\d+)\./);
        const questionNumber = questionNumberMatch ? parseInt(questionNumberMatch[1]) : i + 1;

        // Get options for this question
        // The options are in the next element after the question
        const optionsContainers = await this.page.$$('.examOptions');
        const optionsContainer = optionsContainers[i];
        const options: string[] = [];

        // Get all option elements
        const optionElements = await optionsContainer.$$('li');
        for (const optionEl of optionElements) {
          const optionText = await optionEl.innerText();
          options.push(optionText);
        }

        examQuestions.push({
          questionNumber,
          questionText,
          options
        });

        logger.info(`Extracted question ${questionNumber} with ${options.length} options`);
      }

      return examQuestions;
    } catch (error) {
      logger.error('Error extracting exam questions', error);
      return [];
    }
  }

  /**
   * Answer the final exam using AI
   * @returns Promise resolving to true if the exam was successfully answered
   */
  async answerExam(): Promise<boolean> {
    try {
      logger.info('Attempting to answer final exam...');
      
      // Check if we should use Skyvern for this operation
      const operation = 'answerExam';
      if (this.shouldUseSkyvern(operation)) {
        logger.info('Using Skyvern to handle final exam');
        return await this.skyvernBridge.handleExam();
      }

      // Extract exam questions
      const examQuestions = await this.extractExamQuestions();
      if (examQuestions.length === 0) {
        logger.warn('No exam questions found');
        return false;
      }

      logger.info(`Processing ${examQuestions.length} exam questions`);

      // Process each question
      /*
      for (const question of examQuestions) {
        logger.info(`Processing question ${question.questionNumber}: ${question.questionText.substring(0, 100)}...`);

        // Extract just the text part of each option (remove the letter prefix)
        const cleanOptions = question.options.map(opt => {
          // Remove the letter choice prefix and any leading/trailing whitespace
          return opt.replace(/^[A-Z]\)\s+/, '').trim();
        });

        // Use AI to select the best answer
        const bestAnswerIndex = await selectBestMultipleChoiceAnswer(
          question.questionText,
          cleanOptions,
          this.courseContent
        );

        logger.info(`AI selected option ${bestAnswerIndex + 1} for question ${question.questionNumber}`);

        // Click the selected radio button
        const radioSelector = `input[name="q${question.questionNumber}"][value="${bestAnswerIndex + 1}"]`;
        await this.page.click(radioSelector);
        
        logger.info(`Selected option ${bestAnswerIndex + 1} for question ${question.questionNumber}`);

        // Add a small delay between questions to simulate human behavior
        await this.page.waitForTimeout(1000);
      }
      */
      
      // Use the specialized exam question answering function
      // First, format the questions for the answerExamQuestions function
      const formattedQuestions = examQuestions.map(q => {
        return {
          questionText: q.questionText,
          options: q.options.map(opt => opt.replace(/^[A-Z]\)\s+/, '').trim()) // Clean options
        };
      });
      
      // Get the best answers using AI
      logger.info('Using specialized AI to answer all exam questions at once');
      const bestAnswers = await answerExamQuestions(formattedQuestions, this.courseContent);
      
      // Select each answer
      for (let i = 0; i < examQuestions.length; i++) {
        const question = examQuestions[i];
        const answerIndex = bestAnswers[i];
        
        logger.info(`AI selected option ${answerIndex + 1} for question ${question.questionNumber}`);
        
        // Click the selected radio button
        try {
          const radioSelector = `input[name="q${question.questionNumber}"][value="${answerIndex + 1}"]`;
          await this.page.click(radioSelector);
          logger.info(`Selected option ${answerIndex + 1} for question ${question.questionNumber}`);
        } catch (error) {
          logger.error(`Error selecting option for question ${question.questionNumber}`, error);
        }
        await this.page.waitForTimeout(1000); // Small delay between selections
      }

      // Submit the exam
      logger.info('Submitting exam...');
      await this.page.click('#TestSubmit');

      // Wait for submission to process
      await this.page.waitForTimeout(5000);
      
      logger.info('Exam submitted successfully');
      return true;
    } catch (error) {
      logger.error('Error answering exam', error);
      return false;
    }
  }

  /**
   * Check if the allotted time has been completed
   * @returns Promise resolving to true if the allotted time has been completed
   */
  async isAllottedTimeCompleted(): Promise<boolean> {
    try {
      // Check for indicators that the allotted time has been completed
      // This could be a progress bar at 100%, a message indicating completion, etc.
      const timeCompletedIndicators = [
        // Check for 100% complete progress bar
        '.progress-bar[aria-valuenow="100"]',
        // Check for text indicating completion
        'text=100% Complete',
        // Check for specific elements that appear when time is completed
        '.course-progress:has-text("100%")'
      ];

      for (const indicator of timeCompletedIndicators) {
        const hasIndicator = await this.page.$(indicator) !== null;
        if (hasIndicator) {
          logger.info(`Allotted time completed (matched indicator: ${indicator})`);
          return true;
        }
      }

      // If no specific indicators are found, check if we're on the final page
      // and assume the time is completed if we are
      const isFinalPage = await this.isFinalAssignmentPage();
      if (isFinalPage) {
        logger.info('On final page, assuming allotted time is completed');
        return true;
      }

      return false;
    } catch (error) {
      logger.error('Error checking if allotted time is completed', error);
      return false;
    }
  }

  /**
   * Detect the current page type and navigate accordingly
   * This is the main entry point for page navigation
   * @returns Promise resolving to true if navigation was successful
   * @returns PageType indicating the detected page type
   */
  /**
   * Navigate the current page based on its type
   * @returns Promise resolving to true if navigation was successful
   */
  async navigatePage(): Promise<boolean> {
    try {
      logger.info('Navigating current page...');
      
      // Check if this is an agreement page (highest priority)
      this.lastDetectedPageType = PageType.UNKNOWN;
      const isCourseAgreementPage = await this.isAgreementPage();
      if (isCourseAgreementPage) {
        logger.info('Handling course agreement page');
        return await this.handleAgreementPage();
      }

      // Check if this is a regular lesson page
      const isLessonPage = await this.isLessonPage();
      if (isLessonPage) {
        logger.info('Handling regular lesson page');
        return await this.handleLessonPage();
      }

      // Check if this is the final assignment page
      const isFinalPage = await this.isFinalAssignmentPage();
      if (isFinalPage) {
        logger.info('Handling final assignment page');
        const isTimeCompleted = await this.isAllottedTimeCompleted();
        if (isTimeCompleted) {
          logger.info('Allotted time completed, proceeding to exam');
          return true;
        } else {
          logger.info('Allotted time not yet completed, waiting...');
          return false;
        }
      }

      // Check if this is the exam agreement page
      const isExamAgreePage = await this.isExamAgreementPage();
      if (isExamAgreePage) {
        logger.info('Handling exam agreement page');
        return await this.handleExamAgreement();
      }

      // Check if this is the final exam page
      const isExamPage = await this.isExamPage();
      if (isExamPage) {
        logger.info('Handling final exam page');
        return await this.answerExam();
      }

      // Check if this is a course review page
      const isReviewPage = await this.isCourseReviewPage();
      if (isReviewPage) {
        logger.info('Handling course review page');
        return await this.handleCourseReview();
      }

      // Check if this is a quiz page
      const isQuiz = await this.isQuizPage();
      
      if (isQuiz) {
        logger.info('Handling quiz page');
        return await this.answerQuiz();
      }
      
      // If not a quiz, we'll assume it's a regular page
      // This could be expanded to handle other page types
      this.lastDetectedPageType = PageType.UNKNOWN;
      
      // For unknown page types, use Skyvern after the first attempt
      const operation = 'navigateUnknownPage';
      const attempts = (this.failedAttempts.get(operation) || 0) + 1;
      this.failedAttempts.set(operation, attempts);
      
      logger.info(`Unknown page type (attempt ${attempts}), proceeding with standard navigation`);
      
      return true;
    } catch (error) {
      logger.error('Error navigating page', error);
      return false;
    }
  }
}

export default PageNavigator;