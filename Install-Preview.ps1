param([Parameter(Mandatory=$true)][string]$StagingDirectory,[string]$RuntimeRoot=(Join-Path $env:LOCALAPPDATA 'CodexWidthPreview'))
$ErrorActionPreference='Stop'
$stage=[IO.Path]::GetFullPath($StagingDirectory)
$runtime=[IO.Path]::GetFullPath($RuntimeRoot)
if($runtime -like '*\BaiduSyncdisk\*' -or $runtime -like '*\OneDrive\*'){throw 'RUNTIME_MUST_BE_NON_SYNC'}
if(Test-Path -LiteralPath $runtime){throw 'RUNTIME_ALREADY_EXISTS'}
$config=Get-Content -LiteralPath (Join-Path $stage 'runtime.local.json') -Raw | ConvertFrom-Json
if($config.device -ne [Environment]::MachineName){throw 'WRONG_DEVICE'}
if((Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'ORIGINAL_SHORTCUT_CHANGED'}
if((Get-FileHash -LiteralPath $config.originalShortcutBackup -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'BACKUP_CHANGED'}
New-Item -ItemType Directory -Path $runtime | Out-Null
$names=@('ChatGPTWidthLauncher.exe','ChatGPT.ico','pipe-client.mjs','width-style.mjs','controller.mjs','entry.mjs','app-info.ps1','restore-shortcut.ps1','README.md','UPSTREAM-LICENSE.txt')
foreach($name in $names){
 Copy-Item -LiteralPath (Join-Path $stage $name) -Destination (Join-Path $runtime $name)
 if((Get-FileHash -LiteralPath (Join-Path $stage $name) -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath (Join-Path $runtime $name) -Algorithm SHA256).Hash){throw 'DEPLOYED_FILE_MISMATCH'}
}
$config.runtimeRoot=$runtime
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtime 'runtime.local.json') -Encoding utf8
$wsh=New-Object -ComObject WScript.Shell
foreach($entry in @(@{name='恢复默认宽度.lnk';action='restore'},@{name='恢复90%宽屏.lnk';action='apply'},@{name='恢复官方启动方式.lnk';action='disable'})){
 $link=$wsh.CreateShortcut((Join-Path $runtime $entry.name))
 $link.TargetPath=Join-Path $runtime 'ChatGPTWidthLauncher.exe'
 $link.Arguments='--'+$entry.action
 $link.WorkingDirectory=$runtime
 $link.IconLocation=(Join-Path $runtime 'ChatGPT.ico')+',0'
 $link.Save()
}
$shortcutTouched=$false
try {
 if((Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'ORIGINAL_SHORTCUT_CHANGED'}
 $link=$wsh.CreateShortcut($config.shortcutPath)
 $link.TargetPath=Join-Path $runtime 'ChatGPTWidthLauncher.exe'
 $link.Arguments=''
 $link.WorkingDirectory=$runtime
 $link.IconLocation=(Join-Path $runtime 'ChatGPT.ico')+',0'
 $shortcutTouched=$true
 $link.Save()
 if($config.expectedAppUserModelId){
  $shell=New-Object -ComObject Shell.Application
  $folder=$shell.NameSpace((Split-Path -Parent $config.shortcutPath))
  $item=$folder.ParseName((Split-Path -Leaf $config.shortcutPath))
  if($item.ExtendedProperty('System.AppUserModel.ID') -ne $config.expectedAppUserModelId){throw 'APP_ID_NOT_PRESERVED'}
 }
 $verified=$wsh.CreateShortcut($config.shortcutPath)
 if($verified.TargetPath -ne (Join-Path $runtime 'ChatGPTWidthLauncher.exe')){throw 'SHORTCUT_TARGET_NOT_VERIFIED'}
 $config.managedShortcutSha256=(Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash
 $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtime 'runtime.local.json') -Encoding utf8
 $manifest=@($names | ForEach-Object{[pscustomobject]@{path=$_;sha256=(Get-FileHash -LiteralPath (Join-Path $runtime $_) -Algorithm SHA256).Hash;bytes=(Get-Item -LiteralPath (Join-Path $runtime $_)).Length}})
 [pscustomobject]@{version='0.2.0-community.1';device=[Environment]::MachineName;installedAt=[DateTimeOffset]::UtcNow.ToString('o');sourceRoot=$PSScriptRoot;shortcut=$config.shortcutPath;shortcutSha256=$config.managedShortcutSha256;files=$manifest;clientRestarted=$false} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $runtime 'deployment.json') -Encoding utf8
} catch {
 if($shortcutTouched){
  $current=$wsh.CreateShortcut($config.shortcutPath)
  if($current.TargetPath -eq (Join-Path $runtime 'ChatGPTWidthLauncher.exe')){
   if((Get-FileHash -LiteralPath $config.originalShortcutBackup -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'INSTALL_FAILED_BACKUP_CHANGED'}
   Copy-Item -LiteralPath $config.originalShortcutBackup -Destination $config.shortcutPath -Force
   if((Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'INSTALL_ROLLBACK_NOT_CONFIRMED'}
  } elseif((Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'INSTALL_FAILED_SHORTCUT_CHANGED_EXTERNALLY'}
 }
 throw
}
[pscustomobject]@{deployed=$true;runtime=$runtime;shortcut=$config.shortcutPath;clientRestarted=$false}|ConvertTo-Json -Compress
