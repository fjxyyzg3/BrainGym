param(
  [Parameter(Mandatory)][ValidateSet('start','interrupt','force')][string]$Action,
  [Parameter(Mandatory)][string]$StateDir,
  [Parameter(Mandatory)][string]$Executable,
  [int]$TargetPid
)
$ErrorActionPreference = 'Stop'
$verificationRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../data/wheelmaker-verification'))
$releaseVerificationRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.runtime/release-verification'))
$resolvedStateDir = [IO.Path]::GetFullPath($StateDir)
$resolvedExecutable = [IO.Path]::GetFullPath($Executable)
if ($resolvedStateDir.StartsWith($releaseVerificationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { $verificationRoot = $releaseVerificationRoot }
elseif (-not $resolvedStateDir.StartsWith($verificationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'State directory is outside isolated verification root' }
if ($resolvedStateDir.Contains('"') -or $resolvedExecutable.Contains('"')) { throw 'Invalid process path' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class IsolatedHubNative {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct StartupInfo { public uint cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public ushort showWindow,reserved2; public IntPtr reservedPtr,input,output,error; }
  [StructLayout(LayoutKind.Sequential)]
  public struct ProcessInfo { public IntPtr process,thread; public uint processId,threadId; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfo startup, out ProcessInfo process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint processId);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr handle, out uint code);
  [DllImport("kernel32.dll")] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AttachConsole(uint processId);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern uint GetConsoleProcessList(uint[] list, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GenerateConsoleCtrlEvent(uint control, uint group);
}
'@
if ($Action -eq 'start') {
  $startup = New-Object IsolatedHubNative+StartupInfo
  $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
  $startup.flags = 1
  $startup.showWindow = 0
  $created = New-Object IsolatedHubNative+ProcessInfo
  $command = New-Object Text.StringBuilder ('"' + $resolvedExecutable + '" --hub-worker --dir "' + $resolvedStateDir + '"')
  if (-not [IsolatedHubNative]::CreateProcessW($resolvedExecutable,$command,[IntPtr]::Zero,[IntPtr]::Zero,$false,0x10,[IntPtr]::Zero,$verificationRoot,[ref]$startup,[ref]$created)) { throw "CreateProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  [IsolatedHubNative]::CloseHandle($created.thread) | Out-Null
  [IsolatedHubNative]::CloseHandle($created.process) | Out-Null
  @{pid=$created.processId;hiddenConsole=$true} | ConvertTo-Json -Compress
  exit
}
$target = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetPid"
if (-not $target -or $target.ExecutablePath -ne $resolvedExecutable -or -not $target.CommandLine.Contains($resolvedStateDir)) { throw 'Target is not the owned isolated Hub' }
if ($Action -eq 'force') { Stop-Process -Id $TargetPid -Force; exit }
$processHandle = [IsolatedHubNative]::OpenProcess(0x101000,$false,[uint32]$TargetPid)
if ($processHandle -eq [IntPtr]::Zero) { throw 'Cannot wait for owned isolated Hub' }
[IsolatedHubNative]::FreeConsole() | Out-Null
if (-not [IsolatedHubNative]::AttachConsole([uint32]$TargetPid)) { throw "AttachConsole failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
try {
  [IsolatedHubNative]::SetConsoleCtrlHandler([IntPtr]::Zero,$true) | Out-Null
  $owned = [Collections.Generic.HashSet[uint32]]::new()
  $owned.Add([uint32]$TargetPid) | Out-Null
  $owned.Add([uint32]$PID) | Out-Null
  $processes = @(Get-CimInstance Win32_Process)
  do { $added=$false; foreach($item in $processes) { if($owned.Contains([uint32]$item.ParentProcessId) -and $owned.Add([uint32]$item.ProcessId)) { $added=$true } } } while($added)
  $console = New-Object 'uint32[]' 1024
  $count = [IsolatedHubNative]::GetConsoleProcessList($console,1024)
  if($count -eq 0 -or $count -gt 1024) { throw 'Cannot verify isolated console ownership' }
  for($index=0; $index -lt $count; $index++) { if(-not $owned.Contains($console[$index])) { throw 'Console contains a process outside the isolated Hub tree' } }
  if(-not [IsolatedHubNative]::GenerateConsoleCtrlEvent(0,0)) { throw 'Cannot interrupt isolated Hub' }
  if([IsolatedHubNative]::WaitForSingleObject($processHandle,15000) -ne 0) { throw 'Isolated Hub did not stop gracefully within 15 seconds' }
  $exitCode = [uint32]0
  [IsolatedHubNative]::GetExitCodeProcess($processHandle,[ref]$exitCode) | Out-Null
  @{exitCode=$exitCode} | ConvertTo-Json -Compress
} finally { [IsolatedHubNative]::FreeConsole() | Out-Null; [IsolatedHubNative]::CloseHandle($processHandle) | Out-Null }
