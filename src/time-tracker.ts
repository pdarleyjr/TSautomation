import { EventEmitter } from 'events';
import config from './config';
import { logger } from './logger';
import { formatTime } from './utils';

/**
 * Time tracking events
 */
export enum TimeTrackingEvent {
  TIME_SUFFICIENT = 'time_sufficient',
  TIME_INSUFFICIENT = 'time_insufficient',
  TIME_UPDATED = 'time_updated'
}

/**
 * Time tracker state interface
 */
export interface TimeTrackerState {
  startTime: Date;
  currentTime: Date;
  elapsedTimeSeconds: number;
  requiredTimeSeconds: number;
  courseType: string;
  retryCount: number;
  nextRetryDelayMs: number;
}

/**
 * Time tracker class for enforcing minimum time requirements
 * Implements exponential backoff for retry attempts
 */
export class TimeTracker extends EventEmitter {
  private state: TimeTrackerState;
  private checkIntervalId: NodeJS.Timeout | null = null;
  private courseId: string;
  private courseName: string;

  /**
   * Create a new time tracker
   * @param courseId Course ID
   * @param courseName Course name
   * @param courseType Course type (for minimum time requirements)
   */
  constructor(courseId: string, courseName: string, courseType: string = 'default') {
    super();
    this.courseId = courseId;
    this.courseName = courseName;

    // Get the required time for this course type
    const requiredTimeSeconds = config.course.minimumTimeRequirements[courseType] || 
                               config.course.defaultMinimumTime;

    // Initialize state
    this.state = {
      startTime: new Date(),
      currentTime: new Date(),
      elapsedTimeSeconds: 0,
      requiredTimeSeconds,
      courseType,
      retryCount: 0,
      nextRetryDelayMs: config.timeTracking.baseRetryDelayMs
    };

    logger.info(`Time tracker initialized for course: ${courseName} (ID: ${courseId})`);
    logger.info(`Required time: ${formatTime(requiredTimeSeconds)}`);

    // Start tracking time
    this.startTracking();
  }

  /**
   * Start tracking time
   */
  private startTracking(): void {
    // Check time every 10 seconds
    this.checkIntervalId = setInterval(() => this.checkTime(), 10000);
    logger.debug('Time tracking started');
  }

  /**
   * Stop tracking time
   */
  public stopTracking(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
      logger.debug('Time tracking stopped');
    }
  }

  /**
   * Check if the elapsed time meets the requirement
   */
  private checkTime(): void {
    // Update current time and calculate elapsed time
    this.state.currentTime = new Date();
    this.state.elapsedTimeSeconds = 
      (this.state.currentTime.getTime() - this.state.startTime.getTime()) / 1000;

    // Emit time updated event
    this.emit(TimeTrackingEvent.TIME_UPDATED, { ...this.state });

    // Log progress every minute
    if (Math.floor(this.state.elapsedTimeSeconds) % 60 === 0) {
      logger.info(`Time elapsed: ${formatTime(this.state.elapsedTimeSeconds)} / Required: ${formatTime(this.state.requiredTimeSeconds)}`);
    }
  }

  /**
   * Check if the time requirement is met
   * @returns True if the time requirement is met
   */
  public isTimeSufficient(): boolean {
    return this.state.elapsedTimeSeconds >= this.state.requiredTimeSeconds;
  }

  /**
   * Verify time requirement and emit appropriate event
   * @returns Promise resolving to true if time requirement is met
   */
  public async verifyTimeRequirement(): Promise<boolean> {
    if (this.isTimeSufficient()) {
      logger.info(`Time requirement met: ${formatTime(this.state.elapsedTimeSeconds)} elapsed (required: ${formatTime(this.state.requiredTimeSeconds)})`);
      this.emit(TimeTrackingEvent.TIME_SUFFICIENT, { ...this.state });
      return true;
    } else {
      const remaining = this.state.requiredTimeSeconds - this.state.elapsedTimeSeconds;
      logger.warn(`Time requirement not met: ${formatTime(this.state.elapsedTimeSeconds)} elapsed, ${formatTime(remaining)} remaining`);
      
      // Calculate next retry delay using exponential backoff
      this.calculateNextRetryDelay();
      
      logger.info(`Will retry in ${formatTime(this.state.nextRetryDelayMs / 1000)} (attempt ${this.state.retryCount + 1})`);
      this.emit(TimeTrackingEvent.TIME_INSUFFICIENT, { ...this.state });
      return false;
    }
  }

  /**
   * Calculate the next retry delay using exponential backoff
   */
  private calculateNextRetryDelay(): void {
    // Increment retry count
    this.state.retryCount++;
    
    // Calculate delay: baseDelay * 2^retryCount with jitter
    const jitter = 0.1 + Math.random() * 0.3; // 10-30% jitter
    const exponentialDelay = config.timeTracking.baseRetryDelayMs * Math.pow(2, this.state.retryCount - 1);
    const delayWithJitter = exponentialDelay * (1 + jitter);
    
    // Cap at maximum delay
    this.state.nextRetryDelayMs = Math.min(
      delayWithJitter, 
      config.timeTracking.maxRetryDelayMs
    );
  }

  /**
   * Get the current state
   * @returns Current state
   */
  public getState(): TimeTrackerState {
    return { ...this.state };
  }

  /**
   * Get the next retry delay
   * @returns Next retry delay in milliseconds
   */
  public getNextRetryDelay(): number {
    return this.state.nextRetryDelayMs;
  }

  /**
   * Reset the time tracker for a new attempt
   */
  public reset(): void {
    logger.info(`Resetting time tracker for course: ${this.courseName} (ID: ${this.courseId})`);
    
    // Keep the retry count and next delay, but reset the time
    this.state.startTime = new Date();
    this.state.currentTime = new Date();
    this.state.elapsedTimeSeconds = 0;
    
    // Restart tracking if it was stopped
    if (!this.checkIntervalId) {
      this.startTracking();
    }
  }
}

export default TimeTracker;