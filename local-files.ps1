# Installation helpers. These verify data-file handles, not just path strings.
function Assert-NonSyncPath([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if($full -match '(?i)(^|[\\/])(BaiduSyncdisk|OneDrive(?: - [^\\/]+)?)([\\/]|$)') { throw 'LOCAL_NON_SYNC_PATH_REQUIRED' }
    return $full
}
function Assert-RealFile([string]$Path) {
    $full=[IO.Path]::GetFullPath($Path)
    if(-not ('ChatGPTWideWindows.DataHandle' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace ChatGPTWideWindows {
    public static class DataHandle {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder path, uint count, uint flags);
    }
}
'@
    }
    $file=[IO.File]::Open($full,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
    try {
        $text=[Text.StringBuilder]::new(32768)
        $length=[ChatGPTWideWindows.DataHandle]::GetFinalPathNameByHandle($file.SafeFileHandle,$text,32768,0)
        if($length -eq 0 -or $length -ge 32768) { throw 'DATA_HANDLE_PATH_UNAVAILABLE' }
        $actual=$text.ToString()
        if($actual.StartsWith('\\?\UNC\')) { $actual='\\'+$actual.Substring(8) }
        elseif($actual.StartsWith('\\?\')) { $actual=$actual.Substring(4) }
        if(-not [string]::Equals($actual,$full,[StringComparison]::OrdinalIgnoreCase)) { throw 'DATA_FILE_PATH_REDIRECTED' }
    } finally { $file.Dispose() }
}
