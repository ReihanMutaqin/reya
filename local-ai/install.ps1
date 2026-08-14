$ErrorActionPreference = "Stop"
$RobotRoot = Split-Path -Parent $PSScriptRoot
$PythonEnv = Join-Path $PSScriptRoot ".venv"

Write-Host "Menyiapkan otak dan suara lokal REYA..." -ForegroundColor Cyan
$PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($PythonLauncher) {
    & $PythonLauncher.Source -3.12 -m venv $PythonEnv
} elseif ($PythonCommand) {
    & $PythonCommand.Source -m venv $PythonEnv
} else {
    throw "Python 3.12 belum ditemukan. Pasang Python terlebih dahulu."
}
$PythonExe = Join-Path $PythonEnv "Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $PSScriptRoot "requirements-core.txt")
& $PythonExe -m pip install -r (Join-Path $PSScriptRoot "requirements-ai.txt")

Write-Host "Mengunduh model suara Natural Indo sekitar 400 MB..." -ForegroundColor Cyan
& $PythonExe -c "from supertonic import TTS; TTS(auto_download=True)"

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Ollama belum ditemukan. Pasang Ollama, lalu jalankan: ollama pull qwen3:4b" -ForegroundColor Yellow
} else {
    ollama pull qwen3:4b
}

Write-Host "Selesai. Jalankan start-raya.ps1 dari folder utama." -ForegroundColor Green
