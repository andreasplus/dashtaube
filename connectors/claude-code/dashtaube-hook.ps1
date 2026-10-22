# Dashtaube-Hook für Claude Code unter Windows (PowerShell).
# Reicht die Hook-Eingabe unverändert an Dashtaube weiter und schlägt nie fehl.
$ErrorActionPreference = "SilentlyContinue"
$payload = [Console]::In.ReadToEnd()
if (-not $env:DASHTAUBE_URL -or -not $env:DASHTAUBE_TOKEN) { exit 0 }
$url = $env:DASHTAUBE_URL.TrimEnd("/") + "/v1/hooks/claude-code"
Invoke-RestMethod -Uri $url -Method Post -TimeoutSec 5 `
  -Headers @{ Authorization = "Bearer $env:DASHTAUBE_TOKEN" } `
  -ContentType "application/json; charset=utf-8" `
  -Body ([System.Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
exit 0
