# Yojo local servers (development). Starts everything in its own minimised window, so the servers keep running after
# the terminal that started them closes. Run again any time: it stops old copies first.
#   Database + Redis (Docker) · Academy API :3000 · pages :8000 (no cache) · mission/lab API :8100
# Usage: right-click > Run with PowerShell, or:  powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
$ErrorActionPreference = 'Continue'
$root    = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'yojo-backend-auth-ctf-lms\backend'
$mission = Join-Path $root 'mission-api'

Write-Host 'Starting the database and Redis (Docker)...'
Push-Location $backend; docker compose up -d postgres redis | Out-Null; Pop-Location

# old copies (from an earlier run or another terminal) would block the ports
Get-CimInstance Win32_Process -Filter "name='node.exe'" | Where-Object { $_.CommandLine -match 'yojo-backend-auth-ctf-lms' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.CommandLine -match 'pages-server.py|uvicorn main:app' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

function Start-Win($title, $dir, $cmd) {
  Start-Process powershell -WindowStyle Minimized -WorkingDirectory $dir -ArgumentList '-NoExit', '-Command', "`$Host.UI.RawUI.WindowTitle = '$title'; $cmd"
}
Start-Win 'Yojo API :3000' $backend 'npm run start:dev'
Start-Win 'Yojo Pages :8000' $root 'python scripts/pages-server.py . 8000'
# the mission API reads its settings from .env.academy-link (values are never printed)
$missionCmd = "Get-Content .env.academy-link | Where-Object { `$_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object { `$k, `$v = `$_ -split '=', 2; Set-Item -Path ('Env:' + `$k) -Value `$v }; .\.venv-win\Scripts\python.exe -m uvicorn main:app --port 8100"
Start-Win 'Yojo Mission API :8100' $mission $missionCmd

function Wait-Up($name, $url) {
  for ($i = 0; $i -lt 60; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $url; if ($r.StatusCode -eq 200) { Write-Host "  $name OK"; return $true } } catch {}
    Start-Sleep -Seconds 2
  }
  Write-Host "  $name did not answer (check its window)"; return $false
}
Write-Host 'Waiting for the servers...'
Wait-Up 'Pages :8000' 'http://localhost:8000/' | Out-Null
Wait-Up 'Mission API :8100' 'http://localhost:8100/healthz' | Out-Null
if (Wait-Up 'API :3000' 'http://localhost:3000/api/v1/health/live') { Start-Process 'http://localhost:8000/' }
