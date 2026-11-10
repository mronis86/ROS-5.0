# ROS Green Room display client — portable (no install)
# Standby heartbeat → kiosk Status can Start / Standby this PC.
# Double-click: "Start Green Room Client.bat"

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root 'config.json'
$ExamplePath = Join-Path $Root 'config.example.json'

function Write-Log {
  param([Parameter(ValueFromRemainingArguments = $true)] $Msg)
  Write-Host ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffZ'), ($Msg -join ' '))
}

function Read-Config {
  $file = @{}
  if (Test-Path -LiteralPath $ConfigPath) {
    $file = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
  }

  $hostname = $env:COMPUTERNAME
  $safeHost = ($hostname -replace '[^a-zA-Z0-9_-]+', '-').ToLowerInvariant()

  $apiUrl = if ($env:ROS_API_URL) { $env:ROS_API_URL } elseif ($file.apiUrl) { $file.apiUrl } else { 'https://ros-50-production.up.railway.app' }
  $appUrl = if ($env:ROS_APP_URL) { $env:ROS_APP_URL } elseif ($file.appUrl) { $file.appUrl } else { $apiUrl }
  $token = if ($env:ROS_API_TOKEN) { $env:ROS_API_TOKEN } elseif ($file.token) { $file.token } else { '' }
  $clientId = if ($env:CLIENT_ID) { $env:CLIENT_ID } elseif ($file.clientId) { $file.clientId } else { "gr-$safeHost" }
  $name = if ($env:CLIENT_NAME) { $env:CLIENT_NAME } elseif ($file.name) { $file.name } else { "Green Room · $hostname" }
  $heartbeatMs = 20000
  if ($env:HEARTBEAT_MS) { $heartbeatMs = [int]$env:HEARTBEAT_MS }
  elseif ($file.heartbeatMs) { $heartbeatMs = [int]$file.heartbeatMs }
  if ($heartbeatMs -lt 5000) { $heartbeatMs = 5000 }

  $openBrowser = $true
  if ($env:OPEN_BROWSER -eq '0') { $openBrowser = $false }
  elseif ($null -ne $file.openBrowser) { $openBrowser = [bool]$file.openBrowser }

  return [pscustomobject]@{
    apiUrl       = $apiUrl.TrimEnd('/')
    appUrl       = $appUrl.TrimEnd('/')
    token        = "$token".Trim()
    clientId     = "$clientId".Trim()
    name         = "$name".Trim()
    heartbeatMs  = $heartbeatMs
    openBrowser  = $openBrowser
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
  ($obj | ConvertTo-Json) | Set-Content -LiteralPath $ConfigPath -Encoding UTF8
}

function Ensure-Config {
  $cfg = Read-Config
  if ($cfg.token -and $cfg.token -notmatch 'REPLACE') { return $cfg }

  Write-Host ''
  Write-Host 'ROS Green Room Client — first-run setup' -ForegroundColor Cyan
  Write-Host 'Paste the same Integration token the Offline Kiosk uses (ros_itok_…).'
  Write-Host ''

  if (-not (Test-Path -LiteralPath $ConfigPath) -and (Test-Path -LiteralPath $ExamplePath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $ConfigPath -Force
  }

  $token = Read-Host 'Integration token'
  $token = "$token".Trim()
  if (-not $token) {
    Write-Host 'No token entered. Exiting.' -ForegroundColor Red
    exit 1
  }

  $defaultName = $cfg.name
  $nameIn = Read-Host "Display name [$defaultName]"
  if ("$nameIn".Trim()) { $cfg.name = "$nameIn".Trim() }
  $cfg.token = $token
  Save-Config $cfg
  Write-Host "Saved $ConfigPath" -ForegroundColor Green
  return Read-Config
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
}

function Apply-Command {
  param($Cfg, $Command)
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
        Write-Log 'warn: could not open browser — client still marked active'
      }
    }
    $script:State.status = 'active'
    $script:State.lastError = ''
    Write-Log 'active →' $url
  } elseif ($action -eq 'stop') {
    $script:State.status = 'standby'
    $script:State.lastError = ''
    Write-Log 'back to standby (close the Green Room tab manually for now)'
  } else {
    $script:State.lastError = "Unknown action: $action"
  }
  $script:State.lastCommandId = $Command.id
}

function Send-Heartbeat {
  param($Cfg)
  $body = @{
    clientId       = $Cfg.clientId
    name           = $Cfg.name
    hostname       = $env:COMPUTERNAME
    kind           = 'green-room'
    status         = $script:State.status
    eventId        = $script:State.eventId
    lastCommandId  = $script:State.lastCommandId
    lastError      = $script:State.lastError
  }
  $data = Invoke-RosApi -Cfg $Cfg -Method 'POST' -UrlPath '/api/display-clients/heartbeat' -Body $body
  $queued = $null
  if ($data.client -and $data.client.queuedCommand) { $queued = $data.client.queuedCommand }
  if ($queued -and $queued.id -and "$($queued.id)" -ne "$($script:State.lastCommandId)") {
    Apply-Command -Cfg $Cfg -Command $queued
    $body.status = $script:State.status
    $body.eventId = $script:State.eventId
    $body.lastCommandId = $script:State.lastCommandId
    $body.lastError = $script:State.lastError
    $null = Invoke-RosApi -Cfg $Cfg -Method 'POST' -UrlPath '/api/display-clients/heartbeat' -Body $body
  }
  return $data.client
}

$cfg = Ensure-Config
Write-Log 'Green Room client starting (portable / no install)'
Write-Log '  api     ' $cfg.apiUrl
Write-Log '  clientId' $cfg.clientId
Write-Log '  name    ' $cfg.name
Write-Log '  every   ' ("{0}ms" -f $cfg.heartbeatMs)
Write-Log 'Standby — waiting for kiosk Start / Standby…'
Write-Host 'Leave this window open. Close it to go offline.' -ForegroundColor DarkGray
Write-Host ''

while ($true) {
  try {
    $client = Send-Heartbeat -Cfg $cfg
    $line = "ok · $($client.status)"
    if (-not $client.status) { $line = "ok · $($script:State.status)" }
    if ($client.eventId) { $line += " · event $($client.eventId)" }
    if ($client.queuedCommand) { $line += ' · cmd pending' }
    Write-Log $line
  } catch {
    Write-Log 'heartbeat failed:' $_.Exception.Message
  }
  Start-Sleep -Milliseconds $cfg.heartbeatMs
}
