param([string]$AppHint)
$ErrorActionPreference='Stop'
$WarningPreference='SilentlyContinue'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$processes=@(Get-CimInstance Win32_Process -Filter "Name='ChatGPT.exe'" | Where-Object {$_.CommandLine -notmatch '--type='})
$package=$null
try {$package=Get-AppxPackage -Name OpenAI.Codex -WarningAction SilentlyContinue | Select-Object -First 1} catch {}
$registered=if($package){Join-Path $package.InstallLocation 'app\ChatGPT.exe'}else{$null}
$candidates=@($registered)+@($processes | Select-Object -ExpandProperty ExecutablePath)+@($AppHint)
$selected=$null
foreach($candidate in $candidates){
    if(-not $candidate -or -not (Test-Path -LiteralPath $candidate -PathType Leaf)){continue}
    if($candidate -notmatch '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$'){continue}
    $item=Get-Item -LiteralPath $candidate
    if($item.LinkType){continue}
    $signature=Get-AuthenticodeSignature -LiteralPath $candidate
    if($signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match 'O=.?OpenAI OpCo, LLC'){$selected=$item.FullName;break}
}
if(-not $selected){throw 'OFFICIAL_APP_NOT_FOUND'}
$running=@($processes | Where-Object {$_.ExecutablePath -match '\\WindowsApps\\OpenAI\.Codex_[^\\]+\\app\\ChatGPT\.exe$'} | ForEach-Object {
    [pscustomobject]@{pid=$_.ProcessId;executablePath=$_.ExecutablePath;hasPipe=($_.CommandLine -match '--remote-debugging-pipe');hasPort=($_.CommandLine -match '--remote-debugging-port')}
})
[pscustomobject]@{device=[Environment]::MachineName;official=$true;appExe=$selected;registeredPackage=($null -ne $package);running=$running} | ConvertTo-Json -Depth 4 -Compress
