param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($Root)
$dataDir = Join-Path $root 'data'
$exitFile = Join-Path $dataDir 'tray.exit'

$self = $PID
$tray = Get-CimInstance Win32_Process |
    Where-Object { $_.ProcessId -ne $self -and $_.CommandLine -match 'IndexTray\.ps1' }

if (-not $tray) {
    Write-Output '托盘没有运行。'
    if (Test-Path -LiteralPath $exitFile) { Remove-Item -LiteralPath $exitFile -Force }
    exit 0
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Set-Content -LiteralPath $exitFile -Value 'exit' -Encoding ASCII

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500
    $running = Get-CimInstance Win32_Process |
        Where-Object { $_.ProcessId -ne $self -and $_.CommandLine -match 'IndexTray\.ps1' }
    if (-not $running) {
        if (Test-Path -LiteralPath $exitFile) { Remove-Item -LiteralPath $exitFile -Force }
        Write-Output '托盘和服务已停止。'
        exit 0
    }
}

Write-Output '等待托盘退出超时；请查看 data\logs\tray.log。'
exit 1
