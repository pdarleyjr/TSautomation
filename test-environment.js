/**
 * Test Environment Script
 * 
 * This script tests the TSautomation environment to ensure all components
 * are working correctly. It verifies connectivity to Skyvern, tests browser
 * automation, and validates the overall setup.
 */

const axios = require('axios');
const { firefox } = require('playwright');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration
const config = {
  skyvernApiUrl: process.env.SKYVERN_API_V2_URL || 'http://localhost/api/v2',
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  headless: process.env.TEST_HEADLESS !== 'false',
  testUrl: 'https://example.com',
  outputDir: path.join(__dirname, 'test-results'),
};

// Create output directory if it doesn't exist
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Log function with timestamp
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Test Skyvern API connectivity
async function testSkyvernConnectivity() {
  log('Testing Skyvern API connectivity...');
  
  try {
    const headers = {};
    if (config.skyvernApiKey) {
      headers['x-api-key'] = config.skyvernApiKey;
    }
    
    const response = await axios.get(`${config.skyvernApiUrl}/health`, { headers });
    
    if (response.status === 200) {
      log('Skyvern API is accessible and healthy', 'SUCCESS');
      return true;
    } else {
      log(`Skyvern API returned unexpected status: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Failed to connect to Skyvern API: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Test browser automation
async function testBrowserAutomation() {
  log('Testing browser automation with Playwright...');
  
  let browser;
  try {
    // Launch browser
    browser = await firefox.launch({
      headless: config.headless,
    });
    
    // Create a new page
    const page = await browser.newPage();
    
    // Navigate to test URL
    log(`Navigating to ${config.testUrl}...`);
    await page.goto(config.testUrl);
    
    // Take a screenshot
    const screenshotPath = path.join(config.outputDir, 'test-screenshot.png');
    await page.screenshot({ path: screenshotPath });
    log(`Screenshot saved to ${screenshotPath}`, 'SUCCESS');
    
    // Get page title
    const title = await page.title();
    log(`Page title: ${title}`, 'SUCCESS');
    
    // Test completed successfully
    log('Browser automation test completed successfully', 'SUCCESS');
    return true;
  } catch (error) {
    log(`Browser automation test failed: ${error.message}`, 'ERROR');
    return false;
  } finally {
    // Close browser
    if (browser) {
      await browser.close();
    }
  }
}

// Test internet connectivity
async function testInternetConnectivity() {
  log('Testing internet connectivity...');
  
  try {
    const response = await axios.get('https://www.google.com');
    if (response.status === 200) {
      log('Internet connectivity test passed', 'SUCCESS');
      return true;
    } else {
      log(`Unexpected status code: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Internet connectivity test failed: ${error.message}`, 'ERROR');
    return false;
  }
}

// Test OpenAI API connectivity
async function testOpenAIConnectivity() {
  log('Testing OpenAI API connectivity...');
  
  if (!config.openaiApiKey) {
    log('OpenAI API key not provided, skipping test', 'WARN');
    return false;
  }
  
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello, this is a test message. Please respond with "Test successful".' }],
        max_tokens: 20
      },
      {
        headers: {
          'Authorization': `Bearer ${config.openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    if (response.status === 200) {
      log('OpenAI API connectivity test passed', 'SUCCESS');
      return true;
    } else {
      log(`Unexpected status code: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`OpenAI API connectivity test failed: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Run all tests
async function runTests() {
  log('Starting environment tests...');
  
  // Create results object
  const results = {
    internetConnectivity: false,
    browserAutomation: false,
    skyvernConnectivity: false,
    openaiConnectivity: false,
    timestamp: new Date().toISOString(),
  };
  
  // Test internet connectivity
  results.internetConnectivity = await testInternetConnectivity();
  
  // Test browser automation
  results.browserAutomation = await testBrowserAutomation();
  
  // Test Skyvern connectivity
  results.skyvernConnectivity = await testSkyvernConnectivity();
  
  // Test OpenAI API connectivity
  results.openaiConnectivity = await testOpenAIConnectivity();
  
  // Save results to file
  const resultsPath = path.join(config.outputDir, 'test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  log(`Test results saved to ${resultsPath}`);
  
  // Log summary
  log('\n=== TEST SUMMARY ===', 'INFO');
  log(`Internet Connectivity: ${results.internetConnectivity ? 'PASSED' : 'FAILED'}`, results.internetConnectivity ? 'SUCCESS' : 'ERROR');
  log(`Browser Automation: ${results.browserAutomation ? 'PASSED' : 'FAILED'}`, results.browserAutomation ? 'SUCCESS' : 'ERROR');
  log(`Skyvern Connectivity: ${results.skyvernConnectivity ? 'PASSED' : 'FAILED'}`, results.skyvernConnectivity ? 'SUCCESS' : 'ERROR');
  log(`OpenAI API Connectivity: ${results.openaiConnectivity ? 'PASSED' : 'FAILED'}`, results.openaiConnectivity ? 'SUCCESS' : 'ERROR');
  
  // Overall result
  const allPassed = results.internetConnectivity && 
                    results.browserAutomation && 
                    results.skyvernConnectivity && 
                    results.openaiConnectivity;
  
  log(`\nOverall Test Result: ${allPassed ? 'PASSED' : 'FAILED'}`, allPassed ? 'SUCCESS' : 'ERROR');
  
  return results;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then(() => {
      log('Tests completed');
      process.exit(0);
    })
    .catch(error => {
      log(`Unhandled error: ${error.message}`, 'ERROR');
      process.exit(1);
    });
}

module.exports = {
  runTests,
  testInternetConnectivity,
  testBrowserAutomation,
  testSkyvernConnectivity,
  testOpenAIConnectivity,
};