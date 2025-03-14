import { Browser, BrowserType, firefox, Page } from 'playwright';
import { logger } from './logger';
import { EventEmitter } from 'events';
import config from './config';

/**
 * Events emitted by the BrowserPool
 */
export enum BrowserPoolEvent {
  BROWSER_CREATED = 'browser_created',
  BROWSER_RELEASED = 'browser_released',
  QUEUE_UPDATED = 'queue_updated',
  RESOURCE_USAGE = 'resource_usage'
}

/**
 * Browser request interface
 */
export interface BrowserRequest {
  id: string;
  priority: number;
  resolve: (browser: Browser) => void;
  reject: (error: Error) => void;
}

/**
 * Browser pool for managing concurrent browser instances
 * Implements a priority queue for browser requests and limits the number of concurrent browsers
 */
export class BrowserPool extends EventEmitter {
  private maxConcurrent: number;
  private activeBrowsers: Map<string, Browser> = new Map();
  private queue: BrowserRequest[] = [];
  private isProcessing: boolean = false;
  private browserType: BrowserType;
  private resourceMonitorInterval: NodeJS.Timeout | null = null;

  /**
   * Create a new browser pool
   * @param maxConcurrent Maximum number of concurrent browser instances
   * @param browserType Playwright browser type (default: firefox)
   */
  constructor(maxConcurrent: number = 2, browserType: BrowserType = firefox) {
    super();
    this.maxConcurrent = maxConcurrent;
    this.browserType = browserType;
    logger.info(`Browser pool initialized with max ${maxConcurrent} concurrent browsers`);
    
    // Start resource monitoring
    this.startResourceMonitoring();
  }

  /**
   * Get a browser instance from the pool
   * @param requestId Unique identifier for the request
   * @param priority Priority of the request (higher number = higher priority)
   * @returns Promise resolving to a browser instance
   */
  async getBrowser(requestId: string, priority: number = 0): Promise<Browser> {
    logger.debug(`Browser request received: ${requestId} (priority: ${priority})`);
    
    return new Promise<Browser>((resolve, reject) => {
      // Add request to queue
      this.queue.push({
        id: requestId,
        priority,
        resolve,
        reject
      });
      
      // Sort queue by priority (descending)
      this.queue.sort((a, b) => b.priority - a.priority);
      
      // Emit queue updated event
      this.emit(BrowserPoolEvent.QUEUE_UPDATED, {
        queueLength: this.queue.length,
        activeBrowsers: this.activeBrowsers.size
      });
      
      // Process queue
      this.processQueue();
    });
  }

  /**
   * Release a browser instance back to the pool
   * @param requestId Request ID associated with the browser
   * @param browser Browser instance to release
   */
  async releaseBrowser(requestId: string, browser: Browser): Promise<void> {
    logger.debug(`Releasing browser: ${requestId}`);
    
    if (this.activeBrowsers.has(requestId)) {
      // Close the browser
      try {
        await browser.close();
      } catch (error) {
        logger.error(`Error closing browser: ${requestId}`, error);
      }
      
      // Remove from active browsers
      this.activeBrowsers.delete(requestId);
      
      // Emit browser released event
      this.emit(BrowserPoolEvent.BROWSER_RELEASED, {
        requestId,
        activeBrowsers: this.activeBrowsers.size
      });
      
      // Process queue to handle any waiting requests
      this.processQueue();
    }
  }

  /**
   * Process the browser request queue
   */
  private async processQueue(): Promise<void> {
    // Prevent concurrent processing
    if (this.isProcessing) return;
    this.isProcessing = true;
    
    try {
      // Process requests while there are items in the queue and we haven't reached max concurrent
      while (this.queue.length > 0 && this.activeBrowsers.size < this.maxConcurrent) {
        const request = this.queue.shift()!;
        
        try {
          logger.debug(`Creating browser for request: ${request.id}`);
          
          // Launch a new browser
          const browser = await this.browserType.launch({
            headless: config.browser.headless,
            slowMo: config.browser.slowMo
          });
          
          // Add to active browsers
          this.activeBrowsers.set(request.id, browser);
          
          // Emit browser created event
          this.emit(BrowserPoolEvent.BROWSER_CREATED, {
            requestId: request.id,
            activeBrowsers: this.activeBrowsers.size
          });
          
          // Resolve the promise with the browser
          request.resolve(browser);
        } catch (error) {
          logger.error(`Error creating browser for request: ${request.id}`, error);
          request.reject(error as Error);
        }
      }
    } finally {
      this.isProcessing = false;
      
      // If there are still items in the queue but we've reached max concurrent,
      // log a warning
      if (this.queue.length > 0 && this.activeBrowsers.size >= this.maxConcurrent) {
        logger.warn(`Browser pool at capacity (${this.maxConcurrent}). ${this.queue.length} requests waiting.`);
      }
    }
  }

