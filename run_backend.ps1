Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Virtual environment .venv was not found. Create it and install dependencies first."
}

& $python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
