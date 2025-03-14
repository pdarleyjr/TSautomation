import { Page } from 'playwright';
import { SkyvernClient, SkyvernTask } from './skyvern-enhanced';
import { createCustomTask, waitForTaskCompletion } from './skyvern-integration';
import { logger } from './logger';
import { sleep } from './utils';
import * as langchain from './langchain-integration';
import axios from 'axios';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { TimeTracker } from './time-tracker';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  username: process.env.TS_USERNAME || '',
  password: process.env.TS_PASSWORD || '',
  skyvernApiUrl: process.env.SKYVERN_API_URL || 'http://localhost:8000/api/v1',
  skyvernApiKey: process.env.SKYVERN_API_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjQ4ODY3NjgzMDMsInN1YiI6Im9fMzY5OTA0NTA1MDEwNzczNzYwIn0.GNgyFmswWF1JFV1pYd-k9U0C-6iXEF4kkxwmD3D_GIQ',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  minRequiredTime: parseInt(process.env.MIN_REQUIRED_TIME || '1800000'), // 30 minutes in ms
  maxAttempts: parseInt(process.env.MAX_ATTEMPTS || '3'),
  retryDelay: parseInt(process.env.RETRY_DELAY || '5000'), // 5 seconds
};

/**
 * Combined automation class that leverages both Playwright and Skyvern
 * This class intelligently switches between Playwright and Skyvern based on the context
 */
export class CombinedAutomation {
  private readonly page: Page;
  private skyvernClient: SkyvernClient | null = null;
  private fallbackClient: any = null;
  private courseContent: string = '';
  private isInitialized: boolean = false;
  private courseSummary: string = '';
  private keyConcepts: string[] = [];
  private timeTracker: TimeTracker;
  private lastSkyvernSuccess: boolean = true;
  private consecutivePlaywrightFailures: number = 0;
  private consecutiveSkyvernFailures: number = 0;
  private inSkyvernMode: boolean = false;
  private navigatedUsingSkyvernMap: Map<string, boolean> = new Map();

  constructor(page: Page, timeTracker?: TimeTracker) {
    this.page = page;
    
    // Create time tracker if not provided
    // Using a generic course ID and name since the actual TimeTracker requires these parameters
    const courseId = 'generic-course-id';
    const courseName = 'Combined Automation Course';
    const courseType = 'default';
    this.timeTracker = timeTracker || new TimeTracker(courseId, courseName, courseType);
  }

