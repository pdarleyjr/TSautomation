import dotenv from 'dotenv';
import axios, { AxiosInstance } from 'axios';
import { sleep } from './utils';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  username: process.env.TS_USERNAME || '',
  password: process.env.TS_PASSWORD || '',
  skyvernApiUrl: process.env.SKYVERN_API_URL || 'http://localhost:8000/api/v1',
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '5000'),
  maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
  screenshotDir: process.env.SCREENSHOT_DIR || './screenshots',
  logDir: process.env.LOG_DIR || './logs',
};

// Ensure directories exist
if (!fs.existsSync(config.screenshotDir)) {
  fs.mkdirSync(config.screenshotDir, { recursive: true });
}

if (!fs.existsSync(config.logDir)) {
  fs.mkdirSync(config.logDir, { recursive: true });
}

// Types
export interface SkyvernTask {
  task_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  url?: string;
  navigation_goal: string;
  max_steps: number;
  error?: string;
  result?: any;
  screenshots?: string[];
}

export interface SkyvernWorkflow {
  workflow_id: string;
  name: string;
  description: string;
  tasks: { name: string; task_id: string }[];
}

export interface SkyvernWorkflowRun {
  run_id: string;
  workflow_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  task_results: { task_id: string; status: string; result: any }[];
}

// Skyvern API client
class SkyvernClient {
  private client: AxiosInstance;
  private sessionId: string;

  constructor() {
    this.client = axios.create({
      baseURL: config.skyvernApiUrl,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.skyvernApiKey,
      },
    });
    
