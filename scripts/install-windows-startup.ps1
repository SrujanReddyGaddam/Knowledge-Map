# Knowledge Map: run at login on Windows (the Windows counterpart of install-launchd.sh). No admin rights needed:
# it puts a shortcut in your own Startup folder that starts the app in a hidden window, and starts it now.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1              install and start
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1 -Restart     after editing config.json or server files
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1 -Uninstall   remove the shortcut and stop
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows-startup.ps1 -Print       show what would be installed
#   add -Port 7778 to any of them to use another port (sets KM_PORT too)
#
# Logs: %LOCALAPPDATA%\knowledge-map\knowledge-map.log and knowledge-map.err.log (rewritten at each start).
# It uses the node on PATH right now: run it from a terminal where `node -v` shows the version you want.
param([int]$Port = 7777, [switch]$Uninstall, [switch]$Print, [switch]$Stop, [switch]$Restart)
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$vite = Join-Path $repo 'node_modules\vite\bin\vite.js'
$logDir = Join-Path $env:LOCALAPPDATA 'knowledge-map'
$log = Join-Path $logDir 'knowledge-map.log'
$err = Join-Path $logDir 'knowledge-map.err.log'
$lnk = Join-Path ([Environment]::GetFolderPath('Startup')) 'Knowledge Map.lnk'
$ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Stop-App {
  $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*vite.js*--port $Port*" }
  foreach ($p in $procs) { Stop-Process -Id $p.ProcessId -Force; Write-Host "stopped node (pid $($p.ProcessId))" }
}

if ($Stop) { Stop-App; exit 0 }
if ($Uninstall) {
  Stop-App
  if (Test-Path $lnk) { Remove-Item $lnk; Write-Host "removed $lnk" } else { Write-Host 'no startup shortcut installed' }
  exit 0
}

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Error 'node is not on PATH. Install Node 22.18 or newer, open a new terminal, and run this again.' }
$node = $nodeCmd.Source
if (-not (Test-Path $vite)) { Write-Error "Run 'npm install' in $repo first." }
if (-not (Test-Path (Join-Path $repo 'config.json'))) { Write-Error "No config.json in $repo yet (copy config.example.json and set your vault path)." }

# the command the shortcut runs; single quotes inside are doubled for PowerShell
$q = { param($s) "'" + ($s -replace "'", "''") + "'" }
$cmd = '$env:KM_PORT=' + (& $q "$Port") + '; New-Item -ItemType Directory -Force -Path ' + (& $q $logDir) + ' | Out-Null; ' +
  'Start-Process -FilePath ' + (& $q $node) + ' -ArgumentList ' + (& $q 'node_modules/vite/bin/vite.js') + ',' + (& $q '--port') + ',' + (& $q "$Port") +
  ' -WorkingDirectory ' + (& $q $repo) + ' -WindowStyle Hidden -RedirectStandardOutput ' + (& $q $log) + ' -RedirectStandardError ' + (& $q $err)
$lnkArgs = '-NoProfile -WindowStyle Hidden -Command "' + $cmd + '"'

if ($Print) { Write-Host "shortcut: $lnk"; Write-Host "target:   $ps"; Write-Host "args:     $lnkArgs"; exit 0 }

if (-not $Restart) {
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($lnk)
  $s.TargetPath = $ps; $s.Arguments = $lnkArgs; $s.WorkingDirectory = $repo; $s.WindowStyle = 7; $s.Description = 'Knowledge Map (local notes map)'
  $s.Save()
  Write-Host "installed $lnk (starts at login)"
}

Stop-App
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($busy) { Write-Error "Port $Port is already in use by another program (pid $($busy[0].OwningProcess)). Rerun with -Port 7778." }
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:KM_PORT = "$Port"
Start-Process -FilePath $node -ArgumentList 'node_modules/vite/bin/vite.js', '--port', "$Port" -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err
Start-Sleep -Seconds 5
$line = Select-String -Path $log -Pattern '\[vault\]' -ErrorAction SilentlyContinue | Select-Object -Last 1
if ($line) { Write-Host $line.Line } else { Write-Host "started; no [vault] line yet, check $log and $err" }
Write-Host "open http://knowledge.localhost:$Port"
