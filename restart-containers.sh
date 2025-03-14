#!/bin/bash

# Script to restart Docker containers for TSautomation
# This script will restart the Docker containers to apply configuration changes

echo "Restarting Docker containers for TSautomation..."

# Stop the containers
echo "Stopping containers..."
docker-compose down

# Rebuild the containers
echo "Rebuilding containers..."
docker-compose build skyvernui nginx

# Start the containers
echo "Starting containers..."
docker-compose up -d

# Wait for containers to start
echo "Waiting for containers to start..."
sleep 10

# Check container status
echo "Checking container status..."
docker-compose ps

echo "Restart complete. You can now access the Skyvern UI at http://localhost/skyvern/"