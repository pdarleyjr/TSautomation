import { Page } from 'playwright';
import { SkyvernClient } from './skyvern-enhanced';
import { createCustomTask, waitForTaskCompletion } from './skyvern-integration';
import logger from './logger';
import { extractCourseText } from './index';
import * as langchain from './langchain-integration'; 
import { skyvernAuthV2 } from './skyvern-auth-v2-handler';
import axios from 'axios';
import { skyvernAuth, SkyvernAuthHandler } from './skyvern-auth-handler';

/**
 * DynamicSkyvernBridge class for dynamically switching between Playwright and Skyvern
 * when the automation encounters complex scenarios
 */
export class DynamicSkyvernBridge {
  private page: Page;
  private skyvernClient: SkyvernClient | null = null;
  private courseContent: string = '';
  private isInitialized: boolean = false;
  private keyConcepts: string[] = [];
  private courseSummary: string = '';
  private fallbackClient: any = null;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Initialize the Skyvern client if needed using the enhanced authentication handler.
   */
  async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized) {
      return true;
    }

    logger.info('Initializing Skyvern client for dynamic usage');

    try {
      // Initialize the authentication handler first
      const authInitialized = await skyvernAuthV2.ensureInitialized();
      
      if (authInitialized) {
        this.skyvernClient = new SkyvernClient();
        this.isInitialized = true;
        logger.info('Skyvern client initialized successfully via auth handler');
        return true;
      }
    } catch (error) {
      logger.error('Failed to initialize Skyvern client', error);
      return false;
      // Explicit return to satisfy TypeScript
    }
    return false; // Return false if initialization fails for any other reason
  }

  /**
   * Process course content using LangChain to enhance understanding
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
   * @param content New course content
   */
  updateCourseContent(content: string): void {
    this.courseContent = content;
    logger.debug(`Updated Skyvern bridge course content (${content.length} characters)`);
    this.processCourseContent(); // Process new content asynchronously
  }

  /**
   * Extract course content from the current page
   */
  async extractCurrentContent(): Promise<string> {
    try {
      const content = await extractCourseText(this.page);
      this.updateCourseContent(content);
      return content;
    } catch (error) {
      logger.error('Error extracting course content for Skyvern', error);
      return this.courseContent;
    }
  }

  /**
   * Handle a complex quiz or knowledge check using Skyvern
   * @returns Promise resolving to true if the quiz was successfully handled
   * Now uses LangChain-enhanced context for better performance
   */
  async handleQuiz(): Promise<boolean> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return false;
    }

    try {
      logger.info('Using Skyvern+LangChain to handle quiz/knowledge check');
      
      // Extract current content if we don't have it
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      // Process content if we haven't yet
      if (this.keyConcepts.length === 0) {
        await this.processCourseContent();
      }
      
      // Create an enhanced quiz handling task
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
      
      let taskId;
      let result: any = {};
      
      try {
        if (this.skyvernClient) {
          // Use the primary client
          taskId = await this.skyvernClient.createHandleQuizTask();
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
        } else {
          // Use the auth handler if client isn't available
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', quizTask);
          taskId = response.task_id;
          
          // Poll for task completion
          while (true) {
            const status = await skyvernAuthV2.get<{status: string}>(`/tasks/${taskId}`);
            if (status.status === 'completed' || status.status === 'failed') {
              result = status;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      } catch (error) {
        logger.error('Error executing quiz task', error);
        return false;
      }
      
      return result?.status === 'completed';
    } catch (error) {
      logger.error('Error using Skyvern to handle quiz', error);
      return false;
    }
  }

  /**
   * Handle answering questions using Skyvern
   * @returns Promise resolving to true if the questions were successfully answered
   */
  async answerQuestions(): Promise<boolean> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return false;
    }

    try {
      logger.info('Using Skyvern+LangChain to answer questions');
      
      // Extract current content if we don't have it
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      // Process content if we haven't yet
      if (this.keyConcepts.length === 0) {
        await this.processCourseContent();
      }
      
      // Generate practice questions to improve understanding
      const practiceQuestions = await langchain.generatePracticeQuestions(this.courseContent, 3);
      
      // Create an enhanced task for answering questions
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
      
      let taskId;
      let result: any = {};
      
      try {
        if (this.skyvernClient) {
          taskId = await this.skyvernClient.createAnswerQuestionsTask(this.courseContent);
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
        } else {
          // Use the auth handler directly
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', questionsTask);
          taskId = response.task_id;
          
          // Poll for task completion
          while (true) {
            const status = await skyvernAuthV2.get<{status: string}>(`/tasks/${taskId}`);
            if (status.status === 'completed' || status.status === 'failed') {
              result = status;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      } catch (error) {
        logger.error('Error executing questions task', error);
        return false;
      }
      
      return result?.status === 'completed';
    } catch (error) {
      logger.error('Error using Skyvern to answer questions', error);
      return false;
    }
  }

  /**
   * Handle the final exam using Skyvern
   * @returns Promise resolving to true if the exam was successfully handled
   */
  async handleExam(): Promise<boolean> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return false;
    }

    try {
      logger.info('Using Skyvern+LangChain to handle final exam');
      
      // Extract current content if we don't have it
      if (!this.courseContent) {
        await this.extractCurrentContent();
      }
      
      let taskId;
      let result: any = {};
      
      try {
        if (this.skyvernClient) {
          taskId = await this.skyvernClient.createHandleExamTask(this.courseContent);
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
        } else {
          const examTask = this.createExamTask();
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', examTask);
          taskId = response.task_id;
          
          // Poll for task completion
          while (true) {
            const status = await skyvernAuthV2.get<{status: string}>(`/tasks/${taskId}`);
            if (status.status === 'completed' || status.status === 'failed') {
              result = status;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      } catch (error) {
        logger.error('Error executing exam task', error);
        return false;
      }
      
      return result?.status === 'completed';
    } catch (error) {
      logger.error('Error using Skyvern to handle exam', error);
      return false;
    }
  }

  /**
   * Handle exam agreement page using Skyvern
   * @returns Promise resolving to true if the agreement was successfully handled
   */
  async handleExamAgreement(): Promise<boolean> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return false;
    }

    try {
      logger.info('Using Skyvern+LangChain to handle exam agreement');
      
      let taskId;
      let result: any = {};
      
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

      try {
        if (this.skyvernClient) {
          taskId = await this.skyvernClient.createHandleExamAgreementTask();
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
        } else {
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', agreementTask);
          taskId = response.task_id;
          result = await waitForTaskCompletion(taskId);
        }
        
        return result?.status === 'completed';
      } catch (error) {
        logger.error('Error handling exam agreement', error);
        return false;
      }
    } catch (error) {
      logger.error('Error using Skyvern to handle exam agreement', error);
      return false;
    }
  }

  /**
   * Create an exam task with enhanced context
   */
  private createExamTask(): any {
    return {
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
  }

  /**
   * Handle navigation when confused or stuck
   * @returns Promise resolving to true if navigation was successful
   */
  async handleNavigation(): Promise<boolean> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return false;
    }

    try {
      logger.info('Using Skyvern+LangChain to handle navigation when confused');
      
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
      
      let taskId;
      let result: any = {};
      
      try {
        if (this.skyvernClient) {
          taskId = await this.skyvernClient.createNavigateNextTask();
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
        } else {
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', navigationTask);
          taskId = response.task_id;
          
          // Poll for task completion
          while (true) {
            const status = await skyvernAuthV2.get<{status: string}>(`/tasks/${taskId}`);
            if (status.status === 'completed' || status.status === 'failed') {
              result = status;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
        return result?.status === 'completed';
      } catch (error) {
        logger.error('Error during navigation task', error);
        return false;
      }
    } catch (error) {
      logger.error('Error using Skyvern for navigation', error);
      return false;
    }
  }

  /**
   * Extract content using Skyvern
   * @returns Promise resolving to the extracted content
   */
  async extractContent(): Promise<string> {
    if (!await this.ensureInitialized()) {
      logger.error('Skyvern client not initialized');
      return '';
    }

    try {
      logger.info('Using Skyvern+LangChain to extract content');
      
      const extractTask = {
        navigation_goal: `
          Extract all the text content from the current course page.
          
          Steps to follow:
          1. Identify the main content area of the course (usually a div with course material)
          2. Extract all the text content from this area
          3. Do not click on anything or navigate away from the page
          4. Return the extracted text content
          
          Focus on extracting educational content, ignoring navigation elements, headers, footers, etc.
        `,
        max_steps: 3,
        take_screenshots: true,
      };
      
      let result: any = {};

      try {      
        if (this.skyvernClient) {
          const taskId = await this.skyvernClient.createExtractContentTask();
          result = await this.skyvernClient.waitForTaskCompletion(taskId);
          
          if (result.status === 'completed' && result.result?.extracted_text) {
            const extractedText = result.result.extracted_text;
            this.updateCourseContent(extractedText);
            return extractedText;
          }
        } else {
          const response = await skyvernAuthV2.post<{task_id: string}>('/tasks', extractTask);
          const taskId = response.task_id;
          
          // Poll for task completion
          while (true) {
            const status = await skyvernAuthV2.get<{status: string, result?: {extracted_text?: string}}>(`/tasks/${taskId}`);
            if (status.status === 'completed' || status.status === 'failed') {
              result = status;
              break;
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
          
          if (result?.status === 'completed' && result.result?.extracted_text) {
            const extractedText = result.result.extracted_text || '';
            this.updateCourseContent(extractedText);
            return extractedText;
          }
        }
      } catch (error) {
        logger.error('Error extracting content', error);
        return '';
      }
      
      return '';
    } catch (error) {
      logger.error('Error using Skyvern to extract content', error);
      return '';
    }
  }
}

export default DynamicSkyvernBridge;