    // Generate a unique session ID for this run
    this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Create session log file
    const logFile = path.join(config.logDir, `${this.sessionId}.log`);
    fs.writeFileSync(logFile, `Skyvern session started at ${new Date().toISOString()}\n`);
  }

  /**
   * Log a message to the session log file
   */
  private log(message: string): void {
    const logFile = path.join(config.logDir, `${this.sessionId}.log`);
    fs.appendFileSync(logFile, `${new Date().toISOString()} - ${message}\n`);
    console.log(message);
  }

  /**
   * Save a screenshot
   */
  private saveScreenshot(taskId: string, stepNumber: number, base64Image: string): string {
    const filename = `${this.sessionId}_${taskId}_step${stepNumber}.png`;
    const filepath = path.join(config.screenshotDir, filename);
    
    // Convert base64 to image and save
    const imageBuffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(filepath, imageBuffer);
    
    return filepath;
  }

  /**
   * Create a task to login to Target Solutions
   */
  async createLoginTask(): Promise<string> {
    this.log('Creating login task');
    
    const loginTask = {
      url: 'https://app.targetsolutions.com/auth/index.cfm?action=login.showlogin&customerid=27837&customerpath=miamibeach&timeout',
      navigation_goal: `
        Log in to Target Solutions using the following credentials:
        Username: ${config.username}
        Password: ${config.password}
        
        First, look for the username field and enter the username.
        Then, look for the password field and enter the password.
        Finally, look for the login button and click it.
        
        Wait until you are successfully logged in and can see the dashboard.
      `,
      max_steps: 10,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', loginTask);
      const taskId = response.data.task_id;
      this.log(`Login task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating login task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to find and start an assignment
   */
  async createFindAssignmentTask(): Promise<string> {
    this.log('Creating find assignment task');
    
    const findAssignmentTask = {
      url: 'https://app.targetsolutions.com/tsapp/dashboard/pl_fb/index.cfm?fuseaction=c_pro.showHome',
      navigation_goal: `
        Look at the dashboard and find the first available assignment (not an event).
        Events typically have "Event" in their title, while assignments don't.
        
        Steps to follow:
        1. Scan the page for assignments listed in the "My Assignments" or similar section
        2. Identify assignments that don't have "Event" in their title
        3. Click on the first such assignment to start it
        
        If you don't see any assignments, look for a "My Assignments" link or button and click it first.
        
        Take your time to carefully analyze the page before making a selection.
      `,
      max_steps: 15,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', findAssignmentTask);
      const taskId = response.data.task_id;
      this.log(`Find assignment task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating find assignment task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to handle a video in the course
   */
  async createWatchVideoTask(): Promise<string> {
    this.log('Creating watch video task');
    
    const watchVideoTask = {
      navigation_goal: `
        Check if there's a video on the current page and wait for it to complete.
        
        Steps to follow:
        1. Look for a video player on the page (could be HTML5 video, iframe with YouTube/Vimeo, or other player)
        2. If a video is found, wait for it to complete playing
        3. After the video completes, look for a "Next" button or similar and click it
        4. If no video is found, do nothing and report that no video was detected
        
        Important: You must wait for the video to complete before proceeding. This may take several minutes.
        Look for progress indicators, completion messages, or the appearance of "Next" buttons.
      `,
      max_steps: 20,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', watchVideoTask);
      const taskId = response.data.task_id;
      this.log(`Watch video task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating watch video task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to answer questions in the course
   */
  async createAnswerQuestionsTask(courseContent: string): Promise<string> {
    this.log('Creating answer questions task');
    
    const answerQuestionsTask = {
      navigation_goal: `
        Answer any questions on the current page based on the course content.
        
        Course content for reference:
        ${courseContent.substring(0, 2000)}... (truncated)
        
        Steps to follow:
        1. Look for questions on the page (multiple choice, checkboxes, text inputs)
        2. For each question:
           a. Read the question carefully
           b. Consider the course content to determine the best answer
           c. Select or enter the appropriate response
        3. After answering all questions, look for a "Submit" or "Next" button and click it
        4. If no questions are found, do nothing and report that no questions were detected
        
        Take your time to carefully read each question and select the best answer based on the course content.
      `,
      max_steps: 30,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', answerQuestionsTask);
      const taskId = response.data.task_id;
      this.log(`Answer questions task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating answer questions task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to handle quiz/knowledge check pages
   */
  async createHandleQuizTask(): Promise<string> {
    this.log('Creating handle quiz task');
    
    const handleQuizTask = {
      navigation_goal: `
        Handle a quiz or knowledge check page by selecting the correct answer.
        
        Steps to follow:
        1. Check if the current page is a quiz or knowledge check page
           - Look for "Knowledge Check" heading
           - Look for multiple choice options in a panel
        2. If this is a quiz page:
           a. Read the question carefully
           b. Examine all available answer options
           c. Select the most appropriate answer based on the course content
           d. If a modal appears indicating your answer was correct:
              - Click the "Continue" button to proceed to the next page
           e. If a modal appears indicating your answer was incorrect:
              - Click the "Try Again" button
              - Select a different answer
              - Repeat until you find the correct answer
        3. If this is not a quiz page, do nothing and report that no quiz was detected
        
        Take your time to carefully read the question and select the best answer.
      `,
      max_steps: 20,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', handleQuizTask);
      const taskId = response.data.task_id;
      this.log(`Handle quiz task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating handle quiz task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to navigate to the next section
   */
  async createNavigateNextTask(): Promise<string> {
    this.log('Creating navigate next task');
    
    const navigateNextTask = {
      navigation_goal: `
        Navigate to the next section of the course.
        
        Steps to follow:
        1. Look for a "Next" button, "Continue" button, or similar navigation element
        2. Click the button to proceed to the next section
        3. If no next button is found, report that the course may be complete
        
        Common button text to look for: "Next", "Continue", "Next Section", "Proceed"
        These buttons are often at the bottom of the page or may appear after completing a section.
      `,
      max_steps: 5,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', navigateNextTask);
      const taskId = response.data.task_id;
      this.log(`Navigate next task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating navigate next task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to handle the exam agreement page
   */
  async createHandleExamAgreementTask(): Promise<string> {
    this.log('Creating handle exam agreement task');
    
    const handleExamAgreementTask = {
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
      const response = await this.client.post('/tasks', handleExamAgreementTask);
      const taskId = response.data.task_id;
      this.log(`Handle exam agreement task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating handle exam agreement task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to handle the final exam
   */
  async createHandleExamTask(courseContent: string): Promise<string> {
    this.log('Creating handle final exam task');
    
    const handleExamTask = {
      navigation_goal: `
        Handle the final exam by answering all questions based on the course content and submitting the exam.
        
        Course content for reference:
        ${courseContent.substring(0, 2000)}... (truncated)
        
        Steps to follow:
        1. Read each exam question carefully
        2. For each question, select the best answer based on the course content
        3. After answering all questions, click the "Submit" button
        4. Wait for the exam to be processed
        
        Important: Take your time to carefully read each question and select the best answer.
        There are typically 10 multiple-choice questions in the exam.
      `,
      max_steps: 30,
      take_screenshots: true,
    };

    try {
      const response = await this.client.post('/tasks', handleExamTask);
      const taskId = response.data.task_id;
      this.log(`Handle exam task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating handle exam task: ${error}`);
      throw error;
    }
  }

  /**
   * Create a task to extract course content
   */
  async createExtractContentTask(): Promise<string> {
    this.log('Creating extract content task');
    
    const extractContentTask = {
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

    try {
      const response = await this.client.post('/tasks', extractContentTask);
      const taskId = response.data.task_id;
      this.log(`Extract content task created with ID: ${taskId}`);
      return taskId;
    } catch (error) {
      this.log(`Error creating extract content task: ${error}`);
      throw error;
    }
  }

  /**
   * Check the status of a task
   */
  async checkTaskStatus(taskId: string): Promise<SkyvernTask> {
    try {
      const response = await this.client.get(`/tasks/${taskId}`);
      return response.data;
    } catch (error) {
      this.log(`Error checking status of task ${taskId}: ${error}`);
      throw error;
    }
  }

  /**
   * Wait for a task to complete with retry logic
   */
  async waitForTaskCompletion(taskId: string): Promise<SkyvernTask> {
    this.log(`Waiting for task ${taskId} to complete...`);
    
    let retries = 0;
    let lastStatus = '';
    
    while (true) {
      try {
        const taskStatus = await this.checkTaskStatus(taskId);
        
        // Log status changes
        if (taskStatus.status !== lastStatus) {
          this.log(`Task ${taskId} status: ${taskStatus.status}`);
          lastStatus = taskStatus.status;
        }
        
        // Save screenshots if available
        if (taskStatus.screenshots && taskStatus.screenshots.length > 0) {
          taskStatus.screenshots.forEach((screenshot, index) => {
            this.saveScreenshot(taskId, index + 1, screenshot);
          });
        }
        
        if (taskStatus.status === 'completed') {
          this.log(`Task ${taskId} completed successfully!`);
          return taskStatus;
        } else if (taskStatus.status === 'failed') {
          this.log(`Task ${taskId} failed: ${taskStatus.error}`);
          
          if (retries < config.maxRetries) {
            retries++;
            this.log(`Retrying task (attempt ${retries}/${config.maxRetries})...`);
            // Recreate the task - this would need implementation based on task type
            // For now, we'll just throw an error
            throw new Error(`Task ${taskId} failed: ${taskStatus.error}`);
          } else {
            throw new Error(`Task ${taskId} failed after ${config.maxRetries} retries: ${taskStatus.error}`);
          }
        }
        
        await sleep(config.pollingIntervalMs);
      } catch (error) {
        this.log(`Error while waiting for task ${taskId}: ${error}`);
        
        if (retries < config.maxRetries) {
          retries++;
          this.log(`Retrying (attempt ${retries}/${config.maxRetries})...`);
          await sleep(config.pollingIntervalMs);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Create a workflow to automate a course
   */
  async createCourseWorkflow(courseContent: string): Promise<string> {
    this.log('Creating course automation workflow');
    
    // First create all the tasks
    const loginTaskId = await this.createLoginTask();
    const findAssignmentTaskId = await this.createFindAssignmentTask();
    const extractContentTaskId = await this.createExtractContentTask();
    const watchVideoTaskId = await this.createWatchVideoTask();
    const answerQuestionsTaskId = await this.createAnswerQuestionsTask(courseContent);
    const handleQuizTaskId = await this.createHandleQuizTask();
    const navigateNextTaskId = await this.createNavigateNextTask();
    
    const workflow = {
      name: 'Target Solutions Course Automation',
      description: 'Automate the completion of a Target Solutions course',
      tasks: [
        {
          name: 'Login to Target Solutions',
          task_id: loginTaskId,
        },
        {
          name: 'Find and start an assignment',
          task_id: findAssignmentTaskId,
        },
        {
          name: 'Extract initial course content',
          task_id: extractContentTaskId,
        },
        {
          name: 'Watch video if present',
          task_id: watchVideoTaskId,
        },
        {
          name: 'Answer questions if present',
          task_id: answerQuestionsTaskId,
        },
        {
          name: 'Handle quiz if present',
          task_id: handleQuizTaskId,
        },
        {
          name: 'Navigate to next section',
          task_id: navigateNextTaskId,
        }
      ]
    };
    
    try {
      const response = await this.client.post('/workflows', workflow);
      const workflowId = response.data.workflow_id;
      this.log(`Course workflow created with ID: ${workflowId}`);
      return workflowId;
    } catch (error) {
      this.log(`Error creating course workflow: ${error}`);
      throw error;
    }
  }

  /**
   * Run a workflow
   */
  async runWorkflow(workflowId: string): Promise<string> {
    this.log(`Running workflow ${workflowId}`);
    
    try {
      const response = await this.client.post(`/workflows/${workflowId}/run`);
      const runId = response.data.run_id;
      this.log(`Workflow run started with ID: ${runId}`);
      return runId;
    } catch (error) {
      this.log(`Error running workflow ${workflowId}: ${error}`);
      throw error;
    }
  }

  /**
   * Check the status of a workflow run
   */
  async checkWorkflowRunStatus(runId: string): Promise<SkyvernWorkflowRun> {
    try {
      const response = await this.client.get(`/workflow-runs/${runId}`);
      return response.data;
    } catch (error) {
      this.log(`Error checking status of workflow run ${runId}: ${error}`);
      throw error;
    }
  }

  /**
   * Wait for a workflow run to complete
   */
  async waitForWorkflowCompletion(runId: string): Promise<SkyvernWorkflowRun> {
    this.log(`Waiting for workflow run ${runId} to complete...`);
    
    let lastStatus = '';
    
    while (true) {
      const runStatus = await this.checkWorkflowRunStatus(runId);
      
      // Log status changes
      if (runStatus.status !== lastStatus) {
        this.log(`Workflow run ${runId} status: ${runStatus.status}`);
        lastStatus = runStatus.status;
      }
      
      if (runStatus.status === 'completed') {
        this.log(`Workflow run ${runId} completed successfully!`);
        return runStatus;
      } else if (runStatus.status === 'failed') {
        this.log(`Workflow run ${runId} failed`);
        throw new Error(`Workflow run ${runId} failed`);
      }
      
      await sleep(config.pollingIntervalMs);
    }
  }

  /**
   * Complete a course using individual tasks (more flexible than workflow)
   */
  async completeCourseWithTasks(initialCourseContent: string = ''): Promise<void> {
    this.log('Starting course completion with individual tasks');
    
    try {
      // Step 1: Login
      const loginTaskId = await this.createLoginTask();
      await this.waitForTaskCompletion(loginTaskId);
      
      // Step 2: Find and start an assignment
      const findAssignmentTaskId = await this.createFindAssignmentTask();
      await this.waitForTaskCompletion(findAssignmentTaskId);
      
      // Course completion loop
      let courseComplete = false;
      let sectionCount = 0;
      let courseContent = initialCourseContent;
      let examCompleted = false;
      
      while (!courseComplete && sectionCount < 100) { // Safety limit
        sectionCount++;
        this.log(`Processing section ${sectionCount}...`);
        
        // Step 3: Extract content if we don't have it yet
        if (!courseContent) {
          const extractContentTaskId = await this.createExtractContentTask();
          const extractResult = await this.waitForTaskCompletion(extractContentTaskId);
          courseContent = extractResult.result?.extracted_text || '';
          this.log(`Extracted ${courseContent.length} characters of content`);
          
          // Save content to file
          const contentFile = path.join(config.logDir, `${this.sessionId}_section${sectionCount}_content.txt`);
          fs.writeFileSync(contentFile, courseContent);
        }
        
        // Step 4: Handle video if present
        const watchVideoTaskId = await this.createWatchVideoTask();
        const videoResult = await this.waitForTaskCompletion(watchVideoTaskId);
        const videoFound = videoResult.result?.video_found || false;
        
        if (videoFound) {
          this.log('Video was found and processed');
        } else {
          this.log('No video found on this page');
        }
        
        // Step 5: Answer questions if present
        const answerQuestionsTaskId = await this.createAnswerQuestionsTask(courseContent);
        const questionsResult = await this.waitForTaskCompletion(answerQuestionsTaskId);
        const questionsFound = questionsResult.result?.questions_found || false;
        
        if (questionsFound) {
          this.log('Questions were found and answered');
        } else {
          this.log('No questions found on this page');
        }
        
        // Step 5.5: Handle quiz if present
        const handleQuizTaskId = await this.createHandleQuizTask();
        const quizResult = await this.waitForTaskCompletion(handleQuizTaskId);
        const quizFound = quizResult.result?.quiz_found || false;
        
        if (quizFound) {
          this.log('Quiz was found and handled');
          // If quiz was successfully handled, it may have already navigated to the next page
          // Check if we're on a new page before trying to navigate again
          continue;
        } else {
          this.log('No quiz found on this page');
        }
        
        // Check if we're on the final assignment page
        // Look for indicators like "Summary" heading, page counter showing last page, etc.
        const pageContent = await this.client.get('/page_content');
        const isFinalPage = pageContent.data.includes('Summary') && 
                           (pageContent.data.includes('Slide 35/35') || 
                            pageContent.data.includes('100% Complete'));
        
        if (isFinalPage) {
          this.log('Final assignment page detected');
          
          // Navigate to the next section (which should be the exam agreement page)
          const navigateNextTaskId = await this.createNavigateNextTask();
          await this.waitForTaskCompletion(navigateNextTaskId);
          
          // Check if we're on the exam agreement page
          const pageContentAfterNav = await this.client.get('/page_content');
          const isAgreementPage = pageContentAfterNav.data.includes('Exam Agreement') && 
                                 pageContentAfterNav.data.includes('I understand and agree');
          
          if (isAgreementPage) {
            this.log('Exam agreement page detected');
            
            // Handle the exam agreement page
            const handleAgreementTaskId = await this.createHandleExamAgreementTask();
            await this.waitForTaskCompletion(handleAgreementTaskId);
            
            // Now we should be on the exam page
            // Handle the final exam
            const handleExamTaskId = await this.createHandleExamTask(courseContent);
            await this.waitForTaskCompletion(handleExamTaskId);
            
            this.log('Exam completed successfully');
            examCompleted = true;
            courseComplete = true;
          }
        }
        
        // Step 6: Navigate to next section
        const navigateNextTaskId = await this.createNavigateNextTask();
        const navigateResult = await this.waitForTaskCompletion(navigateNextTaskId);
        const nextButtonFound = navigateResult.result?.next_button_found || false;
        
        if (!nextButtonFound) {
          this.log('No next button found. Course may be complete.');
          courseComplete = true;
        } else {
          this.log('Navigated to next section');
          // Reset course content for the new section
          courseContent = '';
          
          // Small delay to ensure page loads
          await sleep(3000);
        }
      }
      
      if (examCompleted) {
        this.log(`Course and final exam completed! Processed ${sectionCount} sections.`);
      } else {
        this.log(`Course completed! Processed ${sectionCount} sections.`);
      }
    } catch (error) {
      this.log(`Error during course completion: ${error}`);
      throw error;
    }
  }
}

/**
 * Run the Target Solutions automation using Skyvern
 */
async function runSkyvernEnhancedAutomation(): Promise<void> {
  console.log('Starting enhanced Target Solutions automation with Skyvern...');
  
  const skyvernClient = new SkyvernClient();
  
  try {
    // Option 1: Complete course with individual tasks (more flexible)
    await skyvernClient.completeCourseWithTasks();
    
    // Option 2: Use workflow (less flexible but more structured)
    // const workflowId = await skyvernClient.createCourseWorkflow('');
    // const runId = await skyvernClient.runWorkflow(workflowId);
    // await skyvernClient.waitForWorkflowCompletion(runId);
    
    console.log('Skyvern automation completed successfully!');
  } catch (error) {
    console.error('Error during Skyvern automation:', error);
  }
}

// Run the automation if this file is executed directly
if (require.main === module) {
  runSkyvernEnhancedAutomation().catch(console.error);
}

// Export functions for external use
export {
  SkyvernClient,
  runSkyvernEnhancedAutomation
};