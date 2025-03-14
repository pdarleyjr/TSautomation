@echo off
:: Enhanced Docker environment startup script for Windows
:: This script starts all Docker containers for the TSautomation system
:: with proper error handling and logging.

setlocal enabledelayedexpansion

:: Configuration
set LOG_DIR=.\logs
set TIMESTAMP=%date:~10,4%%date:~4,2%%date:~7,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=!TIMESTAMP: =0!
set LOG_FILE=%LOG_DIR%\docker-startup-%TIMESTAMP%.log

:: Create log directory if it doesn't exist
if not exist %LOG_DIR% mkdir %LOG_DIR%

:: Log function
:log
set LEVEL=%~1
set MESSAGE=%~2
set TIMESTAMP=%date:~10,4%-%date:~4,2%-%date:~7,2%T%time:~0,2%:%time:~3,2%:%time:~6,2%Z
set TIMESTAMP=!TIMESTAMP: =0!
echo [!TIMESTAMP!] [%LEVEL%] %MESSAGE%
echo [!TIMESTAMP!] [%LEVEL%] %MESSAGE% >> %LOG_FILE%
goto :eof

:: Check if Docker is running
call :log "INFO" "Checking if Docker is running..."
docker info > nul 2>&1
if %errorlevel% neq 0 (
    call :log "ERROR" "Docker is not running. Please start Docker and try again."
    exit /b 1
)
call :log "INFO" "Docker is running."

:: Check if .env file exists
call :log "INFO" "Checking if .env file exists..."
if not exist .env (
    call :log "WARN" ".env file not found. Creating from .env.example..."
    if exist .env.example (
        copy .env.example .env > nul
        call :log "INFO" ".env file created from .env.example. Please update it with your credentials."
    ) else (
        call :log "ERROR" "Neither .env nor .env.example file found. Please create a .env file."
        exit /b 1
    )
)
call :log "INFO" ".env file exists."

:: Check if required environment variables are set
call :log "INFO" "Checking required environment variables..."

:: Load environment variables from .env file
for /f "tokens=*" %%a in (.env) do (
    set line=%%a
    if "!line:~0,1!" neq "#" (
        for /f "tokens=1,2 delims==" %%b in ("!line!") do (
            set %%b=%%c
        )
    )
)

:: Check required variables
set MISSING_VARS=

if "%OPENAI_API_KEY%"=="" (
    set MISSING_VARS=!MISSING_VARS! OPENAI_API_KEY
)

if "%SKYVERN_API_KEY%"=="" (
    if "%SKYVERN_BEARER_TOKEN%"=="" (
        set MISSING_VARS=!MISSING_VARS! "SKYVERN_API_KEY or SKYVERN_BEARER_TOKEN"
    )
)

if not "!MISSING_VARS!"=="" (
    call :log "ERROR" "Missing required environment variables:!MISSING_VARS!"
    call :log "ERROR" "Please update your .env file with the required values."
    exit /b 1
)

call :log "INFO" "All required environment variables are set."

:: Pull Docker images
call :log "INFO" "Pulling Docker images..."
docker-compose pull
if %errorlevel% neq 0 (
    call :log "ERROR" "Failed to pull Docker images."
    exit /b 1
)
call :log "INFO" "Docker images pulled successfully."

:: Start Docker containers
call :log "INFO" "Starting Docker containers..."
docker-compose up -d
if %errorlevel% neq 0 (
    call :log "ERROR" "Failed to start Docker containers."
    exit /b 1
)
call :log "INFO" "Docker containers started successfully."

:: Check container status
call :log "INFO" "Checking container status..."

:: Wait a moment for containers to start
timeout /t 5 > nul

:: Get container status
set CONTAINERS=tsautomation-main-nginx-1 tsautomation-main-skyvern-1 tsautomation-main-skyvernui-1 tsautomation-main-postgres-1 tsautomation-main-automation-1
set ALL_RUNNING=true

for %%c in (%CONTAINERS%) do (
    for /f "tokens=*" %%s in ('docker ps -a --filter "name=%%c" --format "{{.Status}}"') do (
        set STATUS=%%s
        echo !STATUS! | findstr /C:"Up" > nul
        if !errorlevel! equ 0 (
            call :log "INFO" "Container %%c is running: !STATUS!"
        ) else (
            call :log "ERROR" "Container %%c is not running: !STATUS!"
            set ALL_RUNNING=false
        )
    )
)

if "!ALL_RUNNING!"=="true" (
    call :log "INFO" "All containers are running."
) else (
    call :log "ERROR" "Some containers are not running. Check the logs for details."
    exit /b 1
)

:: Print URLs
call :log "INFO" "TSautomation system is now running."
call :log "INFO" "Skyvern API: http://localhost:8000/api/v2"
call :log "INFO" "Skyvern UI: http://localhost/skyvern/"
call :log "INFO" "Nginx: http://localhost"

call :log "INFO" "TSautomation Docker environment started successfully."
exit /b 0