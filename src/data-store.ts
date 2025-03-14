import { EventEmitter } from 'events';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Events emitted by the DataStore
 */
export enum DataStoreEvent {
  DATA_STORED = 'data_stored',
  DATA_RETRIEVED = 'data_retrieved',
  DATA_DELETED = 'data_deleted',
  STORAGE_ERROR = 'storage_error'
}

/**
 * Storage options interface
 */
export interface StorageOptions {
  expirationMs?: number;  // Time in ms after which data should be automatically deleted
  persistent?: boolean;   // Whether data should be stored on disk (true) or in memory (false)
  encrypt?: boolean;      // Whether data should be encrypted
}

/**
 * Default storage options
 */
const DEFAULT_OPTIONS: StorageOptions = {
  expirationMs: 3600000,  // 1 hour default expiration
  persistent: false,      // In-memory storage by default
  encrypt: true           // Encrypt data by default
};

/**
 * Stored data entry interface
 */
interface StoredData<T> {
  data: T;
  timestamp: number;
  expirationMs: number;
  metadata?: Record<string, any>;
}

/**
 * Data store for temporary storage of extracted data
 * Supports both in-memory and persistent storage with automatic cleanup
 */
export class DataStore extends EventEmitter {
  private memoryStore: Map<string, StoredData<any>> = new Map();
  private storageDir: string;
  private cleanupInterval: NodeJS.Timeout | null = null;
  private encryptionKey: Buffer;

  /**
   * Create a new data store
   * @param storageDir Directory for persistent storage
   * @param cleanupIntervalMs Interval in ms for cleanup of expired data
   * @param encryptionKey Encryption key for securing stored data (defaults to a derived key)
   */
  constructor(
    storageDir: string = path.join(process.cwd(), 'data'),
    cleanupIntervalMs: number = 300000, // 5 minutes
    encryptionKey?: string
  ) {
    super();
    this.storageDir = storageDir;
    
    // Create storage directory if it doesn't exist
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    
    // Set up encryption key
    if (encryptionKey) {
      // Use provided key
      this.encryptionKey = crypto.createHash('sha256').update(encryptionKey).digest();
    } else {
      // Generate a key based on machine-specific information
      const machineId = this.getMachineId();
      this.encryptionKey = crypto.createHash('sha256').update(machineId).digest();
    }
    
    // Start cleanup interval
    this.startCleanupInterval(cleanupIntervalMs);
    
    logger.info(`DataStore initialized with storage directory: ${this.storageDir}`);
  }

  /**
   * Store data with a key
   * @param key Storage key
   * @param data Data to store
   * @param metadata Optional metadata
   * @param options Storage options
   * @returns Promise resolving to true if storage was successful
   */
  async store<T>(
    key: string,
    data: T,
    metadata?: Record<string, any>,
    options: StorageOptions = {}
  ): Promise<boolean> {
    try {
      // Merge with default options
      const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
      
      // Create stored data object
      const storedData: StoredData<T> = {
        data,
        timestamp: Date.now(),
        expirationMs: mergedOptions.expirationMs || DEFAULT_OPTIONS.expirationMs!,
        metadata
      };
      
      // Store in memory
      this.memoryStore.set(key, storedData);
      
      // Store on disk if persistent
      if (mergedOptions.persistent) {
        await this.persistToDisk(key, storedData, mergedOptions.encrypt);
      }
      
      // Emit event
      this.emit(DataStoreEvent.DATA_STORED, { key, metadata });
      
      logger.debug(`Data stored with key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error storing data with key: ${key}`, error);
      this.emit(DataStoreEvent.STORAGE_ERROR, { key, error });
      return false;
    }
  }

  /**
   * Retrieve data by key
   * @param key Storage key
   * @returns Promise resolving to the stored data or null if not found
   */
  async retrieve<T>(key: string): Promise<T | null> {
    try {
      // Check memory store first
      if (this.memoryStore.has(key)) {
        const storedData = this.memoryStore.get(key) as StoredData<T>;
        
        // Check if expired
        if (this.isExpired(storedData)) {
          await this.delete(key);
          return null;
        }
        
        // Emit event
        this.emit(DataStoreEvent.DATA_RETRIEVED, { key, metadata: storedData.metadata });
        
        logger.debug(`Data retrieved from memory with key: ${key}`);
        return storedData.data;
      }
      
      // Check disk store
      const filePath = path.join(this.storageDir, `${key}.json.enc`);
      if (fs.existsSync(filePath)) {
        const storedData = await this.retrieveFromDisk<T>(key);
        
        // Check if expired
        if (storedData && this.isExpired(storedData)) {
          await this.delete(key);
          return null;
        }
        
        // Add to memory store for faster access next time
        if (storedData) {
          this.memoryStore.set(key, storedData);
          
          // Emit event
          this.emit(DataStoreEvent.DATA_RETRIEVED, { key, metadata: storedData.metadata });
          
          logger.debug(`Data retrieved from disk with key: ${key}`);
          return storedData.data;
        }
      }
      
      logger.debug(`No data found with key: ${key}`);
      return null;
    } catch (error) {
      logger.error(`Error retrieving data with key: ${key}`, error);
      this.emit(DataStoreEvent.STORAGE_ERROR, { key, error });
      return null;
    }
  }

