/**
 * Test script for Skyvern API v2 integration
 * 
 * This script tests the Skyvern API v2 integration to ensure it's working correctly.
 * It verifies connectivity, authentication, and basic functionality.
 */

const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration
const config = {
  skyvernApiV2Url: 'http://localhost:8000/api/v2',
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  skyvernBearerToken: process.env.SKYVERN_BEARER_TOKEN || '',
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

// Test Skyvern API v2 connectivity with API key
async function testSkyvernV2ApiKeyAuth() {
  log('Testing Skyvern API v2 connectivity with API key...');
  
  try {
    const headers = {};
    if (config.skyvernApiKey) {
      headers['x-api-key'] = config.skyvernApiKey;
    }
    
    const response = await axios.get(`${config.skyvernApiV2Url}/health`, { headers });
    
    if (response.status === 200) {
      log('Skyvern API v2 is accessible with API key authentication', 'SUCCESS');
      log(`Response: ${JSON.stringify(response.data)}`, 'SUCCESS');
      return true;
    } else {
      log(`Skyvern API v2 returned unexpected status: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Failed to connect to Skyvern API v2 with API key: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Test Skyvern API v2 connectivity with Bearer token
async function testSkyvernV2BearerAuth() {
  log('Testing Skyvern API v2 connectivity with Bearer token...');
  
  try {
    const headers = {};
    if (config.skyvernBearerToken) {
      headers['Authorization'] = `Bearer ${config.skyvernBearerToken}`;
    } else {
      log('No Bearer token provided, skipping test', 'WARN');
      return false;
    }
    
    const response = await axios.get(`${config.skyvernApiV2Url}/health`, { headers });
    
    if (response.status === 200) {
      log('Skyvern API v2 is accessible with Bearer token authentication', 'SUCCESS');
      log(`Response: ${JSON.stringify(response.data)}`, 'SUCCESS');
      return true;
    } else {
      log(`Skyvern API v2 returned unexpected status: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Failed to connect to Skyvern API v2 with Bearer token: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Test creating a task with Skyvern API v2
async function testCreateTaskV2() {
  log('Testing task creation with Skyvern API v2...');
  
  try {
    const headers = {};
    
    // Try Bearer token first, then fall back to API key
    if (config.skyvernBearerToken && config.skyvernBearerToken.trim() !== '') {
      headers['Authorization'] = `Bearer ${config.skyvernBearerToken}`;
      log(`Using Bearer token: ${config.skyvernBearerToken.substring(0, 5)}...`, 'DEBUG');
    } else if (config.skyvernApiKey && config.skyvernApiKey.trim() !== '') {
      headers['x-api-key'] = config.skyvernApiKey;
      log(`Using API key: ${config.skyvernApiKey.substring(0, 5)}...`, 'DEBUG');
    } else {
      log('No authentication credentials provided', 'ERROR');
      return false;
    }
    
    const taskData = {
      url: 'https://example.com',
      navigation_goal: 'Visit the website and extract the page title',
      max_steps: 5
    };

    log(`Request headers: ${JSON.stringify(headers)}`, 'DEBUG');
    
    const response = await axios.post(`${config.skyvernApiV2Url}/tasks`, taskData, { headers });
    
    if (response.status === 200 || response.status === 201) {
      log('Successfully created task with Skyvern API v2', 'SUCCESS');
      log(`Task ID: ${response.data.task_id}`, 'SUCCESS');
      
      // Save the task ID for future reference
      const taskId = response.data.task_id;
      fs.writeFileSync(path.join(config.outputDir, 'last-task-id.txt'), taskId);
      
      return taskId;
    } else {
      log(`Unexpected status when creating task: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Failed to create task with Skyvern API v2: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Test getting task status with Skyvern API v2
async function testGetTaskStatusV2(taskId) {
  log(`Testing get task status with Skyvern API v2 for task ${taskId}...`);
  
  try {
    const headers = {};
    
    // Try Bearer token first, then fall back to API key
    if (config.skyvernBearerToken) {
      headers['Authorization'] = `Bearer ${config.skyvernBearerToken}`;
    } else if (config.skyvernApiKey) {
      headers['x-api-key'] = config.skyvernApiKey;
    } else {
      log('No authentication credentials provided', 'ERROR');
      return false;
    }
    
    const response = await axios.get(`${config.skyvernApiV2Url}/tasks/${taskId}`, { headers });
    
    if (response.status === 200) {
      log('Successfully retrieved task status with Skyvern API v2', 'SUCCESS');
      log(`Task status: ${response.data.status}`, 'SUCCESS');
      return response.data;
    } else {
      log(`Unexpected status when getting task status: ${response.status}`, 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Failed to get task status with Skyvern API v2: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Run all tests
async function runTests() {
  log('Starting Skyvern API v2 integration tests...');
  
  // Create results object
  const results = {
    apiKeyAuth: false,
    bearerTokenAuth: false,
    taskCreation: false,
    taskStatusRetrieval: false,
    timestamp: new Date().toISOString(),
  };
  
  // Test API key authentication
  results.apiKeyAuth = await testSkyvernV2ApiKeyAuth();
  
  // Test Bearer token authentication
  results.bearerTokenAuth = await testSkyvernV2BearerAuth();
  
  // Test task creation
  const taskId = await testCreateTaskV2();
  results.taskCreation = !!taskId;
  
  // Test task status retrieval if task creation succeeded
  if (results.taskCreation) {
    const taskStatus = await testGetTaskStatusV2(taskId);
    results.taskStatusRetrieval = !!taskStatus;
    
    // Wait for a few seconds and check the task status again
    log('Waiting for 5 seconds before checking task status again...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const updatedTaskStatus = await testGetTaskStatusV2(taskId);
    if (updatedTaskStatus) {
      log(`Updated task status: ${updatedTaskStatus.status}`, 'INFO');
    }
  }
  
  // Save results to file
  const resultsPath = path.join(config.outputDir, 'skyvern-v2-test-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
  log(`Test results saved to ${resultsPath}`);
  
  // Log summary
  log('\n=== TEST SUMMARY ===', 'INFO');
  log(`API Key Authentication: ${results.apiKeyAuth ? 'PASSED' : 'FAILED'}`, results.apiKeyAuth ? 'SUCCESS' : 'ERROR');
  log(`Bearer Token Authentication: ${results.bearerTokenAuth ? 'PASSED' : 'FAILED'}`, results.bearerTokenAuth ? 'SUCCESS' : 'ERROR');
  log(`Task Creation: ${results.taskCreation ? 'PASSED' : 'FAILED'}`, results.taskCreation ? 'SUCCESS' : 'ERROR');
  log(`Task Status Retrieval: ${results.taskStatusRetrieval ? 'PASSED' : 'FAILED'}`, results.taskStatusRetrieval ? 'SUCCESS' : 'ERROR');
  
  // Overall result
  const allPassed = results.apiKeyAuth || results.bearerTokenAuth; // Need at least one auth method to work
  const functionalityPassed = results.taskCreation && results.taskStatusRetrieval;
  
  log(`\nAuthentication Test Result: ${allPassed ? 'PASSED' : 'FAILED'}`, allPassed ? 'SUCCESS' : 'ERROR');
  log(`Functionality Test Result: ${functionalityPassed ? 'PASSED' : 'FAILED'}`, functionalityPassed ? 'SUCCESS' : 'ERROR');
  
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
  testSkyvernV2ApiKeyAuth,
  testSkyvernV2BearerAuth,
  testCreateTaskV2,
  testGetTaskStatusV2,
};