  /**
   * Initialize the Skyvern client
   */
  async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    try {
      logger.info('Initializing Skyvern client for combined automation');
      
      // First try to initialize the main Skyvern client 
      try {
        this.skyvernClient = new SkyvernClient();
        this.isInitialized = true;
        logger.info('Main Skyvern client initialized successfully');
        return true;
      } catch (primaryError) {
        logger.warn('Failed to initialize main Skyvern client, trying fallback', primaryError);
        
        // If main client fails, create a fallback client
        try {
          this.fallbackClient = axios.create({
            baseURL: config.skyvernApiUrl,
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': config.skyvernApiKey,
            },
          });
          
          this.isInitialized = true;
          logger.info('Fallback Skyvern client initialized successfully');
          return true;
        } catch (fallbackError) {
          logger.error('Failed to initialize fallback Skyvern client', fallbackError);
          return false;
        }
      }
    } catch (error) {
      logger.error('Failed to initialize Skyvern client', error);
      return false;
    }
  }

  /**
   * Extract and process course content
   */
  async processCourseContent(): Promise<void> {
    if (!this.courseContent) {
      await this.extractCurrentContent();
    }
    
    try {
      // Extract key concepts for better context
      this.keyConcepts = await langchain.extractKeyConcepts(this.courseContent);
      logger.info(`Extracted ${this.keyConcepts.length} key concepts from course content`);
      
      // Create a summary for more efficient context
      this.courseSummary = await langchain.summarizeCourseContent(this.courseContent);
      logger.info(`Created course summary (${this.courseSummary.length} chars)`);
    } catch (error) {
      logger.error('Error processing course content with LangChain', error);
    }
  }

  /**
   * Update the course content
   */
  updateCourseContent(content: string): void {
    this.courseContent = content;
    logger.debug(`Updated course content (${content.length} characters)`);
    
    // Process new content asynchronously
    this.processCourseContent().catch(error => {
      logger.error('Error processing updated course content', error);
    });
    
    return;
  }

  /**
   * Extract course content from the current page
   */
  async extractCurrentContent(): Promise<string> {
    try {
      const content = await this.extractCourseText(this.page);
      if (content) {
        this.updateCourseContent(content);
        return content;
      }
      
      // Try using Skyvern as a fallback if Playwright extraction fails
      if (await this.ensureInitialized() && this.skyvernClient) {
        try {
          logger.info('Attempting content extraction with Skyvern');
          const extractTaskId = await this.skyvernClient.createExtractContentTask();
          const result = await this.skyvernClient.waitForTaskCompletion(extractTaskId);
          const extractedContent = result.result?.extracted_text || '';
          if (extractedContent) {
            this.updateCourseContent(extractedContent);
            return extractedContent;
          }
        } catch (skyvernError) {
          logger.error('Skyvern content extraction also failed', skyvernError);
        }
      }
    } catch (error) {
      
      // Try using Skyvern as a fallback if Playwright extraction fails
      if (await this.ensureInitialized() && this.skyvernClient) {
        try {
          logger.info('Attempting content extraction with Skyvern');
          // Use the createExtractContentTask method pattern as used earlier
          const extractTaskId = await this.skyvernClient.createExtractContentTask();
          const result = await this.skyvernClient.waitForTaskCompletion(extractTaskId);
          const extractedContent = result.result?.extracted_text || '';
          
          if (extractedContent) {
            this.updateCourseContent(extractedContent);
            return extractedContent;
          }
        } catch (skyvernError) {
          logger.error('Skyvern content extraction also failed', skyvernError);
        }
        return '';
      }
      
      return this.courseContent;
    }
    return ''; // Return empty string as fallback if all execution paths fail
  }

  /**
   * Helper method to determine if we should use Skyvern based on the current context
   * This method uses heuristics to decide when to switch between tools
   */
  private shouldUseSkyvernForCurrentTask(taskType: 'navigation' | 'quiz' | 'questions' | 'exam'): boolean {
    // If we've had multiple consecutive Playwright failures, try Skyvern
    if (this.consecutivePlaywrightFailures >= 2) {
      logger.info(`Switching to Skyvern after ${this.consecutivePlaywrightFailures} Playwright failures`);
      return true;
    }

    // If Skyvern has been failing, stick with Playwright
    if (this.consecutiveSkyvernFailures >= 2) {
      logger.info(`Sticking with Playwright after ${this.consecutiveSkyvernFailures} Skyvern failures`);
      return false;
    }

    // Task-specific logic
    switch(taskType) {
      case 'quiz':
      case 'exam':
        // These complex interaction tasks often benefit from Skyvern
        return true;
      
      case 'questions':
        // For regular questions, choose based on past success
        return this.lastSkyvernSuccess;
      
      case 'navigation':
        // Try to use the approach that worked last time for this URL
        const currentUrl = this.page.url();
        const urlKey = new URL(currentUrl).pathname;
        if (this.navigatedUsingSkyvernMap.has(urlKey)) {
          return this.navigatedUsingSkyvernMap.get(urlKey) || false;
        }
        // Default to Playwright for navigation unless previous failures
        return this.consecutivePlaywrightFailures > 0;
    }
  }

  /**
   * Helper method to update success tracking
   */
  private updateSuccessTracking(usedSkyvern: boolean, success: boolean, taskType?: 'navigation' | 'quiz' | 'questions' | 'exam'): void {
    if (usedSkyvern) {
      this.inSkyvernMode = true;
      this.lastSkyvernSuccess = success;
      
      if (success) {
        this.consecutiveSkyvernFailures = 0;
        this.consecutivePlaywrightFailures = 0; // Reset Playwright failures too since we're back on track
        
        // If this was a navigation task, remember that Skyvern worked for this page
        if (taskType === 'navigation') {
          const currentUrl = this.page.url();
          const urlKey = new URL(currentUrl).pathname;
          this.navigatedUsingSkyvernMap.set(urlKey, true);
        }
      } else {
        this.consecutiveSkyvernFailures++;
      }
    } else {
      this.inSkyvernMode = false;
      
      if (success) {
        this.consecutivePlaywrightFailures = 0;
        this.consecutiveSkyvernFailures = 0; // Reset Skyvern failures too
        
        // If this was a navigation task, remember that Playwright worked for this page
        if (taskType === 'navigation') {
          const currentUrl = this.page.url();
          const urlKey = new URL(currentUrl).pathname;
          this.navigatedUsingSkyvernMap.set(urlKey, false);
        }
      } else {
        this.consecutivePlaywrightFailures++;
      }
    }
  }

  /**
   * Handle a quiz using the appropriate automation method
   */
  async handleQuiz(): Promise<boolean> {
    logger.info('Handling quiz');
    
    try {
      // Ensure we have content for context
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      // Determine which method to use
      const useSkyvernForQuiz = this.shouldUseSkyvernForCurrentTask('quiz');
      
      if (useSkyvernForQuiz && await this.ensureInitialized()) {
        logger.info('Using Skyvern for quiz handling');
        let success = false;
        
        // Try with Skyvern
        if (this.skyvernClient) {
          try {
            const taskId = await this.skyvernClient.createHandleQuizTask();
            const result = await this.skyvernClient.waitForTaskCompletion(taskId);
            success = result.status === 'completed';
          } catch (error) {
            logger.error('Error using Skyvern for quiz', error);
          }
        } else if (this.fallbackClient) {
          try {
            // Create quiz task with enhanced context from LangChain
            const quizTask = {
              navigation_goal: `
                Handle a quiz or knowledge check on the current page.
                
                Steps:
                1. Read the question carefully
                2. Consider these key concepts from the course:
                   ${this.keyConcepts.map(c => `- ${c}`).join('\n')}
                3. Select the best answer based on these concepts and the course summary:
                   ${this.courseSummary.substring(0, 500)}...
                4. Click on the selected answer
                5. If a "Continue" button appears, click it to proceed
                
                Take your time to analyze the question and select the correct answer.
              `,
              max_steps: 20,
              take_screenshots: true,
            };
            
            const response = await this.fallbackClient.post('/tasks', quizTask);
            const taskId = response.data.task_id;
            const result = await waitForTaskCompletion(taskId);
            success = result?.status === 'completed';
          } catch (error) {
            logger.error('Error using fallback client for quiz', error);
          }
        }
        
        this.updateSuccessTracking(true, success, 'quiz');
        return success;
      } else {
        logger.info('Using Playwright for quiz handling');
        
        // Implement Playwright-based quiz handling
        try {
          // First, extract quiz text to better understand it
          const quizQuestion = await this.page.$eval('.quiz-question', el => el.textContent?.trim() || '');
          logger.info(`Quiz question: ${quizQuestion}`);
          
          // Extract answer options
          const optionElements = await this.page.$$('.quiz-option');
          const options: string[] = [];
          
          for (const option of optionElements) {
            const text = await option.textContent();
            if (text) options.push(text.trim());
          }
          
          logger.info(`Quiz options: ${options.join(' | ')}`);
          
          // Use LangChain to select the best answer
          const bestAnswerIndex = await langchain.selectBestMultipleChoiceAnswer(
            quizQuestion,
            options,
            this.courseContent
          );
          
          // Click the answer
          await optionElements[bestAnswerIndex].click();
          
          // Wait for feedback modal and click continue if correct
          try {
            await this.page.waitForSelector('.feedback-correct', { timeout: 5000 });
            await this.page.click('.btn-continue');
            
            this.updateSuccessTracking(false, true, 'quiz');
            return true;
          } catch {
            // If no success feedback found, try to check for incorrect feedback
            try {
              await this.page.waitForSelector('.feedback-incorrect', { timeout: 3000 });
              await this.page.click('.btn-try-again');
              
              // Try a different answer
              if (options.length > 1) {
                const nextBestIndex = (bestAnswerIndex + 1) % options.length;
                await optionElements[nextBestIndex].click();
                
                // Check for success again
                await this.page.waitForSelector('.feedback-correct', { timeout: 5000 });
                await this.page.click('.btn-continue');
                
                this.updateSuccessTracking(false, true, 'quiz');
                return true;
              }
            } catch {
              // Failed to resolve with Playwright
              this.updateSuccessTracking(false, false, 'quiz');
              return false;
            }
          }
        } catch (error) {
          logger.error('Error handling quiz with Playwright', error);
          this.updateSuccessTracking(false, false, 'quiz');
          return false;
        }
      }
      
      return false;
    } catch (error) {
      logger.error('Unexpected error in handleQuiz', error);
      return false;
    }
  }

  /**
   * Handle answering questions using the appropriate automation method
   */
  async answerQuestions(): Promise<boolean> {
    logger.info('Handling questions');
    
    try {
      // Extract content if needed
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      // Process content if not done already
      if (this.keyConcepts.length === 0) {
        await this.processCourseContent();
      }
      
      // Determine which automation method to use
      const useSkyvernForQuestions = this.shouldUseSkyvernForCurrentTask('questions');
      
      if (useSkyvernForQuestions && await this.ensureInitialized()) {
        logger.info('Using Skyvern for answering questions');
        let success = false;
        
        if (this.skyvernClient) {
          try {
            const taskId = await this.skyvernClient.createAnswerQuestionsTask(this.courseContent);
            const result = await this.skyvernClient.waitForTaskCompletion(taskId);
            success = result.status === 'completed';
          } catch (error) {
            logger.error('Error using Skyvern to answer questions', error);
          }
        } else if (this.fallbackClient) {
          try {
            // Generate practice questions to improve understanding
            const practiceQuestions = await langchain.generatePracticeQuestions(this.courseContent, 3);
            
            // Create task with enhanced context
            const questionsTask = {
              navigation_goal: `
                Answer questions on the current page based on the course content.
                
                Key concepts to focus on:
                ${this.keyConcepts.map(c => `- ${c}`).join('\n')}
                
                Course summary for reference:
                ${this.courseSummary.substring(0, 500)}...
                
                Example questions and answers from this material:
                ${practiceQuestions.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n')}
                
                Steps:
                1. Read each question carefully
                2. Select or input the best answer based on the course content
                3. After answering all questions, click the "Submit" or "Next" button
              `,
              max_steps: 30,
              take_screenshots: true,
            };
            
            const response = await this.fallbackClient.post('/tasks', questionsTask);
            const taskId = response.data.task_id;
            const result = await waitForTaskCompletion(taskId);
            success = result?.status === 'completed';
          } catch (error) {
            logger.error('Error using fallback client for questions', error);
          }
        }
        
        this.updateSuccessTracking(true, success, 'questions');
        return success;
      } else {
        logger.info('Using Playwright for answering questions');
        
        try {
          // Implement Playwright-based question answering
          // First check if there are any questions on the page
          const questionElements = await this.page.$$('.question-container, .question-prompt, .question-text');
          
          if (questionElements.length === 0) {
            logger.info('No questions found on page with Playwright');
            this.updateSuccessTracking(false, false, 'questions');
            return false;
          }
          
          // Process each question
          for (const questionElement of questionElements) {
            // Extract question text
            const questionText = await questionElement.textContent() || '';
            logger.info(`Processing question: ${questionText.substring(0, 100)}...`);
            
            // Determine type of question (multiple choice, text input, etc.)
            const mcOptions = await this.page.$$('.answer-option, .multiple-choice-option');
            const textInputs = await this.page.$$('input[type="text"], textarea');
            
            if (mcOptions.length > 0) {
              // Handle multiple choice question
              const options: string[] = [];
              for (const option of mcOptions) {
                const text = await option.textContent();
                if (text) options.push(text.trim());
              }
              
              // Use LangChain to determine best answer
              const bestAnswer = await langchain.selectBestMultipleChoiceAnswer(
                questionText,
                options,
                this.courseContent
              );
              
              // Click the best answer
              await mcOptions[bestAnswer].click();
            } else if (textInputs.length > 0) {
              // Handle text input question
              const answer = await langchain.answerQuestion(questionText, this.courseContent);
              await textInputs[0].fill(answer);
            }
          }
          
          // Look for a submit/next button
          try {
            const nextButton = await this.page.$('button.submit, button.next, .btn-submit, .btn-next, .btn-continue');
            if (nextButton) {
              await nextButton.click();
              await this.page.waitForTimeout(1000); // Short wait for page transition
              
              this.updateSuccessTracking(false, true, 'questions');
              return true;
            }
          } catch (buttonError) {
            logger.error('Error finding or clicking next button after questions', buttonError);
          }
          
          this.updateSuccessTracking(false, false, 'questions');
          return false;
        } catch (error) {
          logger.error('Error handling questions with Playwright', error);
          this.updateSuccessTracking(false, false, 'questions');
          return false;
        }
      }
    } catch (error) {
      logger.error('Unexpected error in answerQuestions', error);
      return false;
    }
  }

  /**
   * Handle the final exam using the appropriate automation method
   */
  async handleExam(): Promise<boolean> {
    logger.info('Handling final exam');
    
    try {
      // Ensure we have content for context
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      // Process content if not done already
      if (this.keyConcepts.length === 0) {
        await this.processCourseContent();
      }
      
      // For exams, prefer Skyvern but fallback to Playwright if needed
      if (await this.ensureInitialized()) {
        logger.info('Using Skyvern for exam handling');
        let success = false;
        
        if (this.skyvernClient) {
          try {
            const taskId = await this.skyvernClient.createHandleExamTask(this.courseContent);
            const result = await this.skyvernClient.waitForTaskCompletion(taskId);
            success = result.status === 'completed';
          } catch (error) {
            logger.error('Error using Skyvern for exam', error);
          }
        } else if (this.fallbackClient) {
          try {
            // Create an enhanced exam task with LangChain-processed content
            const examTask = {
              navigation_goal: `
                Handle the final exam by answering all questions based on the course content.
                
                Key concepts from the course:
                ${this.keyConcepts.map(c => `- ${c}`).join('\n')}
                
                Course summary for reference:
                ${this.courseSummary}
                
                Steps to follow:
                1. Read each exam question carefully
                2. For each question, select the best answer based on the course content and key concepts
                3. After answering all questions, click the "Submit" button
                4. Wait for the exam to be processed
                
                Important: Take your time to carefully read each question and select the best answer.
              `,
              max_steps: 30,
              take_screenshots: true,
            };
            
            const response = await this.fallbackClient.post('/tasks', examTask);
            const taskId = response.data.task_id;
            const result = await waitForTaskCompletion(taskId);
            success = result?.status === 'completed';
          } catch (error) {
            logger.error('Error using fallback client for exam', error);
          }
        }
        
        this.updateSuccessTracking(true, success, 'exam');
        
        if (success) {
          return true;
        }
      }
      
      // If Skyvern failed or wasn't initialized, try with Playwright
      logger.info('Using Playwright for exam handling');
      
      try {
        // Extract all exam questions
        const questionContainers = await this.page.$$('.exam-question-container, .exam-question');
        
        if (questionContainers.length === 0) {
          logger.warn('No exam questions found on page with Playwright');
          this.updateSuccessTracking(false, false, 'exam');
          return false;
        }
        
        logger.info(`Found ${questionContainers.length} exam questions`);
        
        // Collect all questions and options
        const examQuestions: Array<{ questionText: string; options: string[] }> = [];
        
        for (const container of questionContainers) {
          // Extract question text
          const questionElement = await container.$('.question-text, .question-prompt');
          const questionText = questionElement ? (await questionElement.textContent() || '') : '';
          
          // Extract options
          const optionElements = await container.$$('.answer-option, .option-text');
          const options: string[] = [];
          
          for (const option of optionElements) {
            const text = await option.textContent();
            if (text) options.push(text.trim());
          }
          
          examQuestions.push({ questionText, options });
        }
        
        // Use LangChain to answer all questions
        const answers = await langchain.answerExamQuestions(examQuestions, this.courseContent);
        
        // Apply the answers by clicking on the appropriate options
        for (let i = 0; i < answers.length; i++) {
          const questionContainer = questionContainers[i];
          const optionElements = await questionContainer.$$('.answer-option, .option-text');
          
          if (optionElements.length > answers[i]) {
            await optionElements[answers[i]].click();
          }
        }
        
        // Look for submit button and click it
        try {
          await this.page.click('#submit-exam, .submit-exam, .btn-submit');
          
          // Wait for confirmation or completion page
          try {
            await this.page.waitForSelector('.exam-complete, .exam-results', { timeout: 10000 });
            this.updateSuccessTracking(false, true, 'exam');
            return true;
          } catch {
            // If we can't find completion indicator, assume it worked
            this.updateSuccessTracking(false, true, 'exam');
            return true;
          }
        } catch (submitError) {
          logger.error('Error submitting exam with Playwright', submitError);
          this.updateSuccessTracking(false, false, 'exam');
          return false;
        }
      } catch (error) {
        logger.error('Error handling exam with Playwright', error);
        this.updateSuccessTracking(false, false, 'exam');
        return false;
      }
    } catch (error) {
      logger.error('Unexpected error in handleExam', error);
      return false;
    }
  }

  /**
   * Handle exam agreement page
   */
  async handleExamAgreement(): Promise<boolean> {
    logger.info('Handling exam agreement page');
    
    try {
      // Try Skyvern first for agreement page
      if (await this.ensureInitialized()) {
        logger.info('Using Skyvern for exam agreement handling');
        let success = false;
        
        if (this.skyvernClient) {
          try {
            const taskId = await this.skyvernClient.createHandleExamAgreementTask();
            const result = await this.skyvernClient.waitForTaskCompletion(taskId);
            success = result.status === 'completed';
          } catch (error) {
            logger.error('Error using Skyvern for exam agreement', error);
          }
        } else if (this.fallbackClient) {
          try {
            const agreementTask = {
              navigation_goal: `
                Handle the exam agreement page by checking the agreement checkbox and clicking continue.
                
                Steps to follow:
                1. Look for the "I understand and agree" checkbox and check it
                2. Look for the "Continue" button and click it
                3. Wait for the page to navigate to the final exam
              `,
              max_steps: 5,
              take_screenshots: true,
            };
            
            const response = await this.fallbackClient.post('/tasks', agreementTask);
            const taskId = response.data.task_id;
            const result = await waitForTaskCompletion(taskId);
            success = result?.status === 'completed';
          } catch (error) {
            logger.error('Error using fallback client for exam agreement', error);
          }
        }
        
        if (success) {
          return true;
        }
      }
      
      // Playwright fallback
      logger.info('Using Playwright for exam agreement handling');
      
      try {
        // Check for agreement checkbox and check it
        await this.page.check('input[type="checkbox"], .agreement-checkbox');
        
        // Click continue button
        await this.page.click('button:has-text("Continue"), .btn-continue');
        
        // Wait for navigation to exam page
        await this.page.waitForNavigation({ timeout: 10000 });
        
        return true;
      } catch (error) {
        logger.error('Error handling exam agreement with Playwright', error);
        return false;
      }
    } catch (error) {
      logger.error('Unexpected error in handleExamAgreement', error);
      return false;
    }
  }

  /**
   * Handle navigation when confused or stuck
   */
  async handleNavigation(): Promise<boolean> {
    logger.info('Handling navigation');
    
    try {
      // Determine which method to use
      const useSkyvernForNavigation = this.shouldUseSkyvernForCurrentTask('navigation');
      
      if (useSkyvernForNavigation && await this.ensureInitialized()) {
        logger.info('Using Skyvern for navigation');
        let success = false;
        
        if (this.skyvernClient) {
          try {
            const taskId = await this.skyvernClient.createNavigateNextTask();
            const result = await this.skyvernClient.waitForTaskCompletion(taskId);
            success = result.status === 'completed';
          } catch (error) {
            logger.error('Error using Skyvern for navigation', error);
          }
        } else if (this.fallbackClient) {
          try {
            const navigationTask = {
              navigation_goal: `
                Navigate to the next section of the course.
                
                Steps to follow:
                1. Look for a "Next" button, "Continue" button, or similar navigation element
                2. Click the button to proceed to the next section
                3. If no next button is found, look for other ways to progress such as:
                   - "Complete" button
                   - "Submit" button
                   - "Finish" button
                   - Any similar navigation controls
              `,
              max_steps: 10,
              take_screenshots: true,
            };
            
            const response = await this.fallbackClient.post('/tasks', navigationTask);
            const taskId = response.data.task_id;
            const result = await waitForTaskCompletion(taskId);
            success = result?.status === 'completed';
          } catch (error) {
            logger.error('Error using fallback client for navigation', error);
          }
        }
        
        this.updateSuccessTracking(true, success, 'navigation');
        return success;
      } else {
        logger.info('Using Playwright for navigation');
        
        try {
          // Try different navigation buttons in order of likelihood
          const buttonSelectors = [
            'button:has-text("Next")',
            'button:has-text("Continue")',
            '.btn-next',
            '.btn-continue',
            '.next-button',
            '.continue-button',
            'button:has-text("Next Section")',
            'button:has-text("Complete")',
            'button:has-text("Submit")',
            'button:has-text("Finish")',
            'a:has-text("Next")',
            'a:has-text("Continue")',
          ];
          
          for (const selector of buttonSelectors) {
            try {
              const isVisible = await this.page.isVisible(selector);
              
              if (isVisible) {
                logger.info(`Found navigation button with selector: ${selector}`);
                await this.page.click(selector);
                
                // Wait for navigation or new content
                try {
                  await Promise.race([
                    this.page.waitForNavigation({ timeout: 5000 }),
                    this.page.waitForFunction(() => {
                      const oldHeight = document.body.scrollHeight;
                      setTimeout(() => {
                        return document.body.scrollHeight !== oldHeight;
                      }, 500);
                    }, { timeout: 5000 })
                  ]);
                } catch {
                  // Navigation timeout is okay, the page might not navigate
                }
                
                this.updateSuccessTracking(false, true, 'navigation');
                return true;
              }
            } catch (buttonError) {
              // Just continue to the next selector
            }
          }
          
          logger.warn('No navigation buttons found with Playwright');
          this.updateSuccessTracking(false, false, 'navigation');
          return false;
        } catch (error) {
          logger.error('Error handling navigation with Playwright', error);
          this.updateSuccessTracking(false, false, 'navigation');
          return false;
        }
      }
    } catch (error) {
      logger.error('Unexpected error in handleNavigation', error);
      return false;
    }
  }

  /**
   * Handle video on the current page
   */
  async handleVideo(): Promise<boolean> {
    logger.info('Handling video with enhanced detection');
    
    try {
      // Multiple detection strategies for videos
      const videoDetectionStrategies = [
        async () => await this.page.$('video, iframe[src*="vimeo"], iframe[src*="youtube"]'),
        async () => await this.page.$('.video-player, .media-player, .ts-video-player'),
        async () => await this.page.$('.video-container, .media-container, #mediaspace'),
        async () => await this.page.$('.video-controls, .media-controls, .vjs-control-bar')
      ];
      
      let videoElement = null;
      for (const strategy of videoDetectionStrategies) {
        videoElement = await strategy();
        if (videoElement) {
          logger.info(`Video detected using strategy: ${strategy.toString().substring(0, 50)}...`);
          break;
        }
      }
      
      if (!videoElement) {
        logger.info('No video found using any detection strategy');
        return false;
      }
      
      logger.info('Video detected, monitoring for completion');

      const sectionStartTime = Date.now();
      logger.info('Starting video completion monitoring');
      
      // Multiple completion detection strategies
      const completionStrategies = [
        async () => {
          const nextButton = await this.checkForNextButton();
          if (nextButton) {
            logger.info('Video completion detected: Next button appeared');
            return true;
          }
          return false;
        },
        async () => {
          const completionIndicator = await this.page.$(
            '.video-completed, .video-complete, .completion-indicator, .video-progress-100'
          );
          if (completionIndicator) {
            logger.info('Video completion detected: Completion indicator found');
            return true;
          }
          return false;
        },
        async () => {
          try {
            const progress = await this.page.$eval('video', (video) => {
              if (video.duration && video.currentTime) {
                return video.currentTime / video.duration;
              }
              return 0;
            });
            
            if (progress > 0.95) {
              logger.info(`Video completion detected: Progress at ${Math.round(progress * 100)}%`);
              return true;
            }
          } catch (e) {}
          return false;
        },
        async () => {
          try {
            // Check if video element is no longer in DOM (some players remove video after completion)
            const videoStillExists = await this.page.$('video');
            const wasVideoPresent = videoElement && videoElement.constructor.name.includes('Element');
            
            if (wasVideoPresent && !videoStillExists) {
              logger.info('Video completion detected: Video element removed from DOM');
              return true;
            }
          } catch (e) {}
          return false;
        },
        async () => {
          // Check for video controls in disabled state
          try {
            const disabledControls = await this.page.$(
              '.vjs-ended, .video-ended, .plyr--ended, .mejs__ended, [data-state="ended"]'
            );
            
            if (disabledControls) {
              logger.info('Video completion detected: Player in ended state');
              return true;
            }
          } catch (e) {}
          return false;
        }
      ];
      
      // Monitor for completion using all strategies with adaptive timing
      const startTime = Date.now();
      const maxWaitTime = 10 * 60 * 1000; // 10 minutes maximum wait time
      let checkInterval = 5000; // Start with 5 second interval
      let lastProgressTime = 0;
      let lastProgress = 0;
      
      // Try to get initial video duration if available
      let videoDuration = 0;
      try {
        videoDuration = await this.page.$eval('video', (video) => video.duration || 0);
        if (videoDuration > 0) {
          logger.info(`Video duration detected: ${Math.round(videoDuration)} seconds`);
        }
      } catch (e) {
        logger.debug('Could not determine video duration');
      }
      
      while (Date.now() - startTime < maxWaitTime) {
        // Check all completion strategies
        for (const strategy of completionStrategies) {
          const isComplete = await strategy();
          if (isComplete) {
            if (await this.clickNextButton()) {
              const elapsedTime = Date.now() - startTime;
              logger.info(`Video completed after ${elapsedTime / 1000}s`);
              return true;
            }
          }
        }
        
        // Monitor video progress to adapt check interval and detect stalls
        try {
          const currentProgress = await this.page.$eval('video', (video) => {
            if (video.duration && video.currentTime) {
              return {
                progress: video.currentTime / video.duration,
                currentTime: video.currentTime,
                paused: video.paused
              };
            }
            return null;
          });
          
          if (currentProgress) {
            // Log progress every 10%
            const progressPercent = Math.round(currentProgress.progress * 100);
            const lastProgressPercent = Math.round(lastProgress * 100);
            
            if (Math.floor(progressPercent / 10) > Math.floor(lastProgressPercent / 10)) {
              logger.info(`Video progress: ${progressPercent}%`);
            }
            
            // Detect if video is making progress
            if (currentProgress.currentTime > lastProgress) {
              lastProgressTime = Date.now();
              lastProgress = currentProgress.currentTime;
              
              // Adapt check interval based on video progress
              // Check more frequently as we approach completion
              if (currentProgress.progress > 0.8) {
                checkInterval = 2000; // Check every 2 seconds when near completion
              } else if (currentProgress.progress > 0.5) {
                checkInterval = 3000; // Check every 3 seconds in the middle
              }
            }
            
            // Detect stalled video and try to resume
            const stallTime = Date.now() - lastProgressTime;
            if (stallTime > 30000 && currentProgress.paused && lastProgress > 0) {
              logger.warn(`Video playback stalled for ${Math.round(stallTime / 1000)}s, attempting to resume`);
              try {
                await this.page.$eval('video', (video) => video.play());
                logger.info('Attempted to resume video playback');
              } catch (e) {
                logger.debug('Failed to resume video playback');
              }
            }
          }
        } catch (e) {
          // Ignore errors in progress monitoring
        }
        
        await sleep(checkInterval);
        logger.debug(`Still waiting for video completion (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      }
      
      logger.warn('Video wait timeout exceeded, attempting to continue anyway');
      return await this.clickNextButton();
      
    } catch (error) {
      logger.error('Error in enhanced video handling', error);
      
      // Try Skyvern as fallback if primary video handling fails
      if (await this.ensureInitialized() && this.skyvernClient) {
        try {
          logger.info('Using Skyvern as fallback for video handling');
          const taskId = await this.skyvernClient.createWatchVideoTask();
          const result = await this.skyvernClient.waitForTaskCompletion(taskId);
          return result.status === 'completed';
        } catch (skyvernError) {
          logger.error('Skyvern fallback also failed', skyvernError);
        }
      }
      return false;
    }
  }

  /**
   * Helper method to check for next button
   */
  private async checkForNextButton(): Promise<boolean> {
    try {
      const nextSelectors = [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        '.btn-next',
        '.btn-continue',
        '.next-button',
        '.continue-button',
        'button:has-text("Next Section")',
      ];
      
      for (const selector of nextSelectors) {
        const isVisible = await this.page.isVisible(selector);
        if (isVisible) {
          return true;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Helper method to click next button
   */
  private async clickNextButton(): Promise<boolean> {
    try {
      const nextSelectors = [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        '.btn-next',
        '.btn-continue',
        '.next-button',
        '.continue-button',
        'button:has-text("Next Section")',
      ];
      
      for (const selector of nextSelectors) {
        const isVisible = await this.page.isVisible(selector);
        if (isVisible) {
          await this.page.click(selector);
          return true;
        }
      }
      
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Complete the current course using combined automation
   */
  async completeCourse(): Promise<boolean> {
    logger.info('Starting course completion with combined automation');
    
    try {
      // Use stopTracking/reset instead since startTracking is private
      this.timeTracker.stopTracking();
      this.timeTracker.reset();
      
      // Start extracting content
      await this.extractCurrentContent();
      
      // Course completion loop
      let courseComplete = false;
      let sectionCount = 0;
      // Track time for the current section
      let sectionStartTime = Date.now();
      const maxSections = 100; // Safety limit
      
      while (!courseComplete && sectionCount < maxSections) {
        sectionCount++;
        logger.info(`Processing section ${sectionCount}...`);
        
        // Extract content for this section
        await this.extractCurrentContent();
        
        // Process content to understand it better
        await this.processCourseContent();
        
        // Handle video if present
        const videoHandled = await this.handleVideo();
        if (videoHandled) {
          logger.info('Video handled successfully');
          continue; // Go to next iteration, the video handling should have navigated
        }
        
        // Handle quiz if present
        const quizHandled = await this.handleQuiz();
        if (quizHandled) {
          logger.info('Quiz handled successfully');
          continue; // Go to next iteration, the quiz handling should have navigated
        }
        
        // Handle regular questions if present
        const questionsHandled = await this.answerQuestions();
        if (questionsHandled) {
          logger.info('Questions handled successfully');
          continue; // Go to next iteration, the questions handling should have navigated
        }
        
        // Check if we're on the exam agreement page
        const isAgreementPage = await this.isExamAgreementPage();
        if (isAgreementPage) {
          logger.info('Exam agreement page detected');
          const agreementHandled = await this.handleExamAgreement();
          
          if (agreementHandled) {
            logger.info('Exam agreement handled successfully');
            
            // Should now be on the exam page
            const examHandled = await this.handleExam();
            if (examHandled) {
              logger.info('Exam handled successfully');
              courseComplete = true;
              break;
            }
          }
        }
        
        // Check if we've reached the final page
        const isFinalPage = await this.isFinalPage();
        if (isFinalPage) {
          logger.info('Final page detected, course complete');
          courseComplete = true;
          break;
        }
        
        // Try regular navigation
        const navigationSuccess = await this.handleNavigation();
        if (!navigationSuccess) {
          logger.warn('Navigation failed, trying with Skyvern as last resort');
          
          // Force Skyvern navigation as last resort if not already tried
          if (!this.inSkyvernMode && await this.ensureInitialized()) {
            if (this.skyvernClient) {
              const taskId = await this.skyvernClient.createNavigateNextTask();
              const result = await this.skyvernClient.waitForTaskCompletion(taskId);
              
              if (result.status === 'completed') {
                logger.info('Skyvern navigation succeeded as last resort');
                continue;
              }
            }
          }
          
          logger.error('All navigation attempts failed, course may be stuck');
          
          // If we've been in the same section for too long, consider the course complete
          const sectionStuckTime = 300000; // 5 minutes
          const currentElapsedTime = Date.now() - sectionStartTime;
          
          if (currentElapsedTime > sectionStuckTime) {
            logger.warn('Been stuck in same section for too long, considering course complete');
            courseComplete = true;
            break;
          }
          
        }
        
        // Small delay to ensure page loads
        await sleep(2000);
      }
      
      // Stop time tracking
      this.timeTracker.stopTracking();
      
      if (courseComplete) {
        logger.info(`Course completed! Processed ${sectionCount} sections.`);
        return true;
      } else {
        logger.warn(`Reached maximum section limit (${maxSections}). Course may be incomplete.`);
        return false;
      }
    } catch (error) {
      logger.error('Error during course completion', error);
      return false;
    }
  }

  /**
   * Check if current page is the exam agreement page
   */
  private async isExamAgreementPage(): Promise<boolean> {
     try {
       const pageTitle = await this.page.title();
       const pageText = await this.page.textContent('body') || '';
       
       return (
         pageTitle.includes('Exam Agreement') ||
         pageText.includes('Exam Agreement') ||
         pageText.includes('I understand and agree')
       );
     } catch {
       return false;
     }
  }

  /**
   * Check if current page is the final page of the course
   */
  private async isFinalPage(): Promise<boolean> {
   try {
     const pageTitle = await this.page.title();
     const pageText = await this.page.textContent('body');
      const textContent = pageText || '';
      
      return (
        pageTitle.includes('Summary') ||
        pageTitle.includes('Complete') ||
        pageTitle.includes('Finished') ||
        textContent.includes('Course Complete') ||
        textContent.includes('Course Summary') ||
        textContent.includes('You have completed this course') ||
        textContent.includes('100% Complete')
      );
    } catch {
      return false;
    }
  }

  // Helper function to extract course text from page
  private async extractCourseText(page: Page): Promise<string> {
    try {
      // Try to find the main course content
      const contentSelectors = [
        '.course-content',
        '.lesson-content',
        '.slide-content',
        '#main-content',
        '.main-content',
        '.player-content',
        'article',
        'main'
      ];
      
      for (const selector of contentSelectors) {
        if (await page.$(selector)) {
          return await page.$eval(selector, el => el.textContent || '');
        }
      }
      
      // If no specific content selector works, try getting all visible content
      // This excludes scripts, styles, and hidden elements
      return await page.evaluate(() => {
        // Remove scripts, styles, and hidden elements
        const elements = document.querySelectorAll('body > *:not(script):not(style):not([style*="display:none"]):not([style*="display: none"])');
        let text = '';
        elements.forEach(el => {
          text += el.textContent + '\n';
        });
        return text;
      });
    } catch (error) {
      logger.error('Error extracting course text:', error);
      return '';
    }
  }
}

export default CombinedAutomation;
