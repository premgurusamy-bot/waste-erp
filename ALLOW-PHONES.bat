@echo off
REM Lets phones on the office Wi-Fi reach GreenCycle ERP (opens TCP port 3000 in Windows Firewall).
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="GreenCycle ERP" >nul 2>&1
netsh advfirewall firewall add rule name="GreenCycle ERP" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo Done. Phones on the office Wi-Fi can now open GreenCycle.
echo In GreenCycle go to Settings, Mobile App to see the address and QR code.
pause
