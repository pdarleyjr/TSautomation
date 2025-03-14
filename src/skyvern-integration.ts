/**
 * Target Solutions LMS Automation using Skyvern
 * 
 * This file demonstrates how to use Skyvern to automate Target Solutions LMS.
 * Skyvern uses AI and computer vision to interact with websites, making it more
 * resilient to UI changes compared to traditional automation tools. Skyvern can be
 * run locally using Docker Compose as described in the Skyvern documentation.
 */

// Note: This is a template for Skyvern integration. You'll need to adapt it
// based on your actual Skyvern setup and API access.

import dotenv from 'dotenv';
import axios from 'axios';
import { skyvernAuth as skyvernAuthV1 } from './skyvern-auth-handler';
import { skyvernAuthV2 } from './skyvern-auth-v2-handler';
import logger from './logger';

// Import LangChain integration
import * as langchain from './langchain-integration';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  username: process.env.TS_USERNAME || 'peterdarley@miamibeachfl.gov',
  password: process.env.TS_PASSWORD || '',
  // Skyvern configuration is now handled by the auth handler
  // Use v2 API by default
  useV2Api: process.env.USE_V2_API !== 'false',
  skyvernAuth: process.env.USE_V2_API !== 'false' ? skyvernAuthV2 : skyvernAuthV1
};

/**
 * Create a Skyvern task to login to Target Solutions
 */
