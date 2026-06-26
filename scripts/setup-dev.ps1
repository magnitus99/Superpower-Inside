[CmdletBinding()]
param(
  [string]$PluginId = "superpower-inside",
  [string[]]$ExtraObsidianConfigDirs = @()
)

$ErrorActionPreference = "Stop"

function Ensure-Directory {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Enable-CommunityPlugin {
  param(
    [Parameter(Mandatory = $true)][string]$CommunityPluginsPath,
    [Parameter(Mandatory = $true)][string]$Id
  )

  [string[]]$plugins = @()
  if (Test-Path -LiteralPath $CommunityPluginsPath) {
    $raw = Get-Content -Raw -LiteralPath $CommunityPluginsPath
    if ($raw.Trim().Length -gt 0) {
      $parsedPlugins = ConvertFrom-Json -InputObject $raw
      foreach ($plugin in @($parsedPlugins)) {
        if ($plugin -is [string]) {
          $plugins += $plugin
        }
      }
    }
  }

  if ($plugins -notcontains $Id) {
    $plugins += $Id
  }

  Write-Utf8NoBom -Path $CommunityPluginsPath -Content (ConvertTo-Json -InputObject $plugins)
}

function Remove-CommunityPlugin {
  param(
    [Parameter(Mandatory = $true)][string]$CommunityPluginsPath,
    [Parameter(Mandatory = $true)][string]$Id
  )

  [string[]]$plugins = @()
  if (Test-Path -LiteralPath $CommunityPluginsPath) {
    $raw = Get-Content -Raw -LiteralPath $CommunityPluginsPath
    if ($raw.Trim().Length -gt 0) {
      $parsedPlugins = ConvertFrom-Json -InputObject $raw
      foreach ($plugin in @($parsedPlugins)) {
        if ($plugin -is [string] -and $plugin -ne $Id) {
          $plugins += $plugin
        }
      }
    }
  }

  Write-Utf8NoBom -Path $CommunityPluginsPath -Content (ConvertTo-Json -InputObject $plugins)
}

function Get-StableVaultId {
  param([Parameter(Mandatory = $true)][string]$VaultPath)

  $normalizedPath = $VaultPath.ToLowerInvariant()
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($normalizedPath)
    $hash = $sha256.ComputeHash($bytes)
    return -join ($hash[0..7] | ForEach-Object { $_.ToString("x2") })
  } finally {
    $sha256.Dispose()
  }
}

function Register-ObsidianVault {
  param(
    [Parameter(Mandatory = $true)][string]$VaultPath,
    [Parameter(Mandatory = $true)][string]$ConfigDir,
    [bool]$Open = $false,
    [bool]$ResetInvalid = $false
  )

  $obsidianConfigDir = $ConfigDir
  $obsidianConfigPath = Join-Path $obsidianConfigDir "obsidian.json"
  Ensure-Directory -Path $obsidianConfigDir

  if (Test-Path -LiteralPath $obsidianConfigPath) {
    $rawConfig = Get-Content -Raw -LiteralPath $obsidianConfigPath
    if ($rawConfig.Trim().Length -gt 0) {
      try {
        $config = ConvertFrom-Json -InputObject $rawConfig
      } catch {
        if (-not $ResetInvalid) {
          Write-Warning "Skipping invalid Obsidian config: $obsidianConfigPath"
          return
        }
        $config = [pscustomobject]@{}
      }
    } else {
      $config = [pscustomobject]@{}
    }
  } else {
    $config = [pscustomobject]@{}
  }

  if (-not $config.PSObject.Properties["vaults"]) {
    $config | Add-Member -MemberType NoteProperty -Name "vaults" -Value ([pscustomobject]@{})
  }

  $vaults = $config.vaults
  $existingVault = $vaults.PSObject.Properties |
    Where-Object { $_.Value.path -eq $VaultPath } |
    Select-Object -First 1

  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  if ($existingVault) {
    $existingVault.Value.ts = $timestamp
    if ($Open) {
      $existingVault.Value | Add-Member -MemberType NoteProperty -Name "open" -Value $true -Force
    }
  } else {
    $vaultId = Get-StableVaultId -VaultPath $VaultPath
    $vaultEntry = [pscustomobject]@{
      path = $VaultPath
      ts = $timestamp
    }
    if ($Open) {
      $vaultEntry | Add-Member -MemberType NoteProperty -Name "open" -Value $true
    }

    $vaults | Add-Member -MemberType NoteProperty -Name $vaultId -Value $vaultEntry
  }

  Write-Utf8NoBom -Path $obsidianConfigPath -Content (ConvertTo-Json -InputObject $config -Depth 8 -Compress)
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$testVaultDir = Join-Path $repoRoot ".test-vault"
$obsidianDir = Join-Path $testVaultDir ".obsidian"
$pluginsRoot = Join-Path $obsidianDir "plugins"
$pluginDir = Join-Path $pluginsRoot $PluginId
$hotReloadDir = Join-Path $pluginsRoot "hot-reload"
$communityPluginsPath = Join-Path $obsidianDir "community-plugins.json"

Ensure-Directory -Path $testVaultDir
Ensure-Directory -Path $obsidianDir
Ensure-Directory -Path $pluginsRoot

$welcomePath = Join-Path $testVaultDir "Welcome.md"
if (-not (Test-Path -LiteralPath $welcomePath)) {
  Write-Utf8NoBom -Path $welcomePath -Content "# Test Vault`n`nThis vault is for developing the Superpower Inside plugin."
}

if (Test-Path -LiteralPath $pluginDir) {
  $pluginItem = Get-Item -LiteralPath $pluginDir
  if (($pluginItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
    throw "Plugin path already exists but is not a Windows junction: $pluginDir"
  }
} else {
  New-Item -ItemType Junction -Path $pluginDir -Target $repoRoot | Out-Null
}

if (-not (Test-Path -LiteralPath $hotReloadDir)) {
  if (Get-Command git -ErrorAction SilentlyContinue) {
    git clone --depth 1 https://github.com/pjeby/hot-reload.git $hotReloadDir
  } else {
    Write-Warning "git was not found. Install hot-reload manually if you need automatic reloads."
  }
}

Remove-CommunityPlugin -CommunityPluginsPath $communityPluginsPath -Id "super-obsidian-by-ai"
Enable-CommunityPlugin -CommunityPluginsPath $communityPluginsPath -Id $PluginId
Enable-CommunityPlugin -CommunityPluginsPath $communityPluginsPath -Id "hot-reload"

if (-not [string]::IsNullOrWhiteSpace($env:APPDATA)) {
  Register-ObsidianVault -VaultPath $testVaultDir -ConfigDir (Join-Path $env:APPDATA "obsidian")
}

foreach ($configDir in $ExtraObsidianConfigDirs) {
  if (-not [string]::IsNullOrWhiteSpace($configDir)) {
    Register-ObsidianVault -VaultPath $testVaultDir -ConfigDir $configDir -Open $true -ResetInvalid $true
  }
}

Get-ChildItem -LiteralPath $testVaultDir -Recurse -Force -Filter ".DS_Store" -ErrorAction SilentlyContinue |
  Remove-Item -Force

Write-Host "Test vault: $testVaultDir"
Write-Host "Plugin junction: $pluginDir -> $repoRoot"
Write-Host "Run: npm run dev"
Write-Host "Open Obsidian: .\scripts\launch-obsidian-debug.ps1"
