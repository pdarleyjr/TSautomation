# Convert PFX to PEM format
$pfxPath = 'nginx/ssl/server.pfx'
$pemCertPath = 'nginx/ssl/server.crt'
$pemKeyPath = 'nginx/ssl/server.key'
$password = 'password'

# Create a temporary file with the PEM certificate
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2
$cert.Import($pfxPath, $password, [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable)

# Export certificate in PEM format
$certPem = '-----BEGIN CERTIFICATE-----' + [Environment]::NewLine
$certPem += [Convert]::ToBase64String($cert.RawData, [System.Base64FormattingOptions]::InsertLineBreaks)
$certPem += [Environment]::NewLine + '-----END CERTIFICATE-----'
[System.IO.File]::WriteAllText($pemCertPath, $certPem)

# Export private key in PEM format
$privateKeyPem = '-----BEGIN PRIVATE KEY-----' + [Environment]::NewLine
$privateKeyPem += [Convert]::ToBase64String($cert.PrivateKey.ExportPkcs8PrivateKey(), [System.Base64FormattingOptions]::InsertLineBreaks)
$privateKeyPem += [Environment]::NewLine + '-----END PRIVATE KEY-----'
[System.IO.File]::WriteAllText($pemKeyPath, $privateKeyPem)

Write-Host 'Certificate and private key exported in PEM format'
