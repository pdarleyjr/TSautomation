/**
 * Test Skyvern API v2 Integration and Store Results in Memory MCP
 * 
 * This script tests the Skyvern API v2 integration and stores the results
 * in the memory MCP server for future reference.
 */

const { runTests } = require('./test-skyvern-v2');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

// Load environment variables
dotenv.config();

// Configuration
const config = {
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

// Store results in memory MCP
async function storeResultsInMemory(results) {
  log('Storing results in memory MCP...');
  
  try {
    // Format the results as a string for storage
    const resultsString = JSON.stringify(results, null, 2);
    
    // Create entities in memory MCP
    const response = await axios.post('http://localhost:3001/api/tools/create_entities', {
      entities: [
        {
          name: 'Skyvern API v2 Integration Test Results',
          entityType: 'TestResults',
          observations: [
            `Test run at ${new Date().toISOString()}`,
            `API Key Authentication: ${results.apiKeyAuth ? 'PASSED' : 'FAILED'}`,
            `Bearer Token Authentication: ${results.bearerTokenAuth ? 'PASSED' : 'FAILED'}`,
            `Task Creation: ${results.taskCreation ? 'PASSED' : 'FAILED'}`,
            `Task Status Retrieval: ${results.taskStatusRetrieval ? 'PASSED' : 'FAILED'}`,
            `Full Results: ${resultsString}`
          ]
        }
      ]
    });
    
    log('Results stored in memory MCP successfully', 'SUCCESS');
    return true;
  } catch (error) {
    log(`Failed to store results in memory MCP: ${error.message}`, 'ERROR');
    if (error.response) {
      log(`Response status: ${error.response.status}`, 'ERROR');
      log(`Response data: ${JSON.stringify(error.response.data)}`, 'ERROR');
    }
    return false;
  }
}

// Run tests and store results
async function runTestsAndStoreResults() {
  log('Starting Skyvern API v2 integration tests...');
  
  try {
    // Run the tests
    const results = await runTests();
    
    // Save results to file
    const resultsPath = path.join(config.outputDir, 'skyvern-v2-test-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    log(`Test results saved to ${resultsPath}`);
    
    // Store results in memory MCP
    await storeResultsInMemory(results);
    
    // Create a summary file
    const summaryPath = path.join(config.outputDir, 'skyvern-v2-test-summary.md');
    const summary = `# Skyvern API v2 Integration Test Summary

## Test Results

- **API Key Authentication**: ${results.apiKeyAuth ? '✅ PASSED' : '❌ FAILED'}
- **Bearer Token Authentication**: ${results.bearerTokenAuth ? '✅ PASSED' : '❌ FAILED'}
- **Task Creation**: ${results.taskCreation ? '✅ PASSED' : '❌ FAILED'}
- **Task Status Retrieval**: ${results.taskStatusRetrieval ? '✅ PASSED' : '❌ FAILED'}

## Overall Result

- **Authentication**: ${results.apiKeyAuth || results.bearerTokenAuth ? '✅ PASSED' : '❌ FAILED'}
- **Functionality**: ${results.taskCreation && results.taskStatusRetrieval ? '✅ PASSED' : '❌ FAILED'}

## Test Timestamp

- **Test Run At**: ${results.timestamp}

## Next Steps

${(results.apiKeyAuth || results.bearerTokenAuth) && (results.taskCreation && results.taskStatusRetrieval) 
  ? '✅ All tests passed! The Skyvern API v2 integration is working correctly.' 
  : '❌ Some tests failed. Please check the detailed results and fix the issues.'}
`;
    
    fs.writeFileSync(summaryPath, summary);
    log(`Test summary saved to ${summaryPath}`);
    
    return results;
  } catch (error) {
    log(`Error running tests: ${error.message}`, 'ERROR');
    throw error;
  }
}

// Run the tests and store results if this file is executed directly
if (require.main === module) {
  runTestsAndStoreResults()
    .then(() => {
      log('Tests and storage completed');
      process.exit(0);
    })
    .catch(error => {
      log(`Unhandled error: ${error.message}`, 'ERROR');
      process.exit(1);
    });
}

module.exports = {
  runTestsAndStoreResults,
  storeResultsInMemory
};