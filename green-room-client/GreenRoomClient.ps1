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
  # Green Room page is on Cloudflare Pages (not the Railway API host).
  $defaultApp = 'https://ros1615.pages.dev'
  $appUrl = if ($env:ROS_APP_URL) { $env:ROS_APP_URL } elseif ($file -and $file.appUrl) { $file.appUrl } else { $defaultApp }
  if ($appUrl -match 'up\.railway\.app') { $appUrl = $defaultApp }
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

  # Nightly sleep window (local time). Default 12:00am-6:00am.
  # Optional sleepSchedule overrides per weekday (mon..sun).
  $sleepEnabled = $true
  if ($env:SLEEP_ENABLED -eq '0') { $sleepEnabled = $false }
  elseif ($file -and $null -ne $file.sleepEnabled) { $sleepEnabled = [bool]$file.sleepEnabled }
  $sleepStartHour = 0
  if ($env:SLEEP_START_HOUR) { $sleepStartHour = [int]$env:SLEEP_START_HOUR }
  elseif ($file -and $null -ne $file.sleepStartHour) { $sleepStartHour = [int]$file.sleepStartHour }
  $sleepEndHour = 6
  if ($env:SLEEP_END_HOUR) { $sleepEndHour = [int]$env:SLEEP_END_HOUR }
  elseif ($file -and $null -ne $file.sleepEndHour) { $sleepEndHour = [int]$file.sleepEndHour }
  if ($sleepStartHour -lt 0) { $sleepStartHour = 0 }
  if ($sleepStartHour -gt 23) { $sleepStartHour = 23 }
  if ($sleepEndHour -lt 0) { $sleepEndHour = 0 }
  if ($sleepEndHour -gt 23) { $sleepEndHour = 23 }

  $sleepSchedule = $null
  if ($file -and $file.sleepSchedule) {
    $sleepSchedule = Normalize-SleepSchedule -Raw $file.sleepSchedule -DefaultStart $sleepStartHour -DefaultEnd $sleepEndHour
  } else {
    $sleepSchedule = New-DefaultSleepSchedule -DefaultStart $sleepStartHour -DefaultEnd $sleepEndHour
  }

  return [pscustomobject]@{
    apiUrl          = ("$apiUrl").TrimEnd('/')
    appUrl          = ("$appUrl").TrimEnd('/')
    token           = ("$token").Trim()
    clientId        = ("$clientId").Trim()
    name            = ("$name").Trim()
    heartbeatMs     = $heartbeatMs
    openBrowser     = $openBrowser
    sleepEnabled    = $sleepEnabled
    sleepStartHour  = $sleepStartHour
    sleepEndHour    = $sleepEndHour
    sleepSchedule   = $sleepSchedule
  }
}

function Get-SleepDayKeys {
  return @('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')
}

function New-DefaultSleepSchedule {
  param([int]$DefaultStart = 0, [int]$DefaultEnd = 6)
  $sched = [ordered]@{}
  foreach ($k in (Get-SleepDayKeys)) {
    $sched[$k] = [ordered]@{ mode = 'window'; startHour = $DefaultStart; endHour = $DefaultEnd }
  }
  return $sched
}

function Normalize-SleepDayRule {
  param($Raw, [int]$DefaultStart = 0, [int]$DefaultEnd = 6)
  $mode = 'window'
  $start = $DefaultStart
  $end = $DefaultEnd
  if ($null -eq $Raw) {
    return [ordered]@{ mode = $mode; startHour = $start; endHour = $end }
  }
  if ($Raw -is [string]) {
    $s = $Raw.Trim().ToLowerInvariant()
    if ($s -eq 'all' -or $s -eq 'allday' -or $s -eq '24' -or $s -eq '24h') {
      return [ordered]@{ mode = 'allDay'; startHour = 0; endHour = 0 }
    }
    if ($s -eq 'off' -or $s -eq 'none' -or $s -eq 'awake') {
      return [ordered]@{ mode = 'off'; startHour = 0; endHour = 0 }
    }
    if ($s -eq 'window' -or $s -eq 'default' -or $s -eq 'nightly') {
      return [ordered]@{ mode = 'window'; startHour = $DefaultStart; endHour = $DefaultEnd }
    }
    if ($s -match '^(\d{1,2})\s*[-:]\s*(\d{1,2})$') {
      $start = [Math]::Max(0, [Math]::Min(23, [int]$Matches[1]))
      $end = [Math]::Max(0, [Math]::Min(23, [int]$Matches[2]))
      return [ordered]@{ mode = 'window'; startHour = $start; endHour = $end }
    }
    return [ordered]@{ mode = 'window'; startHour = $DefaultStart; endHour = $DefaultEnd }
  }
  $modeRaw = ''
  if ($null -ne $Raw.mode) { $modeRaw = ("$($Raw.mode)").Trim().ToLowerInvariant() }
  if ($modeRaw -eq 'all' -or $modeRaw -eq 'allday') { $mode = 'allDay' }
  elseif ($modeRaw -eq 'off' -or $modeRaw -eq 'none' -or $modeRaw -eq 'awake') { $mode = 'off' }
  else { $mode = 'window' }
  if ($null -ne $Raw.startHour) { $start = [int]$Raw.startHour }
  if ($null -ne $Raw.endHour) { $end = [int]$Raw.endHour }
  if ($start -lt 0) { $start = 0 }
  if ($start -gt 23) { $start = 23 }
  if ($end -lt 0) { $end = 0 }
  if ($end -gt 23) { $end = 23 }
  if ($mode -eq 'allDay') { return [ordered]@{ mode = 'allDay'; startHour = 0; endHour = 0 } }
  if ($mode -eq 'off') { return [ordered]@{ mode = 'off'; startHour = 0; endHour = 0 } }
  return [ordered]@{ mode = 'window'; startHour = $start; endHour = $end }
}

