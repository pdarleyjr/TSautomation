import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import logger from './logger';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  skyvernApiUrl: process.env.SKYVERN_API_URL || 'http://localhost:8000',
  skyvernApiV2Url: process.env.SKYVERN_API_V2_URL || 'http://localhost:8000/api/v2',
  skyvernApiKey: process.env.SKYVERN_API_KEY || '',
  skyvernBearerToken: process.env.SKYVERN_BEARER_TOKEN || '',
  
  // Retry configuration for authentication and requests
  maxRetries: parseInt(process.env.MAX_RETRIES || '5'),
  initialRetryDelayMs: parseInt(process.env.INITIAL_RETRY_DELAY_MS || '1000'),
  maxRetryDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '30000'),
  timeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS || '30000'),
  
  // Token refresh configuration
  tokenRefreshIntervalMs: parseInt(process.env.TOKEN_REFRESH_INTERVAL_MS || '3600000'), // 1 hour
  
  // Consecutive failures threshold for alerting
  maxConsecutiveFailures: parseInt(process.env.MAX_CONSECUTIVE_FAILURES || '3'),
  
  // Session logging
  logHealthChecks: process.env.LOG_HEALTH_CHECKS === 'true',
};

/**
 * Types for authentication and responses
 */
export type AuthMethod = 'v2bearer' | 'bearer' | 'apikey' | 'none';

interface AuthSession {
  id: string;
  method: AuthMethod;
  startTime: number;
  lastRefresh: number;
  expiresAt: number | null;
  consecutiveFailures: number;
}

export interface RequestMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  retriedRequests: number;
  authFailures: number;
  networkErrors: number;
  serverErrors: number;
  rateLimitErrors: number;
  timeoutErrors: number;
  lastErrorTime: number | null;
  lastSuccessTime: number | null;
}

/**
 * SkyvernAuthV2Handler - A robust authentication handler for Skyvern API with enhanced features
 * 
 * Improvements:
 * - Comprehensive authentication strategy with multiple fallback methods
 * - Advanced retry logic with exponential backoff and jitter
 * - Detailed logging and telemetry for debugging
 * - Token refresh and session management
 * - Error categorization and specific handling strategies
 * - Circuit breaker pattern to prevent cascading failures
 */
export class SkyvernAuthV2Handler {
  private skyvernClient: AxiosInstance | null = null;
  private fallbackClient: AxiosInstance | null = null;
  private v2Client: AxiosInstance | null = null;
  private useV2: boolean = true;
  private isInitialized: boolean = false;
  private authSession: AuthSession;
  private refreshInProgress: boolean = false;
  private metrics: RequestMetrics;
  private circuitOpen: boolean = false;
  private circuitOpenTime: number = 0;
  private circuitResetTimeMs: number = 30000; // 30 seconds
  private requestQueue: Array<() => Promise<void>> = [];
  private requestInProgress: boolean = false;

  constructor(useV2: boolean = true) {
    this.useV2 = useV2;
    
    // Initialize auth session
    this.authSession = {
      id: uuidv4(),
      method: 'none',
      startTime: Date.now(),
      lastRefresh: 0,
      expiresAt: null,
      consecutiveFailures: 0
    };
    
    // Initialize metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      authFailures: 0,
      networkErrors: 0,
      serverErrors: 0,
      rateLimitErrors: 0,
      timeoutErrors: 0,
      lastErrorTime: null,
      lastSuccessTime: null
    };
    
