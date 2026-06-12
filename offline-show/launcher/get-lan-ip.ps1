# First non-loopback IPv4 suitable for LAN access (used by launcher .bat files).
$ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object {
    $_.IPAddress -notmatch '^127\.' -and $_.PrefixOrigin -ne 'WellKnown'
  } |
  Select-Object -First 1 -ExpandProperty IPAddress

if ($ip) { Write-Output $ip }
