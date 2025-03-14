import { firefox, Page } from 'playwright';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import { CourseInfo, Assignment, extractCourseInfo, getAvailableCourses, scanDashboardForAssignments, formatTime, sleep, randomDelay, ParallelExecutor } from './utils';
import { answerQuestion, summarizeCourseContent } from './langchain-integration';
import logger, { LogLevel } from './logger';
import appConfig from './config';
import SessionHandler from './session-handler';
import TimeTracker from './time-tracker';
import WorkflowManager from './workflow-manager';
import DynamicSkyvernBridge from './dynamic-skyvern';
import PageNavigator, { PageType } from './page-navigator';

dotenv.config();

// Configuration
export const config = {
  username: 'peterdarley@miamibeachfl.gov', // Use the actual credentials directly
  password: 'Ampbj1206', // Use the actual credentials directly
  loginUrl: process.env.TS_LOGIN_URL || 'https://app.targetsolutions.com/auth/index.cfm',
  openaiApiKey: process.env.OPENAI_API_KEY,
  skyvernApiKey: process.env.SKYVERN_API_KEY,
  headless: process.env.HEADLESS === 'true', // Set to true for production
  courseId: process.env.COURSE_ID, // Optional: specific course ID to complete
  slowMo: 50, // Slow down operations for visibility
  browser: {
    headless: process.env.HEADLESS === 'true',
    slowMo: parseInt(process.env.SLOW_MO || '50'),
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000'),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  },
  useSessionHandler: process.env.USE_SESSION_HANDLER !== 'false',
  useWorkflowManager: process.env.USE_WORKFLOW_MANAGER !== 'false'
};

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

/**
 * Login to Target Solutions
 */
async function login(page: Page): Promise<void> {
  console.log('Logging in to Target Solutions...');

  console.log(`Using credentials: ${config.username} / [password hidden]`);

  // Navigate to the login page with customer parameters
  await page.goto('https://app.targetsolutions.com/auth/index.cfm?action=login.showloginone&customerid=0&customerpath=login&msg=');

  // Wait for login form and fill credentials
  await page.waitForSelector('#username', { timeout: config.browser.defaultTimeout });
  
  // Fill in the username and password
  await page.fill('#username', config.username);
  await page.fill('#password', config.password);
  
  console.log('Credentials entered, attempting to login...');

  // Attempt clicking on the login button using alternative selectors
  const loginButtonSelectors = ['#login-button', "button[type='submit']", "input[type='submit']"];
  let clicked = false;
  for (const selector of loginButtonSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 5000 });
      await page.click(selector);
      console.log(`Clicked login button using selector: ${selector}`);
      clicked = true;
      break;
    } catch (error) {
      console.log(`Selector ${selector} not found, trying next.`);
    }
  }
  if (!clicked) {
    throw new Error('Login button not found using any selector.');
  }
  
  try {
    console.log('Login button clicked, waiting for response...');
    
    // Take a screenshot to see what's happening after login button click
    await page.screenshot({ path: 'login-attempt.png' });
    console.log('Screenshot saved to login-attempt.png');
    
    
    // First, wait for any navigation or network activity to settle
    await page.waitForLoadState('networkidle', { timeout: config.browser.defaultTimeout });
    
    // Check if we're still on the login page (login failed)
    const stillOnLoginPage = await page.$$('#username, #password, input[type="submit"]')
      .then(elements => elements.length >= 2);
    
    // Take another screenshot after network activity settles
    await page.screenshot({ path: 'after-login-attempt.png' });
    console.log('Screenshot saved to after-login-attempt.png');
    
    
    if (stillOnLoginPage) {
      // Check if there's an error message
      const errorMessage = await page.$eval('.error-message, .alert, .notification', 
        el => el.textContent?.trim(), 
        { timeout: 5000 }).catch(() => null);
      
      if (errorMessage) {
        throw new Error(`Login failed: ${errorMessage}`);
      } 
      
      // Get the current URL to help with debugging
      const currentUrl = page.url();
      console.log(`Current URL after login attempt: ${currentUrl}`);
      
      // Log the HTML content of the page for debugging
      const pageContent = await page.content();
      console.log('Page content after login attempt:');
      console.log('=================================');
      console.log(pageContent.substring(0, 500) + '...');
      console.log('=================================');
      
      if (currentUrl.includes('login') || currentUrl.includes('auth')) {
        throw new Error('Login failed: Still on login page after submission');
      }
    }
    
    // If we're not on the login page, assume login was successful
    console.log('Login appears successful - no longer on login page');
    
    // Wait a moment for the dashboard to fully load
    await page.waitForTimeout(3000);
  } catch (error: any) {
    throw new Error(`Login process error: ${error.message}`);
  }
}
/**
 * Find and start an assignment from the dashboard
 */
