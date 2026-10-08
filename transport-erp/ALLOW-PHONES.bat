@echo off
REM Lets phones on the office Wi-Fi reach G Road Lines ERP (opens TCP port 4000 in Windows Firewall).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath %~f0 -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="GRL ERP" >nul 2>&1
netsh advfirewall firewall add rule name="GRL ERP" dir=in action=allow protocol=TCP localport=4000 profile=private,domain
echo.
echo Done. Phones on the office Wi-Fi can now open the ERP.
echo In the ERP go to Settings - Mobile app to see the address.
pause
