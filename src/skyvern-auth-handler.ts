import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import logger from './logger';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  skyvernApiUrl: process.env.SKYVERN_API_URL || 'http://localhost:8000/api/v1',
  skyvernApiV2Url: process.env.SKYVERN_API_V2_URL || 'http://localhost:8000/api/v2',
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  
  skyvernBearerToken: process.env.SKYVERN_BEARER_TOKEN || '',
  maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
  initialRetryDelayMs: parseInt(process.env.INITIAL_RETRY_DELAY_MS || '1000'),
  maxRetryDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '30000'),
  timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'),
};

/**
 * SkyvernAuthHandler - A robust authentication handler for Skyvern API
 * 
 * Features:
 * - Multiple authentication methods (Bearer token and API key)
 * - Automatic retry with exponential backoff
 * - Fallback authentication mechanisms
 * - Detailed logging
 */
export class SkyvernAuthHandler {
  private skyvernClient: AxiosInstance | null = null;
  private fallbackClient: AxiosInstance | null = null;
  private v2Client: AxiosInstance | null = null;
  private useV2: boolean = false;
  private isInitialized: boolean = false;
  private authMethod: 'bearer' | 'apikey' | 'v2bearer' | 'none' = 'none';
  private lastTokenRefresh: number = 0;
  private tokenRefreshIntervalMs: number = 3600000; // 1 hour

  private tokenRefreshInProgress: boolean = false;
  private consecutiveFailures: number = 0;
  private maxConsecutiveFailures: number = 3;

  constructor(useV2: boolean = false) {
    this.useV2 = useV2;
    logger.info(`SkyvernAuthHandler created (API v${useV2 ? '2' : '1'})`);
  }