async function findAndStartAssignment(page: Page): Promise<CourseInfo | null> {
  console.log('Scanning dashboard for assignments...');
  
  // Get all assignments from the dashboard
  const assignments = await scanDashboardForAssignments(page);
  
  // Filter out events, only keep assignments
  const availableAssignments = assignments.filter(a => !a.isEvent);
  
  if (availableAssignments.length === 0) {
    console.log('No assignments found on the dashboard. Nothing to complete.');
    return null;
  }
  
  // Select the first assignment
  const selectedAssignment = availableAssignments[0];
  console.log(`Selected assignment: ${selectedAssignment.name} (ID: ${selectedAssignment.id})`);
  
  // Click on the assignment link to start it - using the transcript ID from the row
  await page.click(`#row${selectedAssignment.id} a, a[href*="transcriptID=${selectedAssignment.id}"]`);
  await page.waitForLoadState('networkidle', { timeout: config.browser.defaultTimeout });
  
  // Extract course info from the page
  const courseInfo = await extractCourseInfo(page) || { id: selectedAssignment.id, name: selectedAssignment.name };
  return courseInfo;
}

/**
 * Navigate to a specific course
 */
async function navigateToCourse(page: Page, courseId?: string): Promise<CourseInfo | null> {
  // If no course ID is provided, let the user select from available courses
  if (!courseId) {
    console.log('No course ID provided. Fetching available courses...');
    
    const courses = await getAvailableCourses(page);
    
    if (courses.length === 0) {
      console.log('No courses found. Please check your Target Solutions account.');
      return null;
    }
    
    // Log available courses
    console.log('Available courses:');
    courses.forEach((course, index) => {
      console.log(`${index + 1}. ${course.name} (ID: ${course.id})`);
    });
    
    // For automation, we'll just take the first course
    // In a real implementation, you might want to add user input here
    const selectedCourse = courses[0];
    console.log(`Automatically selected course: ${selectedCourse.name}`);
    courseId = selectedCourse.id;
  }
  
  console.log(`Navigating to course ID: ${courseId}`);
  
  // Navigate to the course page - using the URL format from the provided HTML
  await page.goto(`https://app.targetsolutions.com/training/course/preview.cfm?courseid=${courseId}`);
  
  // Wait for course content to load
  await page.waitForSelector('#lesson-content, #course-content', { timeout: config.browser.defaultTimeout });
  
  // Extract course info from the page
  const courseInfo = await extractCourseInfo(page) || { id: courseId, name: 'Unknown Course' };
  return courseInfo;
}

/**
 * Extract course content text for AI processing
 */
async function extractCourseText(page: Page): Promise<string> {
  console.log('Extracting course content...');
  
  // Get text from the course content area
  const contentSelector = '#lesson-content';
  await page.waitForSelector(contentSelector, { timeout: config.browser.defaultTimeout });
  
  const courseText = await page.locator(contentSelector).innerText();
  
  console.log(`Extracted ${courseText.length} characters of content`);
  return courseText;
}

/**
 * Simulate watching a video by waiting for it to complete
 */