  /**
   * Delete data by key
   * @param key Storage key
   * @returns Promise resolving to true if deletion was successful
   */
  async delete(key: string): Promise<boolean> {
    try {
      // Remove from memory store
      this.memoryStore.delete(key);
      
      // Remove from disk if exists
      const filePath = path.join(this.storageDir, `${key}.json.enc`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      
      // Emit event
      this.emit(DataStoreEvent.DATA_DELETED, { key });
      
      logger.debug(`Data deleted with key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting data with key: ${key}`, error);
      this.emit(DataStoreEvent.STORAGE_ERROR, { key, error });
      return false;
    }
  }

  /**
   * Delete all data for a specific assignment
   * @param assignmentId Assignment ID
   * @returns Promise resolving to true if deletion was successful
   */
  async deleteAssignmentData(assignmentId: string): Promise<boolean> {
    try {
      logger.info(`Deleting all data for assignment: ${assignmentId}`);
      
      // Delete from memory store
      for (const [key, value] of this.memoryStore.entries()) {
        if (key.startsWith(`assignment_${assignmentId}_`)) {
          this.memoryStore.delete(key);
        }
      }
      
      // Delete from disk
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.startsWith(`assignment_${assignmentId}_`) && file.endsWith('.json.enc')) {
          fs.unlinkSync(path.join(this.storageDir, file));
        }
      }
      
      logger.info(`Successfully deleted all data for assignment: ${assignmentId}`);
      return true;
    } catch (error) {
      logger.error(`Error deleting data for assignment: ${assignmentId}`, error);
      return false;
    }
  }

  /**
   * Check if data has expired
   * @param storedData Stored data object
   * @returns True if data has expired
   */
  private isExpired(storedData: StoredData<any>): boolean {
    const now = Date.now();
    return now - storedData.timestamp > storedData.expirationMs;
  }

  /**
   * Persist data to disk
   * @param key Storage key
   * @param data Data to persist
   * @param encrypt Whether to encrypt the data
   */
  private async persistToDisk<T>(key: string, data: StoredData<T>, encrypt: boolean = true): Promise<void> {
    const filePath = path.join(this.storageDir, `${key}.json.enc`);
    
    // Convert to JSON
    const jsonData = JSON.stringify(data);
    
    // Encrypt if requested
    if (encrypt) {
      const encryptedData = this.encryptData(jsonData);
      fs.writeFileSync(filePath, encryptedData);
    } else {
      fs.writeFileSync(filePath, jsonData);
    }
  }

  /**
   * Retrieve data from disk
   * @param key Storage key
   * @returns Promise resolving to the stored data or null if not found
   */
  private async retrieveFromDisk<T>(key: string): Promise<StoredData<T> | null> {
    const filePath = path.join(this.storageDir, `${key}.json.enc`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      // Read file
      const fileData = fs.readFileSync(filePath);
      
      // Try to decrypt
      try {
        const decryptedData = this.decryptData(fileData.toString());
        return JSON.parse(decryptedData) as StoredData<T>;
      } catch (decryptError) {
        // If decryption fails, try parsing as plain JSON
        return JSON.parse(fileData.toString()) as StoredData<T>;
      }
    } catch (error) {
      logger.error(`Error retrieving data from disk with key: ${key}`, error);
      return null;
    }
  }

  /**
   * Encrypt data
   * @param data Data to encrypt
   * @returns Encrypted data
   */
  private encryptData(data: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt data
   * @param data Data to decrypt
   * @returns Decrypted data
   */
  private decryptData(data: string): string {
    const [ivHex, encryptedData] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Start cleanup interval
   * @param intervalMs Interval in ms for cleanup
   */
  private startCleanupInterval(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredData();
    }, intervalMs);
  }

  /**
   * Cleanup expired data
   */
  private async cleanupExpiredData(): Promise<void> {
    const now = Date.now();
    let expiredCount = 0;
    
    // Cleanup memory store
    for (const [key, value] of this.memoryStore.entries()) {
      if (now - value.timestamp > value.expirationMs) {
        this.memoryStore.delete(key);
        expiredCount++;
      }
    }
    
    // Cleanup disk store
    try {
      const files = fs.readdirSync(this.storageDir);
      for (const file of files) {
        if (file.endsWith('.json.enc')) {
          const key = file.replace('.json.enc', '');
          const storedData = await this.retrieveFromDisk(key);
          
          if (storedData && this.isExpired(storedData)) {
            fs.unlinkSync(path.join(this.storageDir, file));
            expiredCount++;
          }
        }
      }
    } catch (error) {
      logger.error('Error cleaning up disk store', error);
    }
    
    if (expiredCount > 0) {
      logger.info(`Cleaned up ${expiredCount} expired data entries`);
    }
  }

  /**
   * Get a unique machine identifier
   * @returns Machine identifier
   */
  private getMachineId(): string {
    try {
      // Try to use hostname and OS info as a unique identifier
      const os = require('os');
      const hostname = os.hostname();
      const platform = os.platform();
      const release = os.release();
      const cpus = os.cpus().length;
      
      return `${hostname}-${platform}-${release}-${cpus}`;
    } catch (error) {
      // Fallback to a random identifier
      return crypto.randomBytes(32).toString('hex');
    }
  }

  /**
   * Shutdown the data store
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down data store');
    
    // Stop cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    // Persist any in-memory data that should be persistent
    for (const [key, value] of this.memoryStore.entries()) {
      // Check if this is persistent data by looking for the file
      const filePath = path.join(this.storageDir, `${key}.json.enc`);
      if (fs.existsSync(filePath)) {
        await this.persistToDisk(key, value, true);
      }
    }
    
    logger.info('Data store shutdown complete');
  }
}

// Export default instance
export default DataStore;