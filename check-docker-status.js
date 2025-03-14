/**
 * Docker container status checker
 * 
 * This script checks the status of all Docker containers in the TSautomation system
 * and verifies that they are running correctly.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  // Expected containers
  expectedContainers: [
    'tsautomation-main-nginx-1',
    'tsautomation-main-skyvern-1',
    'tsautomation-main-skyvernui-1',
    'tsautomation-main-postgres-1',
    'tsautomation-main-automation-1'
  ],
  
  // Output
  outputDir: path.join(__dirname, 'test-results')
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
  const logFile = path.join(config.outputDir, 'docker-status-check.log');
  fs.appendFileSync(logFile, `[${timestamp}] [${level}] ${message}\n`);
}

/**
 * Get the status of all Docker containers
 */
function getDockerContainerStatus() {
  try {
    // Run docker ps command to get container status
    const output = execSync('docker ps -a --format "{{.Names}}|{{.Status}}|{{.Ports}}"').toString();
    
    // Parse the output
    const containers = output.trim().split('\n').map(line => {
      const [name, status, ports] = line.split('|');
      return { name, status, ports };
    });
    
    return containers;
  } catch (error) {
    log(`Error getting Docker container status: ${error.message}`, 'ERROR');
    return [];
  }
}

/**
 * Check if a container is running
 */
function isContainerRunning(status) {
  return status.toLowerCase().includes('up');
}

/**
 * Check the status of all expected containers
 */
function checkContainerStatus() {
  log('Checking Docker container status...');
  
  // Get container status
  const containers = getDockerContainerStatus();
  
  // Results
  const results = {
    containers: {},
    allRunning: true,
    timestamp: new Date().toISOString()
  };
  
  // Check each expected container
  for (const expectedContainer of config.expectedContainers) {
    const container = containers.find(c => c.name === expectedContainer);
    
    if (container) {
      const running = isContainerRunning(container.status);
      results.containers[expectedContainer] = {
        found: true,
        running,
        status: container.status,
        ports: container.ports
      };
      
      if (!running) {
        results.allRunning = false;
        log(`Container ${expectedContainer} is not running: ${container.status}`, 'ERROR');
      } else {
        log(`Container ${expectedContainer} is running: ${container.status}`, 'SUCCESS');
      }
    } else {
      results.containers[expectedContainer] = {
        found: false,
        running: false,
        status: 'Not found',
        ports: ''
      };
      results.allRunning = false;
      log(`Container ${expectedContainer} not found`, 'ERROR');
    }
  }
  
  // Save results
  fs.writeFileSync(
    path.join(config.outputDir, 'docker-status-check-results.json'),
    JSON.stringify(results, null, 2)
  );
  
  // Log summary
  log('\n=== CONTAINER STATUS SUMMARY ===');
  for (const [name, status] of Object.entries(results.containers)) {
    log(`${name}: ${status.running ? 'RUNNING' : 'NOT RUNNING'} (${status.status})`);
  }
  
  log(`\nAll containers running: ${results.allRunning ? 'YES' : 'NO'}`);
  
  return results;
}

// Run the check if this file is executed directly
if (require.main === module) {
  const results = checkContainerStatus();
  process.exit(results.allRunning ? 0 : 1);
}

module.exports = { checkContainerStatus };