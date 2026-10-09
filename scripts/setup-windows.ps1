# One-click setup for Windows. Run through SETUP-WINDOWS.bat (double-click).
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Green }
function Fail($text) { Write-Host ""; Write-Host "PROBLEM: $text" -ForegroundColor Red; Write-Host "Take a screenshot of this window and send it to Claude."; exit 1 }
function Run($label, $cmd) {
  Step $label
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Fail "'$cmd' did not finish successfully." }
}

Write-Host "GreenCycle Waste ERP - Windows setup" -ForegroundColor Cyan

try { $nodeVersion = (node -v) } catch { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, restart the computer, then double-click SETUP-WINDOWS.bat again." }
Write-Host "Node.js $nodeVersion found."

if (-not (Test-Path ".env")) {
  Step "Database connection"
  Write-Host "Type the PostgreSQL password you chose when you installed PostgreSQL (the one you use in pgAdmin)."
  $secure = Read-Host "PostgreSQL password" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ([string]::IsNullOrWhiteSpace($plain)) { Fail "No password was typed." }
  $encoded = [Uri]::EscapeDataString($plain)   # turns @ into %40 etc.
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 60 | ForEach-Object { [char]$_ })
  $content = @"
DATABASE_URL="postgresql://postgres:$encoded@localhost:5432/waste_erp?schema=public"
AUTH_SECRET="$secret"
SESSION_HOURS=12
COOKIE_SECURE=false
APP_TIMEZONE="Asia/Kolkata"
UPLOAD_DIR="./storage/uploads"
MAX_UPLOAD_MB=10
SEED_ADMIN_PASSWORD="Admin@123"
SEED_DEMO_PASSWORD="Demo@123"
SMTP_HOST=""
"@
  [IO.File]::WriteAllText((Join-Path (Get-Location) ".env"), $content, (New-Object Text.UTF8Encoding($false)))
  Write-Host "Settings saved to .env"
} else {
  Write-Host ".env already exists - using it."
}

Run "Installing components (takes a few minutes)" "npm install"
Run "Preparing the database client" "npx prisma generate"
Step "Creating tables in the waste_erp database"
cmd /c "npx prisma migrate deploy"
if ($LASTEXITCODE -ne 0) { Remove-Item ".env" -ErrorAction SilentlyContinue; Fail "Could not connect to the database. Check that the database waste_erp exists in pgAdmin and that the password is right, then double-click SETUP-WINDOWS.bat again (it will ask for the password again)." }
Run "Loading company settings and demo data" "npm run db:seed"
Step "Setup complete. Building and starting the app (takes a few minutes the first time)..."
Write-Host "Sign in with  admin / Admin@123" -ForegroundColor Cyan
& (Join-Path $PSScriptRoot "start-windows.ps1")
