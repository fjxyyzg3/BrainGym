param(
  [Parameter(Mandatory)][ValidateSet('protect','replace','guard','snapshot')][string]$Action,
  [Parameter(Mandatory)][string]$Path,
  [string]$Destination,
  [string]$Candidate,
  [string]$ExpectedHash
)
$ErrorActionPreference = 'Stop'
trap {
  $category = ($_.FullyQualifiedErrorId -replace '[^A-Za-z0-9,._-]','')
  [Console]::Error.WriteLine('RELEASE_WINDOWS_ERROR:' + $category + ':' + $_.Exception.GetBaseException().GetType().Name + ':L' + $_.InvocationInfo.ScriptLineNumber)
  exit 1
}
$resolved = [IO.Path]::GetFullPath($Path)
if ($resolved -eq [IO.Path]::GetPathRoot($resolved) -or $resolved.StartsWith('\\')) { throw 'Unsafe filesystem root' }
function Assert-NoLinks([string]$Value) {
  $cursor = [IO.Path]::GetFullPath($Value)
  while ($cursor) {
    if (Test-Path -LiteralPath $cursor) {
      if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse point refused' }
    }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
}
Assert-NoLinks $resolved
if ($Action -eq 'protect') {
  [IO.Directory]::CreateDirectory($resolved) | Out-Null
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true,$false)
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().User
  foreach ($sid in @($current,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
    $acl.AddAccessRule($rule)
  }
  $access = [Security.AccessControl.DirectorySecurity]::new()
  $sections = [Security.AccessControl.AccessControlSections]::Access
  $access.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($sections),$sections)
  [IO.Directory]::SetAccessControl($resolved,$access)
  exit
}
if ($Action -eq 'replace') {
  Assert-NoLinks $Candidate
  Assert-NoLinks $Destination
  if ((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedHash) { throw 'Configuration changed' }
  $acl = Get-Acl -LiteralPath $resolved
  $access = [Security.AccessControl.FileSecurity]::new()
  $sections = [Security.AccessControl.AccessControlSections]::Access
  $access.SetSecurityDescriptorSddlForm($acl.GetSecurityDescriptorSddlForm($sections),$sections)
  Set-Acl -LiteralPath $Candidate -AclObject $access
  [IO.File]::Replace([IO.Path]::GetFullPath($Candidate),$resolved,[IO.Path]::GetFullPath($Destination))
  $backupAccess = (Get-Acl -LiteralPath $Destination).GetSecurityDescriptorSddlForm($sections)
  if ($backupAccess -ne $acl.GetSecurityDescriptorSddlForm($sections)) { throw 'Backup access ACL changed' }
  exit
}
if ($Action -eq 'guard') {
  $stream = [IO.File]::Open($resolved,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
  try {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { $actual = ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
    finally { $algorithm.Dispose() }
    if ($actual -ne $ExpectedHash) { throw 'Protected configuration changed' }
    [Console]::Out.WriteLine('ready')
    [Console]::Out.Flush()
    $null = [Console]::In.ReadLine()
  } finally { $stream.Dispose() }
  exit
}
Assert-NoLinks $Destination
$destinationRoot = [IO.Path]::GetFullPath($Destination)
if ($destinationRoot.StartsWith($resolved + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or $resolved.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Overlapping snapshot paths' }
$handles = [Collections.Generic.List[object]]::new()
try {
  $all = @(Get-ChildItem -LiteralPath $resolved -Recurse -Force)
  foreach ($item in $all) { if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Snapshot contains a link' } }
  foreach ($item in @($all | Where-Object { -not $_.PSIsContainer })) {
    $stream = [IO.File]::Open($item.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    $handles.Add(@{Source=$item.FullName;Stream=$stream})
  }
  [IO.Directory]::CreateDirectory($destinationRoot) | Out-Null
  foreach ($item in $all | Where-Object { $_.PSIsContainer }) {
    [IO.Directory]::CreateDirectory((Join-Path $destinationRoot $item.FullName.Substring($resolved.Length).TrimStart('\'))) | Out-Null
  }
  foreach ($entry in $handles) {
    $relative = $entry.Source.Substring($resolved.Length).TrimStart('\')
    $target = Join-Path $destinationRoot $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
    $output = [IO.File]::Open($target,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $entry.Stream.CopyTo($output); $output.Flush($true) } finally { $output.Dispose() }
  }
} finally { foreach ($entry in $handles) { $entry.Stream.Dispose() } }
