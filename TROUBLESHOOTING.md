# Troubleshooting Guide for TSautomation

This guide provides solutions for common issues you might encounter when using the TSautomation system.

## Table of Contents

1. [Docker Environment Issues](#docker-environment-issues)
2. [Skyvern API Issues](#skyvern-api-issues)
3. [Authentication Issues](#authentication-issues)
4. [Nginx Configuration Issues](#nginx-configuration-issues)
5. [Browser Automation Issues](#browser-automation-issues)
6. [LangChain Integration Issues](#langchain-integration-issues)
7. [Performance Issues](#performance-issues)

## Docker Environment Issues

### Containers Not Starting

**Symptoms:**
- Docker containers fail to start
- `docker-compose up` command fails

**Solutions:**

1. Check Docker service status:
   ```bash
   # Windows
   sc query docker
   
   # Linux
   systemctl status docker
   ```

2. Check for port conflicts:
   ```bash
   # Windows
   netstat -ano | findstr "80 443 8000 3000 5432"
   
   # Linux
   netstat -tulpn | grep -E '80|443|8000|3000|5432'
   ```

3. Check Docker logs:
   ```bash
   docker-compose logs
   ```

4. Restart Docker:
   ```bash
   # Windows
   restart-service docker
   
   # Linux
   systemctl restart docker
   ```

5. Rebuild containers:
   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

### Container Exiting Immediately

**Symptoms:**
- Containers start but exit immediately
- Status shows "Exited" instead of "Up"

**Solutions:**

1. Check container logs:
   ```bash
   docker logs tsautomation-main-skyvern-1
   ```

2. Check for missing environment variables:
   ```bash
   docker-compose config
   ```

3. Check for permission issues:
   ```bash
   # Linux
   ls -la ./skyvern-data
   sudo chown -R $(id -u):$(id -g) ./skyvern-data
   ```

## Skyvern API Issues

### API Not Accessible

**Symptoms:**
- Cannot access Skyvern API at http://localhost:8000/api/v2
- "Connection refused" or "Not Found" errors

**Solutions:**

1. Check if the Skyvern container is running:
   ```bash
   docker ps | grep skyvern
   ```

2. Check Skyvern container logs:
   ```bash
   docker logs tsautomation-main-skyvern-1
   ```

3. Verify API URL configuration:
   ```bash
   grep SKYVERN_API .env
   ```

4. Test direct API access:
   ```bash
   curl http://localhost:8000/api/v2/health
   ```

5. Restart the Skyvern container:
   ```bash
   docker-compose restart skyvern
   ```

### API Returns 500 Errors

**Symptoms:**
- API requests return 500 Internal Server Error
- Tasks fail to create or retrieve

**Solutions:**

1. Check Skyvern container logs for errors:
   ```bash
   docker logs tsautomation-main-skyvern-1
   ```

2. Check PostgreSQL connection:
   ```bash
   docker logs tsautomation-main-postgres-1
   ```

3. Verify environment variables:
   ```bash
   docker-compose exec skyvern env | grep SKYVERN
   ```

4. Restart the Skyvern and PostgreSQL containers:
   ```bash
   docker-compose restart postgres skyvern
   ```

## Authentication Issues

### API Key Authentication Fails

**Symptoms:**
- API requests return 401 Unauthorized or 403 Forbidden
- Authentication with API key fails

**Solutions:**

1. Verify API key in .env file:
   ```bash
   grep SKYVERN_API_KEY .env
   ```

2. Check if the API key is being passed correctly:
   ```bash
   # Test with curl
   curl -H "x-api-key: your_api_key" http://localhost:8000/api/v2/health
   ```

3. Verify API key in Skyvern container:
   ```bash
   docker-compose exec skyvern env | grep SKYVERN_API_KEY
   ```

4. Update the API key in .env and restart containers:
   ```bash
   docker-compose down
   # Edit .env file
   docker-compose up -d
   ```

### Bearer Token Authentication Fails

**Symptoms:**
- API requests with Bearer token return 401 Unauthorized
- Authentication with Bearer token fails

**Solutions:**

1. Verify Bearer token in .env file:
   ```bash
   grep SKYVERN_BEARER_TOKEN .env
   ```

2. Check if the Bearer token is being passed correctly:
   ```bash
   # Test with curl
   curl -H "Authorization: Bearer your_bearer_token" http://localhost:8000/api/v2/health
   ```

3. Verify Bearer token in Skyvern container:
   ```bash
   docker-compose exec skyvern env | grep SKYVERN_BEARER_TOKEN
   ```

4. Update the Bearer token in .env and restart containers:
   ```bash
   docker-compose down
   # Edit .env file
   docker-compose up -d
   ```

## Nginx Configuration Issues

### Nginx Not Routing Requests Correctly

**Symptoms:**
- Cannot access Skyvern UI at http://localhost/skyvern/
- API requests through Nginx proxy fail
- 404 Not Found or 502 Bad Gateway errors

**Solutions:**

1. Check Nginx configuration:
   ```bash
   docker-compose exec nginx nginx -t
   ```

2. Check Nginx logs:
   ```bash
   docker logs tsautomation-main-nginx-1
   ```

3. Verify Nginx configuration file:
   ```bash
   cat nginx/conf.d/default.conf
   ```

4. Check if services are accessible from Nginx container:
   ```bash
   docker-compose exec nginx curl skyvern:8000/api/v2/health
   docker-compose exec nginx curl skyvernui:3000
   ```

5. Restart Nginx container:
   ```bash
   docker-compose restart nginx
   ```

### CORS Issues

**Symptoms:**
- Browser console shows CORS errors
- API requests from frontend fail with CORS errors

**Solutions:**

1. Check Nginx CORS headers:
   ```bash
   cat nginx/conf.d/default.conf | grep -i cors
   ```

2. Add CORS headers to Nginx configuration:
   ```nginx
   # Add to location blocks in nginx/conf.d/default.conf
   add_header 'Access-Control-Allow-Origin' '*';
   add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS, PUT, DELETE';
   add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,x-api-key';
   ```

3. Restart Nginx container:
   ```bash
   docker-compose restart nginx
   ```

## Browser Automation Issues

### Playwright Browser Fails to Launch

**Symptoms:**
- Browser automation fails
- Error messages about browser launch failure

**Solutions:**

1. Check browser dependencies:
   ```bash
   docker-compose exec automation npx playwright install-deps
   ```

2. Verify browser configuration:
   ```bash
   grep HEADLESS .env
   ```

3. Check browser logs:
   ```bash
   docker logs tsautomation-main-automation-1
   ```

4. Increase browser launch timeout:
   ```bash
   # Update in .env
   DEFAULT_TIMEOUT=60000
   ```

5. Restart automation container:
   ```bash
   docker-compose restart automation
   ```

### Browser Pool Exhaustion

**Symptoms:**
- "No available browsers" errors
- Browser requests queued indefinitely

**Solutions:**

1. Check browser pool configuration:
   ```bash
   grep MAX_CONCURRENT .env
   ```

2. Increase maximum concurrent browsers:
   ```bash
   # Update in .env
   MAX_CONCURRENT_BROWSERS=4
   ```

3. Check for zombie browser processes:
   ```bash
   docker-compose exec automation ps aux | grep chromium
   ```

4. Restart automation container:
   ```bash
   docker-compose restart automation
   ```

## LangChain Integration Issues

### OpenAI API Key Issues

**Symptoms:**
- LangChain operations fail
- OpenAI API key errors

**Solutions:**

1. Verify OpenAI API key in .env file:
   ```bash
   grep OPENAI_API_KEY .env
   ```

2. Check if the API key is being passed correctly:
   ```bash
   docker-compose exec automation env | grep OPENAI_API_KEY
   ```

3. Update the API key in .env and restart containers:
   ```bash
   docker-compose down
   # Edit .env file
   docker-compose up -d
   ```

### LangChain Model Errors

**Symptoms:**
- LangChain operations fail with model errors
- "Model not found" or "Invalid model" errors

**Solutions:**

1. Check model configuration:
   ```bash
   grep OPENAI_MODEL .env
   ```

2. Update to a valid model:
   ```bash
   # Update in .env
   OPENAI_MODEL_NAME=gpt-3.5-turbo
   ```

3. Check for rate limiting:
   ```bash
   docker logs tsautomation-main-automation-1 | grep "rate limit"
   ```

4. Restart automation container:
   ```bash
   docker-compose restart automation
   ```

## Performance Issues

### High CPU or Memory Usage

**Symptoms:**
- Docker containers using excessive CPU or memory
- System becomes slow or unresponsive

**Solutions:**

1. Check container resource usage:
   ```bash
   docker stats
   ```

2. Limit container resources in docker-compose.yml:
   ```yaml
   services:
     automation:
       deploy:
         resources:
           limits:
             cpus: '2'
             memory: 4G
   ```

3. Reduce maximum concurrent browsers:
   ```bash
   # Update in .env
   MAX_CONCURRENT_BROWSERS=2
   ```

4. Optimize browser usage:
   ```bash
   # Update in .env
   HEADLESS=true
   ```

5. Restart containers with updated limits:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

### Slow API Responses

**Symptoms:**
- API requests take a long time to complete
- Timeouts during API calls

**Solutions:**

1. Check Skyvern container logs for performance issues:
   ```bash
   docker logs tsautomation-main-skyvern-1
   ```

2. Check PostgreSQL performance:
   ```bash
   docker logs tsautomation-main-postgres-1
   ```

3. Increase request timeout:
   ```bash
   # Update in .env
   REQUEST_TIMEOUT_MS=60000
   ```

4. Optimize PostgreSQL configuration:
   ```bash
   # Add to docker-compose.yml
   postgres:
     environment:
       - POSTGRES_PASSWORD=postgres
       - POSTGRES_USER=postgres
       - POSTGRES_DB=skyvern
       - POSTGRES_SHARED_BUFFERS=256MB
       - POSTGRES_EFFECTIVE_CACHE_SIZE=1GB
   ```

5. Restart containers:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

## Additional Help

If you continue to experience issues after trying these solutions, please:

1. Check the logs directory for detailed logs
2. Run the diagnostic scripts:
   ```bash
   node test-skyvern-v2-integration.js
   node check-docker-status.js
   ```
3. Create an issue on the GitHub repository with:
   - Detailed description of the issue
   - Steps to reproduce
   - Relevant logs
   - Environment information (OS, Docker version, etc.)