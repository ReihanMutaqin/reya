$ErrorActionPreference = "Stop"
$RobotRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$PythonExe = Join-Path $RobotRoot "local-ai\.venv\Scripts\python.exe"

if (-not (Test-Path (Join-Path $RobotRoot "node_modules"))) {
    Push-Location $RobotRoot
    npm install
    Pop-Location
}

if (Test-Path $PythonExe) {
    Start-Process -FilePath $PythonExe -ArgumentList "server.py" -WorkingDirectory (Join-Path $RobotRoot "local-ai") -WindowStyle Hidden
} else {
    Write-Host "AI lokal belum dipasang. Jalankan local-ai\install-natural-voice.ps1, atau install.ps1 untuk fitur lengkap." -ForegroundColor Yellow
}

Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $RobotRoot -WindowStyle Hidden
Start-Sleep -Seconds 5
Start-Process "http://localhost:3088"
