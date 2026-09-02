# MetroMark console-window layout helper.
#
# Arranges the two MetroMark console windows side by side on the primary
# monitor: "MetroMark Server" on the left half, "MetroMark Harvester" on the
# right half. Best-effort: if either window is missing (e.g. the server crashed
# before this ran) the other one is still placed.
#
# Invoked from operations\start-metromark.bat after the windows open.

$ErrorActionPreference = "SilentlyContinue"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -Namespace W -Name N -MemberDefinition @"
[DllImport("user32.dll")]
public static extern bool SetWindowPos(IntPtr h, IntPtr a, int X, int Y, int cx, int cy, uint f);
"@

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$halfW = [int]($bounds.Width / 2)
$height = [int]$bounds.Height

$server = Get-Process cmd | Where-Object { $_.MainWindowTitle -like "MetroMark Server*" } | Select-Object -First 1
$harvester = Get-Process cmd | Where-Object { $_.MainWindowTitle -like "MetroMark Harvester*" } | Select-Object -First 1

if ($server) {
    [W.N]::SetWindowPos($server.MainWindowHandle, [IntPtr]::Zero, 0, 0, $halfW, $height, 0x0040) | Out-Null
}
if ($harvester) {
    [W.N]::SetWindowPos($harvester.MainWindowHandle, [IntPtr]::Zero, $halfW, 0, $halfW, $height, 0x0040) | Out-Null
}
