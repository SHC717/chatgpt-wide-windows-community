param(
    [Parameter(Mandatory=$true)][string]$TestRoot,
    [string]$NodePath=(Get-Command node -ErrorAction Stop).Source,
    [string]$PowerShellPath=(Get-Command pwsh -ErrorAction Stop).Source
)
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'local-files.ps1')
$root=Assert-NonSyncPath $TestRoot
if(Test-Path -LiteralPath $root){throw 'FRESH_TEST_ROOT_REQUIRED'}
$menu=Join-Path $root 'roaming\Microsoft\Windows\Start Menu\Programs'
$local=Join-Path $root 'local'
$backup=Join-Path $root 'backup'
New-Item -ItemType Directory -Path $menu,$local,$backup | Out-Null
$previousRoaming=$env:APPDATA
$previousLocal=$env:LOCALAPPDATA
try {
    # Environment changes affect only this test process and its child processes.
    $env:APPDATA=Join-Path $root 'roaming'
    $env:LOCALAPPDATA=$local
    $result=& (Join-Path $repo 'Install-Wide.ps1') -BackupRoot $backup -NodePath $NodePath -PowerShellPath $PowerShellPath
    $install=($result -join [Environment]::NewLine)|ConvertFrom-Json
    if(-not $install.installed -or $install.clientRestarted){throw 'ISOLATED_INSTALL_NOT_CONFIRMED'}
    $shortcutHash=(Get-FileHash -LiteralPath $install.shortcut -Algorithm SHA256).Hash
    $expectedConflict=$false
    try { & (Join-Path $repo 'Install-Wide.ps1') -BackupRoot $backup -NodePath $NodePath -PowerShellPath $PowerShellPath | Out-Null }
    catch { if($_.Exception.Message -match 'EXISTING_INSTALLATION_REQUIRES_INSPECTION'){$expectedConflict=$true}else{throw} }
    if(-not $expectedConflict -or $shortcutHash -ne (Get-FileHash -LiteralPath $install.shortcut -Algorithm SHA256).Hash){throw 'EXISTING_INSTALL_OVERWRITTEN'}
    & $PowerShellPath -NoLogo -NoProfile -NonInteractive -File (Join-Path $repo 'test\shortcut.test.ps1') -StagingDirectory $install.staging -TestRoot (Join-Path $root 'shortcut-regression')
    if($LASTEXITCODE -ne 0){throw 'SHORTCUT_REGRESSION_FAILED'}
    $blocked=$false
    try { Assert-NonSyncPath 'D:\OneDrive\not-for-install' | Out-Null } catch { if($_.Exception.Message -eq 'LOCAL_NON_SYNC_PATH_REQUIRED'){$blocked=$true}else{throw} }
    if(-not $blocked){throw 'SYNC_PATH_NOT_REJECTED'}
    [pscustomobject]@{firstInstall='passed';existingInstallProtection='passed';realDataHandles='passed';syncPathRejection='passed';productionStartMenuTouched=$false;clientRestarted=$false} | ConvertTo-Json -Compress
} finally {
    $env:APPDATA=$previousRoaming
    $env:LOCALAPPDATA=$previousLocal
}
