# Use the official Playwright image as base
FROM mcr.microsoft.com/playwright:v1.51.0-jammy

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript code
RUN npm run build

# Create non-root user for better security
RUN useradd -m automation
RUN mkdir -p /app/logs /app/screenshots
RUN chown -R automation:automation /app

# Switch to non-root user
USER automation

# Set environment variables
ENV NODE_ENV=production
ENV HEADLESS=true
ENV DEFAULT_TIMEOUT=60000
ENV PARALLEL_ENABLED=false
ENV LOG_LEVEL=info
ENV SAVE_SCREENSHOTS=false

# Create volume for logs
VOLUME ["/app/logs"]

# Command to run the application
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["complete"]
