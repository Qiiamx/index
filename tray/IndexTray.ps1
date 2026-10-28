param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = [System.IO.Path]::GetFullPath($Root)
Set-Location -LiteralPath $root
$dataDir = Join-Path $root 'data'
$logDir = Join-Path $dataDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$port = 8090
$configPath = Join-Path $root 'config.json'
if (Test-Path -LiteralPath $configPath) {
    try {
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($config.port) { $port = [int]$config.port }
    } catch {
        # Keep the default port; the server will report config errors.
    }
}

function Write-TrayLog {
    param([string]$Message)
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath (Join-Path $logDir 'tray.log') -Value $line -Encoding UTF8
}

$created = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\IndexTray', [ref]$created)
if (-not $created) {
    Start-Process "http://127.0.0.1:$port"
    exit 0
}

$node = $null
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
    $node = $nodeCommand.Source
} else {
    foreach ($candidate in @(
        'C:\Program Files\nodejs\node.exe',
        'C:\Program Files (x86)\nodejs\node.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
    )) {
        if (Test-Path -LiteralPath $candidate) {
            $node = $candidate
            break
        }
    }
}

$npm = 'npm.cmd'
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($npmCommand) { $npm = $npmCommand.Source }

$iconRunningPath = Join-Path $root 'assets\index.ico'
$iconStoppedPath = Join-Path $root 'assets\index-stopped.ico'
if (-not (Test-Path -LiteralPath $iconRunningPath)) {
    try {
        & (Join-Path $root 'tools\make-icons.ps1') -Root $root | Out-Null
    } catch {
        Write-TrayLog "icon generation failed: $($_.Exception.Message)"
    }
}

$script:server = $null
$script:stopping = $false
$script:restartCount = 0
$script:lastHealthy = $false
$script:lastStartAt = $null
$script:stdout = $null
$script:stderr = $null
$script:exited = $false
$exitFile = Join-Path $dataDir 'tray.exit'

$notify = New-Object System.Windows.Forms.NotifyIcon
$script:iconRunning = $null
$script:iconStopped = $null
if (Test-Path -LiteralPath $iconRunningPath) {
    $script:iconRunning = New-Object System.Drawing.Icon($iconRunningPath)
}
if (Test-Path -LiteralPath $iconStoppedPath) {
    $script:iconStopped = New-Object System.Drawing.Icon($iconStoppedPath)
}
$notify.Icon = if ($script:iconRunning) { $script:iconRunning } else { [System.Drawing.SystemIcons]::Application }
$notify.Visible = $false
$notify.Text = 'Index 已停止'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = New-Object System.Windows.Forms.ToolStripMenuItem('打开 Index')
$dataItem = New-Object System.Windows.Forms.ToolStripMenuItem('打开数据目录')
$logItem = New-Object System.Windows.Forms.ToolStripMenuItem('打开日志目录')
$startItem = New-Object System.Windows.Forms.ToolStripMenuItem('启动服务')
$stopItem = New-Object System.Windows.Forms.ToolStripMenuItem('停止服务')
$restartItem = New-Object System.Windows.Forms.ToolStripMenuItem('重启服务')
$startupItem = New-Object System.Windows.Forms.ToolStripMenuItem('开机启动')
$startupItem.CheckOnClick = $false
$exitItem = New-Object System.Windows.Forms.ToolStripMenuItem('退出')

[void]$menu.Items.Add($openItem)
[void]$menu.Items.Add($dataItem)
[void]$menu.Items.Add($logItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($startItem)
[void]$menu.Items.Add($stopItem)
[void]$menu.Items.Add($restartItem)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($startupItem)
[void]$menu.Items.Add($exitItem)
$notify.ContextMenuStrip = $menu

function Show-Balloon {
    param(
        [string]$Title,
        [string]$Text,
        [System.Windows.Forms.ToolTipIcon]$Icon = [System.Windows.Forms.ToolTipIcon]::Info
    )
    try {
        $notify.BalloonTipTitle = $Title
        $notify.BalloonTipText = $Text
        $notify.BalloonTipIcon = $Icon
        $notify.ShowBalloonTip(4000)
    } catch {
        Write-TrayLog "balloon failed: $($_.Exception.Message)"
    }
}

function Test-IndexHealth {
    $request = $null
    $response = $null
    $stream = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:$port/api/health")
        $request.Proxy = $null
        $request.Timeout = 1500
        $request.ReadWriteTimeout = 1500
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $text = $reader.ReadToEnd()
        return $text -like '*"ok":true*'
    } catch {
        return $false
    } finally {
        if ($reader) { $reader.Dispose() }
        if ($stream) { $stream.Dispose() }
        if ($response) { $response.Dispose() }
    }
}

