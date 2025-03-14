@echo off
REM Script to restart Docker containers for TSautomation
REM This script will restart the Docker containers to apply configuration changes

echo Restarting Docker containers for TSautomation...

REM Stop the containers
echo Stopping containers...
docker-compose down

REM Rebuild the containers
echo Rebuilding containers...
docker-compose build skyvernui nginx

REM Start the containers
echo Starting containers...
docker-compose up -d

REM Wait for containers to start
echo Waiting for containers to start...
timeout /t 10 /nobreak

REM Check container status
echo Checking container status...
docker-compose ps

echo Restart complete. You can now access the Skyvern UI at http://localhost/skyvern/