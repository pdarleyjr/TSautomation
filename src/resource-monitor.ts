import { EventEmitter } from 'events';
import { logger } from './logger';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Events emitted by the ResourceMonitor
 */
export enum ResourceMonitorEvent {
  RESOURCE_USAGE = 'resource_usage',
  PERFORMANCE_METRIC = 'performance_metric',
  THRESHOLD_EXCEEDED = 'threshold_exceeded'
}

/**
 * Resource usage interface
 */
export interface ResourceUsage {
  timestamp: number;
  cpu: {
    usage: number;         // CPU usage percentage
    loadAvg: number[];     // Load average (1, 5, 15 minutes)
  };
  memory: {
    total: number;         // Total memory in bytes
    free: number;          // Free memory in bytes
    used: number;          // Used memory in bytes
    usagePercent: number;  // Memory usage percentage
  };
  process: {
    memory: number;        // Process memory usage in bytes
    cpu: number;           // Process CPU usage percentage
    uptime: number;        // Process uptime in seconds
  };
  browsers: {
    active: number;        // Number of active browser instances
    queued: number;        // Number of queued browser requests
  };
}

/**
 * Performance metric interface
 */
export interface PerformanceMetric {
  name: string;            // Metric name
  value: number;           // Metric value
  unit: string;            // Metric unit (ms, count, etc.)
  timestamp: number;       // Timestamp when the metric was recorded
  tags?: Record<string, string>; // Optional tags for categorization
}

/**
 * Resource monitor configuration interface
 */
export interface ResourceMonitorConfig {
  monitorIntervalMs: number;       // Interval for resource monitoring in ms
  logIntervalMs: number;           // Interval for logging resource usage in ms
  persistMetrics: boolean;         // Whether to persist metrics to disk
  metricsDir: string;              // Directory for persisting metrics
  thresholds: {                    // Thresholds for alerting
    cpuPercent: number;            // CPU usage percentage threshold
    memoryPercent: number;         // Memory usage percentage threshold
    browserCount: number;          // Browser count threshold
  };
}

/**
 * Default resource monitor configuration
 */
const DEFAULT_CONFIG: ResourceMonitorConfig = {
  monitorIntervalMs: 5000,         // 5 seconds
  logIntervalMs: 60000,            // 1 minute
  persistMetrics: true,
  metricsDir: './logs/metrics',
  thresholds: {
    cpuPercent: 80,                // 80% CPU usage
    memoryPercent: 85,             // 85% memory usage
    browserCount: 5                // 5 active browsers
  }
};

/**
 * Resource monitor for tracking system resource utilization and execution performance
 */
export class ResourceMonitor extends EventEmitter {
  private config: ResourceMonitorConfig;
  private monitorInterval: NodeJS.Timeout | null = null;
  private logInterval: NodeJS.Timeout | null = null;
  private metrics: PerformanceMetric[] = [];
  private lastUsage: ResourceUsage | null = null;
  private browserPoolRef: any = null;  // Reference to the browser pool
  private startTime: number;

  /**
   * Create a new resource monitor
   * @param config Resource monitor configuration
   * @param browserPool Optional reference to the browser pool
   */
  constructor(config: Partial<ResourceMonitorConfig> = {}, browserPool?: any) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.browserPoolRef = browserPool;
    this.startTime = Date.now();
    
    // Create metrics directory if it doesn't exist
    if (this.config.persistMetrics) {
      if (!fs.existsSync(this.config.metricsDir)) {
        fs.mkdirSync(this.config.metricsDir, { recursive: true });
      }
    }
    
