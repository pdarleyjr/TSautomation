#!/usr/bin/env node
import { program } from 'commander';
import dotenv from 'dotenv';
import { firefox } from 'playwright';
import config from './config';
import logger from './logger';
import { login, findAndStartAssignment, navigateToCourse, completeCourse, completeMultipleCourses } from './index';
import { runSkyvernEnhancedAutomation } from './skyvern-enhanced';
import { CourseInfo } from './utils';
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Define CLI commands and options
program
  .name('tsautomation')
  .description('Target Solutions LMS Automation CLI')
  .version('1.0.0');

// Define interfaces for command options
interface CompleteOptions {
  course?: string;
  headless?: boolean;
  debug?: boolean;
  parallel?: string;
  timeout?: string;
  max?: string;
  dynamicSkyvern?: boolean;
  skyvern?: boolean;
}

interface ListCoursesOptions {
  headless?: boolean;
  output?: string;
}

// Command to complete a course
program
  .command('complete')
  .description('Complete a Target Solutions course')
  .option('-c, --course <id>', 'Specific course ID to complete')
  .option('-h, --headless', 'Run in headless mode (no visible browser)')
  .option('-d, --debug', 'Enable debug mode with additional logging')
  .option('-p, --parallel <number>', 'Number of courses to complete in parallel', '1')
  .option('-t, --timeout <ms>', 'Default timeout in milliseconds', '30000')
  .option('-s, --skyvern', 'Use Skyvern for visual-based automation')
  .option('-m, --max <number>', 'Maximum number of concurrent courses', '3')
  .option('--dynamic-skyvern', 'Use Skyvern dynamically when needed')
  .action(async (options: CompleteOptions) => {
    try {
      // Set up configuration based on options
      if (options.headless) {
        process.env.HEADLESS = 'true';
      }
      
      if (options.debug) {
        process.env.LOG_LEVEL = 'debug';
        process.env.DEBUG = 'pw:*';
      }
      
      if (options.course) {
        process.env.COURSE_ID = options.course;
      }
      
      if (options.timeout) {
        process.env.DEFAULT_TIMEOUT = options.timeout;
      }
      
      if (options.parallel) {
        process.env.PARALLEL_ENABLED = 'true';
        process.env.MAX_CONCURRENT = options.parallel;
      }

      if (options.dynamicSkyvern) {
        process.env.DYNAMIC_SKYVERN = 'true';
        options.skyvern = true; // Also enable Skyvern when dynamic-skyvern is used
      }
      
      logger.info('Starting Target Solutions automation...');
      logger.info(`Configuration: ${JSON.stringify({
        headless: options.headless || false,
        debug: options.debug || false,
        courseId: options.course || 'auto-detect',
        timeout: options.timeout || '30000',
        parallel: options.parallel || '1',
        skyvern: options.skyvern || false,
        dynamicSkyvern: options.dynamicSkyvern || false
      }, null, 2)}`);
      
      // Use Skyvern if specified
      if (options.skyvern) {
        logger.info('Using Skyvern for visual-based automation');
        await runSkyvernEnhancedAutomation();
      } else {
        // Check if parallel execution is requested
        const parallelCount = parseInt(options.parallel || '1');
        if (parallelCount > 1) {
          await completeMultipleCourses(parallelCount);
        } else {
          // Otherwise use standard Playwright automation
          await runPlaywrightAutomation(options);
        }
      }
      
      logger.info('Automation completed successfully!');
    } catch (error) {
      logger.error('Error during automation:', error);
      process.exit(1);
    }
  });

// Command to list available courses
program
  .command('list-courses')
  .description('List available Target Solutions courses')
  .option('-h, --headless', 'Run in headless mode (no visible browser)')
  .option('-o, --output <file>', 'Output file for course list (JSON format)')
  .action(async (options: ListCoursesOptions) => {
    try {
      if (options.headless) {
        process.env.HEADLESS = 'true';
      }
      
      logger.info('Listing available Target Solutions courses...');
      
      // Launch browser
      const browser = await firefox.launch({
        headless: process.env.HEADLESS === 'true',
        slowMo: parseInt(process.env.SLOW_MO || '50')
      });
      
      // Create a new page
      const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      });
      
      // Login to Target Solutions
      await login(page);
      
      // Navigate to courses page
      await page.goto('https://app.targetsolutions.com/training/assignments/my_assignments.cfm');
      await page.waitForSelector('.assignment-list, .course-list', { timeout: 30000 });
      
      // Extract course information
      const courses = await page.$$eval('.assignment-item, .course-item', (elements) => {
        return elements.map(el => {
          // Try to get course ID from data attribute or link
          const courseIdElement = el.querySelector('[data-courseid]');
          const courseLink = el.querySelector('a[href*="courseid="]');
          
          let courseId = '';
          if (courseIdElement) {
            courseId = courseIdElement.getAttribute('data-courseid') || '';
          } else if (courseLink) {
            const href = courseLink.getAttribute('href') || '';
            const match = href.match(/courseid=(\d+)/);
            if (match) {
              courseId = match[1];
            }
          }
          
          // Get transcript ID if available
          const transcriptIdElement = el.querySelector('[data-transcriptid]');
          let transcriptId = '';
          if (transcriptIdElement) {
            transcriptId = transcriptIdElement.getAttribute('data-transcriptid') || '';
          }
          
          // Get course name
          const nameElement = el.querySelector('.course-title, .assignment-title');
          const name = nameElement ? nameElement.textContent?.trim() || '' : '';
          
          // Get due date if available
          const dueDateElement = el.querySelector('.due-date');
          const dueDate = dueDateElement ? dueDateElement.textContent?.trim() || '' : '';
          
          // Get status if available
          const statusElement = el.querySelector('.status');
          const status = statusElement ? statusElement.textContent?.trim() || '' : '';
          
          return {
            id: courseId,
            name: name,
            transcriptId: transcriptId || undefined,
            dueDate: dueDate || undefined,
            status: status || undefined
          };
        }).filter(course => course.id && course.name); // Filter out courses without ID or name
      });
      
      logger.info(`Found ${courses.length} available courses`);
      
      // Display courses
      courses.forEach((course, index) => {
        logger.info(`${index + 1}. ${course.name} (ID: ${course.id})${course.dueDate ? ` - Due: ${course.dueDate}` : ''}${course.status ? ` - Status: ${course.status}` : ''}`);
      });
      
      // Save to file if output option is provided
      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.writeFileSync(outputPath, JSON.stringify(courses, null, 2));
        logger.info(`Course list saved to ${outputPath}`);
      }
      
      // Close the browser
      await browser.close();
    } catch (error) {
      logger.error('Error listing courses:', error);
      process.exit(1);
    }
  });

