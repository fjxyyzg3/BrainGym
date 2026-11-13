param(
  [string]$StateDir = (Join-Path $env:USERPROFILE '.wheelmaker'),
  [string]$AppOrigin = $env:APP_ORIGIN,
  [string]$ProductionDir = 'D:\Apps\BrainGym',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
[Uri]$publicOrigin = $null
if ([string]::IsNullOrWhiteSpace($AppOrigin) -or
    -not [Uri]::TryCreate($AppOrigin, [UriKind]::Absolute, [ref]$publicOrigin) -or
    $publicOrigin.Scheme -cne 'https' -or
    $publicOrigin.UserInfo -ne '' -or
    $AppOrigin -cne $publicOrigin.GetLeftPart([UriPartial]::Authority)) {
  throw 'AppOrigin must be configured as an HTTPS origin without credentials, path, query or fragment'
}
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$hubHome = [IO.Path]::GetFullPath($StateDir)
if ($Apply) { throw 'Use npm run release -- deploy --candidate <verified-path>; direct configuration writes bypass rehearsal and are refused' }
$settings = [IO.File]::ReadAllText((Join-Path $hubHome 'config.json')) | ConvertFrom-Json
$existing = @($settings.apps | Where-Object { $_.id -eq 'braingym-process' })
if ($existing.Count -ne 1 -or -not $existing[0].env.DATABASE_PATH) { throw 'A unique existing BrainGym definition and explicit database are required' }
if ($existing[0].env.APP_ORIGIN -cne $AppOrigin) { throw 'Origin differs from the existing definition; refusing an implicit entry change' }
$definition = $existing[0] | ConvertTo-Json -Depth 20 | ConvertFrom-Json
$originalCwd = [IO.Path]::GetFullPath($definition.cwd)
$databasePath = $definition.env.DATABASE_PATH
if (-not [IO.Path]::IsPathRooted($databasePath)) { $databasePath = Join-Path $originalCwd $databasePath }
$definition.cwd = [IO.Path]::GetFullPath($ProductionDir)
if ($definition.cwd -eq $repositoryRoot) { throw 'Production program must be outside the development directory' }
$definition.env.DATABASE_PATH = [IO.Path]::GetFullPath($databasePath)
$definition.env | Add-Member -NotePropertyName BRAINGYM_ENV -NotePropertyValue 'production' -Force
$verificationDirectory = Join-Path $repositoryRoot '.runtime/releases/config-preview'
& (Join-Path $PSScriptRoot 'release-windows.ps1') -Action protect -Path $verificationDirectory
$previewPath = Join-Path $verificationDirectory 'braingym-app.json'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($previewPath,($definition | ConvertTo-Json -Depth 10),$utf8)
@{applied=$false;preview=$previewPath;appId=$definition.id;publicationRequired=$true} | ConvertTo-Json -Compress