function Update-Tray {
    $processAlive = [bool]($script:server -and (-not $script:server.HasExited))
    $running = $processAlive -and $script:lastHealthy
    if ($running -and $script:iconRunning) {
        $notify.Icon = $script:iconRunning
        $notify.Text = "Index 运行中 · 127.0.0.1:$port"
    } else {
        if ($script:iconStopped) { $notify.Icon = $script:iconStopped }
        $notify.Text = if ($processAlive) { 'Index 启动中 / 无响应' } else { 'Index 已停止' }
    }
    $startItem.Enabled = -not $processAlive
    $stopItem.Enabled = $processAlive
    $restartItem.Enabled = $processAlive
}

function Ensure-Build {
    if (Test-Path -LiteralPath (Join-Path $root 'dist\server.js')) { return $true }
    $setupLog = Join-Path $logDir 'setup.log'
    Show-Balloon 'Index 准备中' '首次启动，正在安装依赖并构建，请稍候…'
    Write-TrayLog 'building missing dist'

    if (-not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
        & $npm install --registry=https://registry.npmmirror.com --no-audit --no-fund *>> $setupLog
        if ($LASTEXITCODE -ne 0) {
            Write-TrayLog "npm install failed: $LASTEXITCODE"
            Show-Balloon 'Index 安装失败' "查看日志：$setupLog" ([System.Windows.Forms.ToolTipIcon]::Error)
            return $false
        }
    }

    & $npm run build *>> $setupLog
    if ($LASTEXITCODE -ne 0) {
        Write-TrayLog "npm run build failed: $LASTEXITCODE"
        Show-Balloon 'Index 构建失败' "查看日志：$setupLog" ([System.Windows.Forms.ToolTipIcon]::Error)
        return $false
    }
    return (Test-Path -LiteralPath (Join-Path $root 'dist\server.js'))
}

function Start-IndexServer {
    if ($script:server -and -not $script:server.HasExited) { return $true }
    if (-not $node) {
        Show-Balloon 'Index 无法启动' '没有找到 node.exe，请安装 Node.js 24' ([System.Windows.Forms.ToolTipIcon]::Error)
        return $false
    }
    if (-not (Ensure-Build)) { return $false }
    Write-TrayLog 'starting server'

    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $script:stdout = Join-Path $logDir "server-$stamp.out.log"
    $script:stderr = Join-Path $logDir "server-$stamp.err.log"
    try {
        $script:server = Start-Process -FilePath $node `
            -ArgumentList @('--disable-warning=ExperimentalWarning', 'dist/server.js') `
            -WorkingDirectory $root `
            -WindowStyle Hidden `
            -PassThru `
            -RedirectStandardOutput $script:stdout `
            -RedirectStandardError $script:stderr
    } catch {
        Write-TrayLog "start failed: $($_.Exception.Message)"
        Show-Balloon 'Index 启动失败' $_.Exception.Message ([System.Windows.Forms.ToolTipIcon]::Error)
        return $false
    }

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if ($script:server.HasExited) { break }
        if (Test-IndexHealth) {
            $script:lastHealthy = $true
            $script:lastStartAt = Get-Date
            Update-Tray
            Write-TrayLog "server started on port $port"
            Show-Balloon 'Index 已启动' "双击托盘图标打开 http://127.0.0.1:$port"
            return $true
        }
    }

    $script:lastHealthy = $false
    Update-Tray
    $detail = if ($script:server.HasExited) {
        "进程已退出，查看日志：$script:stderr"
    } else {
        "健康检查超时，查看日志：$script:stderr"
    }
    Write-TrayLog "server start failed: $detail"
    Show-Balloon 'Index 启动失败' $detail ([System.Windows.Forms.ToolTipIcon]::Error)
    return $false
}

function Stop-IndexServer {
    $script:stopping = $true
    try {
        if ($script:server -and -not $script:server.HasExited) {
            Stop-Process -Id $script:server.Id -Force -ErrorAction SilentlyContinue
            $script:server.WaitForExit(3000) | Out-Null
        }
    } catch {
        Write-TrayLog "stop failed: $($_.Exception.Message)"
    } finally {
        $script:server = $null
        $script:stopping = $false
        $script:lastHealthy = $false
        Update-Tray
        Write-TrayLog 'server stopped'
    }
}

function Restart-IndexServer {
    Stop-IndexServer
    $script:restartCount = 0
    $script:lastStartAt = $null
    [void](Start-IndexServer)
}

