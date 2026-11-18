@echo off
cd /d "%~dp0"
if not exist "%~dp0ProofmarkDesktop.csproj" (
  echo This file was opened from inside the zip, so the rest of the project isn't next to it.
  echo.
  echo Right-click ProofmarkDesktop.zip, choose "Extract All...", then run run.cmd
  echo from the extracted ProofmarkDesktop folder.
  echo.
  pause
  exit /b 1
)
where dotnet >nul 2>nul
if errorlevel 1 (
  echo The .NET SDK isn't installed. Get it from https://dotnet.microsoft.com/download
  echo then run this file again.
  pause
  exit /b 1
)
echo Building and starting Proofmark Desktop...
dotnet run -c Release --project "%~dp0ProofmarkDesktop.csproj"
if errorlevel 1 (
  echo.
  echo Proofmark didn't start. Copy the error above and send it over.
  pause
)