  /**
   * Initialize the Skyvern client with proper authentication
   * Attempts multiple authentication methods with retry logic
   */
  async ensureInitialized(): Promise<boolean> {
    if (this.isInitialized && this.skyvernClient) {
      // Check if we need to refresh the token
      const now = Date.now();
      if (this.authMethod === 'bearer' && now - this.lastTokenRefresh > this.tokenRefreshIntervalMs) {
        logger.info('Token refresh interval exceeded, reinitializing authentication');
        this.isInitialized = false;
      } else {
        return true;
      }
    }

    let retryCount = 0;
    
    while (retryCount < config.maxRetries) {
      try {
        logger.info(`Initializing Skyvern client (attempt ${retryCount + 1}/${config.maxRetries})`);
        
        // Try with API v2 and Bearer token first if v2 is enabled
        if (this.useV2 && config.skyvernBearerToken) {
          try {
            logger.info('Attempting V2 API with Bearer token authentication');
            this.v2Client = axios.create({
              baseURL: config.skyvernApiV2Url,
              headers: {
                'Authorization': `Bearer ${config.skyvernBearerToken}`,
                'Content-Type': 'application/json'
              },
              timeout: config.timeoutMs
            });
            
            // Verify connection with a simple request (for v2 API)
            // Note: Change to an appropriate V2 endpoint for health check
            const response = await this.v2Client.get('/');
            
            if (response.status >= 200 && response.status < 300) {
              this.skyvernClient = this.v2Client;
              this.isInitialized = true;
              this.authMethod = 'v2bearer';
              this.lastTokenRefresh = Date.now();
              this.consecutiveFailures = 0;
              logger.info('Skyvern V2 client initialized with Bearer token');
              return true;
            }
          } catch (v2Error: any) {
            logger.warn(`V2 API Bearer token auth failed: ${v2Error.message || 'Unknown error'}`);
          }
        }
        
        // Try with Bearer token authentication first
        if (config.skyvernBearerToken) {
          try {
            logger.info('Attempting Bearer token authentication');
            this.skyvernClient = axios.create({
              baseURL: config.skyvernApiUrl,
              headers: {
                'Authorization': `Bearer ${config.skyvernBearerToken}`,
                'Content-Type': 'application/json'
              },
              timeout: config.timeoutMs
            });
            
            // Verify connection with a simple request
            const response = await this.skyvernClient.get('/health');
            
            if (response.status === 200) {
              this.isInitialized = true;
              this.authMethod = 'bearer';
              this.lastTokenRefresh = Date.now();
              this.consecutiveFailures = 0;
              logger.info('Skyvern client initialized with Bearer token');
              return true;
            }
          } catch (bearerError: any) {
            logger.warn(`Bearer token auth failed: ${bearerError.message || 'Unknown error'}`);
            logger.debug('Trying API key authentication as fallback');
          }
        }
        
        // Try with x-api-key header if Bearer token failed or wasn't provided
        if (config.skyvernApiKey) {
          try {
            logger.info('Attempting API key authentication');
            this.fallbackClient = axios.create({
              baseURL: config.skyvernApiUrl,
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': config.skyvernApiKey,
              },
              timeout: config.timeoutMs
            });
            
            // Verify connection with a simple request
            const response = await this.fallbackClient.get('/health');
            
            if (response.status === 200) {
              this.skyvernClient = this.fallbackClient;
              this.isInitialized = true;
              this.authMethod = 'apikey';
              this.consecutiveFailures = 0;
              logger.info('Skyvern client initialized with API key');
              return true;
            }
          } catch (apiKeyError: any) {
            logger.error(`API key auth failed: ${apiKeyError.message || 'Unknown error'}`);
            
            // Implement exponential backoff for retries
            retryCount++;
            const delayMs = Math.min(
              config.initialRetryDelayMs * Math.pow(2, retryCount - 1),
              config.maxRetryDelayMs
            );
            
            logger.info(`Retrying in ${delayMs}ms (attempt ${retryCount}/${config.maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } else {
          logger.error('No API key provided for fallback authentication');
          retryCount++;
        }
      } catch (error: any) {
        logger.error(`Initialization error: ${error.message || 'Unknown error'}`);
        
        // Implement exponential backoff for retries
        retryCount++;
        const delayMs = Math.min(
          config.initialRetryDelayMs * Math.pow(2, retryCount - 1),
          config.maxRetryDelayMs
        );
        
        logger.info(`Retrying in ${delayMs}ms (attempt ${retryCount}/${config.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    logger.error(`Failed to initialize Skyvern client after ${config.maxRetries} attempts`);
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      logger.warn(`Reached ${this.maxConsecutiveFailures} consecutive failures. May need human intervention.`);
    }
    return false;
  }

  /**
   * Refresh the authentication token if using bearer token authentication
   * This should be called when tokens expire or authentication fails
   */
  private async refreshToken(): Promise<boolean> {
    // Prevent multiple simultaneous refresh attempts
    if (this.tokenRefreshInProgress) {
      logger.debug('Token refresh already in progress, waiting...');
      // Wait for the existing refresh to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.isInitialized;
    }
    
    this.tokenRefreshInProgress = true;
    logger.info('Refreshing authentication token...');
    
    try {
      // For now, token refresh is equivalent to re-initialization since we don't have
      // a specific token refresh endpoint. In a production environment, you would
      // implement a proper token refresh mechanism here.
      this.isInitialized = false;
      const result = await this.ensureInitialized();
      
      if (result) {
        logger.info('Token refreshed successfully');
        this.lastTokenRefresh = Date.now();
      } else {
        logger.error('Failed to refresh token');
      }
      
      this.tokenRefreshInProgress = false;
      return result;
    } catch (error) {
      logger.error('Error during token refresh:', error);
      this.tokenRefreshInProgress = false;
      return false;
    }
  }
  
  /**
   * Get the current API version URL based on the client configuration
   */
  getApiUrl(): string {
    return this.useV2 ? config.skyvernApiV2Url : config.skyvernApiUrl;
  }
  
  /**
   * Switch between API V1 and V2
   * @param useV2 Whether to use API V2 (true) or V1 (false)
   */
  setApiVersion(useV2: boolean): void {
    this.useV2 = useV2;
    this.isInitialized = false; // Force reinitialization with new version
  }

  /**
   * Make a GET request to the Skyvern API with automatic retries and error handling
   */
  async get<T = any>(endpoint: string, options: AxiosRequestConfig = {}): Promise<T> {
    return this.request<T>('GET', endpoint, undefined, options);
  }

  /**
   * Make a POST request to the Skyvern API with automatic retries and error handling
   */
  async post<T = any>(endpoint: string, data: any, options: AxiosRequestConfig = {}): Promise<T> {
    return this.request<T>('POST', endpoint, data, options);
  }

  /**
   * Make a PUT request to the Skyvern API with automatic retries and error handling
   */
  async put<T = any>(endpoint: string, data: any, options: AxiosRequestConfig = {}): Promise<T> {
    return this.request<T>('PUT', endpoint, data, options);
  }

  /**
   * Make a DELETE request to the Skyvern API with automatic retries and error handling
   */
  async delete<T = any>(endpoint: string, options: AxiosRequestConfig = {}): Promise<T> {
    return this.request<T>('DELETE', endpoint, undefined, options);
  }

  /**
   * Generic request method with retry logic and error handling
   */
  private async request<T = any>(
    method: string,
    endpoint: string,
    data?: any,
    options: AxiosRequestConfig = {}
  ): Promise<T> {
    // Ensure we're initialized before making requests
    const initialized = await this.ensureInitialized();
    if (!initialized || !this.skyvernClient) {
      throw new Error('Skyvern client not initialized');
    }

    let retryCount = 0;
    
    while (retryCount < config.maxRetries) {
      try {
        logger.debug(`Making ${method} request to ${endpoint} (attempt ${retryCount + 1}/${config.maxRetries})`);
        
        let response: AxiosResponse;
        
        switch (method.toUpperCase()) {
          case 'GET':
            response = await this.skyvernClient.get(endpoint, options);
            break;
          case 'POST':
            response = await this.skyvernClient.post(endpoint, data, options);
            break;
          case 'PUT':
            response = await this.skyvernClient.put(endpoint, data, options);
            break;
          case 'DELETE':
            response = await this.skyvernClient.delete(endpoint, options);
            break;
          default:
            throw new Error(`Unsupported HTTP method: ${method}`);
        }
        
        logger.debug(`${method} request to ${endpoint} successful`);
        return response.data;
      } catch (error: any) {
        const status = error.response?.status;
        
        // Handle authentication errors
        if (status === 401 || status === 403) {
          logger.warn(`Authentication error (${status}) for ${method} ${endpoint}, attempting refresh`);
          
          // For bearer token auth, try to refresh the token
          if (this.authMethod === 'bearer' || this.authMethod === 'v2bearer') {
            const refreshSuccessful = await this.refreshToken();
            if (!refreshSuccessful) {
              logger.error('Token refresh failed, forcing reinitialization on next attempt');
              this.isInitialized = false;
          
  }
          } else {
            // For other auth methods, just force reinitialization
            this.isInitialized = false;
            // Try to reinitialize immediately for the next attempt
            await this.ensureInitialized();
          }
          
        } else if (status === 429) {
          // Rate limiting - use longer backoff
          logger.warn(`Rate limit exceeded (429) for ${method} ${endpoint}`);
        } else if (status >= 500) {
          // Server errors - retry
          logger.warn(`Server error (${status}) for ${method} ${endpoint}`);
        } else if (error.code === 'ECONNABORTED') {
          // Timeout - retry
          logger.warn(`Request timeout for ${method} ${endpoint}`);
        } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
          // Connection reset or timed out - retry
          logger.warn(`Connection error (${error.code}) for ${method} ${endpoint}`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Add a small delay for connection issues
        } else {
          // Other errors - may not be recoverable, but we'll still retry
          logger.error(`Error on ${method} ${endpoint}: ${error.message || 'Unknown error'}`);
        }
        
        retryCount++;
        
        if (retryCount >= config.maxRetries) {
          logger.error(`Maximum retries (${config.maxRetries}) exceeded for ${method} ${endpoint}`);
          throw error;
        }
        
        // Calculate backoff with jitter to prevent thundering herd
        const jitter = Math.random() * 0.5 + 0.75; // Random value between 0.75 and 1.25
        const baseDelay = Math.min(config.initialRetryDelayMs * Math.pow(2, retryCount), config.maxRetryDelayMs);
        const delayMs = Math.min(baseDelay * jitter, config.maxRetryDelayMs);
        
        logger.info(`Retrying in ${delayMs}ms (attempt ${retryCount + 1}/${config.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    // This should never be reached due to the error thrown in the loop,
    // but TypeScript requires a return statement
    throw new Error(`Failed after ${config.maxRetries} retries`);
  }

  /**
   * Make an API request to the V2 API endpoint
   * This is a convenience method that temporarily switches to V2 API for a single request
   */
  async requestV2<T = any>(method: string, endpoint: string, data?: any, options: AxiosRequestConfig = {}): Promise<T> {
    const wasUsingV2 = this.useV2;
    this.setApiVersion(true);
    const result = await this.request<T>(method, endpoint, data, options);
    this.setApiVersion(wasUsingV2);
    return result;
  }

  /**
   * Get the authentication method being used
   */
  getAuthMethod(): string {
    return this.authMethod;
  }

  /**
   * Check if the client is properly initialized
   */
  isClientInitialized(): boolean {
    return this.isInitialized && this.skyvernClient !== null;
  }

  /**
   * Get details about the current auth configuration (safe for logging)
   */
  getAuthDetails(): object {
    return {
      isInitialized: this.isInitialized,
      authMethod: this.authMethod,
      apiUrl: config.skyvernApiUrl,
      apiV2Url: config.skyvernApiV2Url,
      usingV2Api: this.useV2,
      hasApiKey: !!config.skyvernApiKey,
      hasBearerToken: !!config.skyvernBearerToken,
      lastTokenRefresh: this.lastTokenRefresh > 0 ? new Date(this.lastTokenRefresh).toISOString() : 'never'
,
      tokenAge: this.lastTokenRefresh > 0 ? Math.floor((Date.now() - this.lastTokenRefresh) / 1000) : 0,
      consecutiveFailures: this.consecutiveFailures,
      refreshInProgress: this.tokenRefreshInProgress
    };
  }
}

// Create a singleton instance for use throughout the application
export const skyvernAuth = new SkyvernAuthHandler();

export default skyvernAuth;
