param([string]$DbPath = $env:REPORT_DB_PATH, [string]$BackupDir = "$env:USERPROFILE\report-maker-backups")
if (-not $DbPath) { $DbPath = "report-maker.db" }
if (-not (Test-Path -LiteralPath $DbPath)) { Write-Error "database not found: $DbPath"; exit 1 }
if (-not (Get-Command sqlite3 -ErrorAction SilentlyContinue)) { Write-Error "sqlite3 required"; exit 1 }
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$dest = Join-Path $BackupDir ("report-maker-{0}.db" -f (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ"))
& sqlite3 $DbPath ".backup '$dest'"
(Get-FileHash -Algorithm SHA256 -LiteralPath $dest).Hash.ToLower() | Set-Content "$dest.sha256"
Write-Output "backup written: $dest"
