Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PythonExe = Join-Path $PSScriptRoot '.venv311\Scripts\python.exe'

if (-not (Test-Path $PythonExe)) {
  throw "Python executable not found at $PythonExe"
}

& $PythonExe -m pip install --no-cache-dir -r (Join-Path $PSScriptRoot 'requirements.txt')
& $PythonExe -m pip install --no-cache-dir -r (Join-Path $PSScriptRoot 'requirements-keras.txt')

Write-Host 'Python ML environment setup complete.'