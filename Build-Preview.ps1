param(
 [Parameter(Mandatory=$true)][string]$OutputDirectory,
 [Parameter(Mandatory=$true)][string]$NodePath,
 [Parameter(Mandatory=$true)][string]$PowerShellPath,
 [Parameter(Mandatory=$true)][string]$AppHint,
 [Parameter(Mandatory=$true)][string]$BackupDirectory,
 [string]$ShortcutPath=(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ChatGPT 宽屏（社区版）.lnk'),
 [string]$LegacyStatePath
)
$ErrorActionPreference='Stop'
$output=[IO.Path]::GetFullPath($OutputDirectory)
if($output -like '*\BaiduSyncdisk\*' -or $output -like '*\OneDrive\*'){throw 'OUTPUT_MUST_BE_NON_SYNC'}
New-Item -ItemType Directory -Path $output -Force | Out-Null
foreach($name in @('pipe-client.mjs','width-style.mjs','controller.mjs','entry.mjs','app-info.ps1','restore-shortcut.ps1','UPSTREAM-LICENSE.txt')){
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $output $name)
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'RUNTIME-README.md') -Destination (Join-Path $output 'README.md')
Add-Type -AssemblyName System.Drawing
$icon=[Drawing.Icon]::ExtractAssociatedIcon($AppHint)
$stream=[IO.File]::Create((Join-Path $output 'ChatGPT.ico'))
try{$icon.Save($stream)}finally{$stream.Dispose();$icon.Dispose()}
$compiler=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $compiler /nologo /utf8output /target:winexe /optimize+ /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll ('/win32icon:'+(Join-Path $output 'ChatGPT.ico')) ('/out:'+(Join-Path $output 'ChatGPTWidthLauncher.exe')) (Join-Path $PSScriptRoot 'Launcher.cs')
if($LASTEXITCODE -ne 0){throw 'GUI_BUILD_FAILED'}
$shortcut=[IO.Path]::GetFullPath($ShortcutPath)
$backupFile=Join-Path $BackupDirectory 'ChatGPT.original.lnk'
$config=[ordered]@{
 schemaVersion=1;version='0.2.0-community.1';device=[Environment]::MachineName;enabled=$true;widthPercent=90;
 runtimeRoot=$output;nodeExe=$NodePath;powershellExe=$PowerShellPath;appExeHint=$AppHint;
 legacyStatePath=$LegacyStatePath;shortcutPath=$shortcut;originalShortcutBackup=$backupFile;
 originalShortcutSha256=(Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash;
 managedShortcutSha256=$null;expectedAppUserModelId=$null
}
$config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output 'runtime.local.json') -Encoding utf8
[pscustomobject]@{built=$true;output=$output;exeSha256=(Get-FileHash -LiteralPath (Join-Path $output 'ChatGPTWidthLauncher.exe') -Algorithm SHA256).Hash}|ConvertTo-Json -Compress
