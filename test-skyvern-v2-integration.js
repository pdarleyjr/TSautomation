/**
 * Comprehensive test script for Skyvern API v2 integration
 * 
 * This script tests all aspects of the Skyvern API v2 integration:
 * 1. API connectivity and authentication
 * 2. Task creation and management
 * 3. Nginx proxy configuration
 */

const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration
const config = {
  // API URLs
  skyvernApiV2Url: process.env.SKYVERN_API_V2_URL || 'http://localhost:8000/api/v2',
  nginxProxyUrl: 'http://localhost/api/v2',
  
  // Authentication
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  skyvernBearerToken: process.env.SKYVERN_BEARER_TOKEN || '',
  
  // Output
  outputDir: path.join(__dirname, 'test-results'),
  
  // Test data
  testTask: {
    url: 'https://example.com',
    navigation_goal: 'Visit the website and extract the page title',
    max_steps: 5
  }
};

// Create output directory if it doesn't exist
if (!fs.existsSync(config.outputDir)) {
  fs.mkdirSync(config.outputDir, { recursive: true });
}

// Log function with timestamp
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
  
  // Also append to log file
  const logFile = path.join(config.outputDir, 'skyvern-v2-integration-test.log');
  fs.appendFileSync(logFile, `[${timestamp}] [${level}] ${message}\n`);
}

// Test results
const results = {
  directApiV2Access: {
    apiKey: false,
    bearerToken: false
  },
  nginxProxyAccess: {
    apiKey: false,
    bearerToken: false
  },
  taskCreation: false,
  taskRetrieval: false,
  timestamp: new Date().toISOString()
};

/**
 * Test direct access to Skyvern API v2 with API key
 */
async function testDirectApiV2WithApiKey() {
  log('Testing direct access to Skyvern API v2 with API key...');
  
  if (!config.skyvernApiKey) {
    log('No API key provided, skipping test', 'WARN');
    return false;
  }
  
  try {
    const response = await axios.get(`${config.skyvernApiV2Url}/health`, {
      headers: {
        'x-api-key': config.skyvernApiKey
      }
    });
    
    if (response.status === 200) {
      log('Direct access to Skyvern API v2 with API key successful', 'SUCCESS');
      return true;
    } else {
      log(`Unexpected status code: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error accessing Skyvern API v2 directly with API key: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Test direct access to Skyvern API v2 with Bearer token
 */
async function testDirectApiV2WithBearerToken() {
  log('Testing direct access to Skyvern API v2 with Bearer token...');
  
  if (!config.skyvernBearerToken) {
    log('No Bearer token provided, skipping test', 'WARN');
    return false;
  }
  
  try {
    const response = await axios.get(`${config.skyvernApiV2Url}/health`, {
      headers: {
        'Authorization': `Bearer ${config.skyvernBearerToken}`
      }
    });
    
    if (response.status === 200) {
      log('Direct access to Skyvern API v2 with Bearer token successful', 'SUCCESS');
      return true;
    } else {
      log(`Unexpected status code: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error accessing Skyvern API v2 directly with Bearer token: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Test Nginx proxy access to Skyvern API v2
 */
async function testNginxProxyAccess() {
  log('Testing Nginx proxy access to Skyvern API v2...');
  
  const headers = {};
  if (config.skyvernBearerToken) {
    headers['Authorization'] = `Bearer ${config.skyvernBearerToken}`;
  } else if (config.skyvernApiKey) {
    headers['x-api-key'] = config.skyvernApiKey;
  } else {
    log('No authentication credentials provided, skipping test', 'ERROR');
    return false;
  }
  
  try {
    const response = await axios.get(`${config.nginxProxyUrl}/health`, { headers });
    
    if (response.status === 200) {
      log('Nginx proxy access to Skyvern API v2 successful', 'SUCCESS');
      return true;
    } else {
      log(`Unexpected status code: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error accessing Skyvern API v2 via Nginx proxy: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Test task creation and retrieval
 */
async function testTaskWorkflow() {
  log('Testing task creation and retrieval...');
  
  const headers = {};
  if (config.skyvernBearerToken) {
    headers['Authorization'] = `Bearer ${config.skyvernBearerToken}`;
  } else if (config.skyvernApiKey) {
    headers['x-api-key'] = config.skyvernApiKey;
  } else {
    log('No authentication credentials provided, skipping test', 'ERROR');
    return false;
  }
  
  try {
    // Create task
    const createResponse = await axios.post(`${config.skyvernApiV2Url}/tasks`, config.testTask, { headers });
    
    if (createResponse.status === 200 || createResponse.status === 201) {
      log('Task creation successful', 'SUCCESS');
      log(`Task ID: ${createResponse.data.task_id}`, 'SUCCESS');
      
      const taskId = createResponse.data.task_id;
      results.taskCreation = true;
      
      // Wait a moment for the task to be processed
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Retrieve task
      const getResponse = await axios.get(`${config.skyvernApiV2Url}/tasks/${taskId}`, { headers });
      
      if (getResponse.status === 200) {
        log('Task retrieval successful', 'SUCCESS');
        log(`Task status: ${getResponse.data.status}`, 'SUCCESS');
        results.taskRetrieval = true;
        return true;
      } else {
        log(`Unexpected status code for task retrieval: ${getResponse.status}`, 'ERROR');
        return false;
      }
    } else {
      log(`Unexpected status code for task creation: ${createResponse.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error in task workflow: ${error.message}`, 'ERROR');
    return false;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  log('Starting Skyvern API v2 integration tests...');
  
  // Test direct API access
  results.directApiV2Access.apiKey = await testDirectApiV2WithApiKey();
  results.directApiV2Access.bearerToken = await testDirectApiV2WithBearerToken();
  
  // Test Nginx proxy access
  results.nginxProxyAccess = await testNginxProxyAccess();
  
  // Test task workflow
  await testTaskWorkflow();
  
  // Save results
  fs.writeFileSync(
    path.join(config.outputDir, 'skyvern-v2-integration-test-results.json'),
    JSON.stringify(results, null, 2)
  );
  
  // Log summary
  log('\n=== TEST SUMMARY ===');
  log(`Direct API access with API key: ${results.directApiV2Access.apiKey ? 'PASSED' : 'FAILED'}`);
  log(`Direct API access with Bearer token: ${results.directApiV2Access.bearerToken ? 'PASSED' : 'FAILED'}`);
  log(`Nginx proxy access: ${results.nginxProxyAccess ? 'PASSED' : 'FAILED'}`);
  log(`Task creation: ${results.taskCreation ? 'PASSED' : 'FAILED'}`);
  log(`Task retrieval: ${results.taskRetrieval ? 'PASSED' : 'FAILED'}`);
  
  // Overall result
  const allPassed = (
    (results.directApiV2Access.apiKey || results.directApiV2Access.bearerToken) &&
    results.nginxProxyAccess &&
    results.taskCreation &&
    results.taskRetrieval
  );
  
  log(`\nOverall test result: ${allPassed ? 'PASSED' : 'FAILED'}`);
  
  return allPassed;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      log(`Unhandled error: ${error.message}`, 'ERROR');
      process.exit(1);
    });
}

module.exports = { runTests };