function Normalize-SleepSchedule {
  param($Raw, [int]$DefaultStart = 0, [int]$DefaultEnd = 6)
  $sched = New-DefaultSleepSchedule -DefaultStart $DefaultStart -DefaultEnd $DefaultEnd
  if (-not $Raw) { return $sched }
  foreach ($k in (Get-SleepDayKeys)) {
    $dayRaw = $null
    if ($Raw.PSObject -and $Raw.PSObject.Properties.Name -contains $k) { $dayRaw = $Raw.$k }
    elseif ($Raw -is [System.Collections.IDictionary] -and $Raw.Contains($k)) { $dayRaw = $Raw[$k] }
    $sched[$k] = Normalize-SleepDayRule -Raw $dayRaw -DefaultStart $DefaultStart -DefaultEnd $DefaultEnd
  }
  return $sched
}

function Get-SleepDayKey {
  param([datetime]$When = $(Get-Date))
  switch ($When.DayOfWeek) {
    'Monday' { return 'mon' }
    'Tuesday' { return 'tue' }
    'Wednesday' { return 'wed' }
    'Thursday' { return 'thu' }
    'Friday' { return 'fri' }
    'Saturday' { return 'sat' }
    default { return 'sun' }
  }
}

function Get-SleepRuleForToday {
  param($Cfg, [datetime]$When = $(Get-Date))
  $key = Get-SleepDayKey -When $When
  $defaultStart = 0
  $defaultEnd = 6
  if ($Cfg -and $null -ne $Cfg.sleepStartHour) { $defaultStart = [int]$Cfg.sleepStartHour }
  if ($Cfg -and $null -ne $Cfg.sleepEndHour) { $defaultEnd = [int]$Cfg.sleepEndHour }
  $raw = $null
  if ($Cfg -and $Cfg.sleepSchedule) {
    if ($Cfg.sleepSchedule.PSObject -and $Cfg.sleepSchedule.PSObject.Properties.Name -contains $key) {
      $raw = $Cfg.sleepSchedule.$key
    } elseif ($Cfg.sleepSchedule -is [System.Collections.IDictionary] -and $Cfg.sleepSchedule.Contains($key)) {
      $raw = $Cfg.sleepSchedule[$key]
    }
  }
  return Normalize-SleepDayRule -Raw $raw -DefaultStart $defaultStart -DefaultEnd $defaultEnd
}

function Format-SleepRuleLabel {
  param($Rule, [string]$DayKey = '')
  if (-not $Rule) { return 'off' }
  $prefix = if ($DayKey) { "$DayKey " } else { '' }
  if ($Rule.mode -eq 'allDay') { return "${prefix}all day" }
  if ($Rule.mode -eq 'off') { return "${prefix}off" }
  return ("{0}{1}:00-{2}:00" -f $prefix, [int]$Rule.startHour, [int]$Rule.endHour)
}

