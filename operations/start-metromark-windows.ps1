# Starts the two MetroMark console windows and snaps them side by side
# (Win+Left / Win+Right). Only sends the snap keys after confirming the target
# window is foreground, so it never snaps the wrong window. Output goes to
# operations\Logs\start-metromark.log.

param(
    [string]$RepoRoot
)

$ErrorActionPreference = "Continue"

if (-not $RepoRoot) { $RepoRoot = Split-Path -Parent $PSScriptRoot }

$logDir = Join-Path $RepoRoot "operations\Logs"
$logFile = Join-Path $logDir "start-metromark.log"
try { New-Item -ItemType Directory -Path $logDir -Force | Out-Null } catch {}
Start-Transcript -Path $logFile -Append | Out-Null

function Write-Log { Write-Output ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $_) }

try {
    Add-Type -Namespace W -Name N -MemberDefinition @"
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
"@
    Write-Log "PInvoke OK"
} catch {
    Write-Log "PInvoke FAILED: $($_.Exception.Message)"
    Stop-Transcript | Out-Null
    exit 1
}

$VK_LWIN = 0x5B
$VK_LEFT = 0x25
$VK_RIGHT = 0x27
$KEYEVENTF_KEYUP = 0x0002

function Find-WindowByTitle {
    param([string]$TitlePrefix)
    $script:found = [IntPtr]::Zero
    $cb = {
        param($hWnd, $lParam)
        if (-not [W.N]::IsWindowVisible($hWnd)) { return $true }
        $sb = New-Object System.Text.StringBuilder 512
        [W.N]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
        if ($sb.ToString() -like "$TitlePrefix*") {
            $script:found = $hWnd
            return $false
        }
        return $true
    }
    [W.N]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
    return $script:found
}

# Bring Hwnd to the foreground; only returns true once GetForegroundWindow
# confirms it. AttachThreadInput is needed for SetForegroundWindow to be
# permitted from a script; AppActivate is the fallback for console windows.
function Bring-ToForeground {
    param([IntPtr]$Hwnd, [string]$Title)
    $deadline = (Get-Date).AddSeconds(4)
    while ((Get-Date) -lt $deadline) {
        $fg = [W.N]::GetForegroundWindow()
        if ($fg -eq $Hwnd) { return $true }

        $fgThread = 0
        if ($fg -ne [IntPtr]::Zero) {
            [W.N]::GetWindowThreadProcessId($fg, [ref]$fgThread) | Out-Null
        }
        $cur = [W.N]::GetCurrentThreadId()
        if ($fgThread -ne 0 -and $fgThread -ne $cur) {
            [W.N]::AttachThreadInput($cur, $fgThread, $true) | Out-Null
            [W.N]::SetForegroundWindow($Hwnd) | Out-Null
            [W.N]::AttachThreadInput($cur, $fgThread, $false) | Out-Null
        } else {
            [W.N]::SetForegroundWindow($Hwnd) | Out-Null
        }

        try {
            $shell = New-Object -ComObject WScript.Shell
            $shell.AppActivate($Title) | Out-Null
        } catch { }

        Start-Sleep -Milliseconds 250
        $fg = [W.N]::GetForegroundWindow()
        if ($fg -eq $Hwnd) { return $true }
    }
    return $false
}

function Snap-Window {
    param([IntPtr]$Hwnd, [string]$Title, [string]$Side)
    if (-not (Bring-ToForeground -Hwnd $Hwnd -Title $Title)) {
        Write-Log "  SKIP '$Title': could not bring it to the foreground (won't snap the wrong window)."
        return
    }
    Start-Sleep -Milliseconds 300

    $key = if ($Side -eq 'right') { $VK_RIGHT } else { $VK_LEFT }
    [W.N]::keybd_event([byte]$VK_LWIN, 0, 0, [UIntPtr]::Zero)
    [W.N]::keybd_event([byte]$key, 0, 0, [UIntPtr]::Zero)
    [W.N]::keybd_event([byte]$key, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    [W.N]::keybd_event([byte]$VK_LWIN, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 400
    Write-Log "  snapped '$Title' $Side"
}

Write-Log "Launching windows..."
Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'start "MetroMark Server" cmd /k "npm run start:prod"' -WorkingDirectory $RepoRoot -WindowStyle Hidden | Out-Null
Start-Process -FilePath "cmd.exe" -ArgumentList '/c', 'start "MetroMark Harvester" cmd /k "call operations\run-harvesters.bat"' -WorkingDirectory $RepoRoot -WindowStyle Hidden | Out-Null

$server = [IntPtr]::Zero
$harvester = [IntPtr]::Zero
$deadline = (Get-Date).AddSeconds(12)
while ((Get-Date) -lt $deadline -and ($server -eq [IntPtr]::Zero -or $harvester -eq [IntPtr]::Zero)) {
    if ($server -eq [IntPtr]::Zero) {
        $server = Find-WindowByTitle -TitlePrefix "MetroMark Server"
    }
    if ($harvester -eq [IntPtr]::Zero) {
        $harvester = Find-WindowByTitle -TitlePrefix "MetroMark Harvester"
    }
    if ($server -eq [IntPtr]::Zero -or $harvester -eq [IntPtr]::Zero) {
        Start-Sleep -Milliseconds 400
    }
}

Write-Log "server window found: $($server -ne [IntPtr]::Zero)"
Write-Log "harvester window found: $($harvester -ne [IntPtr]::Zero)"

if ($server -ne [IntPtr]::Zero) {
    Snap-Window -Hwnd $server -Title "MetroMark Server" -Side 'left'
} else {
    Write-Log "WARNING: could not find MetroMark Server window"
}
if ($harvester -ne [IntPtr]::Zero) {
    Snap-Window -Hwnd $harvester -Title "MetroMark Harvester" -Side 'right'
} else {
    Write-Log "WARNING: could not find MetroMark Harvester window"
}

Write-Log "MetroMark started."
Stop-Transcript | Out-Null
