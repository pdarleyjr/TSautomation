import fs from 'fs';
import path from 'path';
import config from './config';

// Log levels
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// Log entry interface
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

/**
 * Logger class for tracking automation progress
 */
export class Logger {
  private logDir: string;
  private logFile: string;
  private sessionId: string;
  private minLevel: LogLevel;

  /**
   * Create a new logger instance
   * @param sessionId Session ID for this automation run
   * @param logDir Directory to store log files
   */
  constructor(sessionId?: string, logDir?: string) {
    this.minLevel = (config.logging.logLevel as LogLevel) || LogLevel.INFO;
    this.logDir = logDir || config.logging.logDir || './logs';
    this.sessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.logFile = path.join(this.logDir, `${this.sessionId}.log`);
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
    
    // Initialize log file with session start
    this.info(`Session ${this.sessionId} started`);
  }

  /**
   * Get the current session ID
   * @returns Session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Log a debug message
   * @param message Message to log
   * @param data Optional data to include
   */
  debug(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      this.log(LogLevel.DEBUG, message, data);
    }
  }

  /**
   * Log an info message
   * @param message Message to log
   * @param data Optional data to include
   */
  info(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.INFO)) {
      this.log(LogLevel.INFO, message, data);
    }
  }

  /**
   * Log a warning message
   * @param message Message to log
   * @param data Optional data to include
   */
  warn(message: string, data?: any): void {
    if (this.shouldLog(LogLevel.WARN)) {
      this.log(LogLevel.WARN, message, data);
    }
  }

  /**
   * Log an error message
   * @param message Message to log
   * @param error Error object or data to include
   */
  error(message: string, error?: any): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      this.log(LogLevel.ERROR, message, error);
    }
  }

  /**
   * Save course content to a file
   * @param content Course content to save
   * @param section Section number or identifier
   * @returns Path to the saved file
   */
  saveCourseContent(content: string, section: string | number): string {
    if (!config.logging.saveContent) {
      return '';
    }
    
    const contentDir = path.join(this.logDir, 'content');
    if (!fs.existsSync(contentDir)) {
      fs.mkdirSync(contentDir, { recursive: true });
    }
    
    const contentFile = path.join(contentDir, `${this.sessionId}_section${section}.txt`);
    fs.writeFileSync(contentFile, content);
    
    this.debug(`Saved course content for section ${section} to ${contentFile}`);
    return contentFile;
  }

  /**
   * Save a screenshot to a file
   * @param base64Image Base64-encoded image data
   * @param name Name or identifier for the screenshot
   * @returns Path to the saved file
   */
  saveScreenshot(base64Image: string, name: string): string {
    if (!config.logging.saveScreenshots) {
      return '';
    }
    
    const screenshotDir = path.join(this.logDir, 'screenshots');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    const filename = `${this.sessionId}_${name}_${Date.now()}.png`;
    const filepath = path.join(screenshotDir, filename);
    
    // Convert base64 to image and save
    const imageBuffer = Buffer.from(base64Image, 'base64');
    fs.writeFileSync(filepath, imageBuffer);
    
    this.debug(`Saved screenshot ${name} to ${filepath}`);
    return filepath;
  }

  /**
   * Generate a summary report of the automation run
   * @param stats Statistics about the automation run
   * @returns Path to the report file
   */
  generateReport(stats: {
    startTime: Date;
    endTime: Date;
    coursesCompleted: number;
    sectionsProcessed: number;
    videosWatched: number;
    questionsAnswered: number;
    errors: number;
  }): string {
    const reportDir = path.join(this.logDir, 'reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const reportFile = path.join(reportDir, `${this.sessionId}_report.json`);
    
    // Calculate duration
    const durationMs = stats.endTime.getTime() - stats.startTime.getTime();
    const durationMinutes = Math.floor(durationMs / 60000);
    const durationSeconds = Math.floor((durationMs % 60000) / 1000);
    
    const report = {
      sessionId: this.sessionId,
      startTime: stats.startTime.toISOString(),
      endTime: stats.endTime.toISOString(),
      duration: `${durationMinutes}m ${durationSeconds}s`,
      coursesCompleted: stats.coursesCompleted,
      sectionsProcessed: stats.sectionsProcessed,
      videosWatched: stats.videosWatched,
      questionsAnswered: stats.questionsAnswered,
      errors: stats.errors,
    };
    
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    this.info(`Generated report at ${reportFile}`);
    return reportFile;
  }

  /**
   * Check if a log level should be logged based on the minimum level
   * @param level Log level to check
   * @returns True if the level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const minLevelIndex = levels.indexOf(this.minLevel);
    const levelIndex = levels.indexOf(level);
    
    return levelIndex >= minLevelIndex;
  }

  /**
   * Log a message to the log file and console
   * @param level Log level
   * @param message Message to log
   * @param data Optional data to include
   */
  private log(level: LogLevel, message: string, data?: any): void {
    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      data: data || undefined,
    };
    
    // Format for file
    let fileOutput = `${timestamp} [${level.toUpperCase()}] ${message}`;
    if (data) {
      if (data instanceof Error) {
        fileOutput += `\n${data.stack || data.message}`;
      } else if (typeof data === 'object') {
        fileOutput += `\n${JSON.stringify(data, null, 2)}`;
      } else {
        fileOutput += `\n${data}`;
      }
    }
    
    // Append to log file
    fs.appendFileSync(this.logFile, fileOutput + '\n');
    
    // Format for console
    let consoleOutput = `[${level.toUpperCase()}] ${message}`;
    
    // Log to console with appropriate level
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(consoleOutput);
        break;
      case LogLevel.INFO:
        console.info(consoleOutput);
        break;
      case LogLevel.WARN:
        console.warn(consoleOutput);
        break;
      case LogLevel.ERROR:
        console.error(consoleOutput);
        if (data instanceof Error) {
          console.error(data.stack || data.message);
        } else if (data) {
          console.error(data);
        }
        break;
    }
  }
}

// Create and export a default logger instance
export const logger = new Logger();

// Export default
export default logger;