function Save-Config {
  param($Cfg)
  $schedOut = [ordered]@{}
  $normalized = Normalize-SleepSchedule -Raw $Cfg.sleepSchedule -DefaultStart ([int]$Cfg.sleepStartHour) -DefaultEnd ([int]$Cfg.sleepEndHour)
  foreach ($k in (Get-SleepDayKeys)) {
    $r = $normalized[$k]
    if ($r.mode -eq 'allDay') {
      $schedOut[$k] = 'allDay'
    } elseif ($r.mode -eq 'off') {
      $schedOut[$k] = 'off'
    } elseif ([int]$r.startHour -eq [int]$Cfg.sleepStartHour -and [int]$r.endHour -eq [int]$Cfg.sleepEndHour) {
      $schedOut[$k] = 'window'
    } else {
      $schedOut[$k] = [ordered]@{ mode = 'window'; startHour = [int]$r.startHour; endHour = [int]$r.endHour }
    }
  }
  $obj = [ordered]@{
    apiUrl         = $Cfg.apiUrl
    appUrl         = $Cfg.appUrl
    token          = $Cfg.token
    clientId       = $Cfg.clientId
    name           = $Cfg.name
    heartbeatMs    = $Cfg.heartbeatMs
    openBrowser    = $Cfg.openBrowser
    sleepEnabled   = [bool]$Cfg.sleepEnabled
    sleepStartHour = [int]$Cfg.sleepStartHour
    sleepEndHour   = [int]$Cfg.sleepEndHour
    sleepSchedule  = $schedOut
  }
  $json = $obj | ConvertTo-Json -Depth 6
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

function Token-Prefix([string]$Token) {
  if (-not $Token -or $Token.Length -lt 8) { return '(none)' }
  if ($Token.Length -le 12) { return $Token }
  return ($Token.Substring(0, 12) + '...')
}

function Show-SettingsForm {
  param($Cfg, [string]$Title = 'ROS Green Room Client - Settings')

  $form = New-Object System.Windows.Forms.Form
  $form.Text = $Title
  $form.Size = New-Object System.Drawing.Size(540, 620)
  $form.StartPosition = 'CenterScreen'
  $form.FormBorderStyle = 'FixedDialog'
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.TopMost = $true

  $lbl = New-Object System.Windows.Forms.Label
  $lbl.Text = "Integration token (ros_itok_...). Can be its own token - just created by the same Admin as the Offline Kiosk token."
  $lbl.Location = New-Object System.Drawing.Point(16, 12)
  $lbl.Size = New-Object System.Drawing.Size(490, 36)

  $tokenLbl = New-Object System.Windows.Forms.Label
  $tokenLbl.Text = 'Token'
  $tokenLbl.Location = New-Object System.Drawing.Point(16, 50)
  $tokenLbl.Size = New-Object System.Drawing.Size(490, 18)

  $tokenBox = New-Object System.Windows.Forms.TextBox
  $tokenBox.Location = New-Object System.Drawing.Point(16, 70)
  $tokenBox.Size = New-Object System.Drawing.Size(490, 24)
  $tokenBox.UseSystemPasswordChar = $true
  if ($Cfg.token -and $Cfg.token -notmatch 'REPLACE') { $tokenBox.Text = $Cfg.token }

  $nameLbl = New-Object System.Windows.Forms.Label
  $nameLbl.Text = 'Display name'
  $nameLbl.Location = New-Object System.Drawing.Point(16, 100)
  $nameLbl.Size = New-Object System.Drawing.Size(490, 18)

  $nameBox = New-Object System.Windows.Forms.TextBox
  $nameBox.Location = New-Object System.Drawing.Point(16, 120)
  $nameBox.Size = New-Object System.Drawing.Size(490, 24)
  $nameBox.Text = $Cfg.name

  $idLbl = New-Object System.Windows.Forms.Label
  $idLbl.Text = 'Client id (stable id for this PC)'
  $idLbl.Location = New-Object System.Drawing.Point(16, 150)
  $idLbl.Size = New-Object System.Drawing.Size(490, 18)

  $idBox = New-Object System.Windows.Forms.TextBox
  $idBox.Location = New-Object System.Drawing.Point(16, 170)
  $idBox.Size = New-Object System.Drawing.Size(490, 24)
  $idBox.Text = $Cfg.clientId

  $apiLbl = New-Object System.Windows.Forms.Label
  $apiLbl.Text = 'API URL'
  $apiLbl.Location = New-Object System.Drawing.Point(16, 200)
  $apiLbl.Size = New-Object System.Drawing.Size(490, 18)

  $apiBox = New-Object System.Windows.Forms.TextBox
  $apiBox.Location = New-Object System.Drawing.Point(16, 220)
  $apiBox.Size = New-Object System.Drawing.Size(490, 24)
  $apiBox.Text = $Cfg.apiUrl

  $sleepChk = New-Object System.Windows.Forms.CheckBox
  $sleepChk.Text = 'Enable sleep mode'
  $sleepChk.Location = New-Object System.Drawing.Point(16, 256)
  $sleepChk.Size = New-Object System.Drawing.Size(200, 22)
  $sleepChk.Checked = [bool]$Cfg.sleepEnabled

  $winLbl = New-Object System.Windows.Forms.Label
  $winLbl.Text = 'Default window (hours, local)'
  $winLbl.Location = New-Object System.Drawing.Point(220, 258)
  $winLbl.Size = New-Object System.Drawing.Size(160, 20)

  $startNum = New-Object System.Windows.Forms.NumericUpDown
  $startNum.Location = New-Object System.Drawing.Point(384, 254)
  $startNum.Size = New-Object System.Drawing.Size(48, 24)
  $startNum.Minimum = 0
  $startNum.Maximum = 23
  $startNum.Value = [Math]::Max(0, [Math]::Min(23, [int]$Cfg.sleepStartHour))

  $toLbl = New-Object System.Windows.Forms.Label
  $toLbl.Text = 'to'
  $toLbl.Location = New-Object System.Drawing.Point(434, 258)
  $toLbl.Size = New-Object System.Drawing.Size(24, 20)

  $endNum = New-Object System.Windows.Forms.NumericUpDown
  $endNum.Location = New-Object System.Drawing.Point(458, 254)
  $endNum.Size = New-Object System.Drawing.Size(48, 24)
  $endNum.Minimum = 0
  $endNum.Maximum = 23
  $endNum.Value = [Math]::Max(0, [Math]::Min(23, [int]$Cfg.sleepEndHour))

  $schedLbl = New-Object System.Windows.Forms.Label
  $schedLbl.Text = 'Weekly schedule (Default = window above; All day = sleep 24h; Off = never sleep that day)'
  $schedLbl.Location = New-Object System.Drawing.Point(16, 290)
  $schedLbl.Size = New-Object System.Drawing.Size(490, 32)

  $dayLabels = [ordered]@{
    mon = 'Mon'; tue = 'Tue'; wed = 'Wed'; thu = 'Thu'
    fri = 'Fri'; sat = 'Sat'; sun = 'Sun'
  }
  $modeChoices = @('Default', 'All day', 'Off')
  $dayCombos = @{}
  $row = 0
  $sched = Normalize-SleepSchedule -Raw $Cfg.sleepSchedule -DefaultStart ([int]$Cfg.sleepStartHour) -DefaultEnd ([int]$Cfg.sleepEndHour)
  foreach ($k in (Get-SleepDayKeys)) {
    $y = 326 + ($row * 28)
    $dLbl = New-Object System.Windows.Forms.Label
    $dLbl.Text = $dayLabels[$k]
    $dLbl.Location = New-Object System.Drawing.Point(16, ($y + 2))
    $dLbl.Size = New-Object System.Drawing.Size(40, 20)
    $form.Controls.Add($dLbl)

    $combo = New-Object System.Windows.Forms.ComboBox
    $combo.DropDownStyle = 'DropDownList'
    $combo.Location = New-Object System.Drawing.Point(60, $y)
    $combo.Size = New-Object System.Drawing.Size(120, 24)
    [void]$combo.Items.AddRange($modeChoices)
    $rule = $sched[$k]
    if ($rule.mode -eq 'allDay') { $combo.SelectedIndex = 1 }
    elseif ($rule.mode -eq 'off') { $combo.SelectedIndex = 2 }
    else { $combo.SelectedIndex = 0 }
    $form.Controls.Add($combo)
    $dayCombos[$k] = $combo
    $row++
  }

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Save'
  $ok.Location = New-Object System.Drawing.Point(330, 536)
  $ok.Size = New-Object System.Drawing.Size(90, 32)
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Cancel'
  $cancel.Location = New-Object System.Drawing.Point(430, 536)
  $cancel.Size = New-Object System.Drawing.Size(76, 32)
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel

  $form.Controls.AddRange(@(
      $lbl, $tokenLbl, $tokenBox, $nameLbl, $nameBox, $idLbl, $idBox, $apiLbl, $apiBox,
      $sleepChk, $winLbl, $startNum, $toLbl, $endNum, $schedLbl, $ok, $cancel
    ))
  $form.AcceptButton = $ok
  $form.CancelButton = $cancel

  $result = $form.ShowDialog()
  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    $form.Dispose()
    return $null
  }
  $token = ("$($tokenBox.Text)").Trim()
  $name = ("$($nameBox.Text)").Trim()
  $clientId = ("$($idBox.Text)").Trim()
  $apiUrl = ("$($apiBox.Text)").Trim().TrimEnd('/')
  $sleepEnabled = [bool]$sleepChk.Checked
  $sleepStartHour = [int]$startNum.Value
  $sleepEndHour = [int]$endNum.Value
  $newSched = [ordered]@{}
  foreach ($k in (Get-SleepDayKeys)) {
    $sel = $dayCombos[$k].SelectedItem
    if ($sel -eq 'All day') { $newSched[$k] = 'allDay' }
    elseif ($sel -eq 'Off') { $newSched[$k] = 'off' }
    else { $newSched[$k] = 'window' }
  }
  $form.Dispose()
  if (-not $token) { return $null }
  $Cfg.token = $token
  if ($name) { $Cfg.name = $name }
  if ($clientId) { $Cfg.clientId = $clientId }
  if ($apiUrl) {
    $Cfg.apiUrl = $apiUrl
    if (-not $Cfg.appUrl) { $Cfg.appUrl = $apiUrl }
  }
  $Cfg.sleepEnabled = $sleepEnabled
  $Cfg.sleepStartHour = $sleepStartHour
  $Cfg.sleepEndHour = $sleepEndHour
  $Cfg.sleepSchedule = Normalize-SleepSchedule -Raw $newSched -DefaultStart $sleepStartHour -DefaultEnd $sleepEndHour
  if (-not (Test-Path -LiteralPath $ConfigPath) -and (Test-Path -LiteralPath $ExamplePath)) {
    Copy-Item -LiteralPath $ExamplePath -Destination $ConfigPath -Force
  }
  Save-Config $Cfg
  return Read-Config
}

