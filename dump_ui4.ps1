Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32GetObj {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string lpszClass, string lpszWindow);
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
"@

$zalo = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($zalo -eq $null) { Write-Host "Zalo not running"; exit }
$handle = $zalo.MainWindowHandle

$chrome = [Win32GetObj]::FindWindowEx($handle, [IntPtr]::Zero, "Chrome_WidgetWin_0", $null)
$render = [Win32GetObj]::FindWindowEx($chrome, [IntPtr]::Zero, "Chrome_RenderWidgetHostHWND", $null)
if ($render -ne [IntPtr]::Zero) {
    Write-Host "Found RenderWidget, sending WM_GETOBJECT..."
    [Win32GetObj]::SendMessage($render, 0x003D, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
}

Start-Sleep -Seconds 1

$auto = [System.Windows.Automation.AutomationElement]::FromHandle($handle)

$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$btns = $auto.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
Write-Host "Found $($btns.Count) buttons"
foreach ($b in $btns) { Write-Host ("Button: '" + $b.Current.Name + "'") }

$condT = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
$texts = $auto.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condT)
Write-Host "Found $($texts.Count) texts"
foreach ($t in $texts) { Write-Host ("Text: '" + $t.Current.Name + "'") }
