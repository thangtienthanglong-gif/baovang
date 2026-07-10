const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');

function id(prefix = '') {
  return prefix + '_' + Date.now() + Math.random().toString(36).substring(2, 6);
}

// Copy the runWindowsZaloPaste function here
function runWindowsZaloPaste(message, link, imageBase64 = null) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') {
      return reject(new Error('Chỉ hỗ trợ trên Windows.'));
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
  return $false
}

$zaloProc = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($zaloProc) {
  $handle = $zaloProc.MainWindowHandle
  [Win32ZaloPaste]::ShowWindowAsync($handle, 9) | Out-Null
  [Win32ZaloPaste]::SetForegroundWindow($handle) | Out-Null
  Start-Sleep -Milliseconds 100
  [System.Windows.Forms.SendKeys]::SendWait("{ESC}")
  Start-Sleep -Milliseconds 100
}

if ($link) { Start-Process $link }
Start-Sleep -Seconds 1

$zaloProc = Get-Process -Name "Zalo" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $zaloProc) {
  if ($msg) { [System.Windows.Forms.Clipboard]::SetText($msg) }
  Write-Host "Zalo not running"
  exit 0
}

$handle = $zaloProc.MainWindowHandle
Activate-Window $handle

if ($msg) { [System.Windows.Forms.Clipboard]::SetText($msg) }
Start-Sleep -Milliseconds 150

$winId = [Win32ZaloPaste]::GetForegroundWindow()
if ($winId -ne $handle) {
  Activate-Window $handle
  $winId = [Win32ZaloPaste]::GetForegroundWindow()
}
if ($winId -ne $handle) {
  Write-Host "Could not focus Zalo"
  exit 0
}

$pasted = $false
try {
  $auto = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $inputCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
  $inputBox = $auto.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $inputCond)
  if (-not $inputBox) {
    $inputCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
    $inputBox = $auto.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $inputCond)
  }
  if ($inputBox) {
    $inputBox.SetFocus()
    Start-Sleep -Milliseconds 100
    [Win32ZaloPaste]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)
    [Win32ZaloPaste]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
    [Win32ZaloPaste]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero)
    [Win32ZaloPaste]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
    $pasted = $true
  }
} catch {}

if (-not $pasted) {
  Write-Error "Khong the tim thay o nhap tin nhan Zalo. Co the do chua ket ban, so dien thoai khong ton tai hoac Zalo phien ban moi thay doi giao dien."
  exit 1
}

Write-Host "Success"
`;

    const scriptPath = path.join(require('os').tmpdir(), 'zalo-paste-' + Date.now() + '.ps1');
    fs.writeFileSync(scriptPath, script, 'utf8');

    const env = { ...process.env };
    if (message) {
      env.ZALO_AUTOPASTE_MESSAGE_B64 = Buffer.from(message).toString('base64');
    }
    if (link) {
      env.ZALO_AUTOPASTE_LINK_B64 = Buffer.from(link).toString('base64');
    }
    if (imageBase64) {
      env.ZALO_AUTOPASTE_IMAGE_B64 = imageBase64;
    }

    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { env }, (error, stdout, stderr) => {
      try { fs.unlinkSync(scriptPath); } catch (e) {}
      if (error) {
        reject(new Error(stderr || stdout || error.message));
      } else {
        resolve(stdout);
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  // CORS configuration
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Access-Control-Request-Private-Network');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/api/local-zalo/open-paste') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const message = payload.message || '';
        const link = payload.link || '';
        console.log('Received request to paste to Zalo');
        
        await runWindowsZaloPaste(message, link);
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, pasted: true }));
        console.log('Successfully pasted to Zalo');
      } catch (err) {
        console.error('Error pasting to Zalo:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const PORT = 3000;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log('');
    console.log(' LỖI: Cổng 3000 đã bị sử dụng!');
    console.log(' Có thể bạn đang chạy npm start hoặc một cửa sổ ZaloHelper khác chưa tắt.');
    console.log(' Hãy tắt chúng trước khi chạy file này.');
  } else {
    console.log(' LỖI:', e.message);
  }
  console.log('\n Bấm Enter để thoát...');
  process.stdin.once('data', () => process.exit(1));
});

server.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log(` Zalo Helper is running on http://127.0.0.1:${PORT}`);
  console.log(` Keep this window open while using the web app.`);
  console.log(` You can now use auto-paste on the website.`);
  console.log('----------------------------------------------------');
});

process.on('uncaughtException', (err) => {
  console.log('LỖI KHÔNG XÁC ĐỊNH:', err.message);
  console.log('\n Bấm Enter để thoát...');
  process.stdin.once('data', () => process.exit(1));
});
