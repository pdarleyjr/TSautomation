import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

// Default configuration file path
const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'ts-config.json');

// Configuration interface
export interface TSConfig {
  // Target Solutions credentials
  credentials: {
    username: string;
    password: string;
    loginUrl: string;
  };
  
  // API keys
  apiKeys: {
    openai: string;
    skyvern?: string;
  };
  
  // Browser settings
  browser: {
    headless: boolean;
    slowMo: number;
    defaultTimeout: number;
    userAgent: string;
  };
  
  // Course settings
  course: {
    specificCourseId?: string;
    maxSections: number;
    videoTimeout: number;
    minimumTimeRequirements: Record<string, number>; // Course type to minimum seconds
    defaultMinimumTime: number; // Default minimum time in seconds
  };
  
  // AI settings
  ai: {
    model: string;
    temperature: number;
    maxTokens: number;
    chunkSize: number;
    chunkOverlap: number;
  };
  
  // Skyvern settings
  skyvern: {
    apiUrl: string;
    pollingIntervalMs: number;
    maxRetries: number;
    screenshotDir: string;
  };
  
  // Logging settings
  logging: {
    logDir: string;
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    saveScreenshots: boolean;
    saveContent: boolean;
  };
  
  // Parallel processing settings
  parallel: {
    enabled: boolean;
    maxConcurrent: number;
  };

  // Time tracking and retry settings
  timeTracking: {
    baseRetryDelayMs: number;
    maxRetryDelayMs: number;
  };
}

// Default configuration
const defaultConfig: TSConfig = {
  credentials: {
    username: process.env.TS_USERNAME || '',
    password: process.env.TS_PASSWORD || '',
    loginUrl: process.env.TS_LOGIN_URL || 'https://app.targetsolutions.com/auth/index.cfm',
  },
  
  apiKeys: {
    openai: process.env.OPENAI_API_KEY || '',
    skyvern: process.env.SKYVERN_API_KEY,
  },
  
  browser: {
    headless: process.env.HEADLESS === 'true',
    slowMo: parseInt(process.env.SLOW_MO || '50'),
    defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000'),
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  },
  
  course: {
    specificCourseId: process.env.COURSE_ID,
    maxSections: parseInt(process.env.MAX_SECTIONS || '100'),
    videoTimeout: parseInt(process.env.VIDEO_TIMEOUT || '300000'), // 5 minutes
    minimumTimeRequirements: {
      'default': parseInt(process.env.DEFAULT_MINIMUM_TIME || '900'), // 15 minutes by default
      'safety': parseInt(process.env.SAFETY_MINIMUM_TIME || '1800'), // 30 minutes for safety courses
      'compliance': parseInt(process.env.COMPLIANCE_MINIMUM_TIME || '1200'), // 20 minutes for compliance courses
      'hr': parseInt(process.env.HR_MINIMUM_TIME || '1500') // 25 minutes for HR courses
    },
    defaultMinimumTime: parseInt(process.env.DEFAULT_MINIMUM_TIME || '900'), // 15 minutes by default
  },
  
  ai: {
    model: process.env.OPENAI_MODEL_NAME || 'gpt-3.5-turbo',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3'),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000'),
    chunkSize: parseInt(process.env.CHUNK_SIZE || '1000'),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '200'),
  },
  
  skyvern: {
    apiUrl: process.env.SKYVERN_API_URL || 'http://localhost:8000/api/v1',
    pollingIntervalMs: parseInt(process.env.POLLING_INTERVAL_MS || '5000'),
    maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    screenshotDir: process.env.SCREENSHOT_DIR || './screenshots',
  },
  
  logging: {
    logDir: process.env.LOG_DIR || './logs',
    logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    saveScreenshots: process.env.SAVE_SCREENSHOTS !== 'false',
    saveContent: process.env.SAVE_CONTENT !== 'false',
  },
  
  parallel: {
    enabled: process.env.PARALLEL_ENABLED === 'true',
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '2'),
  },

  timeTracking: {
    baseRetryDelayMs: parseInt(process.env.BASE_RETRY_DELAY_MS || '30000'), // 30 seconds
    maxRetryDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS || '600000'), // 10 minutes
  },
};

/**
 * Load configuration from a JSON file
 * @param configPath Path to the configuration file
 * @returns Loaded configuration merged with defaults
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): TSConfig {
  try {
    // Check if config file exists
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Deep merge with default config
      return deepMerge(defaultConfig, fileConfig);
    }
  } catch (error) {
    console.error(`Error loading config from ${configPath}:`, error);
  }
  
  // Return default config if file doesn't exist or there's an error
  return defaultConfig;
}

/**
 * Save configuration to a JSON file
 * @param config Configuration to save
 * @param configPath Path to save the configuration file
 */
export function saveConfig(config: TSConfig, configPath: string = DEFAULT_CONFIG_PATH): void {
  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write config to file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved to ${configPath}`);
  } catch (error) {
    console.error(`Error saving config to ${configPath}:`, error);
  }
}

/**
 * Validate configuration
 * @param config Configuration to validate
 * @returns Validation result with errors if any
 */
export function validateConfig(config: TSConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Check required fields
  if (!config.credentials.username) {
    errors.push('Missing Target Solutions username');
  }
  
  if (!config.credentials.password) {
    errors.push('Missing Target Solutions password');
  }
  
  if (!config.apiKeys.openai) {
    errors.push('Missing OpenAI API key');
  }
  
  // If Skyvern is being used, check Skyvern API key
  if (config.apiKeys.skyvern === '') {
    errors.push('Missing Skyvern API key');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Deep merge two objects
 * @param target Target object
 * @param source Source object
 * @returns Merged object
 */
function deepMerge<T extends Record<string, any>>(target: T, source: Record<string, any>): T {
  const output = { ...target };
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key as keyof T] = deepMerge(target[key as keyof T], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }
  
  return output;
}

/**
 * Check if value is an object
 * @param item Value to check
 * @returns True if value is an object
 */
function isObject(item: any): boolean {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

// Export default config
export default loadConfig();