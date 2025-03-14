import { SkyvernAuthV2Handler } from './skyvern-auth-v2-handler';
import logger from './logger';

/**
 * Example test script to validate the enhanced Skyvern authentication client
 * 
 * This script demonstrates:
 * 1. Initialization with automatic authentication fallback
 * 2. Making API requests with automatic retries
 * 3. Handling various error scenarios
 * 4. Inspecting metrics and session information
 */
async function testSkyvernAuth() {
  try {
    logger.info('------- Starting Skyvern Auth V2 Test -------');

    // Create handler instance - can specify V2 API usage
    const skyvernAuth = new SkyvernAuthV2Handler(true);
    
    // Step 1: Initialize client (this happens automatically on first request)
    logger.info('Step 1: Initializing client...');
    const initialized = await skyvernAuth.ensureInitialized();
    
    if (initialized) {
      logger.info('✅ Client initialized successfully');
      logger.info(`Using authentication method: ${skyvernAuth.getAuthMethod()}`);
    } else {
      logger.error('❌ Client initialization failed');
      return;
    }
    
    // Step 2: Make a simple GET request
    try {
      logger.info('\nStep 2: Making test API request...');
      
      // The client will automatically handle retries and error recovery
      const healthResponse = await skyvernAuth.get('/api/v2/health');
      logger.info('✅ Health check successful:', healthResponse);
    } catch (error: any) {
      logger.error('❌ Health check failed:', error.message);
    }
    
    // Step 3: Test token refresh functionality
    logger.info('\nStep 3: Testing token refresh...');
    try {
      const refreshResult = await skyvernAuth.refreshToken();
      logger.info(`Token refresh ${refreshResult ? 'succeeded' : 'failed'}`);
    } catch (error: any) {
      logger.error('Token refresh error:', error.message);
    }
    
    // Step 4: Simulate error conditions (comment out in production)
    /*
    logger.info('\nStep 4: Simulating error conditions...');
    try {
      // This will likely fail but demonstrate retry and error handling
      await skyvernAuth.get('/non-existent-endpoint');
    } catch (error: any) {
      logger.info('Expected error handled correctly:', error.message);
    }
    */
    
    // Step 5: Display metrics and session information
    logger.info('\nStep 5: Displaying auth metrics and session details');
    
    // Get metrics
    const metrics = skyvernAuth.getMetrics();
    logger.info('Request Metrics:', JSON.stringify(metrics, null, 2));
    
    // Get detailed auth information (safe for logging)
    const authDetails = skyvernAuth.getAuthDetails();
    logger.info('Auth Details:', JSON.stringify(authDetails, null, 2));
    
    logger.info('------- Skyvern Auth V2 Test Complete -------');
  } catch (error: any) {
    logger.error('Unexpected error during test:', error.message);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testSkyvernAuth().catch(error => {
    logger.error('Test failed with error:', error);
    process.exit(1);
  });
}

export default testSkyvernAuth;