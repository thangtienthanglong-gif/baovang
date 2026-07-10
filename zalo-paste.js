const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function runWindowsZaloPaste(message, link, imageBase64 = null) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      const err = new Error('Tự dán vào Zalo chỉ hỗ trợ khi app chạy trên Windows.');
      err.status = 400;
      reject(err);
      return;
    }

    const script = `
$ErrorActionPreference = 'Stop'
$msg = ""
if ($env:ZALO_AUTOPASTE_MESSAGE_B64) {
  $msg = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZALO_AUTOPASTE_MESSAGE_B64))
}
if ($env:ZALO_AUTOPASTE_IMAGE_B64) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $base64Image = $env:ZALO_AUTOPASTE_IMAGE_B64
    if ($base64Image -match "^data:image/.*?;base64,(.*)$") {
      $base64Image = $matches[1]
    }
    $bytes = [Convert]::FromBase64String($base64Image)
    $ms = New-Object System.IO.MemoryStream($bytes, 0, $bytes.Length)
    $img = [System.Drawing.Image]::FromStream($ms)
    [System.Windows.Forms.Clipboard]::SetImage($img)
  } catch {
    $msg = "Lỗi copy ảnh: " + $_.Exception.Message
  }
}
$link = ""
if ($env:ZALO_AUTOPASTE_LINK_B64) {
  $link = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:ZALO_AUTOPASTE_LINK_B64))
}
if ($link) { Start-Process $link }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32ZaloPaste {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint GetIdleTime() {
    LASTINPUTINFO lastInPut = new LASTINPUTINFO();
    lastInPut.cbSize = (uint)Marshal.SizeOf(lastInPut);
    if (!GetLastInputInfo(ref lastInPut)) return 0;
    return (uint)Environment.TickCount - lastInPut.dwTime;
  }
}
public struct RECT {
  public int Left;
  public int Top;
  public int Right;
  public int Bottom;
}
[StructLayout(LayoutKind.Sequential)]
public struct LASTINPUTINFO {
  public uint cbSize;
  public uint dwTime;
}
"@

function Click-Point($x, $y) {
  [Win32ZaloPaste]::SetCursorPos([int]$x, [int]$y) | Out-Null
  Start-Sleep -Milliseconds 80
  [Win32ZaloPaste]::mouse_event(0x0002, 0, 0, 0, 0)
  [Win32ZaloPaste]::mouse_event(0x0004, 0, 0, 0, 0)
}

function Click-WindowRatio($handle, $xRatio, $yRatio) {
  try {
    $rect = New-Object RECT
    if ([Win32ZaloPaste]::GetWindowRect([IntPtr]$handle, [ref]$rect)) {
      $width = [Math]::Max(1, $rect.Right - $rect.Left)
      $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
      Click-Point ($rect.Left + ($width * $xRatio)) ($rect.Top + ($height * $yRatio))
      return $true
    }
  } catch {}
  return $false
}

function Activate-Window($handle) {
  try {
    [Win32ZaloPaste]::ShowWindowAsync($handle, 9) | Out-Null
    [Win32ZaloPaste]::SetForegroundWindow($handle) | Out-Null
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $handle } | Select-Object -First 1
    if ($proc) {
      $shell = New-Object -ComObject WScript.Shell
      $shell.AppActivate([int]$proc.Id) | Out-Null
    }
    Start-Sleep -Milliseconds 250
  } catch {}
}

function Invoke-AutomationElement($element) {
  try {
    $pattern = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    if ($pattern) {
      $pattern.Invoke()
      return $true
    }
  } catch {}

  try {
    $rect = $element.Current.BoundingRectangle
    if ($rect.Width -gt 0 -and $rect.Height -gt 0) {
      $x = [int]($rect.Left + ($rect.Width / 2))
      $y = [int]($rect.Top + ($rect.Height / 2))
      Click-Point $x $y
      return $true
    }
  } catch {}

  return $false
}

function Focus-ChatInputArea($handle) {
  [Win32ZaloPaste]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 150
  
  # Click trực tiếp vào tọa độ ô chat (50% X, 97% Y) để tránh trúng thanh công cụ chụp màn hình
  Click-WindowRatio $handle 0.5 0.97 | Out-Null
  return $true
}

function Find-ZaloWindowHandle {
  $windows = Get-Process |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Where-Object {
      $_.MainWindowTitle -match 'Zalo' -or
      $_.ProcessName -match 'Zalo|chrome|msedge|firefox|brave'
    } |
    Sort-Object StartTime -ErrorAction SilentlyContinue

  $zaloWindow = $windows | Where-Object { $_.MainWindowTitle -match 'Zalo' } | Select-Object -Last 1
  if ($zaloWindow) { return [IntPtr]$zaloWindow.MainWindowHandle }

  $foreground = [Win32ZaloPaste]::GetForegroundWindow()
  if ($foreground -ne [IntPtr]::Zero) { return $foreground }

  $fallback = $windows | Select-Object -Last 1
  if ($fallback) { return [IntPtr]$fallback.MainWindowHandle }
  return [IntPtr]::Zero
}

$handle = [IntPtr]::Zero
$global:focused = $false
$zaloSeenCount = 0
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  $handle = Find-ZaloWindowHandle
  if ($handle -ne [IntPtr]::Zero) {
    $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $handle } | Select-Object -First 1
    $isRealZalo = ($proc -and $proc.ProcessName -match '(?i)^Zalo$')

    Activate-Window $handle
    Start-Sleep -Milliseconds 400
    
    # Chúng ta đã bỏ UIAutomation chậm chạp, nên có thể click luôn
    if (Focus-ChatInputArea $handle) { 
      $global:focused = $true
      break 
    }
    
    if ($isRealZalo) {
      $zaloSeenCount++
      if ($zaloSeenCount -ge 12) {
        break
      }
    }
  }
}

if ($handle -eq [IntPtr]::Zero) {
  throw 'Không tìm thấy cửa sổ Zalo để dán tin nhắn.'
}

if (-not $global:focused) {
  Start-Sleep -Milliseconds 2000
  Activate-Window $handle
  Focus-ChatInputArea $handle | Out-Null
}

Start-Sleep -Milliseconds 500

if (-not $env:ZALO_AUTOPASTE_IMAGE_B64) {
  Set-Clipboard -Value $msg
}
Start-Sleep -Milliseconds 300

if ($msg -or $env:ZALO_AUTOPASTE_IMAGE_B64) {
  Start-Sleep -Milliseconds 1500
  # Sử dụng keybd_event không đồng bộ để tránh bị treo (SendWait có thể block 30s)
  [Win32ZaloPaste]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
  [Win32ZaloPaste]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Win32ZaloPaste]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
  [Win32ZaloPaste]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
  
  Start-Sleep -Milliseconds 400
  
  [Win32ZaloPaste]::keybd_event(0x0D, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [Win32ZaloPaste]::keybd_event(0x0D, 0, 2, [UIntPtr]::Zero)
}

`;
    const msgB64 = Buffer.from(message || '').toString('base64');
    const linkB64 = Buffer.from(link || '').toString('base64');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    
    const child = spawn('powershell.exe', ['-Sta', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      env: {
        ...process.env,
        ZALO_AUTOPASTE_MESSAGE_B64: msgB64,
        ZALO_AUTOPASTE_LINK_B64: linkB64,
        ZALO_AUTOPASTE_IMAGE_B64: imageBase64 || ''
      }
    });

    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      const err = new Error('Mở Zalo và tự dán quá lâu. Hãy dùng nút Copy tin rồi dán thủ công.');
      err.status = 500;
      reject(err);
    }, 30000);

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      const err = new Error(stderr.trim() || 'Không mở/dán được vào Zalo. Hãy dùng nút Copy tin rồi dán thủ công.');
      err.status = 500;
      reject(err);
    });
  });
}