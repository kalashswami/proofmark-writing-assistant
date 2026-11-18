@echo off
cd /d "%~dp0"
echo Making a copy of Proofmark Desktop to share. The other PC will not need .NET.
echo The first time, this downloads about 100 MB of Windows runtime files.
echo.
if exist share rmdir /s /q share
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o share\Proofmark
if errorlevel 1 (
  echo.
  echo The build failed. Copy the error above and send it over.
  pause
  exit /b 1
)
powershell -NoProfile -Command "Compress-Archive -Path share\Proofmark -DestinationPath Proofmark-Desktop-for-sharing.zip -Force"
echo.
echo Done. Send this file to your friend:
echo %~dp0Proofmark-Desktop-for-sharing.zip
pause
