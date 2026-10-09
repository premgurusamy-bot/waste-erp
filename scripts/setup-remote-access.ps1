# Makes GreenCycle reachable from anywhere through a Cloudflare Tunnel (free, no router changes).
# Run through SETUP-REMOTE-ACCESS.bat (double-click). Needs: a domain added to a free Cloudflare account.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
function Step($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Green }
function Fail($t) { Write-Host ""; Write-Host "PROBLEM: $t" -ForegroundColor Red; Write-Host "Take a screenshot of this window and send it to Claude."; Read-Host "Press Enter to close"; exit 1 }

Write-Host "GreenCycle ERP - open from anywhere (Cloudflare Tunnel)" -ForegroundColor Cyan
Write-Host "Before you start: buy a domain (e.g. yourcompany.in) and add it to a free account at dash.cloudflare.com."
Write-Host ""

# 1. cloudflared
$cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
if (-not $cf) {
  Step "Installing Cloudflare's connector (cloudflared)"
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  if (-not $cf) {
    foreach ($p in @("${env:ProgramFiles}\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) { if (Test-Path $p) { $cf = $p } }
  }
  if (-not $cf) { Fail "Could not install cloudflared. Download it from https://github.com/cloudflare/cloudflared/releases (cloudflared-windows-amd64.msi), install it, then run this again." }
}
Write-Host "cloudflared: $cf"

# 2. Sign in to Cloudflare (opens the browser; choose your domain and click Authorize)
$home2 = Join-Path $env:USERPROFILE ".cloudflared"
if (-not (Test-Path (Join-Path $home2 "cert.pem"))) {
  Step "Sign in to Cloudflare: a browser window opens. Pick your domain and click Authorize."
  & $cf tunnel login
  if (-not (Test-Path (Join-Path $home2 "cert.pem"))) { Fail "Cloudflare sign-in did not finish." }
}

# 3. The web address
Step "Choose the web address"
Write-Host "Type the address staff will use, on your domain. Example: erp.yourcompany.in"
$hostname = (Read-Host "Address").Trim().ToLower() -replace '^https?://', '' -replace '/.*$', ''
if ($hostname -notmatch '^[a-z0-9-]+(\.[a-z0-9-]+)+$') { Fail "'$hostname' is not a valid address." }

# 4. Tunnel
Step "Creating the tunnel"
$name = "greencycle"
$list = & $cf tunnel list --output json | ConvertFrom-Json
$tunnel = $list | Where-Object { $_.name -eq $name } | Select-Object -First 1
if (-not $tunnel) {
  & $cf tunnel create $name | Out-Host
  $list = & $cf tunnel list --output json | ConvertFrom-Json
  $tunnel = $list | Where-Object { $_.name -eq $name } | Select-Object -First 1
}
if (-not $tunnel) { Fail "The tunnel could not be created." }
$id = $tunnel.id

$dir = "C:\ProgramData\GreenCycle\cloudflared"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$credSrc = Join-Path $home2 "$id.json"
if (-not (Test-Path $credSrc)) { Fail "Tunnel credentials $credSrc are missing. Delete the 'greencycle' tunnel in the Cloudflare dashboard (Zero Trust > Networks > Tunnels) and run this again." }
Copy-Item $credSrc (Join-Path $dir "$id.json") -Force
$config = @"
tunnel: $id
credentials-file: $dir\$id.json
ingress:
  - hostname: $hostname
    service: http://localhost:3000
  - service: http_status:404
"@
[IO.File]::WriteAllText((Join-Path $dir "config.yml"), $config, (New-Object Text.UTF8Encoding($false)))

Step "Pointing $hostname to this computer"
& $cf tunnel route dns --overwrite-dns $name $hostname | Out-Host

# 5. Run the tunnel as a Windows service (starts with Windows, even before anyone signs in)
Step "Installing the tunnel as a Windows service"
$svc = Get-Service -Name Cloudflared -ErrorAction SilentlyContinue
if (-not $svc) { & $cf service install | Out-Host }
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\Cloudflared" -Name ImagePath -Value "`"$cf`" --config `"$dir\config.yml`" tunnel run"
Set-Service -Name Cloudflared -StartupType Automatic
Restart-Service -Name Cloudflared -Force

# 6. Start GreenCycle when Windows starts
Step "Start GreenCycle automatically"
$ans = Read-Host "Start GreenCycle automatically every time this computer starts? (Y/N)"
if ($ans -match '^[Yy]') {
  $startup = [Environment]::GetFolderPath("Startup")
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $startup "GreenCycle ERP.lnk"))
  $lnk.TargetPath = (Join-Path (Get-Location) "START-WINDOWS.bat")
  $lnk.WorkingDirectory = (Get-Location).Path
  $lnk.WindowStyle = 7
  $lnk.Save()
  Write-Host "Added to Windows startup."
}

Write-Host ""
Write-Host "DONE. GreenCycle can be opened from anywhere at:  https://$hostname" -ForegroundColor Cyan
Write-Host "1. In GreenCycle open Settings > Remote & Google Sign-in, type https://$hostname as Public web address and Save."
Write-Host "2. In the phone app, set the server address to $hostname (your name > App settings)."
Write-Host "3. This computer must stay ON with GreenCycle running. Set Windows power options so it never sleeps."
Write-Host "4. Give every user a strong password: the sign-in page is now on the internet."
Read-Host "Press Enter to close"
