# ROS Green Room Client - portable tray app (ASCII only; Windows PowerShell 5.1 safe)
# Double-click: "Start Green Room Client.bat"
# Sits in the system tray (by the clock). Right-click for status / exit.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root 'config.json'
$ExamplePath = Join-Path $Root 'config.example.json'
$LogPath = Join-Path $Root 'green-room-client.log'
$IconPath = Join-Path $Root 'app.ico'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function Write-Log {
  param([Parameter(ValueFromRemainingArguments = $true)] $Msg)
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), ($Msg -join ' ')
  try { Add-Content -LiteralPath $LogPath -Value $line -Encoding ASCII -ErrorAction SilentlyContinue } catch {}
}

function Read-Config {
  $file = $null
  if (Test-Path -LiteralPath $ConfigPath) {
    $file = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }

  $hostname = $env:COMPUTERNAME
  $safeHost = ($hostname -replace '[^a-zA-Z0-9_-]+', '-').ToLowerInvariant()

  $apiUrl = if ($env:ROS_API_URL) { $env:ROS_API_URL } elseif ($file -and $file.apiUrl) { $file.apiUrl } else { 'https://ros-50-production.up.railway.app' }
  $appUrl = if ($env:ROS_APP_URL) { $env:ROS_APP_URL } elseif ($file -and $file.appUrl) { $file.appUrl } else { $apiUrl }
  $token = if ($env:ROS_API_TOKEN) { $env:ROS_API_TOKEN } elseif ($file -and $file.token) { $file.token } else { '' }
  $clientId = if ($env:CLIENT_ID) { $env:CLIENT_ID } elseif ($file -and $file.clientId) { $file.clientId } else { "gr-$safeHost" }
  $name = if ($env:CLIENT_NAME) { $env:CLIENT_NAME } elseif ($file -and $file.name) { $file.name } else { "Green Room - $hostname" }
  $heartbeatMs = 20000
  if ($env:HEARTBEAT_MS) { $heartbeatMs = [int]$env:HEARTBEAT_MS }
  elseif ($file -and $file.heartbeatMs) { $heartbeatMs = [int]$file.heartbeatMs }
  if ($heartbeatMs -lt 5000) { $heartbeatMs = 5000 }

  $openBrowser = $true
  if ($env:OPEN_BROWSER -eq '0') { $openBrowser = $false }
  elseif ($file -and $null -ne $file.openBrowser) { $openBrowser = [bool]$file.openBrowser }

  return [pscustomobject]@{
    apiUrl      = ("$apiUrl").TrimEnd('/')
    appUrl      = ("$appUrl").TrimEnd('/')
    token       = ("$token").Trim()
    clientId    = ("$clientId").Trim()
    name        = ("$name").Trim()
    heartbeatMs = $heartbeatMs
    openBrowser = $openBrowser
  }
}

function Save-Config {
  param($Cfg)
  $obj = [ordered]@{
    apiUrl      = $Cfg.apiUrl
    appUrl      = $Cfg.appUrl
    token       = $Cfg.token
    clientId    = $Cfg.clientId
    name        = $Cfg.name
    heartbeatMs = $Cfg.heartbeatMs
    openBrowser = $Cfg.openBrowser
  }
  $json = $obj | ConvertTo-Json
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ConfigPath, $json, $utf8)
}

function Ensure-AppIcon {
  if (Test-Path -LiteralPath $IconPath) {
    try { return New-Object System.Drawing.Icon($IconPath) } catch {}
  }
  $bmp = New-Object System.Drawing.Bitmap 32, 32
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::FromArgb(0, 0, 0, 0))
  $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 16, 185, 129))
  $g.FillEllipse($brush, 2, 2, 28, 28)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White, 2.5)
  $g.DrawEllipse($pen, 8, 8, 16, 16)
  $g.Dispose()
  $brush.Dispose()
  $pen.Dispose()
  $iconHandle = $bmp.GetHicon()
  $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
  try {
    $fs = [System.IO.File]::Open($IconPath, [System.IO.FileMode]::Create)
    $icon.Save($fs)
    $fs.Close()
  } catch {}
  $bmp.Dispose()
  if (Test-Path -LiteralPath $IconPath) {
    try { return New-Object System.Drawing.Icon($IconPath) } catch {}
  }
  return [System.Drawing.SystemIcons]::Application
}

