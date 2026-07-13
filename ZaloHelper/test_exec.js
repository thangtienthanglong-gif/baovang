const { execFile } = require('child_process');

execFile('powershell.exe', [
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText('test')"
], (error, stdout, stderr) => {
  console.log('Error:', error?.message);
  console.log('Stderr:', stderr);
  console.log('Stdout:', stdout);
});
