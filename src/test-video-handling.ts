import { firefox, Page } from 'playwright';
import { sleep, formatTime } from './utils';
import logger from './logger';
import { CombinedAutomation } from './combined-automation';
import SessionHandler from './session-handler';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Test script for enhanced video handling
 * This script tests the various video detection and completion strategies
 */
async function testVideoHandling() {
  console.log('Starting video handling test...');
  
  // Launch browser
  const browser = await firefox.launch({
    headless: false, // Use headed mode for visibility
    slowMo: 50
  });
  
  // Create a new page
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
  });
  
  try {
    // Test with different implementations
    await testCombinedAutomation(page);
    await testSessionHandler(page);
    await testStandaloneFunction(page);
    
    console.log('All video handling tests completed successfully!');
  } catch (error) {
    console.error('Error during video handling test:', error);
  } finally {
    // Close the browser
    await browser.close();
  }
}

/**
 * Test video handling with CombinedAutomation
 */
async function testCombinedAutomation(page: Page) {
  console.log('\n=== Testing CombinedAutomation video handling ===');
  
  // Navigate to a test page with video
  await navigateToTestPage(page);
  
  // Create CombinedAutomation instance
  const automation = new CombinedAutomation(page);
  
  // Test video handling
  console.log('Testing handleVideo method...');
  const startTime = Date.now();
  const result = await automation.handleVideo();
  const elapsedTime = (Date.now() - startTime) / 1000;
  
  console.log(`CombinedAutomation video handling ${result ? 'succeeded' : 'failed'}`);
  console.log(`Elapsed time: ${formatTime(elapsedTime)}`);
}

/**
 * Test video handling with SessionHandler
 */
async function testSessionHandler(page: Page) {
  console.log('\n=== Testing SessionHandler video handling ===');
  
  // Navigate to a test page with video
  await navigateToTestPage(page);
  
  // Create SessionHandler instance with mock course info
  const sessionHandler = new SessionHandler(page, {
    id: 'test-course',
    name: 'Test Course'
  });
  
  // Test video handling
  console.log('Testing handleVideo method...');
  const startTime = Date.now();
  const result = await sessionHandler.handleVideo();
  const elapsedTime = (Date.now() - startTime) / 1000;
  
  console.log(`SessionHandler video handling ${result ? 'succeeded' : 'failed'}`);
  console.log(`Elapsed time: ${formatTime(elapsedTime)}`);
}

/**
 * Test video handling with standalone function from index.ts
 */
async function testStandaloneFunction(page: Page) {
  console.log('\n=== Testing standalone watchVideo function ===');
  
  // Navigate to a test page with video
  await navigateToTestPage(page);
  
  // Import the watchVideo function dynamically to avoid circular dependencies
  const { watchVideo } = await import('./index.js');
  
  // Test video handling
  console.log('Testing watchVideo function...');
  const startTime = Date.now();
  await watchVideo(page);
  const elapsedTime = (Date.now() - startTime) / 1000;
  
  console.log(`Standalone watchVideo function completed`);
  console.log(`Elapsed time: ${formatTime(elapsedTime)}`);
}

/**
 * Navigate to a test page with video content
 * This function can be modified to test with different video types
 */
async function navigateToTestPage(page: Page) {
  // For testing purposes, we'll use a public page with a video
  // You can replace this with a local test page or a specific course page
  
  // Option 1: YouTube embed
  await page.goto('https://www.youtube.com/embed/dQw4w9WgXcQ');
  
  // Option 2: HTML5 video (uncomment to test)
  // await page.goto('https://www.w3schools.com/html/mov_bbb.mp4');
  
  // Option 3: Custom HTML with video element (for more controlled testing)
  // await page.setContent(`
  //   <html>
  //     <head>
  //       <style>
  //         .video-container { width: 640px; margin: 0 auto; }
  //         .video-player { width: 100%; }
  //         .video-controls { margin-top: 10px; text-align: center; }
  //         .btn-next { display: none; padding: 10px; background: blue; color: white; }
  //         .video-completed { display: none; color: green; }
  //       </style>
  //     </head>
  //     <body>
  //       <div class="video-container">
  //         <video class="video-player" controls>
  //           <source src="https://www.w3schools.com/html/mov_bbb.mp4" type="video/mp4">
  //         </video>
  //         <div class="video-controls">
  //           <button class="btn-next">Next</button>
  //           <div class="video-completed">Video Completed!</div>
  //         </div>
  //       </div>
  //       <script>
  //         const video = document.querySelector('video');
  //         const btnNext = document.querySelector('.btn-next');
  //         const completedIndicator = document.querySelector('.video-completed');
  //         
  //         // Show next button and completion indicator when video ends
  //         video.addEventListener('ended', () => {
  //           btnNext.style.display = 'inline-block';
  //           completedIndicator.style.display = 'block';
  //         });
  //         
  //         // For testing, make the video shorter
  //         video.addEventListener('loadedmetadata', () => {
  //           // Set the duration to 10 seconds for testing
  //           video.currentTime = Math.max(0, video.duration - 10);
  //         });
  //       </script>
  //     </body>
  //   </html>
  // `);
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  console.log('Test page loaded');
}

// Run the test if this file is executed directly
if (require.main === module) {
  testVideoHandling().catch(console.error);
}

export { testVideoHandling };