    logger.info('Resource monitor initialized');
  }

  /**
   * Start monitoring resources
   */
  start(): void {
    logger.info('Starting resource monitoring');
    
    // Start monitor interval
    this.monitorInterval = setInterval(() => {
      this.monitorResources();
    }, this.config.monitorIntervalMs);
    
    // Start log interval
    this.logInterval = setInterval(() => {
      this.logResourceUsage();
    }, this.config.logIntervalMs);
  }

  /**
   * Stop monitoring resources
   */
  stop(): void {
    logger.info('Stopping resource monitoring');
    
    // Stop intervals
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    if (this.logInterval) {
      clearInterval(this.logInterval);
      this.logInterval = null;
    }
    
    // Persist metrics if configured
    if (this.config.persistMetrics) {
      this.persistMetrics();
    }
  }

  /**
   * Monitor system resources
   */
  private monitorResources(): void {
    try {
      // Get CPU usage
      const cpus = os.cpus();
      const cpuCount = cpus.length;
      
      // Calculate CPU usage
      let totalIdle = 0;
      let totalTick = 0;
      
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          totalTick += cpu.times[type as keyof typeof cpu.times];
        }
        totalIdle += cpu.times.idle;
      }
      
      // Calculate CPU usage percentage
      let cpuUsage = 0;
      
      if (this.lastUsage) {
        const lastTotalTick = this.lastUsage.cpu.usage * cpuCount;
        const lastTotalIdle = this.lastUsage.cpu.usage * cpuCount * (1 - this.lastUsage.cpu.usage / 100);
        
        const idleDiff = totalIdle - lastTotalIdle;
        const tickDiff = totalTick - lastTotalTick;
        
        if (tickDiff > 0) {
          cpuUsage = 100 - (idleDiff / tickDiff * 100);
        }
      }
      
      // Get memory usage
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const memoryUsagePercent = (usedMemory / totalMemory) * 100;
      
      // Get process resource usage
      const processMemory = process.memoryUsage().rss;
      const processUptime = process.uptime();
      
      // Get browser pool stats if available
      let activeBrowsers = 0;
      let queuedBrowsers = 0;
      
      if (this.browserPoolRef) {
        activeBrowsers = this.browserPoolRef.getActiveBrowserCount?.() || 0;
        queuedBrowsers = this.browserPoolRef.getQueueLength?.() || 0;
      }
      
      // Create resource usage object
      const usage: ResourceUsage = {
        timestamp: Date.now(),
        cpu: {
          usage: cpuUsage,
          loadAvg: os.loadavg()
        },
        memory: {
          total: totalMemory,
          free: freeMemory,
          used: usedMemory,
          usagePercent: memoryUsagePercent
        },
        process: {
          memory: processMemory,
          cpu: cpuUsage, // Approximation
          uptime: processUptime
        },
        browsers: {
          active: activeBrowsers,
          queued: queuedBrowsers
        }
      };
      
      // Store last usage
      this.lastUsage = usage;
      
      // Emit resource usage event
      this.emit(ResourceMonitorEvent.RESOURCE_USAGE, usage);
      
      // Check thresholds
      this.checkThresholds(usage);
    } catch (error) {
      logger.error('Error monitoring resources', error);
    }
  }

  /**
   * Log resource usage
   */
  private logResourceUsage(): void {
    if (!this.lastUsage) return;
    
    const usage = this.lastUsage;
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    logger.info(`Resource usage - CPU: ${usage.cpu.usage.toFixed(1)}%, Memory: ${usage.memory.usagePercent.toFixed(1)}%, Browsers: ${usage.browsers.active} active, ${usage.browsers.queued} queued, Uptime: ${formatTime(uptime)}`);
  }

  /**
   * Check resource thresholds and emit events if exceeded
   * @param usage Resource usage
   */
  private checkThresholds(usage: ResourceUsage): void {
    const thresholds = this.config.thresholds;
    
    // Check CPU threshold
    if (usage.cpu.usage > thresholds.cpuPercent) {
      this.emit(ResourceMonitorEvent.THRESHOLD_EXCEEDED, {
        type: 'cpu',
        value: usage.cpu.usage,
        threshold: thresholds.cpuPercent,
        message: `CPU usage (${usage.cpu.usage.toFixed(1)}%) exceeded threshold (${thresholds.cpuPercent}%)`
      });
      
      logger.warn(`CPU usage (${usage.cpu.usage.toFixed(1)}%) exceeded threshold (${thresholds.cpuPercent}%)`);
    }
    
    // Check memory threshold
    if (usage.memory.usagePercent > thresholds.memoryPercent) {
      this.emit(ResourceMonitorEvent.THRESHOLD_EXCEEDED, {
        type: 'memory',
        value: usage.memory.usagePercent,
        threshold: thresholds.memoryPercent,
        message: `Memory usage (${usage.memory.usagePercent.toFixed(1)}%) exceeded threshold (${thresholds.memoryPercent}%)`
      });
      
      logger.warn(`Memory usage (${usage.memory.usagePercent.toFixed(1)}%) exceeded threshold (${thresholds.memoryPercent}%)`);
    }
    
    // Check browser count threshold
    if (usage.browsers.active > thresholds.browserCount) {
      this.emit(ResourceMonitorEvent.THRESHOLD_EXCEEDED, {
        type: 'browsers',
        value: usage.browsers.active,
        threshold: thresholds.browserCount,
        message: `Active browser count (${usage.browsers.active}) exceeded threshold (${thresholds.browserCount})`
      });
      
      logger.warn(`Active browser count (${usage.browsers.active}) exceeded threshold (${thresholds.browserCount})`);
    }
  }

  /**
   * Record a performance metric
   * @param name Metric name
   * @param value Metric value
   * @param unit Metric unit
   * @param tags Optional tags
   */
  recordMetric(name: string, value: number, unit: string = 'ms', tags?: Record<string, string>): void {
    const metric: PerformanceMetric = {
      name,
      value,
      unit,
      timestamp: Date.now(),
      tags
    };
    
    // Add to metrics array
    this.metrics.push(metric);
    
    // Emit metric event
    this.emit(ResourceMonitorEvent.PERFORMANCE_METRIC, metric);
    
    // Log metric
    logger.debug(`Performance metric: ${name} = ${value}${unit}${tags ? ` (${JSON.stringify(tags)})` : ''}`);
  }

  /**
   * Start timing a performance metric
   * @param name Metric name
   * @returns Function to stop timing and record the metric
   */
  startTimer(name: string, tags?: Record<string, string>): () => void {
    const startTime = Date.now();
    
    return () => {
      const duration = Date.now() - startTime;
      this.recordMetric(name, duration, 'ms', tags);
    };
  }

  /**
   * Persist metrics to disk
   */
  private persistMetrics(): void {
    if (!this.config.persistMetrics || this.metrics.length === 0) return;
    
    try {
      const filename = `metrics_${new Date().toISOString().replace(/:/g, '-')}.json`;
      const filePath = path.join(this.config.metricsDir, filename);
      
      fs.writeFileSync(filePath, JSON.stringify(this.metrics, null, 2));
      
      logger.info(`Persisted ${this.metrics.length} metrics to ${filePath}`);
      
      // Clear metrics array
      this.metrics = [];
    } catch (error) {
      logger.error('Error persisting metrics', error);
    }
  }

  /**
   * Get the latest resource usage
   * @returns Latest resource usage or null if not available
   */
  getLatestUsage(): ResourceUsage | null {
    return this.lastUsage;
  }

  /**
   * Get all recorded metrics
   * @returns Array of performance metrics
   */
  getMetrics(): PerformanceMetric[] {
    return [...this.metrics];
  }

  /**
   * Set the browser pool reference
   * @param browserPool Browser pool reference
   */
  setBrowserPool(browserPool: any): void {
    this.browserPoolRef = browserPool;
  }
}

/**
 * Format time in seconds to a human-readable format
 * @param seconds Time in seconds
 * @returns Formatted time string (e.g., "1h 30m 45s")
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  let result = '';
  if (hours > 0) {
    result += `${hours}h `;
  }
  if (minutes > 0 || hours > 0) {
    result += `${minutes}m `;
  }
  result += `${secs}s`;
  
  return result;
}

// Export default
export default ResourceMonitor;