<#
.SYNOPSIS
  Publica o agregador e o dashboard na internet via Cloudflare Quick Tunnel.

.EXAMPLE
  .\scripts\public.ps1          # sobe tudo e mostra as URLs públicas
  .\scripts\public.ps1 url      # só mostra as URLs atuais
  .\scripts\public.ps1 stop     # derruba os tunnels (volta a ser só local)
#>
param([ValidateSet("start", "url", "stop")] [string]$Action = "start")

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$env:COMPOSE_FILE = "docker/docker-compose.yml"
$profiles = @("--profile", "observability", "--profile", "public")

function Get-TunnelUrl([string]$service) {
  # A URL só aparece no log depois que o tunnel conecta.
  for ($i = 0; $i -lt 30; $i++) {
    $log = docker compose @profiles logs $service 2>&1 | Out-String
    $found = [regex]::Matches($log, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($found.Count -gt 0) { return $found[$found.Count - 1].Value }
    Start-Sleep -Seconds 2
  }
  return "(ainda não disponível — rode .\scripts\public.ps1 url)"
}

switch ($Action) {
  "start" {
    # Exposto na internet: Grafana sem nenhum login (só leitura anônima).
    $env:GRAFANA_DISABLE_LOGIN = "true"
    $env:GRAFANA_BASIC_AUTH = "false"
    $env:OTEL_ENABLED = "true"
    docker compose @profiles up -d --build --wait
    if ($LASTEXITCODE -ne 0) { throw "docker compose falhou" }
  }
  "stop" {
    docker compose @profiles stop tunnel-api tunnel-dashboard
    Write-Host "Tunnels derrubados. A stack continua rodando localmente."
    return
  }
}

$api = Get-TunnelUrl "tunnel-api"
$dash = Get-TunnelUrl "tunnel-dashboard"
Write-Host ""
Write-Host "API pública:       $api" -ForegroundColor Green
Write-Host "Dashboard público: $dash" -ForegroundColor Green
Write-Host ""
Write-Host "Teste:"
Write-Host "  curl.exe -X POST $api/search -H 'Content-Type: application/json' -d '{\""origin\"":\""GRU\"",\""destination\"":\""GIG\"",\""date\"":\""2026-11-20\""}'"
Write-Host ""
Write-Host "A URL muda quando o tunnel reinicia. O PC precisa ficar ligado e sem suspender."