    logger.info(`SkyvernAuthV2Handler created (API v${useV2 ? '2' : '1'}) - Session ID: ${this.authSession.id}`);
  }

  /**
   * Initialize the Skyvern client with proper authentication using a comprehensive strategy
   */
  async ensureInitialized(): Promise<boolean> {
    // Check if already initialized and not expired
    if (this.isInitialized && this.skyvernClient) {
      // Check if we need to refresh the token
      const now = Date.now();
      
      // Token expiration check
      if (this.authSession.expiresAt && now >= this.authSession.expiresAt) {
        logger.info('Token has expired, reinitializing authentication');
        this.isInitialized = false;
      }
      // Periodic refresh check
      else if (
        (this.authSession.method === 'bearer' || this.authSession.method === 'v2bearer') && 
        now - this.authSession.lastRefresh > config.tokenRefreshIntervalMs
      ) {
        logger.info('Token refresh interval exceeded, reinitializing authentication');
        this.isInitialized = false;
      } else {
        return true;
      }
    }

    // Circuit breaker pattern to prevent repeated initialization attempts
    if (this.circuitOpen) {
      const now = Date.now();
      if (now - this.circuitOpenTime < this.circuitResetTimeMs) {
        logger.warn(`Circuit breaker open. Skipping initialization. Will retry after ${Math.round((this.circuitOpenTime + this.circuitResetTimeMs - now) / 1000)}s`);
        return false;
      } else {
        logger.info('Circuit breaker reset. Attempting initialization.');
        this.circuitOpen = false;
      }
    }

    let retryCount = 0;
    
    while (retryCount < config.maxRetries) {
      try {
        logger.info(`Initializing Skyvern client (attempt ${retryCount + 1}/${config.maxRetries})`);
        
        // Create a session ID for tracking this initialization attempt
        const attemptId = `init_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        
        // Try with API v2 and Bearer token first if v2 is enabled
        if (this.useV2 && config.skyvernBearerToken) {
          try {
            logger.info(`[${attemptId}] Attempting V2 API with Bearer token authentication`);
            
            // Create client with bearer token for V2 API
            this.v2Client = axios.create({
              baseURL: config.skyvernApiV2Url,
              headers: {
                'Authorization': `Bearer ${config.skyvernBearerToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-ID': attemptId
              },
              timeout: config.timeoutMs
            });
            
            // Add response interceptor for request timing and error logging
            this.v2Client.interceptors.response.use(
              (response) => {
                if (config.logHealthChecks || !response.config.url?.includes('/health')) {
                  logger.debug(`[${attemptId}] V2 API request succeeded: ${response.config.method?.toUpperCase()} ${response.config.url} (${response.status})`);
                }
                return response;
              },
              (error) => {
                this.logAxiosError(error, attemptId);
                throw error;
              }
            );
            
            // Verify connection with a validation request to V2 API
            // Use the root endpoint or another appropriate health endpoint for V2
            const response = await this.v2Client.get('/api/v2/health', { 
              validateStatus: (status) => status >= 200 && status < 300 
            });
            
            if (response.status >= 200 && response.status < 300) {
              this.skyvernClient = this.v2Client;
              this.isInitialized = true;
              this.authSession = {
                id: uuidv4(),
                method: 'v2bearer',
                startTime: Date.now(),
                lastRefresh: Date.now(),
                expiresAt: null, // If the API provides token expiration info, set it here
                consecutiveFailures: 0
              };
              
              logger.info(`[${attemptId}] Skyvern V2 client initialized with Bearer token (Session: ${this.authSession.id})`);
              
              // Update metrics
              this.metrics.lastSuccessTime = Date.now();
              return true;
            }
          } catch (v2Error: any) {
            const errorMsg = v2Error?.response?.data?.message || v2Error?.message || 'Unknown error';
            logger.warn(`[${attemptId}] V2 API Bearer token auth failed: ${errorMsg}`);
            // Continue to next authentication method
          }
        }
        
        // Try with Bearer token authentication for V1 API
        if (config.skyvernBearerToken) {
          try {
            logger.info(`[${attemptId}] Attempting V1 API with Bearer token authentication`);
            
            // Create client with bearer token for V1 API
            this.skyvernClient = axios.create({
              baseURL: config.skyvernApiUrl,
              headers: {
                'Authorization': `Bearer ${config.skyvernBearerToken}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Request-ID': attemptId
              },
              timeout: config.timeoutMs
            });
            
            // Add response interceptor for request timing and error logging
            this.skyvernClient.interceptors.response.use(
              (response) => {
                if (config.logHealthChecks || !response.config.url?.includes('/health')) {
                  logger.debug(`[${attemptId}] V1 API request succeeded: ${response.config.method?.toUpperCase()} ${response.config.url} (${response.status})`);
                }
                return response;
              },
              (error) => {
                this.logAxiosError(error, attemptId);
                throw error;
              }
            );
            
            // Verify connection with a health check request
            const response = await this.skyvernClient.get('/health', {
              validateStatus: (status) => status >= 200 && status < 300
            });
            
            if (response.status >= 200 && response.status < 300) {
              this.isInitialized = true;
              this.authSession = {
                id: uuidv4(),
                method: 'bearer',
                startTime: Date.now(),
                lastRefresh: Date.now(),
                expiresAt: null,
                consecutiveFailures: 0
              };
              
              logger.info(`[${attemptId}] Skyvern V1 client initialized with Bearer token (Session: ${this.authSession.id})`);
              
              // Update metrics
              this.metrics.lastSuccessTime = Date.now();
              return true;
            }
          } catch (bearerError: any) {
            const errorMsg = bearerError?.response?.data?.message || bearerError?.message || 'Unknown error';
            logger.warn(`[${attemptId}] V1 Bearer token auth failed: ${errorMsg}`);
            logger.debug('Trying API key authentication as fallback');
          }
        }
        
        // Try with x-api-key header if Bearer token failed or wasn't provided
        if (config.skyvernApiKey) {
          try {
            logger.info(`[${attemptId}] Attempting API key authentication`);
            
            // Create client with API key
            this.fallbackClient = axios.create({
              baseURL: config.skyvernApiUrl,
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'x-api-key': config.skyvernApiKey,
                'X-Request-ID': attemptId
              },
              timeout: config.timeoutMs
            });
            
            // Add response interceptor for request timing and error logging
            this.fallbackClient.interceptors.response.use(
              (response) => {
                if (config.logHealthChecks || !response.config.url?.includes('/health')) {
                  logger.debug(`[${attemptId}] API key request succeeded: ${response.config.method?.toUpperCase()} ${response.config.url} (${response.status})`);
                }
                return response;
              },
              (error) => {
                this.logAxiosError(error, attemptId);
                throw error;
              }
            );
            
            // Verify connection with a health check request
            const response = await this.fallbackClient.get('/health', {
              validateStatus: (status) => status >= 200 && status < 300
            });
            
            if (response.status >= 200 && response.status < 300) {
              this.skyvernClient = this.fallbackClient;
              this.isInitialized = true;
              this.authSession = {
                id: uuidv4(),
                method: 'apikey',
                startTime: Date.now(),
                lastRefresh: Date.now(),
                expiresAt: null,
                consecutiveFailures: 0
              };
              
              logger.info(`[${attemptId}] Skyvern client initialized with API key (Session: ${this.authSession.id})`);
              
              // Update metrics
              this.metrics.lastSuccessTime = Date.now();
              return true;
            }
          } catch (apiKeyError: any) {
            const errorMsg = apiKeyError?.response?.data?.message || apiKeyError?.message || 'Unknown error';
            logger.error(`[${attemptId}] API key auth failed: ${errorMsg}`);
            
            // Track this failure
            this.metrics.authFailures++;
            this.metrics.lastErrorTime = Date.now();
            
            // Implement exponential backoff with jitter for retries
            retryCount++;
            const baseDelay = Math.min(
              config.initialRetryDelayMs * Math.pow(2, retryCount - 1),
              config.maxRetryDelayMs
            );
            // Add jitter (±20%) to prevent thundering herd
            const jitter = 0.8 + Math.random() * 0.4; // between 0.8 and 1.2
            const delayMs = Math.round(baseDelay * jitter);
            
            logger.info(`[${attemptId}] Retrying in ${delayMs}ms (attempt ${retryCount}/${config.maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
          }
        } else {
          logger.error(`[${attemptId}] No API key provided for fallback authentication`);
          retryCount++;
          // Even with no API key, apply backoff
          await new Promise(resolve => setTimeout(resolve, config.initialRetryDelayMs * retryCount));
        }
      } catch (error: any) {
        const errorMsg = error?.message || 'Unknown error';
        logger.error(`Initialization error: ${errorMsg}`);
        
        // Update metrics
        this.metrics.failedRequests++;
        this.metrics.lastErrorTime = Date.now();
        
        // Implement exponential backoff with jitter for retries
        retryCount++;
        const baseDelay = Math.min(
          config.initialRetryDelayMs * Math.pow(2, retryCount - 1),
          config.maxRetryDelayMs
        );
        // Add jitter (±20%) to prevent thundering herd
        const jitter = 0.8 + Math.random() * 0.4; // between 0.8 and 1.2
        const delayMs = Math.round(baseDelay * jitter);
        
        logger.info(`Retrying in ${delayMs}ms (attempt ${retryCount}/${config.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    // If we get here, all authentication attempts failed
    logger.error(`Failed to initialize Skyvern client after ${config.maxRetries} attempts`);
    
    // Update session
    this.authSession.consecutiveFailures++;
    
    // Check if we need to open the circuit breaker
    if (this.authSession.consecutiveFailures >= config.maxConsecutiveFailures) {
      logger.warn(`Reached ${this.authSession.consecutiveFailures} consecutive failures. Opening circuit breaker.`);
      this.circuitOpen = true;
      this.circuitOpenTime = Date.now();
    }
    
    return false;
  }

  /**
   * Log helpful information about Axios errors
   */
  private logAxiosError(error: AxiosError, requestId: string = 'unknown'): void {
    if (!error.response) {
      // Network error or timeout
      if (error.code === 'ECONNABORTED') {
        logger.warn(`[${requestId}] Request timeout: ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        this.metrics.timeoutErrors++;
      } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
        logger.warn(`[${requestId}] Network error (${error.code}): ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        this.metrics.networkErrors++;
      } else {
        logger.error(`[${requestId}] Request failed: ${error.message}`);
      }
    } else {
      // HTTP error
      const status = error.response.status;
      const data = error.response.data ? JSON.stringify(error.response.data).substring(0, 200) : '(no data)';
      
      if (status === 401 || status === 403) {
        logger.warn(`[${requestId}] Authentication error (${status}): ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${data}`);
        this.metrics.authFailures++;
      } else if (status === 429) {
        logger.warn(`[${requestId}] Rate limit exceeded (429): ${error.config?.method?.toUpperCase()} ${error.config?.url}`);
        this.metrics.rateLimitErrors++;
      } else if (status >= 500) {
        logger.warn(`[${requestId}] Server error (${status}): ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${data}`);
        this.metrics.serverErrors++;
      } else {
        logger.error(`[${requestId}] HTTP error (${status}): ${error.config?.method?.toUpperCase()} ${error.config?.url} - ${data}`);
      }
    }
    
    // Update metrics
    this.metrics.failedRequests++;
    this.metrics.lastErrorTime = Date.now();
  }

  /**
   * Refresh the authentication token if using bearer token authentication
   * Implements proper token refresh strategy with retry logic
   */
  async refreshToken(): Promise<boolean> {
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshInProgress) {
      logger.debug('Token refresh already in progress, waiting...');
      // Wait for the existing refresh to complete
      for (let i = 0; i < 10; i++) { // Wait up to ~5 seconds
        if (!this.refreshInProgress) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      return this.isInitialized;
    }
    
    // Acquire the refresh lock
    this.refreshInProgress = true;
    const refreshId = `refresh_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    logger.info(`[${refreshId}] Refreshing authentication token...`);
    
    try {
      // For this implementation, token refresh is equivalent to re-initialization
      // In a production system with a proper token refresh endpoint, you would
      // implement a separate refresh flow here using the refresh token
      
      // Force reinitialization
      this.isInitialized = false;
      const result = await this.ensureInitialized();
      
      if (result) {
        logger.info(`[${refreshId}] Token refreshed successfully (Session: ${this.authSession.id})`);
        this.authSession.lastRefresh = Date.now();
        // Reset consecutive failures since we succeeded
        this.authSession.consecutiveFailures = 0;
      } else {
        logger.error(`[${refreshId}] Failed to refresh token`);
        this.authSession.consecutiveFailures++;
      }
      
      this.refreshInProgress = false;
      return result;
    } catch (error: any) {
      const errorMsg = error?.message || 'Unknown error';
      logger.error(`[${refreshId}] Error during token refresh: ${errorMsg}`);
      this.refreshInProgress = false;
      this.authSession.consecutiveFailures++;
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
    if (this.useV2 !== useV2) {
      logger.info(`Switching API version from v${this.useV2 ? '2' : '1'} to v${useV2 ? '2' : '1'}`);
      this.useV2 = useV2;
      this.isInitialized = false; // Force reinitialization with new version
    }
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
   * Generic request method with retry logic, error handling, and rate limiting control
   * Implements a comprehensive request processing strategy
   */
  private async request<T = any>(
    method: string,
    endpoint: string,
    data?: any,
    options: AxiosRequestConfig = {}
  ): Promise<T> {
    // Ensure we're initialized before making requests
    const initialized = await this.ensureInitialized();
    if (!initialized) {
      throw new Error('Skyvern client not initialized');
    }
    
    // If skyvernClient is still null after initialization, something has gone wrong
    if (!this.skyvernClient) {
      throw new Error('Skyvern client still null after initialization');
    }
    
    // Create a safe reference to the client
    const skyvernClient = this.skyvernClient;

    // Create unique request ID for tracking
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    
    // Use a queueing mechanism for requests if needed for rate limiting
    return new Promise<T>((resolve, reject) => {
      // Queue this request
      this.requestQueue.push(async () => {
        let retryCount = 0;
        
        while (retryCount < config.maxRetries) {
          try {
            // Update metrics
            this.metrics.totalRequests++;
            
            if (retryCount > 0) {
              this.metrics.retriedRequests++;
              logger.debug(`[${requestId}] Retry ${retryCount}/${config.maxRetries} for ${method} ${endpoint}`);
            } else {
              logger.debug(`[${requestId}] Making ${method} request to ${endpoint}`);
            }
            
            let response: AxiosResponse;
            
            // Add request ID to headers for tracing
            const requestOptions: AxiosRequestConfig = {
              ...options,
              headers: {
                ...options.headers,
                'X-Request-ID': requestId
              }
            };
            
            // Make request based on method
            switch (method.toUpperCase()) {
              case 'GET':
                response = await skyvernClient.get(endpoint, requestOptions);
                break;
              case 'POST':
                response = await skyvernClient.post(endpoint, data, requestOptions);
                break;
              case 'PUT':
                response = await skyvernClient.put(endpoint, data, requestOptions);
                break;
              case 'DELETE':
                response = await skyvernClient.delete(endpoint, requestOptions);
                break;
              default:
                throw new Error(`Unsupported HTTP method: ${method}`);
            }
            
            // Update metrics for successful request
            this.metrics.successfulRequests++;
            this.metrics.lastSuccessTime = Date.now();
            
            // Reset consecutive failures counter on success
            this.authSession.consecutiveFailures = 0;
            
            logger.debug(`[${requestId}] ${method} request to ${endpoint} successful`);
            resolve(response.data);
            return;
          } catch (error: any) {
            const isAxiosError = axios.isAxiosError(error);
            const status = isAxiosError ? error.response?.status : null;
            
            // Handle authentication errors
            if (status === 401 || status === 403) {
              logger.warn(`[${requestId}] Authentication error (${status}) for ${method} ${endpoint}, attempting refresh`);
              
              // For bearer token auth, try to refresh the token
              if (this.authSession.method === 'bearer' || this.authSession.method === 'v2bearer') {
                const refreshSuccessful = await this.refreshToken();
                if (!refreshSuccessful) {
                  logger.error('[${requestId}] Token refresh failed, forcing reinitialization on next attempt');
                  this.isInitialized = false;
                  // Try to reinitialize immediately for the next attempt
                  await this.ensureInitialized();
                }
              } else {
                // For other auth methods, just force reinitialization
                this.isInitialized = false;
                // Try to reinitialize immediately for the next attempt
                await this.ensureInitialized();
              }
            } 
            // Handle rate limiting
            else if (status === 429) {
              // Rate limiting - use longer backoff
              logger.warn(`[${requestId}] Rate limit exceeded (429) for ${method} ${endpoint}`);
              
              // Check for Retry-After header
              const retryAfter = error.response?.headers['retry-after'];
              let waitMs = config.initialRetryDelayMs * Math.pow(2, retryCount);
              
              if (retryAfter) {
                // Retry-After can be seconds or a date
                if (/^\d+$/.test(retryAfter)) {
                  waitMs = parseInt(retryAfter) * 1000;
                } else {
                  const retryTime = new Date(retryAfter).getTime();
                  waitMs = retryTime - Date.now();
                }
              }
              
              waitMs = Math.min(waitMs, config.maxRetryDelayMs);
              logger.info(`[${requestId}] Rate limiting - waiting ${Math.round(waitMs/1000)}s before retry`);
              await new Promise(resolve => setTimeout(resolve, waitMs));
            } 
            // Handle server errors
            else if (status && status >= 500) {
              // Server errors - retry with backoff
              logger.warn(`[${requestId}] Server error (${status}) for ${method} ${endpoint}`);
              
              // Apply exponential backoff with jitter
              const baseDelay = Math.min(
                config.initialRetryDelayMs * Math.pow(2, retryCount),
                config.maxRetryDelayMs
              );
              const jitter = 0.8 + Math.random() * 0.4; // between 0.8 and 1.2
              const delayMs = Math.round(baseDelay * jitter);
              
              logger.info(`[${requestId}] Server error - waiting ${Math.round(delayMs/1000)}s before retry`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            } 
            // Handle timeouts
            else if (isAxiosError && error.code === 'ECONNABORTED') {
              // Timeout - retry
              logger.warn(`[${requestId}] Request timeout for ${method} ${endpoint}`);
              
              // Apply exponential backoff with jitter
              const baseDelay = Math.min(
                config.initialRetryDelayMs * Math.pow(2, retryCount),
                config.maxRetryDelayMs
              );
              const jitter = 0.8 + Math.random() * 0.4;
              const delayMs = Math.round(baseDelay * jitter);
              
              logger.info(`[${requestId}] Timeout - waiting ${Math.round(delayMs/1000)}s before retry`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            } 
            // Handle network errors
            else if (isAxiosError && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND')) {
              // Connection reset or timed out - retry
              logger.warn(`[${requestId}] Connection error (${error.code}) for ${method} ${endpoint}`);
              
              // Network errors may benefit from a short initial delay
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Then apply standard backoff
              const baseDelay = Math.min(
                config.initialRetryDelayMs * Math.pow(2, retryCount),
                config.maxRetryDelayMs
              );
              const jitter = 0.8 + Math.random() * 0.4;
              const delayMs = Math.round(baseDelay * jitter);
              
              logger.info(`[${requestId}] Network error - waiting ${Math.round(delayMs/1000)}s before retry`);
              await new Promise(resolve => setTimeout(resolve, delayMs));
            } 
            // Handle other errors
            else {
              // Other errors - may not be recoverable, but we'll still retry
              const errorMsg = error?.message || 'Unknown error';
              logger.error(`[${requestId}] Error on ${method} ${endpoint}: ${errorMsg}`);
              
              // Apply standard backoff
              const baseDelay = Math.min(
                config.initialRetryDelayMs * Math.pow(2, retryCount),
                config.maxRetryDelayMs
              );
              const jitter = 0.8 + Math.random() * 0.4;
              const delayMs = Math.round(baseDelay * jitter);
              
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }
            
            retryCount++;
            
            if (retryCount >= config.maxRetries) {
              logger.error(`[${requestId}] Maximum retries (${config.maxRetries}) exceeded for ${method} ${endpoint}`);
              
              // Update metrics
              this.metrics.failedRequests++;
              this.metrics.lastErrorTime = Date.now();
              this.authSession.consecutiveFailures++;
              
              reject(error);
              return;
            }
          }
        }
        
        // This should never be reached due to the return in the success case
        // and the reject in the failure case
        reject(new Error(`[${requestId}] Failed after ${config.maxRetries} retries`));
      });
      
      // Process the queue
      this.processRequestQueue();
    });
  }

  /**
   * Process the request queue to control concurrency and rate limiting
   * This helps prevent overwhelming the API with too many simultaneous requests
   */
  private async processRequestQueue(): Promise<void> {
    if (this.requestInProgress || this.requestQueue.length === 0) {
      return;
    }
    
    this.requestInProgress = true;
    
    try {
      // Get the next request from the queue
      const nextRequest = this.requestQueue.shift();
      if (nextRequest) {
        // Execute the request
        await nextRequest();
      }
    } catch (error) {
      logger.error('Error processing request queue:', error);
    } finally {
      this.requestInProgress = false;
      
      // Process the next request in the queue if any
      if (this.requestQueue.length > 0) {
        // Add a small delay between requests to avoid overwhelming the API
        setTimeout(() => this.processRequestQueue(), 50);
      }
    }
  }

  /**
   * Make an API request to the V2 API endpoint
   * This is a convenience method that temporarily switches to V2 API for a single request
   */
  async requestV2<T = any>(
    method: string, 
    endpoint: string, 
    data?: any, 
    options: AxiosRequestConfig = {}
  ): Promise<T> {
    const wasUsingV2 = this.useV2;
    this.setApiVersion(true);
    
    try {
      const result = await this.request<T>(method, endpoint, data, options);
      return result;
    } finally {
      // Always restore the original API version setting
      this.setApiVersion(wasUsingV2);
    }
  }

  /**
   * Get the authentication method being used
   */
  getAuthMethod(): AuthMethod {
    return this.authSession.method;
  }

  /**
   * Check if the client is properly initialized
   */
  isClientInitialized(): boolean {
    return this.isInitialized && this.skyvernClient !== null;
  }

  /**
   * Get detailed metrics about the authentication and requests
   */
  getMetrics(): RequestMetrics {
    return {...this.metrics}; // Return a copy
  }

  /**
   * Get details about the current auth configuration (safe for logging)
   */
  getAuthDetails(): object {
    return {
      isInitialized: this.isInitialized,
      sessionId: this.authSession.id,
      authMethod: this.authSession.method,
      apiUrl: this.getApiUrl(),
      usingV2Api: this.useV2,
      hasApiKey: !!config.skyvernApiKey,
      hasBearerToken: !!config.skyvernBearerToken,
      sessionStartTime: new Date(this.authSession.startTime).toISOString(),
      lastTokenRefresh: this.authSession.lastRefresh > 0 
        ? new Date(this.authSession.lastRefresh).toISOString() 
        : 'never',
      tokenAge: this.authSession.lastRefresh > 0 
        ? Math.floor((Date.now() - this.authSession.lastRefresh) / 1000) 
        : 0,
      tokenExpiresAt: this.authSession.expiresAt 
        ? new Date(this.authSession.expiresAt).toISOString() 
        : 'unknown',
      tokenStatus: this.authSession.expiresAt 
        ? (Date.now() < this.authSession.expiresAt ? 'valid' : 'expired') 
        : 'unknown',
      consecutiveFailures: this.authSession.consecutiveFailures,
      refreshInProgress: this.refreshInProgress,
      circuitBreakerStatus: this.circuitOpen ? 'open' : 'closed',
      metrics: {
        successRate: this.metrics.totalRequests > 0 
          ? (this.metrics.successfulRequests / this.metrics.totalRequests * 100).toFixed(1) + '%' 
          : 'N/A',
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        authFailures: this.metrics.authFailures,
        lastActivity: this.metrics.lastSuccessTime 
          ? new Date(this.metrics.lastSuccessTime).toISOString() 
          : 'never'
      }
    };
  }
}

// Create a singleton instance for use throughout the application
export const skyvernAuthV2 = new SkyvernAuthV2Handler();

export default skyvernAuthV2;