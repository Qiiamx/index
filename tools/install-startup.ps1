param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($Root)
$startup = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startup 'Index.lnk'
$launcher = Join-Path $root 'Index.vbs'
$icon = Join-Path $root 'assets\index.ico'

if (-not (Test-Path -LiteralPath $launcher)) {
    throw "找不到 Index.vbs：$launcher"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = 'wscript.exe'
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = $icon
$shortcut.Description = 'Index 本地服务'
$shortcut.Save()

Write-Output "已添加开机启动：$shortcutPath"