function Ensure-Config {
  $cfg = Read-Config
  if ($cfg.token -and $cfg.token -notmatch 'REPLACE') { return $cfg }
  return Show-SettingsForm -Cfg $cfg -Title 'ROS Green Room Client - Setup'
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

function Get-ClientDisplays {
  $list = @()
  try {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $i = 0
    foreach ($s in $screens) {
      $b = $s.Bounds
      $list += [pscustomobject]@{
        index      = $i
        primary    = [bool]$s.Primary
        deviceName = "$($s.DeviceName)"
        label      = if ($s.Primary) { "Display $($i + 1) (primary)" } else { "Display $($i + 1)" }
        x          = [int]$b.X
        y          = [int]$b.Y
        width      = [int]$b.Width
        height     = [int]$b.Height
      }
      $i++
    }
  } catch {
    $list = @([pscustomobject]@{
        index = 0; primary = $true; deviceName = 'primary'; label = 'Primary display'
        x = 0; y = 0; width = 1920; height = 1080
      })
  }
  return $list
}

function Find-BrowserExe {
  $candidates = @(
    "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles(x86)\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Stop-BrowserSession {
  if ($script:State.browserPid) {
    try {
      Stop-Process -Id ([int]$script:State.browserPid) -Force -ErrorAction SilentlyContinue
    } catch {}
  }
  $script:State.browserPid = $null
}

function Ensure-FocusApi {
  if ($script:FocusApiReady) { return }
  try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RosGrFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public const int SW_RESTORE = 9;
  public const int SW_SHOW = 5;
}
"@ -ErrorAction SilentlyContinue
  } catch {}
  $script:FocusApiReady = $true
}

