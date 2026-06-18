[CmdletBinding()]
param(
  [string]$ObsidianPath = $env:OBSIDIAN_EXE,
  [int]$RemoteDebuggingPort = 9222,
  [string]$PluginId = "superpower-inside"
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Get-AvailablePort {
  param([Parameter(Mandatory = $true)][int]$PreferredPort)

  for ($port = $PreferredPort; $port -lt ($PreferredPort + 20); $port++) {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $port)
    try {
      $listener.Start()
      return $port
    } catch {
      continue
    } finally {
      $listener.Stop()
    }
  }

  throw "No available remote debugging port found starting at $PreferredPort."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$testVaultDir = Join-Path $repoRoot ".test-vault"
$profileDir = Join-Path $testVaultDir ".obsidian-dev-profile"
Ensure-Directory -Path $profileDir

& (Join-Path $PSScriptRoot "setup-dev.ps1") -PluginId $PluginId -ExtraObsidianConfigDirs @($profileDir) | Out-Host

if (-not (Test-Path -LiteralPath $testVaultDir)) {
  throw "Test vault was not found. Run .\scripts\setup-dev.ps1 first."
}

if ([string]::IsNullOrWhiteSpace($ObsidianPath)) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\Obsidian\Obsidian.exe"),
    (Join-Path $env:ProgramFiles "Obsidian\Obsidian.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Obsidian\Obsidian.exe")
  )

  $ObsidianPath = $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

if ([string]::IsNullOrWhiteSpace($ObsidianPath) -or -not (Test-Path -LiteralPath $ObsidianPath)) {
  throw "Obsidian.exe was not found. Set OBSIDIAN_EXE or pass -ObsidianPath."
}

$RemoteDebuggingPort = Get-AvailablePort -PreferredPort $RemoteDebuggingPort

$arguments = @(
  "--user-data-dir=$profileDir",
  "--remote-debugging-port=$RemoteDebuggingPort",
  $testVaultDir
)
Start-Process -FilePath $ObsidianPath -ArgumentList $arguments

$enableScript = Join-Path $PSScriptRoot "enable-obsidian-dev-plugins.mjs"
if (Get-Command node -ErrorAction SilentlyContinue) {
  & node $enableScript "--port=$RemoteDebuggingPort" "--plugin=$PluginId"
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to enable Obsidian development plugins."
  }
} else {
  Write-Warning "node was not found. Open Obsidian settings and enable community plugins manually."
}

Write-Host "Opened Obsidian: $ObsidianPath"
Write-Host "Vault: $testVaultDir"
Write-Host "Profile: $profileDir"
Write-Host "Remote debugging port: $RemoteDebuggingPort"