// Command to generate a configuration file
program
  .command('init')
  .description('Generate a configuration file')
  .option('-f, --force', 'Overwrite existing configuration file')
  .action((options: { force?: boolean }) => {
    try {
      const configPath = path.join(process.cwd(), 'ts-config.json');
      
      // Check if config file already exists
      if (fs.existsSync(configPath) && !options.force) {
        logger.error(`Configuration file already exists at ${configPath}. Use --force to overwrite.`);
        return;
      }
      
      // Create default config
      const defaultConfig = {
        credentials: {
          username: process.env.TS_USERNAME || '',
          password: process.env.TS_PASSWORD || '',
          loginUrl: process.env.TS_LOGIN_URL || 'https://app.targetsolutions.com/auth/index.cfm',
        },
        apiKeys: {
          openai: process.env.OPENAI_API_KEY || '',
          skyvern: process.env.SKYVERN_API_KEY || '',
        },
        browser: {
          headless: process.env.HEADLESS === 'true',
          slowMo: parseInt(process.env.SLOW_MO || '50'),
          defaultTimeout: parseInt(process.env.DEFAULT_TIMEOUT || '30000'),
        },
        course: {
          specificCourseId: process.env.COURSE_ID,
          maxSections: parseInt(process.env.MAX_SECTIONS || '100'),
          videoTimeout: parseInt(process.env.VIDEO_TIMEOUT || '300000'),
        },
        ai: {
          model: process.env.OPENAI_MODEL_NAME || 'gpt-3.5-turbo',
          temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.3'),
          maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000'),
        },
        logging: {
          logDir: process.env.LOG_DIR || './logs',
          logLevel: process.env.LOG_LEVEL || 'info',
          saveScreenshots: process.env.SAVE_SCREENSHOTS !== 'false',
          saveContent: process.env.SAVE_CONTENT !== 'false',
        },
        parallel: {
          enabled: process.env.PARALLEL_ENABLED === 'true',
          maxConcurrent: parseInt(process.env.MAX_CONCURRENT || '2'),
        },
      };
      
      // Write config to file
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      logger.info(`Configuration file generated at ${configPath}`);
    } catch (error) {
      logger.error('Error generating configuration file:', error);
      process.exit(1);
    }
  });

/**
 * Run automation using Playwright
 */
async function runPlaywrightAutomation(options: CompleteOptions): Promise<void> {
  // Launch browser
  const browser = await firefox.launch({
    headless: process.env.HEADLESS === 'true',
    slowMo: parseInt(process.env.SLOW_MO || '50')
  });
  
  try {
    // Create a new page
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    });
    
    // Enable console logging from the browser
    page.on('console', msg => logger.debug(`Browser console: ${msg.text()}`));
    
    // Login to Target Solutions
    await login(page);
    
    // Take a screenshot after login for debugging
    if (!process.env.HEADLESS) {
      await page.screenshot({ path: 'login-success.png' });
      logger.debug('Screenshot saved to login-success.png');
    }
    
    let courseInfo: CourseInfo | null = null;
    
    // If a specific course ID is provided, navigate to it
    if (options.course) {
      courseInfo = await navigateToCourse(page, options.course);
    } else {
      // Otherwise, find and start an assignment from the dashboard
      courseInfo = await findAndStartAssignment(page);
    }
    
    if (!courseInfo) {
      logger.error('Failed to navigate to a course. Exiting...');
      return;
    }
    
    // Complete the course
    await completeCourse(page, courseInfo);
  } finally {
    // Close the browser
    await browser.close();
  }
}

// Parse command line arguments
program.parse(process.argv);

// If no arguments provided, show help
if (process.argv.length <= 2) {
  program.help();
}