function Show-SetupForm {
  param($Cfg)

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'ROS Green Room Client - Setup'
  $form.Size = New-Object System.Drawing.Size(480, 260)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true

  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = "Paste the same Integration token the Offline Kiosk uses (ros_itok_...)."
  $lbl.Location = New-Object System.Drawing.Point(16, 16)
  $lbl.Size = New-Object System.Drawing.Size(430, 36)

  $tokenBox = New-Object System.Windows.Forms.TextBox
  $tokenBox.Location = New-Object System.Drawing.Point(16, 56)
  $tokenBox.Size = New-Object System.Drawing.Size(430, 24)
  $tokenBox.UseSystemPasswordChar = $true
  if ($Cfg.token -and $Cfg.token -notmatch 'REPLACE') { $tokenBox.Text = $Cfg.token }

  $nameLbl = New-Object System.Windows.Forms.Label
  $nameLbl.Text = 'Display name'
  $nameLbl.Location = New-Object System.Drawing.Point(16, 96)
  $nameLbl.Size = New-Object System.Drawing.Size(430, 20)

  $nameBox = New-Object System.Windows.Forms.TextBox
  $nameBox.Location = New-Object System.Drawing.Point(16, 118)
  $nameBox.Size = New-Object System.Drawing.Size(430, 24)
  $nameBox.Text = $Cfg.name

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Save and start'
  $ok.Location = New-Object System.Drawing.Point(250, 170)
  $ok.Size = New-Object System.Drawing.Size(120, 32)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'
  $cancel.Location = New-Object System.Drawing.Point(376, 170)
  $cancel.Size = New-Object System.Drawing.Size(70, 32)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.Controls.AddRange(@($lbl, $tokenBox, $nameLbl, $nameBox, $ok, $cancel))
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel

  $result = $form.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    $form.Dispose()
    return $null
  }
  $token = ("$($tokenBox.Text)").Trim()
  $name = ("$($nameBox.Text)").Trim()
  $form.Dispose()
  if (-not $token) { return $null }
  $Cfg.token = $token
  if ($name) { $Cfg.name = $name }
  if (-not (Test-Path -LiteralPath $ConfigPath) -and (Test-Path -LiteralPath $ExamplePath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $ConfigPath -Force
  }
  Save-Config $Cfg
  return Read-Config
}

function Ensure-Config {
  $cfg = Read-Config
  if ($cfg.token -and $cfg.token -notmatch 'REPLACE') { return $cfg }
  return Show-SetupForm -Cfg $cfg
}

function Invoke-RosApi {
  param($Cfg, [string]$Method, [string]$UrlPath, $Body = $null)
  $uri = "$($Cfg.apiUrl)$UrlPath"
  $headers = @{
    Accept        = 'application/json'
    Authorization = "Bearer $($Cfg.token)"
  }
  $params = @{
    Method  = $Method
    Uri     = $uri
    Headers = $headers
  }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 6)
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $msg = $_.Exception.Message
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      try {
        $errObj = $_.ErrorDetails.Message | ConvertFrom-Json
        if ($errObj.error) { $msg = $errObj.error }
      } catch {
        $msg = $_.ErrorDetails.Message
      }
    }
    throw [Exception]::new($msg)
  }
}

function Open-Url {
  param([string]$Url)
  try {
    Start-Process $Url | Out-Null
    return $true
  } catch {
    return $false
  }
}

$script:State = @{
  status        = 'standby'
  eventId       = ''
  lastCommandId = $null
  lastError     = ''
  openedUrl     = ''
  lastOk        = $false
  lastMessage   = 'Starting...'
}

