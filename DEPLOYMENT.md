# TSautomation Deployment Guide

This guide provides instructions for deploying the TSautomation system using Docker and Docker Compose, both for local development and production environments.

## Prerequisites

- Docker and Docker Compose installed
- Git (to clone the repository)
- OpenSSL (for generating SSL certificates)

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/TSautomation.git
cd TSautomation
```

### 2. Configure Environment Variables

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Edit the `.env` file and fill in your credentials:

```
# Target Solutions Credentials
TS_USERNAME=yourUsername
TS_PASSWORD=yourPassword

# OpenAI API Key
OPENAI_API_KEY=your_openai_api_key_here

# Skyvern Authentication
# API Key method (traditional)
SKYVERN_API_KEY=your_skyvern_api_key_here
# Bearer token method (alternative)
SKYVERN_BEARER_TOKEN=your_skyvern_bearer_token_here
# API Version Configuration
USE_V2_API=true
```

### 3. Generate SSL Certificates

For Linux/macOS:
```bash
chmod +x generate-ssl-certs.sh
./generate-ssl-certs.sh
```

For Windows:
```cmd
generate-ssl-certs.bat
```

### 4. Build and Start the Containers

```bash
docker-compose up -d
```

This will:
- Build the TSautomation container
- Pull the Skyvern and PostgreSQL images
- Set up the Nginx reverse proxy
- Start all services

### 5. Verify the Setup

- Automation service: https://localhost/automation/
- Skyvern API v1: https://localhost/api/v1/
- Skyvern API v2: https://localhost/api/v2/
- Skyvern UI: https://localhost/skyvern/

## Production Deployment

For production deployment, additional steps are recommended:

### 1. Use Real SSL Certificates

Replace the self-signed certificates in `nginx/ssl/` with real certificates from a trusted CA like Let's Encrypt.

### 2. Adjust Resource Limits

In `docker-compose.yml`, adjust the resource limits based on your server capacity:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'  # Adjust based on server capacity
      memory: 8G  # Adjust based on server capacity
```

### 3. Configure Persistent Storage

Ensure that volumes are properly configured for persistent data:

```yaml
volumes:
  - /path/on/host/logs:/app/logs
  - /path/on/host/skyvern-data:/data
  - /path/on/host/postgres-data:/var/lib/postgresql/data
```

### 4. Set Up Monitoring

Consider adding monitoring services like Prometheus and Grafana to monitor the health and performance of your containers.

### 5. Configure Backups

Set up regular backups of the PostgreSQL database and other important data.

## Docker Compose Commands

- Start services: `docker-compose up -d`
- Stop services: `docker-compose down`
- View logs: `docker-compose logs -f [service_name]`
- Rebuild a service: `docker-compose build [service_name]`
- Restart a service: `docker-compose restart [service_name]`

## Troubleshooting

### Container Fails to Start

Check the logs:
```bash
docker-compose logs automation
```

### Skyvern API Connection Issues

Verify that the Skyvern service is running:
```bash
docker-compose ps skyvern
```

Check the Skyvern logs:
```bash
docker-compose logs skyvern
```

Ensure the API URLs in the automation service environment variables are correctly set:
```
# For API v1
SKYVERN_API_URL=http://skyvern:8000
# For API v2
SKYVERN_API_V2_URL=http://localhost
```

### Browser Automation Issues

If you encounter issues with browser automation in the container:

1. Check if the container has enough resources
2. Verify that the `HEADLESS` environment variable is set to `true`
3. Check the browser logs in the automation container

### API Version Issues

If you're experiencing issues with the Skyvern API:

1. Check which API version you're using:
   - Set `USE_V2_API=true` in your `.env` file to use API v2 (recommended)
   - Set `USE_V2_API=false` to use API v1 (legacy)

2. Verify authentication for both API versions:
   - Both API key and Bearer token may be required for certain operations in API v2

## Security Considerations

- Never commit your `.env` file to version control
- Regularly update Docker images to get security patches
- Use a non-root user in the containers (already configured in the Dockerfile)
- Restrict access to the Docker socket
- Use network segmentation to isolate services

## Scaling

To scale the automation service:

```bash
docker-compose up -d --scale automation=3
```

Note: When scaling, ensure that:
- Each instance has a unique name
- Resource limits are appropriate
- Load balancing is configured correctly

## Migrating to a Different Server

1. Stop the services on the old server:
   ```bash
   docker-compose down
   ```

2. Back up your data:
   ```bash
   tar -czvf tsautomation-data.tar.gz .env logs skyvern-data nginx/ssl
   ```

3. Transfer the backup to the new server

4. Set up Docker and Docker Compose on the new server

5. Extract the backup:
   ```bash
   tar -xzvf tsautomation-data.tar.gz
   ```

6. Start the services on the new server:
   ```bash
   docker-compose up -d
   ```

## Updating the Application

1. Pull the latest code:
   ```bash
   git pull
   ```

2. Rebuild and restart the containers:
   ```bash
   docker-compose down
   docker-compose build
   docker-compose up -d
   ```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Skyvern Documentation](https://github.com/Skyvern-AI/skyvern)
- [Skyvern API v2 Documentation](https://docs.skyvern.com/running-tasks/api-v2-spec)