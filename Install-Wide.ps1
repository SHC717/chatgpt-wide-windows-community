param(
    [Parameter(Mandatory=$true)][string]$BackupRoot,
    [string]$NodePath,
    [string]$PowerShellPath,
    [string]$RuntimeRoot=(Join-Path $env:LOCALAPPDATA 'ChatGPTWideWindows'),
    [switch]$PlanOnly
)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'local-files.ps1')
if($PSVersionTable.PSVersion.Major -lt 7 -or -not [Environment]::Is64BitOperatingSystem) { throw 'WINDOWS_X64_POWERSHELL7_REQUIRED' }
$identity=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if($identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'RUN_AS_NORMAL_WINDOWS_USER' }
if(-not $NodePath) { $NodePath=(Get-Command node -ErrorAction Stop).Source }
if(-not $PowerShellPath) { $PowerShellPath=(Get-Command pwsh -ErrorAction Stop).Source }
foreach($file in @($NodePath,$PowerShellPath)) { if(-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw 'DEPENDENCY_NOT_FOUND' } }
$nodeVersion=(& $NodePath --version).Trim()
if($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 22) { throw 'NODE22_OR_NEWER_REQUIRED' }
$shellVersion=(& $PowerShellPath -NoLogo -NoProfile -NonInteractive -Command '$PSVersionTable.PSVersion.Major').Trim()
if($LASTEXITCODE -ne 0 -or $shellVersion -notmatch '^\d+$' -or [int]$shellVersion -lt 7) { throw 'POWERSHELL7_REQUIRED' }
$infoText=& $PowerShellPath -NoLogo -NoProfile -NonInteractive -File (Join-Path $PSScriptRoot 'app-info.ps1')
if($LASTEXITCODE -ne 0) { throw 'OFFICIAL_APP_CHECK_FAILED' }
$info=($infoText -join [Environment]::NewLine) | ConvertFrom-Json
if(-not $info.official -or $info.device -ne [Environment]::MachineName) { throw 'OFFICIAL_APP_CHECK_FAILED' }
$runtime=Assert-NonSyncPath $RuntimeRoot
$backupParent=Assert-NonSyncPath $BackupRoot
$backupItem=Get-Item -LiteralPath $backupParent
if(-not $backupItem.PSIsContainer -or $backupItem.LinkType) { throw 'BACKUP_ROOT_MUST_BE_EXISTING_NORMAL_DIRECTORY' }
$menu=Assert-NonSyncPath (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
if(-not (Test-Path -LiteralPath $menu -PathType Container)) { throw 'START_MENU_DIRECTORY_NOT_FOUND' }
$shortcut=Join-Path $menu 'ChatGPT 宽屏（社区版）.lnk'
if(Test-Path -LiteralPath $runtime) { throw 'EXISTING_INSTALLATION_REQUIRES_INSPECTION' }
if(Test-Path -LiteralPath $shortcut) { throw 'EXISTING_SHORTCUT_PRESERVED' }
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if(-not (Test-Path -LiteralPath $compiler -PathType Leaf)) { throw 'FRAMEWORK_COMPILER_NOT_FOUND' }
if($PlanOnly) {
    [pscustomobject]@{ready=$true;official=$true;nodeVersion=$nodeVersion;runtime=$runtime;shortcut=$shortcut;backupRoot=$backupParent;clientWillBeRestarted=$false;filesWritten=$false} | ConvertTo-Json -Compress
    return
}
$suffix=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup=Join-Path $backupParent ('ChatGPTWideWindows-'+$suffix)
$stage=Join-Path ([IO.Path]::GetTempPath()) ('ChatGPTWideWindows-build-'+$suffix)
foreach($directory in @($backup,$stage)) { if(Test-Path -LiteralPath $directory) { throw 'NEW_DIRECTORY_ALREADY_EXISTS' } }
New-Item -ItemType Directory -Path $backup,$stage | Out-Null
$baseline=Join-Path $backup 'ChatGPT.original.lnk'
$shell=New-Object -ComObject WScript.Shell
$link=$shell.CreateShortcut($baseline)
$link.TargetPath=$info.appExe
$link.WorkingDirectory=Split-Path -Parent $info.appExe
$link.Description='ChatGPT official launch target; community shortcut rollback baseline'
$link.Save()
Assert-RealFile $baseline
$baselineHash=(Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash
& (Join-Path $PSScriptRoot 'Build-Preview.ps1') -OutputDirectory $stage -NodePath $NodePath -PowerShellPath $PowerShellPath -AppHint $info.appExe -BackupDirectory $backup -ShortcutPath $shortcut | Out-Null
if(-not (Test-Path -LiteralPath (Join-Path $stage 'ChatGPTWidthLauncher.exe'))) { throw 'GUI_BUILD_FAILED' }
$probe=Start-Process -FilePath (Join-Path $stage 'ChatGPTWidthLauncher.exe') -ArgumentList '--probe' -WindowStyle Hidden -PassThru -Wait
if($probe.ExitCode -ne 0) { throw 'GUI_PROBE_FAILED' }
$probeState=Get-Content -LiteralPath (Join-Path $stage 'state\last-launcher-result.json') -Raw | ConvertFrom-Json
if(-not $probeState.ok -or -not $probeState.official -or -not $probeState.pipeOnly) { throw 'GUI_PROBE_NOT_CONFIRMED' }
# Only this new independent shortcut is touched. Existing official entries stay intact.
[IO.File]::Copy($baseline,$shortcut,$false)
try {
    Assert-RealFile $shortcut
    & (Join-Path $PSScriptRoot 'Install-Preview.ps1') -StagingDirectory $stage -RuntimeRoot $runtime | Out-Null
    foreach($name in @('runtime.local.json','controller.mjs','width-style.mjs','ChatGPTWidthLauncher.exe')) { Assert-RealFile (Join-Path $runtime $name) }
    Assert-RealFile $shortcut
} catch {
    # Remove our newly created baseline only when its exact bytes are still present.
    if((Test-Path -LiteralPath $shortcut -PathType Leaf) -and (Get-FileHash -LiteralPath $shortcut -Algorithm SHA256).Hash -eq $baselineHash) {
        Assert-RealFile $shortcut
        [IO.File]::Delete($shortcut)
    }
    throw
}
[pscustomobject]@{installed=$true;runtime=$runtime;shortcut=$shortcut;backup=$backup;staging=$stage;clientRestarted=$false;next='When convenient, fully quit the app and launch ChatGPT 宽屏（社区版）.'} | ConvertTo-Json -Compress