async function watchVideo(page: Page): Promise<void> {
  console.log('Checking for video content...');
  const startTime = Date.now();

  try {
    // Multiple detection strategies for videos
    const videoDetectionStrategies = [
      async () => {
        const elements = await page.$$('#mediaspace, video, iframe[src*="vimeo"], iframe[src*="youtube"]');
        return elements.length > 0 ? 'Standard video elements' : null;
      },
      async () => {
        const elements = await page.$$('.video-player, .media-player, .ts-video-player');
        return elements.length > 0 ? 'Video player containers' : null;
      },
      async () => {
        const elements = await page.$$('.video-container, .media-container');
        return elements.length > 0 ? 'Video containers' : null;
      },
      async () => {
        const elements = await page.$$('.video-controls, .media-controls, .vjs-control-bar');
        return elements.length > 0 ? 'Video controls' : null;
      }
    ];

    // Try each detection strategy
    let videoDetected = false;
    let detectionMethod = '';

    for (const strategy of videoDetectionStrategies) {
      const result = await strategy();
      if (result) {
        videoDetected = true;
        detectionMethod = result;
        break;
      }
    }

    if (!videoDetected) {
      console.log('No video found on this page');
      return;
    }

    console.log(`Video detected using ${detectionMethod}. Waiting for it to complete...`);

    // Multiple completion detection strategies
    const completionStrategies = [
      // Strategy 1: Wait for the "Next Section" modal to appear
      async () => {
        try {
          const nextButton = await page.waitForSelector('#dialog_next_slide', { timeout: 10000 });
          if (nextButton) {
            console.log('Video completion detected: Next button dialog appeared');
            await page.click('#dialog_next_slide .btn-primary, .next-button, .continue-button');
            return true;
          }
        } catch (e) {}
        return false;
      },
      
      // Strategy 2: Check for completion indicators
      async () => {
        const indicators = [
          '.video-completed', '.video-complete', '.completion-indicator', 
          '.video-progress-100', '[data-state="ended"]', '.vjs-ended'
        ];
        
        for (const indicator of indicators) {
          try {
            const element = await page.$(indicator);
            if (element) {
              console.log(`Video completion detected: ${indicator} found`);
              return true;
            }
          } catch (e) {}
        }
        return false;
      },
      
      // Strategy 3: Monitor video progress
      async () => {
        try {
          const progress = await page.$eval('video', (video) => {
            if (video.duration && video.currentTime) {
              return video.currentTime / video.duration;
            }
            return 0;
          });
          
          if (progress > 0.95) {
            console.log(`Video completion detected: Progress at ${Math.round(progress * 100)}%`);
            return true;
          }
        } catch (e) {}
        return false;
      },
      
      // Strategy 4: Check for next button appearance
      async () => {
        const nextButtons = [
          '.btn-next', '.btn-continue', '.next-button', 
          'button:has-text("Next")', 'button:has-text("Continue")'
        ];
        
        for (const button of nextButtons) {
          try {
            const isVisible = await page.isVisible(button);
            if (isVisible) {
              console.log(`Video completion detected: ${button} is visible`);
              await page.click(button);
              console.log(`Clicked ${button} after video completion`);
              return true;
            }
          } catch (e) {}
        }
        return false;
      }
    ];

    // Monitor for completion using all strategies
    const maxWaitTime = 600000; // 10 minutes maximum wait time
    const checkInterval = 5000; // Check every 5 seconds
    let videoDuration = 0;
    let lastProgress = 0;
    let lastProgressTime = Date.now();

    // Try to get initial video duration if available
    try {
      videoDuration = await page.$eval('video', (video) => video.duration || 0);
      if (videoDuration > 0) {
        console.log(`Video duration detected: ${Math.round(videoDuration)} seconds`);
      }
    } catch (e) {
      console.log('Could not determine video duration');
    }

    while (Date.now() - startTime < maxWaitTime) {
      // Try all completion strategies
      let completed = false;
      
      for (const strategy of completionStrategies) {
        if (await strategy()) {
          completed = true;
          break;
        }
      }
      
      if (completed) {
        const elapsedTime = Date.now() - startTime;
        console.log(`Video completed after ${formatTime(elapsedTime / 1000)}`);
        return;
      }
      
      // Monitor progress to detect stalls and log progress
      try {
        const currentTime = await page.$eval('video', (video) => video.currentTime || 0);
        
        if (currentTime > lastProgress) {
          // Progress is being made
          lastProgressTime = Date.now();
          
          // Log progress every 10%
          if (videoDuration > 0) {
            const progressPercent = Math.round((currentTime / videoDuration) * 100);
            const lastProgressPercent = Math.round((lastProgress / videoDuration) * 100);
            
            if (Math.floor(progressPercent / 10) > Math.floor(lastProgressPercent / 10)) {
              console.log(`Video progress: ${progressPercent}%`);
            }
            
            // Store current progress in localStorage for stall detection
            await page.evaluate((time) => localStorage.setItem('lastVideoProgress', time.toString()), currentTime);
          }
          
          lastProgress = currentTime;
        } else {
          // Check for stalled playback
          const stallTime = Date.now() - lastProgressTime;
          if (stallTime > 30000 && lastProgress > 0) { // 30 seconds of no progress
            console.log(`Video playback stalled for ${Math.round(stallTime / 1000)}s, attempting to resume`);
            
            try {
              await page.evaluate(() => {
                const video = document.querySelector('video');
                if (video && video.paused) {
                  video.play();
                }
                // Try to skip ahead slightly if stuck
                if (video && video.currentTime === parseFloat(localStorage.getItem('lastVideoProgress') || '0')) {
                  video.currentTime += 1.0;
                }
              });
              console.log('Attempted to resume video playback');
            } catch (e) {
              console.log('Failed to resume video playback');
            }
          }
        }
      } catch (e) {
        // Ignore errors in progress monitoring
      }
      
      await sleep(checkInterval);
      console.log(`Still waiting for video completion (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
    }

    console.log('Video wait timeout exceeded');
    
    // Final attempt to find and click next button
    try {
      await page.click('.btn-next, .btn-continue, .next-button, button:has-text("Next")');
      console.log('Clicked next button after timeout');
    } catch (e) {
      console.log('No next button found after timeout');
    }
  } catch (e) {
    console.log('Error in video handling:', e);
  }
}

/**
 * Answer questions using AI (LangChain/OpenAI)
 */
async function answerQuestionWithAI(page: Page, useSessionHandler: boolean = false): Promise<void> {
  console.log('Checking for questions...');
  
  // Check if there are questions on the page
  const hasQuestions = await page.$$eval('.question, input[type="radio"], input[type="checkbox"]', 
    elements => elements.length > 0);
  
  if (!hasQuestions) {
    console.log('No questions found on this page');
    return;
  }
  
  console.log('Questions detected. Extracting content for AI...');
  
  // Extract the course text and questions
  const courseText = await extractCourseText(page);

  // Generate a summary of the course content for better context
  const courseSummary = await summarizeCourseContent(courseText);
  
  // Get all question text
  const questions = await page.$$eval('.question, .question-text', 
    elements => elements.map(el => el.textContent?.trim()));
  
  console.log(`Found ${questions.length} questions`);
  
  // For each question, generate an AI response
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    console.log(`Processing question ${i+1}: ${question}`);
    
    // Use LangChain integration to answer the question
    let responseText = "";
    try {
      responseText = await answerQuestion(question || '', courseText || '');
    } catch (error) {
      console.error('Error using LangChain for question answering:', error);
      // Fallback to OpenAI direct API
      responseText = await legacyAnswerQuestion(question || '', courseText || '');
    }
    console.log(`AI Response: ${responseText}`);
    
    // Find and select the correct answer based on AI response
    // This is a simplified approach - in reality, you'd need to match the AI response
    // to the available options and select the most appropriate one
    
    // For radio buttons (single choice)
    const radioButtons = await page.$$('input[type="radio"]');
    if (radioButtons.length > 0) {
      // Get all label text for radio buttons
      const options = await page.$$eval('input[type="radio"] + label, label:has(input[type="radio"])', 
        elements => elements.map(el => el.textContent?.trim()));
      
      // Find the best match between AI response and available options
      let bestMatchIndex = 0;
      let bestMatchScore = 0;
      
      for (let j = 0; j < options.length; j++) {
        const option = options[j] || "";
        const score = calculateSimilarity(responseText, option);
        
        if (score > bestMatchScore) {
          bestMatchScore = score;
          bestMatchIndex = j;
        }
      }
      
      // Select the best matching option
      await radioButtons[bestMatchIndex].click();
      console.log(`Selected option: ${options[bestMatchIndex]}`);
    }
    
    // For checkboxes (multiple choice)
    const checkboxes = await page.$$('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      // For simplicity, we'll just select the first checkbox
      // In a real implementation, you'd need more sophisticated logic
      await checkboxes[0].click();
      console.log('Selected first checkbox option');
    }
    
    // For text input questions
    const textInputs = await page.$$('input[type="text"], textarea');
    if (textInputs.length > 0) {
      await textInputs[0].fill(responseText);
      console.log('Filled text input with AI response');
    }
  }
  
  // Submit the answers
  const submitButton = await page.$('.submit-button, #submit, button[type="submit"]');
  if (submitButton) {
    await submitButton.click();
    console.log('Submitted answers');
    await page.waitForTimeout(2000); // Wait for submission to process
  }
}

/**
 * Legacy method to answer questions using OpenAI directly (fallback)
 */
async function legacyAnswerQuestion(question: string, courseText: string): Promise<string> {
  console.log('Using legacy OpenAI method for question answering');
  
  // Generate AI response
  const prompt = `
    Based on this course material: 
    ${courseText.substring(0, 4000)}... 
    
    Please answer this question: ${question}
    
    Provide only the answer, no explanations.
  `;
  
  const aiResponse = await openai.chat.completions.create({ 
    model: "gpt-3.5-turbo", 
    messages: [{ role: "user", content: prompt }],
    temperature: 0.3 // Lower temperature for more accurate responses
  });
  
  return aiResponse.choices[0]?.message?.content || "";
}

/**
 * Simple text similarity function
 */
function calculateSimilarity(text1: string, text2: string): number {
  const set1 = new Set(String(text1).toLowerCase().split(' '));
  const set2 = new Set(text2.toLowerCase().split(' '));
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return intersection.size / union.size;
}

/**
 * Navigate to the next page/section
 */
async function goToNextSection(page: Page): Promise<boolean> {
  console.log('Attempting to navigate to next section...');
  
  // Look for next buttons with various selectors - from the HTML, we know it's #nextPager
  const nextButtonSelectors = [
    '#nextPager', 
    '.next-button', 
    '.continue-button', 
    'button:has-text("Next")', 
    'a:has-text("Next")'
  ];
  
  for (const selector of nextButtonSelectors) {
    const hasNextButton = await page.$(selector) !== null;
    
    if (hasNextButton) {
      console.log(`Found next button with selector: ${selector}`);
      // Try to click the anchor inside the nextPager div or the element itself
      try {
        await page.click(`${selector} a`);
      } catch (e) {
        // If clicking the anchor fails, try clicking the element directly
        await page.click(selector);
      }
      await page.waitForTimeout(2000); // Wait for navigation
      return true;
    }
  }
  
  console.log('No next button found. Course may be complete.');
  return false;
}

/**
 * Complete an entire course
 */
async function completeCourse(page: Page, courseInfo: CourseInfo, useSessionHandler: boolean = true): Promise<void> {
  console.log(`Starting completion process for course: ${courseInfo.name} (ID: ${courseInfo.id})`);
  
  let hasNextSection = true;
  let sectionCount = 0;
  const startTime = Date.now();
  let pageNavigator: PageNavigator | null = null;
  let workflowManager: WorkflowManager | null = null;
  let skyvernBridge: DynamicSkyvernBridge | null = null;
  
  // Add a small delay to ensure the page is fully loaded
  await sleep(randomDelay(1000, 2000));
  
  // Use the new SessionHandler if enabled
  if (useSessionHandler) {
    try {
      // Create workflow manager if enabled
      if (config.useWorkflowManager) {
        workflowManager = new WorkflowManager(page);
        logger.info('Workflow manager initialized');
      }
      
      // Create session handler with workflow manager
      const sessionHandler = new SessionHandler(page, courseInfo, 3, config.browser.defaultTimeout, workflowManager || undefined);
      
      await sessionHandler.completeCourse();
      return;
    } catch (error) {
      console.error('Error using SessionHandler, falling back to legacy method:', error);
      // Fall back to legacy method
      logger.warn('Falling back to legacy course completion method');
    }
  }

  // Initialize the PageNavigator
  pageNavigator = new PageNavigator(page);
  
  // Initialize the DynamicSkyvernBridge for fallback to Skyvern when needed
  skyvernBridge = new DynamicSkyvernBridge(page);
  logger.info('Dynamic Skyvern Bridge initialized for fallback support');

  // Initialize the WorkflowManager for legacy mode if enabled
  if (config.useWorkflowManager && !workflowManager) {
    workflowManager = new WorkflowManager(page);
    await workflowManager.startAssignment(courseInfo.id, courseInfo.name);
    logger.info('Workflow manager initialized in legacy mode');
  }
  
  while (hasNextSection) {
    sectionCount++;
    console.log(`Processing section ${sectionCount}...`);
    
    // Extract content for logging/debugging
    try {
      const courseText = await extractCourseText(page);
      // Update the page navigator with the course content
      if (pageNavigator && courseText) {
        pageNavigator.updateCourseContent(courseText);
      }
      skyvernBridge?.updateCourseContent(courseText);
    } catch (e) {
      console.log('Could not extract course text', e);
    }
    
    // Check for course review page and handle it
    if (pageNavigator) {
      try {
        const isReviewPage = await pageNavigator.isCourseReviewPage();
        if (isReviewPage) {
          await pageNavigator.handleCourseReview();
        }
      } catch (e) {
        console.log('Error checking for course review page:', e);
      }
    }
    
    // Try to navigate the page using the PageNavigator
    if (pageNavigator) {
      try {
        const navigated = await pageNavigator.navigatePage();
        if (navigated) {
          console.log('Page successfully navigated using PageNavigator');
          // If the page was successfully navigated, it might have already moved to the next page
          // Wait for the next page to load
          await page.waitForTimeout(3000);
          continue;
        }
        
        // If PageNavigator failed, try using Skyvern directly for complex scenarios
        if (skyvernBridge && pageNavigator.getLastDetectedPageType() !== PageType.UNKNOWN) {
          try {
            logger.info('PageNavigator failed, attempting to use Skyvern directly');
            const navigated = await skyvernBridge.handleNavigation();
            if (navigated) {
              logger.info('Page successfully navigated using Skyvern');
              await page.waitForTimeout(3000);
              continue;
            }
          } catch (e) {
            logger.error('Error using Skyvern directly:', e);
          }
        }
      } catch (e) {
        console.log('Error using PageNavigator, falling back to standard methods:', e);
      }
    }
    
    // Handle videos if present
    await watchVideo(page).catch(e => console.log('Error in video handling:', e));
    
    // Answer questions if present
    await answerQuestionWithAI(page).catch(e => console.log('Error in question answering:', e));
    
    // Try to go to next section
    hasNextSection = await goToNextSection(page).catch(e => {
      console.log('Error navigating to next section:', e);
      return false;
    });
    
    // If we couldn't find a next button, the course might be complete
    if (!hasNextSection) {
      break;
    }
    
    // Wait for the next page to load
    await page.waitForTimeout(3000);
  }
  
  const completionTime = (Date.now() - startTime) / 1000;
  console.log(`Course completed! Processed ${sectionCount} sections.`);
  console.log(`Total completion time: ${formatTime(completionTime)}`);
  
  // Notify workflow manager of completion
  if (workflowManager) {
    await workflowManager.completeAssignment(true);
    logger.info('Notified workflow manager of course completion');
    await workflowManager.findAndStartNextAssignment();
  }
}

/**
 * Complete multiple courses in parallel
 */
async function completeMultipleCourses(maxConcurrent: number = 3): Promise<void> {
  console.log(`Starting parallel completion of courses (max ${maxConcurrent} concurrent)`);
  
  // Create a browser instance
  const browser = await firefox.launch({
    headless: appConfig.browser.headless,
    slowMo: appConfig.browser.slowMo
  });
  
  // Track successful and failed courses
  const results = {
    successful: [] as string[],
    failed: [] as {name: string, error: string}[]
  };
  
  try {
    // Create a page to get available courses
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      userAgent: appConfig.browser.userAgent
    });
    
    // Login to Target Solutions
    await login(page);
    
    // Get available courses
    const courses = await getAvailableCourses(page);
    await page.close();
    
    console.log(`Found ${courses.length} available courses`);
    
    // Create a parallel executor
    const executor = new ParallelExecutor(maxConcurrent);
    const coursesToProcess = [...courses]; // Make a copy for the summary
    
    // Add each course to the executor
    for (const course of courses) {
      executor.addTask(async () => {
        const coursePage = await browser.newPage({
          viewport: { width: 1280, height: 800 },
          userAgent: appConfig.browser.userAgent
        });
        
        try {
          await login(coursePage);
          await navigateToCourse(coursePage, course.id);
          await completeCourse(coursePage, course, true);
          results.successful.push(course.name);
        } catch (error: any) {
          results.failed.push({name: course.name, error: error.message || 'Unknown error'});
        } finally {
          await coursePage.close();
        }
      });
    }
    
    // Run all tasks and wait for completion
    await executor.run();
    
    // Log summary of results
    console.log('\n===== PARALLEL EXECUTION SUMMARY =====');
    console.log(`Total courses processed: ${coursesToProcess.length}`);
    console.log(`Successfully completed: ${results.successful.length}`);
    console.log(`Failed: ${results.failed.length}`);
    results.failed.forEach((f: {name: string, error: string}) => console.log(`- ${f.name}: ${f.error}`));
  } finally {
    await browser.close();
  }
}

/**
 * Main function to run the automation
 */
async function main(parallel: boolean = false, maxConcurrent: number = 3) {
  console.log('Starting Target Solutions automation...');
  
  // Launch Firefox browser
  const browser = await firefox.launch({
    headless: config.headless,
    slowMo: config.slowMo
  });
  
  // Create a new page with better viewport and user agent
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  
  // Enable console logging from the browser
  page.on('console', msg => console.log(`Browser console: ${msg.text()}`));
  
  try {
    // Login to Target Solutions
    await login(page);

    // If parallel execution is requested, run multiple courses in parallel
    if (parallel) {
      console.log(`Parallel execution requested with ${maxConcurrent} concurrent processes`);
      await completeMultipleCourses(maxConcurrent);
      return;
    }
    
    // Take a screenshot after login for debugging
    if (!config.headless) {
      await page.screenshot({ path: 'login-success.png' });
      console.log('Screenshot saved to login-success.png');
    }
    
    // Find and start an assignment from the dashboard
    // This will automatically select the first available assignment (not an event)
    const courseInfo = await findAndStartAssignment(page);
    
    if (!courseInfo) {
      console.log('Failed to navigate to a course. Exiting...');
      return;
    }
    
    // Complete the course
    await completeCourse(page, courseInfo, true);
    
    console.log('Automation completed successfully!');
  } catch (error) {
    console.error('Error during automation:', error);
    
    // Take a screenshot on error for debugging
    if (!config.headless) {
      await page.screenshot({ path: 'error-screenshot.png' });
      console.log('Error screenshot saved to error-screenshot.png');
    }
  } finally {
    // Close the browser
    await browser.close();
  }
}

/**
 * Process all available assignments sequentially
 */
async function processAllAssignments(): Promise<void> {
  console.log('Starting sequential processing of all available assignments...');
  
  // Launch Firefox browser
  const browser = await firefox.launch({
    headless: config.headless,
    slowMo: config.slowMo
  });
  
  // Create a new page
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent: config.browser.userAgent
  });
  
  try {
    // Login to Target Solutions
    await login(page);
    
    // Create workflow manager
    const workflowManager = new WorkflowManager(page);
    
    // Find and start the first assignment
    const started = await workflowManager.findAndStartNextAssignment();
    if (started) {
      // The workflow manager will handle progression to subsequent assignments
      console.log('First assignment started, workflow manager will handle progression');
    }
  } catch (error) {
    console.error('Error during assignment processing:', error);
  }
}

// Run the automation
if (require.main === module) {
  // Check for parallel flag in command line arguments
  const args = process.argv.slice(2);
  const parallelIndex = args.indexOf('--parallel');
  const parallel = parallelIndex !== -1;
  
  // Get max concurrent value if specified
  const maxConcurrent = parallel && args.length > parallelIndex + 1 ? 
    parseInt(args[parallelIndex + 1], 10) || 3 : 3;
  
  main(parallel, maxConcurrent).catch(console.error);
}

// Export functions for testing or external use
export {
  login,
  navigateToCourse,
  findAndStartAssignment,
  extractCourseText,
  watchVideo,
  answerQuestionWithAI,
  goToNextSection,
  completeCourse,
  completeMultipleCourses,
  processAllAssignments,
  legacyAnswerQuestion
};