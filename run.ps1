Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Error "Virtual environment .venv was not found. Create it and install dependencies first."
}

& $python -c "import kivy, kivymd" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Missing Python modules (kivy/kivymd). Run: .\\.venv\\Scripts\\python.exe -m pip install -r requirements.txt"
}

& $python (Join-Path $PSScriptRoot "main.py")
