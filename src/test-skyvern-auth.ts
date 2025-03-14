/**
 * Test script for Skyvern authentication improvements
 * 
 * This script tests the enhanced authentication mechanism with retry logic,
 * exponential backoff, and fallback methods.
 */

import { skyvernAuth } from './skyvern-auth-handler';
import logger from './logger';

/**
 * Test the Skyvern authentication handler
 */
async function testSkyvernAuth() {
  logger.info('Starting Skyvern authentication test...');
  
  try {
    // Test initialization
    logger.info('Testing initialization...');
    const initialized = await skyvernAuth.ensureInitialized();
    logger.info(`Initialization result: ${initialized}`);
    
    if (!initialized) {
      logger.error('Failed to initialize Skyvern client. Check your credentials.');
      return;
    }
    
    // Log authentication details
    const authDetails = skyvernAuth.getAuthDetails();
    logger.info('Authentication details:', authDetails);
    
    // Test making a simple API request
    logger.info('Testing API request...');
    try {
      const healthResponse = await skyvernAuth.get('/health');
      logger.info('Health check response:', healthResponse);
    } catch (error) {
      logger.error('Health check failed:', error);
    }
    
    // Test task creation
    logger.info('Testing task creation...');
    try {
      const taskParams = {
        user_prompt: 'Open https://www.example.com and get the page title',
        proxy_location: 'RESIDENTIAL',
      };
      
      const taskResponse = await skyvernAuth.post('/tasks', taskParams);
      logger.info('Task creation response:', taskResponse);
      
      if (taskResponse && taskResponse.task_id) {
        logger.info(`Created task with ID: ${taskResponse.task_id}`);
        
        // Test task status check
        logger.info('Testing task status check...');
        
        let attempts = 0;
        const maxAttempts = 5;
        
        while (attempts < maxAttempts) {
          attempts++;
          logger.info(`Checking task status (attempt ${attempts}/${maxAttempts})...`);
          
          const statusResponse = await skyvernAuth.get(`/tasks/${taskResponse.task_id}`);
          logger.info(`Task status: ${statusResponse.status}`);
          
          if (statusResponse.status === 'completed' || statusResponse.status === 'failed') {
            logger.info('Task finished with status:', statusResponse.status);
            break;
          }
          
          logger.info('Task still in progress. Waiting...');
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    } catch (error) {
      logger.error('Task creation or status check failed:', error);
    }
    
    logger.info('Authentication test completed.');
  } catch (error) {
    logger.error('Authentication test failed:', error);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testSkyvernAuth()
    .then(() => logger.info('Test script completed'))
    .catch(error => logger.error('Test script failed:', error));
}

export default testSkyvernAuth;