@echo off
cd /d "%~dp0"
echo Building a standalone copy of Proofmark Desktop...
dotnet publish -c Release -r win-x64 --self-contained false -o publish
if errorlevel 1 (
  echo.
  echo The build failed. Copy the error above and send it over.
  pause
  exit /b 1
)
echo.
echo Done. Start it from: %~dp0publish\ProofmarkDesktop.exe
pause
