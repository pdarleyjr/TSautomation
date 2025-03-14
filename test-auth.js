// This script compiles and runs the test-skyvern-auth.ts file
// to verify the authentication mechanism

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m'
};

// Log with color
function logColor(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

// First compile the TypeScript files
logColor(colors.blue, '📦 Compiling TypeScript files...');

const tsc = spawn('npx', ['tsc'], { shell: true });

tsc.stdout.on('data', (data) => {
  console.log(data.toString());
});

tsc.stderr.on('data', (data) => {
  console.error(colors.yellow, data.toString());
});

tsc.on('close', (code) => {
  if (code !== 0) {
    logColor(colors.red, `❌ TypeScript compilation failed with code ${code}`);
    return;
  }
  
  logColor(colors.green, '✅ TypeScript compilation successful');
  
  // Check if the compiled file exists
  const compiledFile = path.join(__dirname, 'dist', 'test-skyvern-auth.js');
  
  if (!fs.existsSync(compiledFile)) {
    logColor(colors.red, `❌ Compiled file not found: ${compiledFile}`);
    return;
  }
  
  // Run the test script
  logColor(colors.blue, '🧪 Running Skyvern authentication test...');
  
  const tester = spawn('node', [compiledFile], { 
    shell: true,
    stdio: 'inherit' // This will show the output directly in the console
  });
  
  tester.on('close', (code) => {
    if (code !== 0) {
      logColor(colors.red, `❌ Test failed with code ${code}`);
    } else {
      logColor(colors.green, '✅ Authentication test completed successfully');
      logColor(colors.bright, 'Authentication system has been verified!');
    }
  });
});