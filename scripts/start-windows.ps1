# Starts GreenCycle ERP on Windows. Run through START-WINDOWS.bat (double-click).
# Rebuilds automatically when the files changed (e.g. after extracting a new ZIP),
# and opens the browser only once the app is ready.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Green }
function Fail($text) { Write-Host ""; Write-Host "PROBLEM: $text" -ForegroundColor Red; Write-Host "Take a screenshot of this window and send it to Claude."; exit 1 }
function Run($label, $cmd) {
  Step $label
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Fail "'$cmd' did not finish successfully." }
}
function PortOpen($port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.ConnectAsync("127.0.0.1", $port).Wait(1500) -and $c.Connected } catch { $false } finally { $c.Dispose() }
}

Write-Host "GreenCycle Waste ERP" -ForegroundColor Cyan

try { $null = (node -v) } catch { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, restart the computer, then run SETUP-WINDOWS.bat." }
if (-not (Test-Path ".env")) { Fail "This folder has not been set up yet. Double-click SETUP-WINDOWS.bat first." }

if (PortOpen 3000) {
  Write-Host "GreenCycle is already running. Opening the browser..." -ForegroundColor Cyan
  Start-Process "http://localhost:3000"
  exit 0
}

if (-not (PortOpen 5432)) {
  Fail "PostgreSQL (the database) is not running. Press Windows key, type Services, open it, find 'postgresql-x64-...', right-click it and choose Start. Then double-click START-WINDOWS.bat again."
}

# Fingerprint of the program files; if it differs from the last build, rebuild.
$files = Get-ChildItem -Path src, prisma, public, package.json, package-lock.json -Recurse -File | Sort-Object FullName
$sha = [Security.Cryptography.SHA256]::Create()
$sb = New-Object Text.StringBuilder
foreach ($f in $files) { [void]$sb.Append($f.FullName.Substring((Get-Location).Path.Length)).Append((Get-FileHash $f.FullName -Algorithm SHA1).Hash) }
$stamp = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sb.ToString()))).Replace("-", "")
$stampFile = ".next\greencycle-build-stamp.txt"
$built = (Test-Path ".next\BUILD_ID") -and (Test-Path $stampFile) -and ((Get-Content $stampFile -Raw).Trim() -eq $stamp)

if (-not $built) {
  Write-Host "New or changed program files found - updating (takes a few minutes, only this once)." -ForegroundColor Yellow
  Run "Installing components" "npm install"
  Run "Preparing the database client" "npx prisma generate"
  Run "Updating the database tables" "npx prisma migrate deploy"
  Run "Building the app" "npm run build"
  Set-Content -Path $stampFile -Value $stamp
}

# Open the browser when the app answers, not before (avoids "localhost refused to connect").
$opener = @'
for ($i = 0; $i -lt 180; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:3000/api/health | Out-Null; Start-Process http://localhost:3000; break } catch { Start-Sleep -Seconds 1 }
}
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($opener))
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile -EncodedCommand $encoded"

Step "Starting GreenCycle. The browser opens by itself in a few seconds."
Write-Host "KEEP THIS WINDOW OPEN while anyone uses GreenCycle. Closing it stops the app." -ForegroundColor Cyan
Write-Host "Address on this computer: http://localhost:3000"
cmd /c "npx next start -p 3000"
Fail "GreenCycle stopped. If you did not close it yourself, read the red text above."