function Apply-Command {
  param($Cfg, $Command, $Notify)
  if (-not $Command -or -not $Command.id) { return }
  $action = ("$($Command.action)").ToLowerInvariant()
  $eventId = ("$($Command.eventId)").Trim()
  Write-Log 'command' $action $(if ($eventId) { $eventId } else { '(no event)' }) $Command.id

  if ($action -eq 'assign') {
    $script:State.eventId = $eventId
    $script:State.status = 'standby'
    $script:State.lastError = ''
  } elseif ($action -eq 'start') {
    $script:State.eventId = $eventId
    $url = if ($Command.url) { "$($Command.url)" } else {
      $u = [UriBuilder]::new("$($Cfg.appUrl)/green-room")
      $u.Query = "eventId=$([Uri]::EscapeDataString($eventId))"
      $u.Uri.AbsoluteUri
    }
    $script:State.openedUrl = $url
    if ($Cfg.openBrowser) {
      if (-not (Open-Url $url)) {
        Write-Log 'warn: could not open browser - client still marked active'
      }
    }
    $script:State.status = 'active'
    $script:State.lastError = ''
    Write-Log 'active ->' $url
    if ($Notify) {
      $Notify.ShowBalloonTip(4000, 'Green Room started', "Opened event $eventId", [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } elseif ($action -eq 'stop') {
    $script:State.status = 'standby'
    $script:State.lastError = ''
    Write-Log 'back to standby (close the Green Room tab manually for now)'
    if ($Notify) {
      $Notify.ShowBalloonTip(3000, 'Green Room standby', 'Waiting for the next Start from the kiosk.', [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } else {
    $script:State.lastError = "Unknown action: $action"
  }
  $script:State.lastCommandId = $Command.id
}

function Send-Heartbeat {
  param($Cfg, $Notify)
  $body = @{
    clientId      = $Cfg.clientId
    name          = $Cfg.name
    hostname      = $env:COMPUTERNAME
    kind          = 'green-room'
    status        = $script:State.status
    eventId       = $script:State.eventId
    lastCommandId = $script:State.lastCommandId
    lastError     = $script:State.lastError
  }
  $data = Invoke-RosApi -Cfg $Cfg -Method 'POST' -UrlPath '/api/display-clients/heartbeat' -Body $body
  $queued = $null
  if ($data.client -and $data.client.queuedCommand) { $queued = $data.client.queuedCommand }
  if ($queued -and $queued.id -and "$($queued.id)" -ne "$($script:State.lastCommandId)") {
    Apply-Command -Cfg $Cfg -Command $queued -Notify $Notify
    $body.status = $script:State.status
    $body.eventId = $script:State.eventId
    $body.lastCommandId = $script:State.lastCommandId
    $body.lastError = $script:State.lastError
    $null = Invoke-RosApi -Cfg $Cfg -Method 'POST' -UrlPath '/api/display-clients/heartbeat' -Body $body
  }
  return $data.client
}

function Update-TrayText {
  param($Notify, $Cfg)
  $status = $script:State.status
  $tip = "ROS Green Room`n$($Cfg.name)`n$status"
  if ($script:State.eventId) { $tip += "`nevent $($script:State.eventId)" }
  if (-not $script:State.lastOk) { $tip += "`n$($script:State.lastMessage)" }
  if ($tip.Length -gt 60) { $tip = $tip.Substring(0, 57) + '...' }
  $Notify.Text = $tip
}

# --- main ---
$cfg = Ensure-Config
if (-not $cfg) {
  Write-Log 'Setup cancelled.'
  exit 1
}

Write-Log 'Green Room client starting (tray)'
Write-Log '  api     ' $cfg.apiUrl
Write-Log '  clientId' $cfg.clientId
Write-Log '  name    ' $cfg.name
Write-Log '  every   ' ("{0}ms" -f $cfg.heartbeatMs)

$icon = Ensure-AppIcon
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Visible = $true
$notify.Text = 'ROS Green Room'

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemStatus = New-Object System.Windows.Forms.ToolStripMenuItem
$itemStatus.Text = 'Status: starting...'
$itemStatus.Enabled = $false

$itemOpenLog = New-Object System.Windows.Forms.ToolStripMenuItem
$itemOpenLog.Text = 'Open log'
$itemOpenLog.Add_Click({
  if (Test-Path -LiteralPath $LogPath) { Start-Process notepad.exe $LogPath }
})

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem
$itemExit.Text = 'Exit'
$itemExit.Add_Click({
  $script:ShouldExit = $true
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

[void]$menu.Items.Add($itemStatus)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemOpenLog)
[void]$menu.Items.Add($itemExit)
$notify.ContextMenuStrip = $menu

$script:ShouldExit = $false
$script:Cfg = $cfg

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = [Math]::Max(5000, [int]$cfg.heartbeatMs)
$timer.Add_Tick({
  try {
    $client = Send-Heartbeat -Cfg $script:Cfg -Notify $notify
    $status = if ($client.status) { "$($client.status)" } else { $script:State.status }
    $script:State.lastOk = $true
    $script:State.lastMessage = "ok - $status"
    if ($client.eventId) { $script:State.lastMessage += " - event $($client.eventId)" }
    Write-Log $script:State.lastMessage
    $itemStatus.Text = "Status: $($script:State.lastMessage)"
    Update-TrayText -Notify $notify -Cfg $script:Cfg
  } catch {
    $script:State.lastOk = $false
    $script:State.lastMessage = $_.Exception.Message
    Write-Log 'heartbeat failed:' $script:State.lastMessage
    $itemStatus.Text = "Status: error - $($script:State.lastMessage)"
    Update-TrayText -Notify $notify -Cfg $script:Cfg
  }
})

$notify.ShowBalloonTip(
  4000,
  'ROS Green Room Client',
  "Standby as $($cfg.name). Right-click the tray icon to exit.",
  [System.Windows.Forms.ToolTipIcon]::Info
)

# Immediate first heartbeat, then timer.
try {
  $null = Send-Heartbeat -Cfg $script:Cfg -Notify $notify
  $script:State.lastOk = $true
  $script:State.lastMessage = "ok - $($script:State.status)"
  $itemStatus.Text = "Status: $($script:State.lastMessage)"
  Update-TrayText -Notify $notify -Cfg $script:Cfg
  Write-Log $script:State.lastMessage
} catch {
  $script:State.lastOk = $false
  $script:State.lastMessage = $_.Exception.Message
  $itemStatus.Text = "Status: error - $($script:State.lastMessage)"
  Write-Log 'heartbeat failed:' $script:State.lastMessage
}

$timer.Start()
[System.Windows.Forms.Application]::Run()
