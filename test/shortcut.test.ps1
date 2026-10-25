param([Parameter(Mandatory=$true)][string]$StagingDirectory,[Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference='Stop'
$stage=[IO.Path]::GetFullPath($StagingDirectory)
$root=[IO.Path]::GetFullPath($TestRoot)
if($root -like '*\BaiduSyncdisk\*' -or $root -like '*\OneDrive\*' -or (Test-Path -LiteralPath $root)){throw 'FRESH_NON_SYNC_TEST_ROOT_REQUIRED'}
New-Item -ItemType Directory -Path $root | Out-Null
$original=Get-Content -LiteralPath (Join-Path $stage 'runtime.local.json') -Raw | ConvertFrom-Json
$wsh=New-Object -ComObject WScript.Shell
$source=Split-Path -Parent $PSScriptRoot
function Invoke-Check([string]$Script,[string[]]$ScriptArguments,[bool]$ExpectedSuccess){
 $savedPreference=$ErrorActionPreference
 try{
  $ErrorActionPreference='Continue'
  $output=& $original.powershellExe -NoLogo -NoProfile -NonInteractive -File $Script @ScriptArguments 2>&1
  $code=$LASTEXITCODE
 }finally{$ErrorActionPreference=$savedPreference}
 if(($code -eq 0) -ne $ExpectedSuccess){throw ('UNEXPECTED_TEST_EXIT: '+$code+' '+($output -join ' '))}
 return ($output -join [Environment]::NewLine)
}
function Prepare-Stage([string]$Name,[bool]$RetainAppId){
 $caseRoot=Join-Path $root $Name
 $caseStage=Join-Path $caseRoot 'stage'
 New-Item -ItemType Directory -Path $caseStage | Out-Null
 Get-ChildItem -LiteralPath $stage -File | Copy-Item -Destination $caseStage
 $shortcut=Join-Path $caseRoot 'ChatGPT.lnk'
 if($RetainAppId){Copy-Item -LiteralPath $original.originalShortcutBackup -Destination $shortcut}
 else{$link=$wsh.CreateShortcut($shortcut);$link.TargetPath=$original.appExeHint;$link.Save()}
 $backup=Join-Path $caseRoot 'original.lnk'
 Copy-Item -LiteralPath $shortcut -Destination $backup
 $config=Get-Content -LiteralPath (Join-Path $caseStage 'runtime.local.json') -Raw | ConvertFrom-Json
 $config.shortcutPath=$shortcut
 $config.originalShortcutBackup=$backup
 $config.originalShortcutSha256=(Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash
 $config.runtimeRoot=$caseStage
 if(-not $RetainAppId){$config.expectedAppUserModelId='com.openai.codex'}
 $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $caseStage 'runtime.local.json') -Encoding utf8
 return [pscustomobject]@{stage=$caseStage;runtime=(Join-Path $caseRoot 'runtime');shortcut=$shortcut;backup=$backup;originalHash=$config.originalShortcutSha256}
}
$good=Prepare-Stage 'normal' $true
[void](Invoke-Check (Join-Path $source 'Install-Preview.ps1') @('-StagingDirectory',$good.stage,'-RuntimeRoot',$good.runtime) $true)
$configPath=Join-Path $good.runtime 'runtime.local.json'
$config=Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if($wsh.CreateShortcut($good.shortcut).TargetPath -ne (Join-Path $good.runtime 'ChatGPTWidthLauncher.exe')){throw 'TEST_INSTALL_TARGET'}
$managedCopy=Join-Path $root 'managed.lnk'
Copy-Item -LiteralPath $good.shortcut -Destination $managedCopy
$changed=$wsh.CreateShortcut($good.shortcut)
$changed.Description='isolated external change'
$changed.Save()
$tamperedHash=(Get-FileHash -LiteralPath $good.shortcut -Algorithm SHA256).Hash
$output=Invoke-Check (Join-Path $source 'restore-shortcut.ps1') @('-ConfigPath',$configPath,'-CurrentOfficialExe',$original.appExeHint) $false
if($output -notmatch 'SHORTCUT_BYTES_CHANGED'){throw 'TEST_WRONG_CONFLICT_ERROR'}
if((Get-FileHash -LiteralPath $good.shortcut -Algorithm SHA256).Hash -ne $tamperedHash){throw 'TEST_CONFLICT_OVERWRITTEN'}
Copy-Item -LiteralPath $managedCopy -Destination $good.shortcut -Force
[void](Invoke-Check (Join-Path $source 'restore-shortcut.ps1') @('-ConfigPath',$configPath,'-CurrentOfficialExe',$original.appExeHint) $true)
if((Get-FileHash -LiteralPath $good.shortcut -Algorithm SHA256).Hash -ne $good.originalHash){throw 'TEST_RESTORE_BYTES'}
[void](Invoke-Check (Join-Path $source 'restore-shortcut.ps1') @('-ConfigPath',$configPath,'-CurrentOfficialExe',$original.appExeHint) $true)
$failed=Prepare-Stage 'rollback' $false
$output=Invoke-Check (Join-Path $source 'Install-Preview.ps1') @('-StagingDirectory',$failed.stage,'-RuntimeRoot',$failed.runtime) $false
if($output -notmatch 'APP_ID_NOT_PRESERVED'){throw 'TEST_WRONG_INSTALL_ERROR'}
if((Get-FileHash -LiteralPath $failed.shortcut -Algorithm SHA256).Hash -ne $failed.originalHash){throw 'TEST_INSTALL_ROLLBACK_BYTES'}
$gui=Join-Path $good.runtime 'ChatGPTWidthLauncher.exe'
$bytes=[IO.File]::ReadAllBytes($gui)
$peOffset=[BitConverter]::ToInt32($bytes,60)
if([BitConverter]::ToUInt16($bytes,$peOffset+92) -ne 2){throw 'TEST_NOT_GUI_SUBSYSTEM'}
$process=Start-Process -FilePath $gui -ArgumentList '--probe' -WindowStyle Hidden -PassThru -Wait
if($process.ExitCode -ne 0){throw 'TEST_GUI_PROBE_FAILED'}
$probe=Get-Content -LiteralPath (Join-Path $good.runtime 'state\last-launcher-result.json') -Raw | ConvertFrom-Json
if(-not $probe.ok -or -not $probe.official -or -not $probe.pipeOnly){throw 'TEST_PROBE_RESULT'}
[pscustomobject]@{shortcutInstall='passed';conflictProtection='passed';exactRestore='passed';repeatRestore='passed';installRollback='passed';guiSubsystem='passed';guiProbe='passed';clientRestarted=$false;cases=7} | ConvertTo-Json -Compress
