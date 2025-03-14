/**
 * Finalize Skyvern API v2 Integration
 * 
 * This script runs all the necessary steps to finalize the Skyvern API v2 integration:
 * 1. Restart the Docker containers to apply configuration changes
 * 2. Test the Skyvern API v2 integration
 * 3. Store the test results in the memory MCP server
 * 4. Generate a final report
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

// Promisify exec
const execAsync = promisify(exec);

// Load environment variables
dotenv.config();

// Configuration
const config = {
  outputDir: path.join(__dirname, 'test-results'),
  isWindows: process.platform === 'win32',
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

// Run a command and return the output
async function runCommand(command) {
  log(`Running command: ${command}`);
  
  try {
    const { stdout, stderr } = await execAsync(command);
    
    if (stdout) {
      log(`Command output: ${stdout}`);
    }
    
    if (stderr) {
      log(`Command error output: ${stderr}`, 'WARN');
    }
    
    return { success: true, stdout, stderr };
  } catch (error) {
    log(`Command failed: ${error.message}`, 'ERROR');
    return { success: false, error };
  }
}

// Restart Docker containers
async function restartContainers() {
  log('Restarting Docker containers...');
  
  try {
    // Run the appropriate restart script based on the platform
    const scriptPath = config.isWindows ? 'restart-containers.bat' : './restart-containers.sh';
    
    // Make the script executable if on Linux/macOS
    if (!config.isWindows) {
      await runCommand('chmod +x ./restart-containers.sh');
    }
    
    // Run the restart script
    const result = await runCommand(scriptPath);
    
    if (result.success) {
      log('Docker containers restarted successfully', 'SUCCESS');
      return true;
    } else {
      log('Failed to restart Docker containers', 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error restarting Docker containers: ${error.message}`, 'ERROR');
    return false;
  }
}

// Test Skyvern API v2 integration
async function testSkyvernV2Integration() {
  log('Testing Skyvern API v2 integration...');
  
  try {
    // Run the test script
    const result = await runCommand('node test-skyvern-v2.js');
    
    if (result.success) {
      log('Skyvern API v2 integration tests completed', 'SUCCESS');
      return true;
    } else {
      log('Skyvern API v2 integration tests failed', 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error testing Skyvern API v2 integration: ${error.message}`, 'ERROR');
    return false;
  }
}

// Store test results in memory MCP
async function storeTestResults() {
  log('Storing test results in memory MCP...');
  
  try {
    // Run the test and store results script
    const result = await runCommand('node test-and-store-results.js');
    
    if (result.success) {
      log('Test results stored in memory MCP successfully', 'SUCCESS');
      return true;
    } else {
      log('Failed to store test results in memory MCP', 'ERROR');
      return false;
    }
  } catch (error) {
    log(`Error storing test results: ${error.message}`, 'ERROR');
    return false;
  }
}

// Generate final report
async function generateFinalReport(results) {
  log('Generating final report...');
  
  try {
    // Create a final report
    const reportPath = path.join(config.outputDir, 'skyvern-v2-integration-final-report.md');
    const report = `# Skyvern API v2 Integration Final Report

## Integration Status

- **Docker Containers Restart**: ${results.containersRestarted ? '✅ SUCCESS' : '❌ FAILED'}
- **Skyvern API v2 Tests**: ${results.testsCompleted ? '✅ SUCCESS' : '❌ FAILED'}
- **Results Storage in Memory MCP**: ${results.resultsStored ? '✅ SUCCESS' : '❌ FAILED'}

## Overall Status

${results.containersRestarted && results.testsCompleted && results.resultsStored 
  ? '✅ The Skyvern API v2 integration is complete and fully functional.' 
  : '❌ The Skyvern API v2 integration has some issues that need to be addressed.'}

## Next Steps

${results.containersRestarted && results.testsCompleted && results.resultsStored 
  ? `
1. Monitor the system for any issues
2. Conduct final testing with real Target Solutions courses
3. Optimize performance as needed
4. Enhance security measures
5. Finalize documentation for deployment
` 
  : `
1. Address the issues identified in the tests
2. Restart the Docker containers
3. Run the tests again
4. Store the results in the memory MCP server
5. Generate a new final report
`}

## Report Generated

- **Timestamp**: ${new Date().toISOString()}
`;
    
    fs.writeFileSync(reportPath, report);
    log(`Final report saved to ${reportPath}`, 'SUCCESS');
    
    // Also store the final report in the memory MCP
    try {
      const response = await axios.post('http://localhost:3001/api/tools/create_entities', {
        entities: [
          {
            name: 'Skyvern API v2 Integration Final Report',
            entityType: 'Report',
            observations: [
              `Report generated at ${new Date().toISOString()}`,
              `Docker Containers Restart: ${results.containersRestarted ? 'SUCCESS' : 'FAILED'}`,
              `Skyvern API v2 Tests: ${results.testsCompleted ? 'SUCCESS' : 'FAILED'}`,
              `Results Storage in Memory MCP: ${results.resultsStored ? 'SUCCESS' : 'FAILED'}`,
              `Overall Status: ${results.containersRestarted && results.testsCompleted && results.resultsStored 
                ? 'The Skyvern API v2 integration is complete and fully functional.' 
                : 'The Skyvern API v2 integration has some issues that need to be addressed.'}`
            ]
          }
        ]
      });
      
      log('Final report stored in memory MCP successfully', 'SUCCESS');
    } catch (error) {
      log(`Failed to store final report in memory MCP: ${error.message}`, 'WARN');
    }
    
    return true;
  } catch (error) {
    log(`Error generating final report: ${error.message}`, 'ERROR');
    return false;
  }
}

// Run all steps
async function runAllSteps() {
  log('Starting Skyvern API v2 integration finalization...');
  
  const results = {
    containersRestarted: false,
    testsCompleted: false,
    resultsStored: false,
    reportGenerated: false,
  };
  
  // Step 1: Restart Docker containers
  results.containersRestarted = await restartContainers();
  
  // Step 2: Test Skyvern API v2 integration
  if (results.containersRestarted) {
    // Wait for containers to fully start
    log('Waiting for containers to fully start...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    results.testsCompleted = await testSkyvernV2Integration();
  } else {
    log('Skipping tests because container restart failed', 'WARN');
  }
  
  // Step 3: Store test results in memory MCP
  if (results.testsCompleted) {
    results.resultsStored = await storeTestResults();
  } else {
    log('Skipping results storage because tests failed or were skipped', 'WARN');
  }
  
  // Step 4: Generate final report
  results.reportGenerated = await generateFinalReport(results);
  
  // Log final status
  if (results.containersRestarted && results.testsCompleted && results.resultsStored && results.reportGenerated) {
    log('Skyvern API v2 integration finalization completed successfully', 'SUCCESS');
  } else {
    log('Skyvern API v2 integration finalization completed with some issues', 'WARN');
  }
  
  return results;
}

// Run all steps if this file is executed directly
if (require.main === module) {
  runAllSteps()
    .then(results => {
      log('Finalization process completed');
      process.exit(results.containersRestarted && results.testsCompleted && results.resultsStored ? 0 : 1);
    })
    .catch(error => {
      log(`Unhandled error: ${error.message}`, 'ERROR');
      process.exit(1);
    });
}

module.exports = {
  runAllSteps,
  restartContainers,
  testSkyvernV2Integration,
  storeTestResults,
  generateFinalReport
};