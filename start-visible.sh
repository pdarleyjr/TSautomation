#!/bin/bash

# Parse command line arguments
COMMAND="complete"
HEADLESS=""  # No headless flag means browser will be visible
COURSE_ID=""
SKYVERN=""
DYNAMIC_SKYVERN=""
TIMEOUT=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    list-courses|complete|init) COMMAND="$1"; shift ;;
    --course|-c) COURSE_ID="--course $2"; shift 2 ;;
    --skyvern|-s) SKYVERN="--skyvern"; shift ;;
    --dynamic-skyvern|-d) DYNAMIC_SKYVERN="--dynamic-skyvern"; shift ;;
    --timeout|-t) TIMEOUT="--timeout $2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Build the TypeScript code if needed
if [ ! -d "dist" ] || [ "$(find src -newer dist -name "*.ts" 2>/dev/null)" ]; then
  echo "Building TypeScript code..."
  npm run build
fi

# Run the CLI command
node dist/cli.js $COMMAND $HEADLESS $COURSE_ID $SKYVERN $DYNAMIC_SKYVERN $TIMEOUT