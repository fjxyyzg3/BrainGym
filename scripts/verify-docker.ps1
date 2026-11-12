param([string]$Image = 'braingym:verify-20261112')
$ErrorActionPreference = 'Stop'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$containerName = "braingym-verify-$suffix"
$volumeName = "braingym-verify-data-$suffix"
$containerId = $null
$volumeCreated = $false
$origin = 'http://127.0.0.1:3201'
function Docker-Checked {
  $output = & docker --config .docker-local @args
  if ($LASTEXITCODE -ne 0) { throw 'Docker verification command failed' }
  return $output
}
function Start-VerificationContainer {
  $id = Docker-Checked run -d --name $containerName -p '127.0.0.1:3201:3000' -e "APP_ORIGIN=$origin" -e 'COOKIE_SECURE=false' -v "${volumeName}:/app/data" $Image
  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    try { $health = Invoke-RestMethod "$origin/api/health"; if ($health.ok) { return $id } } catch {}
    Start-Sleep -Milliseconds 200
  }
  throw 'Verification container did not become ready'
}
try {
  $null = Docker-Checked volume create --label 'braingym-purpose=verification' $volumeName
  $volumeCreated = $true
  $containerId = Start-VerificationContainer
  $createdText = Docker-Checked exec $containerName node dist/server/server/cli.js user:create 'Docker verification'
  $created = ($createdText -join "`n") | ConvertFrom-Json
  $headers = @{ Origin = $origin }
  $null = Invoke-RestMethod "$origin/api/login" -Method Post -ContentType 'application/json' -Headers $headers -Body (@{ token = $created.token } | ConvertTo-Json) -SessionVariable verifySession
  $resultId = [guid]::NewGuid().ToString()
  $payload = @{ resultId = $resultId; startedByUserId = $created.user.id; game = 'spatial-n-back'; version = 1; n = 2; tp = 9; fn = 0; fp = 0; tn = 21; completedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffZ') } | ConvertTo-Json
  $saved = Invoke-RestMethod "$origin/api/results" -Method Post -ContentType 'application/json' -Headers $headers -WebSession $verifySession -Body $payload
  if ($saved.score -ne 100) { throw 'Server did not derive the expected score' }
  $actualId = Docker-Checked inspect --format '{{.Id}}' $containerName
  if ($actualId -ne $containerId) { throw 'Verification container identity changed' }
  $null = Docker-Checked stop $containerName
  $null = Docker-Checked rm $containerName
  $containerId = $null
  $containerId = Start-VerificationContainer
  $null = Invoke-RestMethod "$origin/api/login" -Method Post -ContentType 'application/json' -Headers $headers -Body (@{ token = $created.token } | ConvertTo-Json) -SessionVariable restoredSession
  $history = Invoke-RestMethod "$origin/api/history" -WebSession $restoredSession
  if ($history.total -ne 1 -or $history.items[0].resultId -ne $resultId) { throw 'Data did not survive container recreation' }
  $duplicate = Invoke-RestMethod "$origin/api/results" -Method Post -ContentType 'application/json' -Headers $headers -WebSession $restoredSession -Body $payload
  if ($duplicate.receivedAt -ne $saved.receivedAt) { throw 'Retry changed the original receive time' }
  $html = Invoke-WebRequest $origin -UseBasicParsing
  if ($html.StatusCode -ne 200 -or $html.Content -notmatch 'BrainGym') { throw 'Static app was not served' }
  Write-Output 'PASS: Docker static app, CLI, login, server score, persistent volume and idempotent retry after container recreation'
} finally {
  if ($containerId) {
    $actualId = & docker --config .docker-local inspect --format '{{.Id}}' $containerName 2>$null
    if ($actualId -eq $containerId) { $null = & docker --config .docker-local rm -f $containerName }
  }
  if ($volumeCreated) { $null = & docker --config .docker-local volume rm $volumeName }
}
