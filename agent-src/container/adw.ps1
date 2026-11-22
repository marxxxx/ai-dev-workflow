# Project-owned; written once by adw init. Runs a command in this project's agent
# container: .\adw.ps1 [command [args...]] (no command opens bash). See .adw/README.md.
# Works in Windows PowerShell 5.1 and PowerShell 7. No param() block, so every argument
# (including ones starting with '-') is passed through verbatim via $args.
$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot

# Per-machine settings (AGENT_CA_DIR, proxies, AGENT_IMAGE, ...). Never overrides a variable that
# is already set in the environment.
$envFile = Join-Path $root '.adw/.env'
if ((Test-Path -LiteralPath (Join-Path $root '.env.ai-dev'))) {
  Write-Warning 'adw.ps1: move .env.ai-dev to .adw/.env, or run adw upgrade; it is not read anymore.'
}
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
# A running adw-mcp container is not in .adw/compose.yml; without this every call warns about it.
$env:COMPOSE_IGNORE_ORPHANS = '1'
# Docker Desktop on Windows maps ownership itself (default 1000:1000); PowerShell 7 on
# Linux/macOS needs the host IDs like adw.sh.
if ((Test-Path Variable:IsWindows) -and -not $IsWindows) {
  if (-not $env:HOST_UID) { $env:HOST_UID = (& id -u) }
  if (-not $env:HOST_GID) { $env:HOST_GID = (& id -g) }
}

$composeArgs = @('compose', '--project-directory', $root, '-f', (Join-Path $root '.adw/compose.yml'))
if ($env:AGENT_CA_DIR) { $composeArgs += @('-f', (Join-Path $root '.adw/compose.certs.yml')) }
# Opt-in Docker daemon (AGENT_DIND=1): root-equivalent on the host, see .adw/README.md.
if ($env:AGENT_DIND -eq '1') {
  $composeArgs += @('-f', (Join-Path $root '.adw/compose.dind.yml'))
  if ($env:AGENT_CA_DIR) { $composeArgs += @('-f', (Join-Path $root '.adw/compose.dind-certs.yml')) }
}

# Newest build of the configured image (AGENT_IMAGE or the default). A project image built from
# .adw/compose.yml (build:) is rebuilt on the newest base image instead, from the cache when the
# base is unchanged, and without pulling when the base image exists only locally. Offline, the
# local image starts.
function Update-Image {
  # 'Continue': Windows PowerShell 5.1 turns compose's progress on stderr into errors when redirected.
  $ErrorActionPreference = 'Continue'
  $config = & docker @($composeArgs + @('config', 'ai-dev-workflow')) 2>$null
  if (@($config) -match '^    build:') {
    & docker @($composeArgs + @('build', '--pull', 'ai-dev-workflow'))
    if ($LASTEXITCODE -ne 0) { & docker @($composeArgs + @('build', 'ai-dev-workflow')) }
    if ($LASTEXITCODE -ne 0) { Write-Warning 'adw.ps1: could not build the image; starting the local one.' }
  } else {
    & docker @($composeArgs + @('pull', 'ai-dev-workflow'))
    if ($LASTEXITCODE -ne 0) { Write-Warning 'adw.ps1: could not pull the image; starting the local one.' }
  }
}

# The opt-in MCP server of .adw/compose.mcp.yml: .\adw.ps1 mcp [up options] starts it (-d: in the
# background), .\adw.ps1 mcp down stops it.
if ($args.Count -gt 0 -and $args[0] -eq 'mcp') {
  if (-not (Test-Path -LiteralPath (Join-Path $root '.adw/compose.mcp.yml'))) {
    [Console]::Error.WriteLine('adw.ps1: the MCP server is not set up. Run adw init again (keep .adw/project.json, set up the dev container) and answer yes to the MCP question.')
    exit 1
  }
  $mcpArgs = $composeArgs + @('-f', (Join-Path $root '.adw/compose.mcp.yml'))
  if ($env:AGENT_CA_DIR) { $mcpArgs += @('-f', (Join-Path $root '.adw/compose.mcp-certs.yml')) }
  $rest = @($args | Select-Object -Skip 1)
  if ($rest.Count -gt 0 -and $rest[0] -eq 'down') {
    # Compose checks ADW_MCP_TOKEN for every command, stop too: a placeholder lets an empty one stop the
    # server. Only for this call: the session's environment keeps what it had.
    $token = $env:ADW_MCP_TOKEN
    if (-not $env:ADW_MCP_TOKEN) { $env:ADW_MCP_TOKEN = 'unused' }
    try {
      & docker @($mcpArgs + @('stop') + @($rest | Select-Object -Skip 1) + @('adw-mcp'))
      $code = $LASTEXITCODE
    } finally { $env:ADW_MCP_TOKEN = $token }
    exit $code
  }
  if (-not $env:ADW_MCP_TOKEN) {
    [Console]::Error.WriteLine('adw.ps1: ADW_MCP_TOKEN is empty. Set it in .adw/.env (32 characters or more).')
    exit 1
  }
  Update-Image
  & docker @($mcpArgs + @('up') + $rest + @('adw-mcp'))
  exit $LASTEXITCODE
}

Update-Image
& docker @($composeArgs + @('run', '--rm', 'ai-dev-workflow') + $args)
exit $LASTEXITCODE
