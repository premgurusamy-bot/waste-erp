# One-click setup for Windows (server mode). Run through SETUP-WINDOWS.bat.
# Needs: Node.js LTS (nodejs.org) and PostgreSQL (postgresql.org) installed first.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Green }
function Fail($text) { Write-Host ""; Write-Host "PROBLEM: $text" -ForegroundColor Red; exit 1 }
function Run($label, $cmd) {
  Step $label
  cmd /c $cmd
  if ($LASTEXITCODE -ne 0) { Fail "'$cmd' did not finish successfully." }
}

Write-Host "G Road Lines - Transport Agent ERP - Windows setup" -ForegroundColor Cyan
try { $nodeVersion = (node -v) } catch { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, restart the computer, then run SETUP-WINDOWS.bat again." }
Write-Host "Node.js $nodeVersion found."

if (-not (Test-Path ".env")) {
  Step "Database connection"
  Write-Host "Type the PostgreSQL password you chose when you installed PostgreSQL."
  $secure = Read-Host "PostgreSQL password" -AsSecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
  if ([string]::IsNullOrWhiteSpace($plain)) { Fail "No password was typed." }
  $encoded = [Uri]::EscapeDataString($plain)
  $secret = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
  $pgBin = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue | Sort-Object { [int]$_.Name } -Descending | Select-Object -First 1
  $pgDump = if ($pgBin) { Join-Path $pgBin.FullName "bin\pg_dump.exe" } else { "" }
  @"
DATABASE_URL="postgresql://postgres:$encoded@localhost:5432/grl_erp"
AUTH_SECRET="$secret"
PORT=4000
COOKIE_SECURE=false
PG_DUMP_PATH="$pgDump"
"@ | Set-Content -Encoding ASCII ".env"
  Write-Host ".env created (it holds the database password; keep it private)."
  Step "Creating database grl_erp (if it does not exist)"
  if ($pgBin) {
    $env:PGPASSWORD = $plain
    & (Join-Path $pgBin.FullName "bin\psql.exe") -U postgres -h localhost -tc "SELECT 1 FROM pg_database WHERE datname='grl_erp'" | Out-String | ForEach-Object {
      if ($_.Trim() -ne "1") { & (Join-Path $pgBin.FullName "bin\psql.exe") -U postgres -h localhost -c "CREATE DATABASE grl_erp" | Out-Null }
    }
    Remove-Item Env:PGPASSWORD
  } else { Write-Host "psql not found: create the database grl_erp in pgAdmin, then run this again." }
}

Run "Installing packages (a few minutes)" "npm install"
Run "Building the ERP" "npm run build"
Run "Creating / updating database tables" "npx prisma migrate deploy"
$demo = Read-Host "Load SAMPLE data for testing (20 customers, 100 trips...)? Type Y for sample data, N for an empty ERP"
if ($demo -eq "Y" -or $demo -eq "y") { $env:SEED_DEMO = "true" } else { $env:SEED_DEMO = "false" }
$adminPw = Read-Host "Choose the password for user 'admin' (8+ characters, letters and numbers)"
$env:SEED_ADMIN_PASSWORD = $adminPw
Run "Creating the administrator" "npm run db:seed"

Step "Done"
Write-Host "Backups will be kept in: $([Environment]::GetFolderPath('MyDocuments'))\G Road Lines ERP\Backup" -ForegroundColor Cyan
Write-Host "Start the ERP any time with START-WINDOWS.bat. Sign in as admin."
Write-Host "Moving from another computer? Sign in, open Backup & Restore, click RESTORE FROM EXCEL."
Start-Process "START-WINDOWS.bat"