async function createLoginTask(): Promise<string> {
  const loginTask = {
    url: 'https://app.targetsolutions.com/auth/index.cfm?action=login.showlogin&customerid=27837&customerpath=miamibeach&timeout',
    navigation_goal: `
      Log in to Target Solutions using the following credentials:
      Username: ${config.username}
      Password: ${config.password}
    `,
    max_steps: 10,
  };

  try {
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.post<{task_id: string}>('/tasks', loginTask);
    return response.task_id;
  } catch (error) {
    logger.error('Error creating login task:', error);
    throw new Error(`Failed to create login task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a Skyvern task to find and start an assignment
 */
async function createFindAssignmentTask(): Promise<string> {
  const findAssignmentTask = {
    url: 'https://app.targetsolutions.com/tsapp/dashboard/pl_fb/index.cfm?fuseaction=c_pro.showHome',
    navigation_goal: `
      Look at the dashboard and find the first available assignment (not an event).
      Events typically have "Event" in their title, while assignments don't.
      Click on the first assignment to start it.
      Ignore any items that have "Event" in their title.
    `,
    max_steps: 15,
  };

  try {
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.post<{task_id: string}>('/tasks', findAssignmentTask);
    return response.task_id;
  } catch (error) {
    logger.error('Error creating find assignment task:', error);
    throw new Error(`Failed to create find assignment task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a Skyvern task to complete a course
 */
async function createCompleteCourseTask(): Promise<string> {
  const completeCourseTask = {
    // No URL needed as we'll be continuing from the previous task
    navigation_goal: `
      Complete the course by following these steps:
      1. For each page in the course:
         a. If there's a video, wait for it to finish playing
         b. If there's a "Next Section" button that appears after the video, click it
         c. If there are questions, read the content and answer them based on the material
         d. Click the "Next" button to proceed to the next page
      2. Continue until you reach the end of the course
      
      Important notes:
      - Videos must be fully watched before proceeding
      - For multiple choice questions, select the best answer based on the course content
      - If you encounter any issues, try to resolve them and continue
    `,
    max_steps: 100, // Courses can be long, so allow many steps
  };

  try {
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.post<{task_id: string}>('/tasks', completeCourseTask);
    return response.task_id;
  } catch (error) {
    logger.error('Error creating complete course task:', error);
    throw new Error(`Failed to create complete course task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Check the status of a Skyvern task
 */
async function checkTaskStatus(taskId: string): Promise<{status: string, error?: string}> {
  try {
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.get<{status: string, error?: string}>(`/tasks/${taskId}`);
    return response;
  } catch (error) {
    logger.error(`Error checking status of task ${taskId}:`, error);
    throw new Error(`Failed to check task status: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Wait for a Skyvern task to complete
 */
async function waitForTaskCompletion(
  taskId: string, 
  pollingIntervalMs = 5000,
  maxAttempts = 60
): Promise<any> {
  logger.info(`Waiting for task ${taskId} to complete...`);
  
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    attempts++;
    const taskStatus: any = await checkTaskStatus(taskId);
    
    if (taskStatus.status === 'completed') {
      logger.info(`Task ${taskId} completed successfully!`);
      return taskStatus as any;
    } else if (taskStatus.status === 'failed') {
      logger.error(`Task ${taskId} failed:`, taskStatus.error);
      throw new Error(`Task ${taskId} failed: ${taskStatus.error || 'Unknown error'}`);
    }
    
    logger.info(`Task ${taskId} status: ${taskStatus.status}. Waiting...`);
    await new Promise(resolve => setTimeout(resolve, pollingIntervalMs));
  }
  
  throw new Error(`Task ${taskId} did not complete within the maximum number of attempts (${maxAttempts})`);
}

/**
 * Create a Skyvern workflow to automate Target Solutions with LangChain integration
 */
async function createWorkflowWithAI(courseContent: string = ''): Promise<string[]> {
  // Use LangChain to process and understand the course content
  let processedContent = courseContent;
  let keyConcepts: string[] = [];
  
  if (courseContent) {
    try {
      // Extract key concepts from the course content
      keyConcepts = await langchain.extractKeyConcepts(courseContent) || [];
      
      // Summarize the course content for better context
      const summary = await langchain.summarizeCourseContent(courseContent);
      processedContent = summary;
      
      logger.info('Course content processed with LangChain');
      logger.debug('Key concepts:', keyConcepts);
    } catch (error) {
      console.error('Error processing course content with LangChain:', error);
    }
  }
  
  // Create enhanced task descriptions using the processed content
  const loginTask = {
    url: 'https://app.targetsolutions.com/auth/index.cfm?action=login.showlogin&customerid=27837&customerpath=miamibeach&timeout',
    navigation_goal: `
      Log in to Target Solutions using the following credentials:
      Username: ${config.username}
      Password: ${config.password}
    `,
    max_steps: 10,
  };
  
  const findAssignmentTask = {
    url: 'https://app.targetsolutions.com/tsapp/dashboard/pl_fb/index.cfm?fuseaction=c_pro.showHome',
    navigation_goal: `
      Look at the dashboard and find the first available assignment (not an event).
      Events typically have "Event" in their title, while assignments don't.
      Click on the first assignment to start it.
      Ignore any items that have "Event" in their title.
    `,
    max_steps: 15,
  };
  
  // Enhanced course completion task with AI understanding
  const completeCourseTask = {
    navigation_goal: `
      Complete the course by following these steps:
      1. For each page in the course:
         a. If there's a video, wait for it to finish playing
         b. If there's a "Next Section" button that appears after the video, click it
         c. If there are questions, read the content and answer them based on the material
         d. Click the "Next" button to proceed to the next page
      2. Continue until you reach the end of the course
      
      Important notes:
      - Videos must be fully watched before proceeding
      - For multiple choice questions, select the best answer based on the course content
      - If you encounter any issues, try to resolve them and continue
      
      Key concepts to focus on:
      ${keyConcepts.length > 0 ? keyConcepts.map(c => `- ${c}`).join('\n') : 'No key concepts identified yet'}
    `,
    navigation_payload: {
      course_summary: processedContent,
    },
    max_steps: 100,
  };
  
  try {
    const loginTaskId = await createCustomTask(loginTask); 
    const findAssignmentTaskId = await createCustomTask(findAssignmentTask);
    const completeCourseTaskId = await createCustomTask(completeCourseTask);
    
    return [loginTaskId, findAssignmentTaskId, completeCourseTaskId];
  } catch (error) {
    logger.error('Error creating enhanced workflow:', error);
    throw new Error(`Failed to create workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Create a Skyvern workflow
 */
async function createWorkflow(): Promise<string> {
  interface Task {
    name: string;
    task_id: string | null;
  }

  const workflow: {
    name: string;
    description: string;
    tasks: Task[];
  } = {
    name: 'Target Solutions Automation',
    description: 'Automate Target Solutions LMS to complete assignments',
    tasks: [
      {
        name: 'Login to Target Solutions',
        task_id: null,
      },
      {
        name: 'Find and start an assignment',
        task_id: null,
      },
      {
        name: 'Complete the course',
        task_id: null,
      }
    ]
  };

  try {
    // Create task ID variables
    const loginTaskId = await createLoginTask();
    const findAssignmentTaskId = await createFindAssignmentTask();
    const completeCourseTaskId = await createCompleteCourseTask();
    
    // Update the task IDs
    const updatedTasks: Task[] = [
      {name: 'Login to Target Solutions', task_id: loginTaskId},
      {name: 'Find and start an assignment', task_id: findAssignmentTaskId},
      {name: 'Complete the course', task_id: completeCourseTaskId}
    ];
    
    const workflowToSubmit = {
      ...workflow,
      tasks: updatedTasks
    };
    
    // Create the workflow
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.post<{workflow_id: string}>('/workflows', workflowToSubmit);
    return response.workflow_id;
  } catch (error) {
    logger.error('Error creating workflow:', error);
    throw new Error(`Failed to create workflow: ${error instanceof Error ? 
      error.message : 'Unknown error'}`);
  }
}

/**
 * Run the Target Solutions automation using Skyvern
 */
async function main(): Promise<void> {
  logger.info('Starting Target Solutions automation with Skyvern...');
  
  try {
    // Ensure the auth handler is initialized
    await config.skyvernAuth.ensureInitialized();
    // Option 1: Run tasks sequentially
    logger.info('Running tasks sequentially...');
    
    // Login
    const loginTaskId = await createLoginTask();
    await waitForTaskCompletion(loginTaskId);
    
    // Find and start an assignment
    const findAssignmentTaskId = await createFindAssignmentTask();
    await waitForTaskCompletion(findAssignmentTaskId);
    
    // Complete the course
    const completeCourseTaskId = await createCompleteCourseTask();
    await waitForTaskCompletion(completeCourseTaskId);
    
    logger.info('All tasks completed successfully!');
    
    // Option 2: Create and run a workflow
    // logger.info('Creating workflow...');
    // const workflowId = await createWorkflow();
    // logger.info(`Workflow created with ID: ${workflowId}`);
    //
    // logger.info('Running workflow...');
    // const runResponse = await skyvernAuth.post<{run_id: string}>(`/workflows/${workflowId}/run`, {});
    // const runId = runResponse.run_id;
    // 
    // logger.info(`Workflow run started with ID: ${runId}`);
    // // You would then poll for the workflow run status
    
  } catch (error) {
    logger.error('Error during automation:', error);
  }
}

/**
 * Create a custom Skyvern task with specific parameters
 */
async function createCustomTask(taskParams: any): Promise<string> {
  try {
    await config.skyvernAuth.ensureInitialized();
    const response = await config.skyvernAuth.post<{task_id: string}>('/tasks', taskParams);
    return response.task_id;
  } catch (error) {
    logger.error('Error creating custom task:', error);
    throw new Error(`Failed to create custom task: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Run the Target Solutions automation using enhanced Skyvern + LangChain
 */
async function runEnhancedAutomation(): Promise<void> {
  logger.info('Starting enhanced Target Solutions automation with Skyvern and LangChain...');
  
  try {
    // Ensure the auth handler is initialized
    await config.skyvernAuth.ensureInitialized();

    // Login to get to the dashboard
    const loginTaskId = await createLoginTask();
    await waitForTaskCompletion(loginTaskId);
    
    // Use the LangChain + Skyvern integration for the rest of the workflow
    const tasks = await createWorkflowWithAI();
    const findAssignmentTaskId = tasks[1];
    const completeCourseTaskId = tasks[2];
    await waitForTaskCompletion(findAssignmentTaskId);
    await waitForTaskCompletion(completeCourseTaskId);
  } catch (error) {
    logger.error('Error during enhanced automation:', error);
  }
}

// Standard execution - run only if directly executed (will be properly configured once @types/node is installed)
main().catch((err) => logger.error('Error in main execution:', err));

// Export functions for external use
export {
  createLoginTask,
  createFindAssignmentTask,
  checkTaskStatus,
  waitForTaskCompletion,
  createCompleteCourseTask,
  createCustomTask,
  createWorkflow,
  runEnhancedAutomation,
  main as runSkyvernAutomation
};