function Focus-ProcessWindow {
  param([int]$ProcessId, [int]$Tries = 12)
  if ($ProcessId -le 0) { return $false }
  Ensure-FocusApi
  if (-not ([System.Management.Automation.PSTypeName]'RosGrFocus').Type) { return $false }
  for ($i = 0; $i -lt $Tries; $i++) {
    Start-Sleep -Milliseconds 400
    try {
      $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
      if (-not $proc) { continue }
      $hwnd = $proc.MainWindowHandle
      if (-not $hwnd -or [int64]$hwnd -eq 0) {
        # Chromium often spawns a launcher then a child with the real window.
        $child = Get-CimInstance Win32_Process -Filter ("ParentProcessId = {0}" -f $ProcessId) -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -match 'msedge|chrome' } |
          Select-Object -First 1
        if ($child) {
          $proc = Get-Process -Id ([int]$child.ProcessId) -ErrorAction SilentlyContinue
          if ($proc) {
            $script:State.browserPid = $proc.Id
            $hwnd = $proc.MainWindowHandle
          }
        }
      }
      if (-not $hwnd -or [int64]$hwnd -eq 0) { continue }
      if ([RosGrFocus]::IsIconic($hwnd)) { [void][RosGrFocus]::ShowWindow($hwnd, [RosGrFocus]::SW_RESTORE) }
      else { [void][RosGrFocus]::ShowWindow($hwnd, [RosGrFocus]::SW_SHOW) }
      [void][RosGrFocus]::BringWindowToTop($hwnd)
      $fg = [RosGrFocus]::GetForegroundWindow()
      $fgPid = [uint32]0
      $fgTid = [RosGrFocus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
      $curTid = [RosGrFocus]::GetCurrentThreadId()
      if ($fgTid -ne 0 -and $fgTid -ne $curTid) {
        [void][RosGrFocus]::AttachThreadInput($curTid, $fgTid, $true)
        [void][RosGrFocus]::SetForegroundWindow($hwnd)
        [void][RosGrFocus]::AttachThreadInput($curTid, $fgTid, $false)
      } else {
        [void][RosGrFocus]::SetForegroundWindow($hwnd)
      }
      Write-Log 'focus' "pid=$($proc.Id)" "hwnd=$hwnd"
      return $true
    } catch {
      Write-Log 'focus failed' $_.Exception.Message
    }
  }
  return $false
}

function Test-SleepWindow {
  param($Cfg, [datetime]$When = $(Get-Date))
  if (-not $Cfg -or -not $Cfg.sleepEnabled) { return $false }
  $rule = Get-SleepRuleForToday -Cfg $Cfg -When $When
  if ($rule.mode -eq 'off') { return $false }
  if ($rule.mode -eq 'allDay') { return $true }
  $hour = [int]$When.Hour
  $start = [int]$rule.startHour
  $end = [int]$rule.endHour
  if ($start -eq $end) { return $false }
  if ($start -lt $end) { return ($hour -ge $start -and $hour -lt $end) }
  # Overnight window e.g. 22 -> 6
  return ($hour -ge $start -or $hour -lt $end)
}

# Keep displays awake while the client is not in its sleep window.
# Pattern from StayActive.ps1 / PSMouseJiggler: SetThreadExecutionState + 1px nudge.
function Ensure-KeepAwakeApi {
  if ($script:KeepAwakeReady) { return $true }
  try {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class RosKeepAwake {
  public const uint ES_CONTINUOUS = 0x80000000;
  public const uint ES_SYSTEM_REQUIRED = 0x00000001;
  public const uint ES_DISPLAY_REQUIRED = 0x00000002;
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("kernel32.dll")]
  public static extern uint SetThreadExecutionState(uint esFlags);
  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int X, int Y);
}
"@ -ErrorAction Stop
    $script:KeepAwakeReady = $true
  } catch {
    if ("$($_.Exception.Message)" -match 'already exists') { $script:KeepAwakeReady = $true }
    else { Write-Log 'keep-awake API load failed' "$($_.Exception.Message)"; return $false }
  }
  return [bool]$script:KeepAwakeReady
}

function Update-KeepAwake {
  param([bool]$Allow)
  if (-not (Ensure-KeepAwakeApi)) { return }
  try {
    if ($Allow) {
      [void][RosKeepAwake]::SetThreadExecutionState(
        [RosKeepAwake]::ES_CONTINUOUS -bor [RosKeepAwake]::ES_SYSTEM_REQUIRED -bor [RosKeepAwake]::ES_DISPLAY_REQUIRED
      )
      $now = Get-Date
      $last = $script:State.lastJiggleAt
      if (-not $last -or ($now - $last).TotalSeconds -ge 55) {
        $pt = New-Object RosKeepAwake+POINT
        if ([RosKeepAwake]::GetCursorPos([ref]$pt)) {
          [void][RosKeepAwake]::SetCursorPos(($pt.X + 1), $pt.Y)
          Start-Sleep -Milliseconds 40
          [void][RosKeepAwake]::SetCursorPos($pt.X, $pt.Y)
        }
        $script:State.lastJiggleAt = $now
      }
      $script:State.keepAwake = $true
    } else {
      [void][RosKeepAwake]::SetThreadExecutionState([RosKeepAwake]::ES_CONTINUOUS)
      $script:State.keepAwake = $false
    }
  } catch {
    Write-Log 'keep-awake update failed' "$($_.Exception.Message)"
  }
}