  /**
   * Start monitoring resource usage
   */
  private startResourceMonitoring(): void {
    // Monitor resource usage every 30 seconds
    this.resourceMonitorInterval = setInterval(() => {
      const usage = {
        activeBrowsers: this.activeBrowsers.size,
        maxConcurrent: this.maxConcurrent,
        queueLength: this.queue.length,
        utilizationPercent: (this.activeBrowsers.size / this.maxConcurrent) * 100
      };
      
      logger.info(`Browser pool usage: ${usage.activeBrowsers}/${usage.maxConcurrent} (${usage.utilizationPercent.toFixed(1)}%), Queue: ${usage.queueLength}`);
      
      // Emit resource usage event
      this.emit(BrowserPoolEvent.RESOURCE_USAGE, usage);
    }, 30000);
  }

  /**
   * Stop resource monitoring
   */
  public stopResourceMonitoring(): void {
    if (this.resourceMonitorInterval) {
      clearInterval(this.resourceMonitorInterval);
      this.resourceMonitorInterval = null;
    }
  }

  /**
   * Get the current number of active browsers
   * @returns Number of active browsers
   */
  public getActiveBrowserCount(): number {
    return this.activeBrowsers.size;
  }

  /**
   * Get the current queue length
   * @returns Number of requests in the queue
   */
  public getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Update the maximum number of concurrent browsers
   * @param maxConcurrent New maximum number of concurrent browsers
   */
  public setMaxConcurrent(maxConcurrent: number): void {
    if (maxConcurrent < 1) {
      throw new Error('Maximum concurrent browsers must be at least 1');
    }
    
    this.maxConcurrent = maxConcurrent;
    logger.info(`Browser pool max concurrent updated to ${maxConcurrent}`);
    
    // Process queue in case we can now handle more browsers
    this.processQueue();
  }

  /**
   * Execute a task with a browser from the pool
   * @param task Task function that takes a browser and returns a promise
   * @param requestId Unique identifier for the request
   * @param priority Priority of the request (higher number = higher priority)
   * @returns Promise resolving to the result of the task
   */
  async execute<T>(
    task: (browser: Browser) => Promise<T>,
    requestId: string = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    priority: number = 0
  ): Promise<T> {
    // Get a browser from the pool
    const browser = await this.getBrowser(requestId, priority);
    
    try {
      // Execute the task
      return await task(browser);
    } finally {
      // Release the browser back to the pool
      await this.releaseBrowser(requestId, browser);
    }
  }

  /**
   * Execute a task with a page from a browser in the pool
   * @param task Task function that takes a page and returns a promise
   * @param requestId Unique identifier for the request
   * @param priority Priority of the request (higher number = higher priority)
   * @returns Promise resolving to the result of the task
   */
  async executeWithPage<T>(
    task: (page: Page) => Promise<T>,
    requestId: string = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    priority: number = 0
  ): Promise<T> {
    return this.execute(async (browser) => {
      // Create a new page
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        userAgent: config.browser.userAgent
      });
      
      try {
        // Execute the task with the page
        return await task(page);
      } finally {
        // Close the page
        await page.close();
      }
    }, requestId, priority);
  }

  /**
   * Shutdown the browser pool
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down browser pool');
    
    // Stop resource monitoring
    this.stopResourceMonitoring();
    
    // Close all active browsers
    const closePromises = Array.from(this.activeBrowsers.entries()).map(async ([requestId, browser]) => {
      try {
        await browser.close();
        logger.debug(`Closed browser: ${requestId}`);
      } catch (error) {
        logger.error(`Error closing browser: ${requestId}`, error);
      }
    });
    
    // Wait for all browsers to close
    await Promise.all(closePromises);
    
    // Clear active browsers
    this.activeBrowsers.clear();
    
    // Reject any remaining requests in the queue
    this.queue.forEach(request => {
      request.reject(new Error('Browser pool shutdown'));
    });
    
    // Clear queue
    this.queue = [];
    
    logger.info('Browser pool shutdown complete');
  }
}

// Export default instance
export default BrowserPool;