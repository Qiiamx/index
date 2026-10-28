$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host 'installing dependencies...'
    npm install --registry=https://registry.npmmirror.com --no-audit --no-fund
}

if (-not (Test-Path -LiteralPath (Join-Path $root 'dist\server.js'))) {
    Write-Host 'building...'
    npm run build
}

$port = 8090
if (Test-Path -LiteralPath (Join-Path $root 'config.json')) {
    try {
        $config = Get-Content -LiteralPath (Join-Path $root 'config.json') -Raw | ConvertFrom-Json
        if ($config.port) { $port = [int]$config.port }
    } catch {
        Write-Host "config.json 解析失败，使用默认端口 $port"
    }
}

Start-Process "http://127.0.0.1:$port"
node --disable-warning=ExperimentalWarning dist/server.js
