# TSautomation System

A comprehensive automation system designed to interact with the Skyvern API and provide robust automation capabilities for Target Solutions courses.

## Overview

The TSautomation system integrates various components including:

- **Skyvern API v2 Integration**: Robust API integration with authentication fallbacks
- **Self-hosted Playwright Automation**: Browser automation for course navigation
- **LangChain Integration**: AI-powered content analysis and question answering
- **Resource Management**: Optimized browser pool and data storage
- **Video Handling**: Advanced video detection and completion monitoring
- **Docker Environment**: Containerized deployment for consistent execution

## System Requirements

- Docker and Docker Compose
- Node.js 16+ (for development)
- Git

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/TSautomation.git
cd TSautomation
```

### 2. Configure Environment Variables

Copy the example environment file and update it with your credentials:

```bash
cp .env.example .env
```

Edit the `.env` file and add your:
- Target Solutions credentials (TS_USERNAME, TS_PASSWORD)
- OpenAI API Key (OPENAI_API_KEY)
- Skyvern API Key (SKYVERN_API_KEY) or Bearer Token (SKYVERN_BEARER_TOKEN)

### 3. Start the Docker Environment

#### On Windows:

```bash
.\start-docker-environment.bat
```

#### On Linux/macOS:

```bash
chmod +x ./start-docker-environment.sh
./start-docker-environment.sh
```

### 4. Access the System

- **Skyvern API**: http://localhost:8000/api/v2
- **Skyvern UI**: http://localhost/skyvern/
- **Nginx**: http://localhost

## System Architecture

The TSautomation system consists of the following Docker containers:

- **nginx**: Reverse proxy for routing requests
- **skyvern**: Skyvern API server
- **skyvernui**: Skyvern UI server
- **postgres**: PostgreSQL database for Skyvern
- **automation**: Main automation container

## Authentication

The system supports multiple authentication methods:

1. **API Key Authentication**: Using the `SKYVERN_API_KEY` environment variable
2. **Bearer Token Authentication**: Using the `SKYVERN_BEARER_TOKEN` environment variable

The authentication system includes:
- Multi-method authentication with fallbacks
- Robust error handling
- Advanced retry logic
- Circuit breaker pattern
- Token management

## Key Components

### Skyvern API Integration

The system integrates with Skyvern API v2 for visual automation tasks. The integration includes:

- Robust authentication with multiple fallback mechanisms
- Comprehensive error handling
- Automatic retries with exponential backoff
- Circuit breaker pattern to prevent cascading failures

### Playwright Automation

The system uses Playwright for browser automation with the following features:

- Browser pool for managing concurrent browser instances
- Resource optimization
- Graceful shutdown
- Configurable browser settings

### LangChain Integration

The LangChain integration provides AI-powered capabilities:

- Course content analysis
- Question answering
- Content summarization
- Key concept extraction
- Practice question generation

### Resource Management

The resource management system optimizes performance and resource utilization:

- Browser pool for limiting concurrent browser instances
- Data store for managing course data
- Resource monitoring for tracking system performance
- Graceful shutdown support

### Video Handling

The video handling system uses a multi-strategy approach:

- Enhanced video detection
- Reliable video completion detection
- Intelligent waiting with adaptive timing
- Skyvern fallback integration

## Configuration

The system can be configured through environment variables in the `.env` file:

### Target Solutions Configuration

```
TS_USERNAME=your_username
TS_PASSWORD=your_password
TS_LOGIN_URL=https://app.targetsolutions.com/auth/index.cfm
```

### API Configuration

```
OPENAI_API_KEY=your_openai_api_key
SKYVERN_API_KEY=your_skyvern_api_key
SKYVERN_BEARER_TOKEN=your_skyvern_bearer_token
SKYVERN_API_URL=http://localhost:8000/api/v1
SKYVERN_API_V2_URL=http://localhost:8000/api/v2
USE_V2_API=true
```

### Browser Configuration

```
HEADLESS=true
SLOW_MO=50
DEFAULT_TIMEOUT=30000
```

### Resource Management

```
MAX_CONCURRENT_BROWSERS=2
DATA_STORAGE_DIR=./data
DATA_EXPIRATION_MS=3600000
PERSIST_DATA=true
USE_RESOURCE_MANAGER=true
```

### Retry and Timeout Configuration

```
MAX_RETRIES=5
INITIAL_RETRY_DELAY_MS=1000
MAX_RETRY_DELAY_MS=30000
REQUEST_TIMEOUT_MS=30000
TOKEN_REFRESH_INTERVAL_MS=3600000
MAX_CONSECUTIVE_FAILURES=3
LOG_HEALTH_CHECKS=false
```

## Testing

### Testing Skyvern API v2 Integration

Run the Skyvern API v2 integration test:

```bash
node test-skyvern-v2-integration.js
```

This test verifies:
- Direct API access with API key and Bearer token
- Nginx proxy access
- Task creation and retrieval

### Checking Docker Container Status

Check the status of all Docker containers:

```bash
node check-docker-status.js
```

## Troubleshooting

### Common Issues

#### Docker Containers Not Starting

Check the Docker logs:

```bash
docker-compose logs
```

#### Skyvern API Not Accessible

Verify the Nginx configuration:

```bash
docker-compose exec nginx nginx -t
```

#### Authentication Failures

Check your API key or Bearer token in the `.env` file.

## Security Considerations

- Store sensitive credentials in the `.env` file, which is excluded from Git
- Use environment variables for all sensitive information
- Do not hardcode credentials in source code
- Use the provided `.gitignore` file to prevent accidental commits of sensitive files

## License

[MIT License](LICENSE)