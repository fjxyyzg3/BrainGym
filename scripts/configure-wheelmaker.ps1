param(
  [string]$StateDir = (Join-Path $env:USERPROFILE '.wheelmaker'),
  [string]$AppOrigin = $env:APP_ORIGIN,
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
$nodeExecutable = (Get-Command node -CommandType Application | Select-Object -First 1).Source
if (-not (Test-Path -LiteralPath (Join-Path $repositoryRoot 'dist/server/server/main.js'))) { throw 'Build BrainGym before configuring Hub' }
$definition = [ordered]@{
  id='braingym-process'; name='BrainGym'; executable=$nodeExecutable
  args=@('dist/server/server/main.js'); cwd=$repositoryRoot
  env=[ordered]@{
    HOST='127.0.0.1'; PORT='3001'; APP_BASE_PATH='/braingym/'
    APP_ORIGIN=$AppOrigin; COOKIE_SECURE='true'; NODE_ENV='production'
    DATABASE_PATH=(Join-Path $repositoryRoot 'data/braingym.sqlite')
    WHEELMAKER_STATE_DIR=$hubHome; WHEELMAKER_SERVICE_ID='braingym'
  }
}
$verificationDirectory = Join-Path $repositoryRoot 'data/wheelmaker-verification'
[IO.Directory]::CreateDirectory($verificationDirectory) | Out-Null
$previewPath = Join-Path $verificationDirectory 'braingym-app.json'
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($previewPath,($definition | ConvertTo-Json -Depth 10),$utf8)
if (-not $Apply) { @{applied=$false;preview=$previewPath;appId=$definition.id} | ConvertTo-Json -Compress; exit }
$configPath = Join-Path $hubHome 'config.json'
$originalBytes = [IO.File]::ReadAllBytes($configPath)
$settings = [Text.Encoding]::UTF8.GetString($originalBytes) | ConvertFrom-Json
$apps = @($settings.apps | Where-Object { $null -ne $_ })
$existing = @($apps | Where-Object {$_.id -eq $definition.id})
if ($existing.Count -gt 1 -or ($existing.Count -eq 1 -and [IO.Path]::GetFullPath($existing[0].cwd) -ne $repositoryRoot)) { throw 'Application ID belongs to another definition; refusing overwrite' }
$nextApps = @($apps | Where-Object {$_.id -ne $definition.id}) + @($definition)
if ($nextApps.Count -gt 64) { throw 'Hub application limit exceeded' }
$settings | Add-Member -NotePropertyName apps -NotePropertyValue $nextApps -Force
$candidate = $settings | ConvertTo-Json -Depth 100
$null = $candidate | ConvertFrom-Json
$acl = Get-Acl -LiteralPath $configPath
$temporaryDirectory = Join-Path $hubHome '.tmp'
[IO.Directory]::CreateDirectory($temporaryDirectory) | Out-Null
$suffix = [guid]::NewGuid().ToString('N')
$backupPath = Join-Path $temporaryDirectory "braingym-config-backup-$suffix.json"
$candidatePath = Join-Path $temporaryDirectory "braingym-config-candidate-$suffix.json"
foreach ($path in @($backupPath,$candidatePath)) {
  $stream = [IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write)
  $stream.Dispose()
  Set-Acl -LiteralPath $path -AclObject $acl
}
[IO.File]::WriteAllBytes($backupPath,$originalBytes)
[IO.File]::WriteAllText($candidatePath,$candidate + "`n",$utf8)
[IO.File]::Replace($candidatePath,$configPath,[System.Management.Automation.Language.NullString]::Value)
@{applied=$true;appId=$definition.id;backup=$backupPath;reloadRequired=$true} | ConvertTo-Json -Compress