function Open-GreenRoomWindow {
  param(
    [string]$Url,
    [bool]$Fullscreen = $true,
    $Display = $null,
    [int]$DisplayIndex = 0
  )
  if (-not $Url) { return $false }
  $x = 0; $y = 0; $w = 1920; $h = 1080
  if ($Display) {
    if ($null -ne $Display.x) { $x = [int]$Display.x }
    if ($null -ne $Display.y) { $y = [int]$Display.y }
    if ($null -ne $Display.width) { $w = [Math]::Max(800, [int]$Display.width) }
    if ($null -ne $Display.height) { $h = [Math]::Max(600, [int]$Display.height) }
    if ($null -ne $Display.index) { $DisplayIndex = [int]$Display.index }
  }
  $browser = Find-BrowserExe
  if ($browser) {
    # Chromium ignores --window-position when reusing the default profile.
    # A per-display user-data-dir is required for secondary-monitor + fullscreen.
    $profileDir = Join-Path $env:LOCALAPPDATA ("ROS-GreenRoom\profile-d{0}" -f $DisplayIndex)
    try { New-Item -ItemType Directory -Force -Path $profileDir | Out-Null } catch {}
    # Use ProcessStartInfo so & in query strings (apiToken, day, etc.) are not mangled
    # by Start-Process -ArgumentList array quoting quirks on Windows PowerShell 5.1.
    $argParts = New-Object System.Collections.Generic.List[string]
    if ($Fullscreen) { [void]$argParts.Add('--start-fullscreen') }
    [void]$argParts.Add('--user-data-dir="' + $profileDir + '"')
    [void]$argParts.Add('--no-first-run')
    [void]$argParts.Add('--no-default-browser-check')
    [void]$argParts.Add('--disable-session-crashed-bubble')
    [void]$argParts.Add("--window-position=$x,$y")
    [void]$argParts.Add("--window-size=$w,$h")
    [void]$argParts.Add('--app="' + $Url + '"')
    $argLine = [string]::Join(' ', $argParts)
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $browser
      $psi.Arguments = $argLine
      $psi.UseShellExecute = $false
      $p = [System.Diagnostics.Process]::Start($psi)
      if ($p -and $p.Id) {
        $script:State.browserPid = $p.Id
        Write-Log 'browser' $browser "pid=$($p.Id)" "pos=$x,$y" "size=${w}x${h}" "fs=$Fullscreen" "profile=$profileDir"
        $null = Focus-ProcessWindow -ProcessId $p.Id
        return $true
      }
    } catch {
      Write-Log 'browser launch failed' $_.Exception.Message
    }
  }
  try {
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'start', '""', $Url) -WindowStyle Hidden -PassThru
    if ($p) { return $true }
  } catch {}
  try {
    Start-Process -FilePath $Url | Out-Null
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
  browserPid    = $null
  activeUntil   = $null
  sleeping      = $false
  sleepNotified = $false
  keepAwake     = $false
  lastJiggleAt  = $null
}
$script:FocusApiReady = $false
$script:KeepAwakeReady = $false

