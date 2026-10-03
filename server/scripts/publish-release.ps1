param([string]$Manifest="releases.json",[string]$Root="testdata/artifacts",[string]$Spec="")
Push-Location (Split-Path -Parent $PSScriptRoot)
$a=@("-manifest",$Manifest,"-root",$Root); if($Spec){$a+=@("-spec",$Spec)}; go run ./cmd/publish-release @a; Pop-Location