function Exit-Tray {
    if ($script:exited) { return }
    $script:exited = $true
    $script:stopping = $true
    Stop-IndexServer
    if ($script:timer) { $script:timer.Stop() }
    $notify.Visible = $false
    $notify.Dispose()
    if ($script:iconRunning) { $script:iconRunning.Dispose() }
    if ($script:iconStopped) { $script:iconStopped.Dispose() }
    $menu.Dispose()
    try { $mutex.ReleaseMutex() } catch {}
    [System.Windows.Forms.Application]::Exit()
}

function Open-Index {
    if (-not ($script:server -and -not $script:server.HasExited -and $script:lastHealthy)) {
        if (-not (Start-IndexServer)) { return }
    }
    Start-Process "http://127.0.0.1:$port"
}

function Test-StartupShortcut {
    $startup = [Environment]::GetFolderPath('Startup')
    return Test-Path -LiteralPath (Join-Path $startup 'Index.lnk')
}

function Set-StartupShortcut {
    param([bool]$Enabled)
    $startup = [Environment]::GetFolderPath('Startup')
    $shortcutPath = Join-Path $startup 'Index.lnk'
    try {
        if ($Enabled) {
            $shell = New-Object -ComObject WScript.Shell
            $shortcut = $shell.CreateShortcut($shortcutPath)
            $shortcut.TargetPath = 'wscript.exe'
            $shortcut.Arguments = '"' + (Join-Path $root 'Index.vbs') + '"'
            $shortcut.WorkingDirectory = $root
            $shortcut.IconLocation = $iconRunningPath
            $shortcut.Description = 'Index 本地服务'
            $shortcut.Save()
            Show-Balloon '开机启动' '已添加到登录启动'
        } else {
            if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
            Show-Balloon '开机启动' '已取消登录启动'
        }
    } catch {
        Write-TrayLog "startup shortcut failed: $($_.Exception.Message)"
        Show-Balloon '开机启动设置失败' $_.Exception.Message ([System.Windows.Forms.ToolTipIcon]::Error)
    }
}

$openItem.Add_Click({ Open-Index })
$dataItem.Add_Click({ Start-Process explorer.exe $dataDir })
$logItem.Add_Click({ Start-Process explorer.exe $logDir })
$startItem.Add_Click({
    $script:restartCount = 0
    $script:lastStartAt = $null
    [void](Start-IndexServer)
})
$stopItem.Add_Click({ Stop-IndexServer })
$restartItem.Add_Click({ Restart-IndexServer })
$startupItem.Add_Click({ Set-StartupShortcut -Enabled (-not (Test-StartupShortcut)) })
$exitItem.Add_Click({ Exit-Tray })
$notify.Add_DoubleClick({ Open-Index })
$menu.Add_Opening({
    $startupItem.Checked = Test-StartupShortcut
    $running = $script:server -and (-not $script:server.HasExited) -and $script:lastHealthy
    $startItem.Enabled = -not $running
    $stopItem.Enabled = [bool]$running
    $restartItem.Enabled = [bool]$running
})

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 4000
$script:timer.Add_Tick({
    if (Test-Path -LiteralPath $exitFile) {
        Remove-Item -LiteralPath $exitFile -Force -ErrorAction SilentlyContinue
        Exit-Tray
        return
    }
    if ($script:server -and $script:server.HasExited -and -not $script:stopping) {
        $healthyForAWhile = $script:lastStartAt -and
            (((Get-Date) - $script:lastStartAt).TotalSeconds -gt 60)
        if ($healthyForAWhile) { $script:restartCount = 0 }
        $script:lastHealthy = $false
        Update-Tray
        if ($script:restartCount -lt 3) {
            $script:restartCount += 1
            Show-Balloon 'Index 服务已退出' "正在自动重启（$($script:restartCount)/3）" ([System.Windows.Forms.ToolTipIcon]::Warning)
            [void](Start-IndexServer)
        } else {
            $script:server = $null
            Show-Balloon 'Index 已停止' '自动重启失败，请查看日志或右键启动服务' ([System.Windows.Forms.ToolTipIcon]::Error)
            Update-Tray
        }
        return
    }
    if ($script:server -and -not $script:server.HasExited) {
        $script:lastHealthy = Test-IndexHealth
        Update-Tray
    }
})

$notify.Visible = $true
Update-Tray
$script:timer.Start()
Write-TrayLog "tray started (root=$root, port=$port)"
[void](Start-IndexServer)

try {
    [System.Windows.Forms.Application]::Run()
} finally {
    if (-not $script:exited) {
        $script:exited = $true
        $script:timer.Stop()
        $notify.Visible = $false
        $notify.Dispose()
        if ($script:iconRunning) { $script:iconRunning.Dispose() }
        if ($script:iconStopped) { $script:iconStopped.Dispose() }
        $menu.Dispose()
        try { $mutex.ReleaseMutex() } catch {}
    }
}
