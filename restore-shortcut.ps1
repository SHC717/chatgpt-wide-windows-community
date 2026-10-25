param([Parameter(Mandatory=$true)][string]$ConfigPath,[Parameter(Mandatory=$true)][string]$CurrentOfficialExe)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$config=Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($config.shortcutPath)
if($shortcut.TargetPath -eq $CurrentOfficialExe){[pscustomobject]@{restored=$false;alreadyOfficial=$true}|ConvertTo-Json -Compress;exit}
if($shortcut.TargetPath -ne (Join-Path $config.runtimeRoot 'ChatGPTWidthLauncher.exe')){throw 'SHORTCUT_TARGET_CHANGED'}
if((Get-FileHash -LiteralPath $config.originalShortcutBackup -Algorithm SHA256).Hash -ne $config.originalShortcutSha256){throw 'BACKUP_HASH_MISMATCH'}
if((Get-FileHash -LiteralPath $config.shortcutPath -Algorithm SHA256).Hash -ne $config.managedShortcutSha256){throw 'SHORTCUT_BYTES_CHANGED'}
Copy-Item -LiteralPath $config.originalShortcutBackup -Destination $config.shortcutPath -Force
$shortcut=$shell.CreateShortcut($config.shortcutPath)
if($shortcut.TargetPath -ne $CurrentOfficialExe){$shortcut.TargetPath=$CurrentOfficialExe;$shortcut.WorkingDirectory=Split-Path -Parent $CurrentOfficialExe;$shortcut.Save()}
$verified=$shell.CreateShortcut($config.shortcutPath)
if($verified.TargetPath -ne $CurrentOfficialExe){throw 'SHORTCUT_RESTORE_FAILED'}
[pscustomobject]@{restored=$true;alreadyOfficial=$false}|ConvertTo-Json -Compress
