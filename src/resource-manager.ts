import { Browser, Page } from 'playwright';
import { BrowserPool, BrowserPoolEvent } from './browser-pool';
import { DataStore, DataStoreEvent } from './data-store';
import { ResourceMonitor, ResourceMonitorEvent } from './resource-monitor';
import { logger } from './logger';
import config from './config';
import { EventEmitter } from 'events';

/**
 * Events emitted by the ResourceManager
 */
export enum ResourceManagerEvent {
  BROWSER_ALLOCATED = 'browser_allocated',
  BROWSER_RELEASED = 'browser_released',
  DATA_STORED = 'data_stored',
  DATA_RETRIEVED = 'data_retrieved',
  DATA_DELETED = 'data_deleted',
  RESOURCE_WARNING = 'resource_warning',
  RESOURCE_CRITICAL = 'resource_critical'
}

/**
 * Resource manager configuration interface
 */
export interface ResourceManagerConfig {
  maxConcurrentBrowsers: number;
  dataStorageDir: string;
  dataExpirationMs: number;
  persistData: boolean;
  monitorResources: boolean;
  resourceCheckIntervalMs: number;
}

/**
 * Default resource manager configuration
 */
const DEFAULT_CONFIG: ResourceManagerConfig = {
  maxConcurrentBrowsers: config.parallel.maxConcurrent || 2,
  dataStorageDir: './data',
  dataExpirationMs: 3600000, // 1 hour
  persistData: true,
  monitorResources: true,
  resourceCheckIntervalMs: 30000 // 30 seconds
};

/**
 * Resource manager for coordinating browser instances, data storage, and resource monitoring
 */
export class ResourceManager extends EventEmitter {
  private browserPool: BrowserPool;
  private dataStore: DataStore;
  private resourceMonitor: ResourceMonitor;
  private config: ResourceManagerConfig;
  private assignmentDataMap: Map<string, string[]> = new Map();
  private isShuttingDown: boolean = false;

  /**
   * Create a new resource manager
   * @param config Resource manager configuration
   */
  constructor(config: Partial<ResourceManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize browser pool
    this.browserPool = new BrowserPool(this.config.maxConcurrentBrowsers);
    
    // Initialize data store
    this.dataStore = new DataStore(
      this.config.dataStorageDir,
      this.config.resourceCheckIntervalMs,
      undefined // Use default encryption key
    );
    
    // Initialize resource monitor
    this.resourceMonitor = new ResourceMonitor(
      {
        monitorIntervalMs: this.config.resourceCheckIntervalMs,
        persistMetrics: true,
        metricsDir: './logs/metrics'
      },
      this.browserPool
    );
    
    // Set up event listeners
    this.setupEventListeners();
    
    logger.info(`Resource manager initialized with max ${this.config.maxConcurrentBrowsers} concurrent browsers`);
    
    // Start resource monitoring if enabled
    if (this.config.monitorResources) {
      this.resourceMonitor.start();
    }
  }

  /**
   * Set up event listeners for components
   */
  private setupEventListeners(): void {
    // Browser pool events
    this.browserPool.on(BrowserPoolEvent.BROWSER_CREATED, (data) => {
      logger.debug(`Browser created: ${data.requestId}`);
    });
    
    this.browserPool.on(BrowserPoolEvent.BROWSER_RELEASED, (data) => {
      logger.debug(`Browser released: ${data.requestId}`);
    });
    
    this.browserPool.on(BrowserPoolEvent.RESOURCE_USAGE, (data) => {
      // Forward to resource monitor
      this.resourceMonitor.recordMetric('browser_pool_utilization', data.utilizationPercent, '%');
    });
    
    // Data store events
    this.dataStore.on(DataStoreEvent.DATA_STORED, (data) => {
      this.emit(ResourceManagerEvent.DATA_STORED, data);
    });
    
    this.dataStore.on(DataStoreEvent.DATA_RETRIEVED, (data) => {
      this.emit(ResourceManagerEvent.DATA_RETRIEVED, data);
    });
    
    this.dataStore.on(DataStoreEvent.DATA_DELETED, (data) => {
      this.emit(ResourceManagerEvent.DATA_DELETED, data);
    });
    
    // Resource monitor events
    this.resourceMonitor.on(ResourceMonitorEvent.THRESHOLD_EXCEEDED, (data) => {
      if (data.type === 'cpu' || data.type === 'memory') {
        if (data.value > data.threshold * 1.2) {
          // Critical threshold exceeded (20% over threshold)
          this.emit(ResourceManagerEvent.RESOURCE_CRITICAL, data);
          
          // Reduce max concurrent browsers if too many
          if (this.browserPool.getActiveBrowserCount() > 1) {
            const newMax = Math.max(1, this.config.maxConcurrentBrowsers - 1);
            logger.warn(`Reducing max concurrent browsers to ${newMax} due to resource pressure`);
            this.browserPool.setMaxConcurrent(newMax);
          }
        } else {
          // Warning threshold exceeded
          this.emit(ResourceManagerEvent.RESOURCE_WARNING, data);
        }
      }
    });
  }

