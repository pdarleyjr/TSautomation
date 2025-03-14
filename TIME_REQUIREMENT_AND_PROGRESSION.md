# Time Requirement Handling & Assignment Progression

This document outlines the implementation of time requirement handling and assignment progression features in the Target Solutions LMS Automation system.

## Overview

The system now includes two new major components:

1. **Time Requirement Enforcement**: Ensures that assignments are only completed if the required minimum time has elapsed, with automatic restart and exponential backoff for retry attempts.

2. **Assignment Progression Logic**: Automatically navigates between assignments, detecting completion, handling course reviews, and initiating the next assignment.

## Implementation Details

### New Modules

1. **TimeTracker (`src/time-tracker.ts`)**
   - Records start time when beginning an assignment
   - Continuously monitors elapsed time against course requirements
   - Implements exponential backoff for retry attempts
   - Emits events for time requirement status

2. **WorkflowManager (`src/workflow-manager.ts`)**
   - Manages assignment progression
   - Detects when an assignment is successfully completed
   - Navigates to the assignments dashboard/queue
   - Finds and starts the next available assignment
   - Handles course review pages

### Configuration Updates (`src/config.ts`)

Added new configuration options:

```typescript
// Course settings
course: {
  // ...existing settings...
  minimumTimeRequirements: Record<string, number>; // Course type to minimum seconds
  defaultMinimumTime: number; // Default minimum time in seconds
}

// Time tracking and retry settings
timeTracking: {
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}
```

Default values:
- Default minimum time: 15 minutes (900 seconds)
- Safety courses: 30 minutes (1800 seconds)
- Compliance courses: 20 minutes (1200 seconds)
- HR courses: 25 minutes (1500 seconds)
- Base retry delay: 30 seconds
- Maximum retry delay: 10 minutes

### Integration Points

1. **SessionHandler Integration**
   - Now creates and manages a TimeTracker instance
   - Verifies time requirements before proceeding to exams
   - Handles course review pages after completion
   - Integrates with WorkflowManager for assignment progression

2. **PageNavigator Enhancements**
   - Added detection and handling for course review pages
   - Improved page type detection with enum-based tracking
   - Enhanced navigation logic to work with time requirements

3. **Main Application Flow**
   - Updated to use WorkflowManager for assignment progression
   - Added support for processing all available assignments sequentially

## Workflow

1. When an assignment starts:
   - TimeTracker begins monitoring elapsed time
   - Course type is determined to set the appropriate minimum time requirement

2. During assignment:
   - TimeTracker continuously checks elapsed time
   - SessionHandler verifies time requirements before proceeding to final exam

3. When an assignment reaches completion:
   - If time requirement is not met, the assignment is restarted with exponential backoff
   - If time requirement is met, the assignment is marked as complete

4. After assignment completion:
   - Course review pages are automatically handled (skipped or filled with default values)
   - WorkflowManager navigates to the assignments dashboard
   - Next assignment is identified and started

## Error Handling

- Exponential backoff with jitter for retry attempts
- Fallback navigation paths if primary routes fail
- Detailed logging of time tracking and assignment progression events

## Usage

The new features are enabled by default but can be controlled via environment variables:

- `USE_WORKFLOW_MANAGER=false` to disable automatic assignment progression
- `DEFAULT_MINIMUM_TIME=600` to change the default minimum time (in seconds)
- `BASE_RETRY_DELAY_MS=60000` to change the base retry delay (in milliseconds)
- `MAX_RETRY_DELAY_MS=300000` to change the maximum retry delay (in milliseconds)

## Example

```typescript
// Create workflow manager
const workflowManager = new WorkflowManager(page);

// Find and start the first assignment
const started = await workflowManager.findAndStartNextAssignment();
if (started) {
  // The workflow manager will handle progression to subsequent assignments
  console.log('First assignment started, workflow manager will handle progression');
}