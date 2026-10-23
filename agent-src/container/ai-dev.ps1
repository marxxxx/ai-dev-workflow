# Project-owned; written once by ai-dev-workflow init. Runs a command in this project's agent
# container: .\ai-dev.ps1 [command [args...]] (no command opens bash). See AI-DEV.md.
# Works in Windows PowerShell 5.1 and PowerShell 7. No param() block, so every argument
# (including ones starting with '-') is passed through verbatim via $args.
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

# Per-machine settings (AGENT_CA_DIR, proxies, AGENT_IMAGE, ...). Never overrides a variable that
# is already set in the environment.
$envFile = Join-Path $root '.env.ai-dev'
if (Test-Path -LiteralPath $envFile) {
  foreach ($raw in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    $line = $raw.TrimEnd("`r")
    if ($line -eq '' -or $line.StartsWith('#')) { continue }
    if ($line.StartsWith('export ')) { $line = $line.Substring(7) }
    $eq = $line.IndexOf('=')
    if ($eq -lt 1) { continue }
    $key = $line.Substring(0, $eq)
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
    $value = $line.Substring($eq + 1)
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if (-not (Test-Path -LiteralPath "Env:$key")) { Set-Item -LiteralPath "Env:$key" -Value $value }
  }
}

$env:PROJECT_ROOT = $root
# Docker Desktop on Windows maps ownership itself (default 1000:1000); PowerShell 7 on
# Linux/macOS needs the host IDs like ai-dev.sh.
if ((Test-Path Variable:IsWindows) -and -not $IsWindows) {
  if (-not $env:HOST_UID) { $env:HOST_UID = (& id -u) }
  if (-not $env:HOST_GID) { $env:HOST_GID = (& id -g) }
}

$composeArgs = @('compose', '-f', (Join-Path $root 'compose.ai-dev.yml'))
if ($env:AGENT_CA_DIR) { $composeArgs += @('-f', (Join-Path $root 'compose.ai-dev.certs.yml')) }
# Opt-in Docker daemon (AGENT_DIND=1): root-equivalent on the host, see AI-DEV.md.
if ($env:AGENT_DIND -eq '1') {
  $composeArgs += @('-f', (Join-Path $root 'compose.ai-dev.dind.yml'))
  if ($env:AGENT_CA_DIR) { $composeArgs += @('-f', (Join-Path $root 'compose.ai-dev.dind-certs.yml')) }
}
$composeArgs += @('run', '--rm', 'ai-dev-workflow') + $args

& docker @composeArgs
exit $LASTEXITCODE