function Clear-ActiveSession {
  $script:State.status = 'standby'
  $script:State.activeUntil = $null
  Stop-BrowserSession
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
    if (Test-SleepWindow -Cfg $Cfg) {
      $rule = Get-SleepRuleForToday -Cfg $Cfg
      $script:State.eventId = $eventId
      $script:State.status = 'standby'
      $script:State.lastError = ("Sleep mode ({0}) - Start ignored" -f (Format-SleepRuleLabel -Rule $rule -DayKey (Get-SleepDayKey)))
      $script:State.lastCommandId = $Command.id
      Write-Log 'sleep: ignoring start command' $Command.id
      if ($Notify) {
        $Notify.ShowBalloonTip(5000, 'Green Room sleeping', $script:State.lastError, [System.Windows.Forms.ToolTipIcon]::Info)
      }
      return
    }
    $script:State.eventId = $eventId
    $day = [Math]::Max(1, [int]($Command.day))
    if (-not $day) { $day = 1 }
    $hours = 0
    if ($Command.durationHours) { $hours = [double]$Command.durationHours }
    if ($hours -lt 2) { $hours = 2 }
    if ($hours -gt 24) { $hours = 24 }
    $fullscreen = $true
    if ($null -ne $Command.fullscreen) {
      # PS ConvertFrom-Json may yield bool or string; avoid [bool]"false" => $true
      $fsRaw = $Command.fullscreen
      if ($fsRaw -is [bool]) { $fullscreen = $fsRaw }
      elseif ("$fsRaw" -eq '0' -or "$fsRaw" -eq 'false' -or "$fsRaw" -eq 'False') { $fullscreen = $false }
      else { $fullscreen = $true }
    }

    # Always open the live Cloudflare Green Room page (fetches Railway directly).
    # Do not reuse Command.url — stale event-* / Railway links break timers/schedule.
    $appBase = if ($Cfg.appUrl -and $Cfg.appUrl -notmatch 'up\.railway\.app') { $Cfg.appUrl } else { 'https://ros1615.pages.dev' }
    $fsFlag = if ($fullscreen) { '1' } else { '0' }
    $url = "$appBase/green-room?eventId=$([Uri]::EscapeDataString($eventId))&day=$day&sessionHours=$hours&fs=$fsFlag"
    # Bootstrap SPA API auth from this client's Integration token (no Neon sign-in).
    # Prefer query apiToken (hash fragments are sometimes dropped by Windows shell launches).
    if ($Cfg.token) {
      $url = "$url&apiToken=$([Uri]::EscapeDataString($Cfg.token))"
    }
    $script:State.openedUrl = $url

    $displays = @(Get-ClientDisplays)
    $displayIndex = 0
    if ($null -ne $Command.displayIndex) { $displayIndex = [int]$Command.displayIndex }
    $display = $null
    if ($Command.display) {
      $display = $Command.display
      # Prefer live local bounds for the selected index (coords in the command can be stale).
      $live = $displays | Where-Object { [int]$_.index -eq $displayIndex } | Select-Object -First 1
      if ($live) { $display = $live }
    }
    elseif ($displays.Count -gt 0) {
      $display = $displays | Where-Object { [int]$_.index -eq $displayIndex } | Select-Object -First 1
      if (-not $display) { $display = $displays[0] }
    }
    $script:State.activeUntil = (Get-Date).AddHours($hours)

    Stop-BrowserSession
    $opened = $false
    if ($Cfg.openBrowser) {
      $opened = Open-GreenRoomWindow -Url $url -Fullscreen $fullscreen -Display $display -DisplayIndex $displayIndex
      if (-not $opened) {
        Write-Log 'warn: could not open browser - client still marked active'
        $script:State.lastError = 'Could not open browser'
      }
    }
    $script:State.status = 'active'
    if ($opened) { $script:State.lastError = '' }
    Write-Log 'active ->' ($url -replace 'apiToken=[^&#]+', 'apiToken=(redacted)' -replace 'ros_api_token=[^&#]+', 'ros_api_token=(redacted)') "until=$($script:State.activeUntil)" "day=$day" "fs=$fullscreen" "display=$displayIndex"
    if ($Notify) {
      $tip = if ($opened) { "Green Room for ${hours}h (day $day)" } else { 'Active, but browser did not open. Use Open Green Room now.' }
      $Notify.ShowBalloonTip(7000, 'Green Room started', $tip, [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } elseif ($action -eq 'stop') {
    Clear-ActiveSession
    $script:State.lastError = ''
    Write-Log 'back to standby'
    if ($Notify) {
      $Notify.ShowBalloonTip(4000, 'Green Room standby', 'Back on standby.', [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } else {
    $script:State.lastError = "Unknown action: $action"
  }
  $script:State.lastCommandId = $Command.id
}

function Send-Heartbeat {
  param($Cfg, $Notify)
  if ($script:State.status -eq 'active' -and $script:State.activeUntil) {
    if ((Get-Date) -ge [datetime]$script:State.activeUntil) {
      Write-Log 'duration elapsed - returning to standby'
      Clear-ActiveSession
      if ($Notify) {
        $Notify.ShowBalloonTip(5000, 'Green Room ended', 'Active time finished - back on standby.', [System.Windows.Forms.ToolTipIcon]::Info)
      }
    }
  }

  $nowSleeping = Test-SleepWindow -Cfg $Cfg
  $todayRule = Get-SleepRuleForToday -Cfg $Cfg
  $todayKey = Get-SleepDayKey
  if ($nowSleeping) {
    if (-not $script:State.sleeping) {
      $label = Format-SleepRuleLabel -Rule $todayRule -DayKey $todayKey
      Write-Log 'entering sleep window' $label
      Clear-ActiveSession
      $script:State.sleeping = $true
      Update-KeepAwake -Allow $false
      if (-not $script:State.sleepNotified -and $Notify) {
        $tipMsg = if ($todayRule.mode -eq 'allDay') {
          ("Sleeping all day ({0}). Browser closed; Start ignored." -f $todayKey)
        } else {
          ("Sleeping {0}. Browser closed; Start ignored until awake." -f $label)
        }
        $Notify.ShowBalloonTip(6000, 'Green Room sleep', $tipMsg, [System.Windows.Forms.ToolTipIcon]::Info)
        $script:State.sleepNotified = $true
      }
    }
    $script:State.status = 'standby'
  } elseif ($script:State.sleeping) {
    Write-Log 'leaving sleep window'
    $script:State.sleeping = $false
    $script:State.sleepNotified = $false
    $script:State.lastError = ''
    Update-KeepAwake -Allow $true
    if ($Notify) {
      $Notify.ShowBalloonTip(4000, 'Green Room awake', 'Sleep window ended - ready for Start.', [System.Windows.Forms.ToolTipIcon]::Info)
    }
  } else {
    Update-KeepAwake -Allow $true
  }

  $displays = @(Get-ClientDisplays)
  $body = @{
    clientId      = $Cfg.clientId
    name          = $Cfg.name
    hostname      = $env:COMPUTERNAME
    kind          = 'green-room'
    status        = $script:State.status
    eventId       = $script:State.eventId
    lastCommandId = $script:State.lastCommandId
    lastError     = $script:State.lastError
    meta          = @{
      displays       = $displays
      activeUntil    = if ($script:State.activeUntil) { ([datetime]$script:State.activeUntil).ToString('o') } else { $null }
      openedUrl      = $script:State.openedUrl
      sleeping       = [bool]$script:State.sleeping
      sleepDay       = $todayKey
      sleepMode      = $todayRule.mode
      sleepStartHour = [int]$todayRule.startHour
      sleepEndHour   = [int]$todayRule.endHour
    }
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
    $body.meta.activeUntil = if ($script:State.activeUntil) { ([datetime]$script:State.activeUntil).ToString('o') } else { $null }
    $body.meta.openedUrl = $script:State.openedUrl
    $null = Invoke-RosApi -Cfg $Cfg -Method 'POST' -UrlPath '/api/display-clients/heartbeat' -Body $body
  }
  return $data.client
}

function Update-TrayText {
  param($Notify, $Cfg)
  $status = $script:State.status
  if ($script:State.sleeping) { $status = 'sleep' }
  $tip = "ROS Green Room`n$($Cfg.name)`n$status"
  if ($script:State.sleeping) {
    $tip += ("`n{0}" -f (Format-SleepRuleLabel -Rule (Get-SleepRuleForToday -Cfg $Cfg) -DayKey (Get-SleepDayKey)))
  }
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

$itemInfo = New-Object System.Windows.Forms.ToolStripMenuItem
$itemInfo.Text = ("Id: {0}  Token: {1}" -f $cfg.clientId, (Token-Prefix $cfg.token))
$itemInfo.Enabled = $false

$itemSettings = New-Object System.Windows.Forms.ToolStripMenuItem
$itemSettings.Text = 'Settings...'
$itemSettings.Add_Click({
  $updated = Show-SettingsForm -Cfg $script:Cfg
  if ($updated) {
    $script:Cfg = $updated
    $timer.Interval = [Math]::Max(5000, [int]$script:Cfg.heartbeatMs)
    $itemInfo.Text = ("Id: {0}  Token: {1}" -f $script:Cfg.clientId, (Token-Prefix $script:Cfg.token))
    Write-Log 'settings saved' $script:Cfg.clientId (Token-Prefix $script:Cfg.token)
    try {
      $null = Send-Heartbeat -Cfg $script:Cfg -Notify $notify
      $script:State.lastOk = $true
      $script:State.lastMessage = "ok - $($script:State.status)"
      $itemStatus.Text = "Status: $($script:State.lastMessage)"
      $notify.ShowBalloonTip(3000, 'Settings saved', 'Heartbeat OK - kiosk should see this PC.', [System.Windows.Forms.ToolTipIcon]::Info)
    } catch {
      $script:State.lastOk = $false
      $script:State.lastMessage = $_.Exception.Message
      $itemStatus.Text = "Status: error - $($script:State.lastMessage)"
      $notify.ShowBalloonTip(5000, 'Heartbeat failed', $script:State.lastMessage, [System.Windows.Forms.ToolTipIcon]::Error)
    }
    Update-TrayText -Notify $notify -Cfg $script:Cfg
  }
})

$itemTest = New-Object System.Windows.Forms.ToolStripMenuItem
$itemTest.Text = 'Test connection'
$itemTest.Add_Click({
  try {
    $null = Send-Heartbeat -Cfg $script:Cfg -Notify $notify
    $script:State.lastOk = $true
    $script:State.lastMessage = "ok - $($script:State.status)"
    $itemStatus.Text = "Status: $($script:State.lastMessage)"
    Update-TrayText -Notify $notify -Cfg $script:Cfg
    [System.Windows.Forms.MessageBox]::Show(
      ("Connected.`nClient id: {0}`nToken: {1}`nStatus: {2}" -f $script:Cfg.clientId, (Token-Prefix $script:Cfg.token), $script:State.status),
      'Green Room Client',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  } catch {
    $script:State.lastOk = $false
    $script:State.lastMessage = $_.Exception.Message
    $itemStatus.Text = "Status: error - $($script:State.lastMessage)"
    [System.Windows.Forms.MessageBox]::Show(
      ("Heartbeat failed:`n{0}" -f $script:State.lastMessage),
      'Green Room Client',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
  }
})

$itemOpenGr = New-Object System.Windows.Forms.ToolStripMenuItem
$itemOpenGr.Text = 'Open Green Room now'
$itemOpenGr.Add_Click({
  $eid = if ($script:State.eventId) { $script:State.eventId } else { 'TEST' }
  $appBase = if ($script:Cfg.appUrl -and $script:Cfg.appUrl -notmatch 'up\.railway\.app') { $script:Cfg.appUrl } else { 'https://ros1615.pages.dev' }
  $url = if ($script:State.openedUrl) { $script:State.openedUrl } else { "$appBase/green-room?eventId=$([Uri]::EscapeDataString($eid))&day=1&sessionHours=4&fs=1" }
  if ($script:Cfg.token -and $url -notmatch 'apiToken=' -and $url -notmatch 'ros_api_token=') {
    $join = if ($url -match '\?') { '&' } else { '?' }
    $url = "$url${join}apiToken=$([Uri]::EscapeDataString($script:Cfg.token))"
  }
  $displays = @(Get-ClientDisplays)
  $ok = Open-GreenRoomWindow -Url $url -Fullscreen $true -Display ($displays | Select-Object -First 1) -DisplayIndex 0
  Write-Log 'manual open' ($url -replace 'apiToken=[^&#]+', 'apiToken=(redacted)' -replace 'ros_api_token=[^&#]+', 'ros_api_token=(redacted)') "ok=$ok"
  if ($ok) {
    $notify.ShowBalloonTip(4000, 'Green Room', 'Opened full screen', [System.Windows.Forms.ToolTipIcon]::Info)
  } else {
    [System.Windows.Forms.MessageBox]::Show("Could not open browser for:`n$($url -replace 'apiToken=[^&#]+', 'apiToken=(redacted)' -replace 'ros_api_token=[^&#]+', 'ros_api_token=(redacted)')", 'Green Room Client') | Out-Null
  }
})

$itemOpenLog = New-Object System.Windows.Forms.ToolStripMenuItem
$itemOpenLog.Text = 'Open log'
$itemOpenLog.Add_Click({
  if (Test-Path -LiteralPath $LogPath) { Start-Process notepad.exe $LogPath }
})

$itemExit = New-Object System.Windows.Forms.ToolStripMenuItem
$itemExit.Text = 'Exit'
$itemExit.Add_Click({
  $script:ShouldExit = $true
  try { Update-KeepAwake -Allow $false } catch {}
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
})

[void]$menu.Items.Add($itemStatus)
[void]$menu.Items.Add($itemInfo)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$menu.Items.Add($itemSettings)
[void]$menu.Items.Add($itemTest)
[void]$menu.Items.Add($itemOpenGr)
[void]$menu.Items.Add($itemOpenLog)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
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
