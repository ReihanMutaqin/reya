$ErrorActionPreference = "Stop"
$PythonEnv = Join-Path $PSScriptRoot ".venv"

Write-Host "Menyiapkan suara perempuan natural Bahasa Indonesia..." -ForegroundColor Cyan
$PythonLauncher = Get-Command py -ErrorAction SilentlyContinue
$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not (Test-Path $PythonEnv)) {
    if ($PythonLauncher) {
        & $PythonLauncher.Source -3.12 -m venv $PythonEnv
    } elseif ($PythonCommand) {
        & $PythonCommand.Source -m venv $PythonEnv
    } else {
        throw "Python 3.12 belum ditemukan. Pasang Python terlebih dahulu."
    }
}

$PythonExe = Join-Path $PythonEnv "Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -r (Join-Path $PSScriptRoot "requirements-core.txt")
& $PythonExe -m pip install -r (Join-Path $PSScriptRoot "requirements-natural.txt")

Write-Host "Mengunduh model suara lokal sekitar 400 MB..." -ForegroundColor Cyan
& $PythonExe -c "from supertonic import TTS; TTS(auto_download=True)"

Write-Host "Selesai. Suara Natural Indo sudah siap. Jalankan kembali start-raya.ps1." -ForegroundColor Green