  /**
   * Get a browser instance from the pool
   * @param requestId Unique identifier for the request
   * @param priority Priority of the request (higher number = higher priority)
   * @returns Promise resolving to a browser instance
   */
  async getBrowser(requestId: string, priority: number = 0): Promise<Browser> {
    logger.debug(`Requesting browser: ${requestId} (priority: ${priority})`);
    
    // Start timer for performance tracking
    const stopTimer = this.resourceMonitor.startTimer('browser_allocation_time', { requestId });
    
    try {
      const browser = await this.browserPool.getBrowser(requestId, priority);
      
      // Stop timer and emit event
      stopTimer();
      this.emit(ResourceManagerEvent.BROWSER_ALLOCATED, { requestId });
      
      return browser;
    } catch (error) {
      logger.error(`Error getting browser: ${requestId}`, error);
      throw error;
    }
  }

  /**
   * Release a browser instance back to the pool
   * @param requestId Request ID associated with the browser
   * @param browser Browser instance to release
   */
  async releaseBrowser(requestId: string, browser: Browser): Promise<void> {
    logger.debug(`Releasing browser: ${requestId}`);
    
    try {
      await this.browserPool.releaseBrowser(requestId, browser);
      this.emit(ResourceManagerEvent.BROWSER_RELEASED, { requestId });
    } catch (error) {
      logger.error(`Error releasing browser: ${requestId}`, error);
    }
  }

  /**
   * Execute a task with a browser from the pool
   * @param task Task function that takes a browser and returns a promise
   * @param requestId Unique identifier for the request
   * @param priority Priority of the request (higher number = higher priority)
   * @returns Promise resolving to the result of the task
   */
  async executeWithBrowser<T>(
    task: (browser: Browser) => Promise<T>,
    requestId: string = `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    priority: number = 0
  ): Promise<T> {
    return this.browserPool.execute(task, requestId, priority);
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
    return this.browserPool.executeWithPage(task, requestId, priority);
  }

  /**
   * Store assignment data
   * @param assignmentId Assignment ID
   * @param key Data key
   * @param data Data to store
   * @param metadata Optional metadata
   * @returns Promise resolving to true if storage was successful
   */
  async storeAssignmentData<T>(
    assignmentId: string,
    key: string,
    data: T,
    metadata?: Record<string, any>
  ): Promise<boolean> {
    // Create a storage key that includes the assignment ID
    const storageKey = `assignment_${assignmentId}_${key}`;
    
    // Track keys associated with this assignment
    if (!this.assignmentDataMap.has(assignmentId)) {
      this.assignmentDataMap.set(assignmentId, []);
    }
    this.assignmentDataMap.get(assignmentId)?.push(storageKey);
    
    // Store the data
    return this.dataStore.store(
      storageKey,
      data,
      metadata,
      {
        expirationMs: this.config.dataExpirationMs,
        persistent: this.config.persistData,
        encrypt: true
      }
    );
  }

  /**
   * Retrieve assignment data
   * @param assignmentId Assignment ID
   * @param key Data key
   * @returns Promise resolving to the stored data or null if not found
   */
  async retrieveAssignmentData<T>(assignmentId: string, key: string): Promise<T | null> {
    const storageKey = `assignment_${assignmentId}_${key}`;
    return this.dataStore.retrieve<T>(storageKey);
  }

  /**
   * Delete all data for a specific assignment
   * @param assignmentId Assignment ID
   * @returns Promise resolving to true if deletion was successful
   */
  async deleteAssignmentData(assignmentId: string): Promise<boolean> {
    logger.info(`Deleting all data for assignment: ${assignmentId}`);
    
    // Remove from tracking map
    this.assignmentDataMap.delete(assignmentId);
    
    // Delete from data store
    return this.dataStore.deleteAssignmentData(assignmentId);
  }

  /**
   * Record a performance metric
   * @param name Metric name
   * @param value Metric value
   * @param unit Metric unit
   * @param tags Optional tags
   */
  recordMetric(name: string, value: number, unit: string = 'ms', tags?: Record<string, string>): void {
    this.resourceMonitor.recordMetric(name, value, unit, tags);
  }

  /**
   * Start timing a performance metric
   * @param name Metric name
   * @returns Function to stop timing and record the metric
   */
  startTimer(name: string, tags?: Record<string, string>): () => void {
    return this.resourceMonitor.startTimer(name, tags);
  }

  /**
   * Get the current resource usage
   * @returns Current resource usage or null if not available
   */
  getResourceUsage(): any {
    return this.resourceMonitor.getLatestUsage();
  }

  /**
   * Update the maximum number of concurrent browsers
   * @param maxConcurrent New maximum number of concurrent browsers
   */
  setMaxConcurrentBrowsers(maxConcurrent: number): void {
    if (maxConcurrent < 1) {
      throw new Error('Maximum concurrent browsers must be at least 1');
    }
    
    this.config.maxConcurrentBrowsers = maxConcurrent;
    this.browserPool.setMaxConcurrent(maxConcurrent);
    logger.info(`Max concurrent browsers updated to ${maxConcurrent}`);
  }

  /**
   * Shutdown the resource manager
   */
  async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    logger.info('Shutting down resource manager');
    
    // Stop resource monitoring
    if (this.config.monitorResources) {
      this.resourceMonitor.stop();
    }
    
    // Shutdown browser pool
    await this.browserPool.shutdown();
    
    // Shutdown data store
    await this.dataStore.shutdown();
    
    logger.info('Resource manager shutdown complete');
  }
}

// Export default instance
export default ResourceManager;