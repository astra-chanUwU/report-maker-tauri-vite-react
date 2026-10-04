param([Parameter(Mandatory=$true)][string]$BackupFile)
if (-not (Test-Path -LiteralPath $BackupFile)) { Write-Error "backup not found"; exit 1 }
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) { Write-Error "sqlite3 required"; exit 1 }
$tmp = Join-Path $env:TEMP ("report-maker-restore-{0}.db" -f [guid]::NewGuid().ToString('N'))
try {
    Copy-Item -LiteralPath $BackupFile -Destination $tmp
    if ((& sqlite3 $tmp 'PRAGMA integrity_check;').Trim() -ne 'ok') { Write-Error 'integrity_check failed'; exit 1 }
    Write-Output 'restore verification ok'
} finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
