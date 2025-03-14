#!/bin/bash

# Create directories if they don't exist
mkdir -p nginx/ssl

# Generate a self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/server.key \
  -out nginx/ssl/server.crt \
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" \
  -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"

# Set proper permissions
chmod 600 nginx/ssl/server.key
chmod 644 nginx/ssl/server.crt

echo "Self-signed SSL certificates generated successfully."
echo "Note: These certificates are for development/testing only."
echo "For production, use proper certificates from a trusted CA."