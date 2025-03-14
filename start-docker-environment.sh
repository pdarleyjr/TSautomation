#!/bin/bash

# Enhanced Docker environment startup script
# This script starts all Docker containers for the TSautomation system
# with proper error handling and logging.

# Set error handling
set -e

# Configuration
LOG_DIR="./logs"
LOG_FILE="$LOG_DIR/docker-startup-$(date +%Y%m%d-%H%M%S).log"

# Create log directory if it doesn't exist
mkdir -p "$LOG_DIR"

# Log function
log() {
  local level="$1"
  local message="$2"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Check if Docker is running
check_docker() {
  log "INFO" "Checking if Docker is running..."
  if ! docker info > /dev/null 2>&1; then
    log "ERROR" "Docker is not running. Please start Docker and try again."
    exit 1
  fi
  log "INFO" "Docker is running."
}

# Check if .env file exists
check_env_file() {
  log "INFO" "Checking if .env file exists..."
  if [ ! -f .env ]; then
    log "WARN" ".env file not found. Creating from .env.example..."
    if [ -f .env.example ]; then
      cp .env.example .env
      log "INFO" ".env file created from .env.example. Please update it with your credentials."
    else
      log "ERROR" "Neither .env nor .env.example file found. Please create a .env file."
      exit 1
    fi
  fi
  log "INFO" ".env file exists."
}

# Check if required environment variables are set
check_env_vars() {
  log "INFO" "Checking required environment variables..."
  
  # Source .env file
  source .env
  
  # Check required variables
  local missing_vars=()
  
  if [ -z "$OPENAI_API_KEY" ]; then
    missing_vars+=("OPENAI_API_KEY")
  fi
  
  if [ -z "$SKYVERN_API_KEY" ] && [ -z "$SKYVERN_BEARER_TOKEN" ]; then
    missing_vars+=("SKYVERN_API_KEY or SKYVERN_BEARER_TOKEN")
  fi
  
  if [ ${#missing_vars[@]} -gt 0 ]; then
    log "ERROR" "Missing required environment variables: ${missing_vars[*]}"
    log "ERROR" "Please update your .env file with the required values."
    exit 1
  fi
  
  log "INFO" "All required environment variables are set."
}

# Pull Docker images
pull_images() {
  log "INFO" "Pulling Docker images..."
  docker-compose pull
  log "INFO" "Docker images pulled successfully."
}

# Start Docker containers
start_containers() {
  log "INFO" "Starting Docker containers..."
  docker-compose up -d
  log "INFO" "Docker containers started successfully."
}

# Check container status
check_container_status() {
  log "INFO" "Checking container status..."
  
  # Wait a moment for containers to start
  sleep 5
  
  # Get container status
  local containers=(
    "tsautomation-main-nginx-1"
    "tsautomation-main-skyvern-1"
    "tsautomation-main-skyvernui-1"
    "tsautomation-main-postgres-1"
    "tsautomation-main-automation-1"
  )
  
  local all_running=true
  
  for container in "${containers[@]}"; do
    local status=$(docker ps -a --filter "name=$container" --format "{{.Status}}")
    
    if [[ $status == *"Up"* ]]; then
      log "INFO" "Container $container is running: $status"
    else
      log "ERROR" "Container $container is not running: $status"
      all_running=false
    fi
  done
  
  if [ "$all_running" = true ]; then
    log "INFO" "All containers are running."
  else
    log "ERROR" "Some containers are not running. Check the logs for details."
    exit 1
  fi
}

# Print URLs
print_urls() {
  log "INFO" "TSautomation system is now running."
  log "INFO" "Skyvern API: http://localhost:8000/api/v2"
  log "INFO" "Skyvern UI: http://localhost/skyvern/"
  log "INFO" "Nginx: http://localhost"
}

# Main function
main() {
  log "INFO" "Starting TSautomation Docker environment..."
  
  check_docker
  check_env_file
  check_env_vars
  pull_images
  start_containers
  check_container_status
  print_urls
  
  log "INFO" "TSautomation Docker environment started successfully."
}

# Run main function
main