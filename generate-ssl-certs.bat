@echo off
setlocal

REM Create directories if they don't exist
if not exist nginx\ssl mkdir nginx\ssl

REM Check if OpenSSL is available
where openssl >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo OpenSSL is not installed or not in PATH.
    echo Please install OpenSSL and try again.
    exit /b 1
)

REM Generate a self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 ^
  -keyout nginx\ssl\server.key ^
  -out nginx\ssl\server.crt ^
  -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" ^
  -addext "subjectAltName = DNS:localhost,IP:127.0.0.1"

if %ERRORLEVEL% neq 0 (
    echo Failed to generate SSL certificates.
    exit /b 1
)

echo Self-signed SSL certificates generated successfully.
echo Note: These certificates are for development/testing only.
echo For production, use proper certificates from a trusted CA.

endlocal