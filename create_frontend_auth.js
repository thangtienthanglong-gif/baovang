const fs = require('fs');
const path = require('path');

// 1. Create login.html
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir);

const loginHtml = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Đăng nhập - Báo vắng học sinh</title>
  <link rel="stylesheet" href="style.css">
  <style>
    body { display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f3f4f6; }
    .login-container { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); width: 100%; max-width: 400px; }
    .login-container h1 { font-size: 1.5rem; text-align: center; margin-bottom: 1.5rem; color: #1e3a8a; }
    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
    .form-group input { width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 4px; box-sizing: border-box; }
    .btn-login { width: 100%; padding: 0.75rem; background: #2563eb; color: white; border: none; border-radius: 4px; font-weight: 600; cursor: pointer; }
    .btn-login:hover { background: #1d4ed8; }
    #errorMsg { color: #dc2626; text-align: center; margin-bottom: 1rem; font-size: 0.875rem; }
  </style>
</head>
<body>
  <div class="login-container">
    <h1>Hệ thống Quản lý</h1>
    <div id="errorMsg"></div>
    <form id="loginForm">
      <div class="form-group">
        <label>Tên đăng nhập</label>
        <input type="text" id="username" required>
      </div>
      <div class="form-group">
        <label>Mật khẩu</label>
        <input type="password" id="password" required>
      </div>
      <button type="submit" class="btn-login">Đăng nhập</button>
    </form>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = document.getElementById('username').value;
      const pass = document.getElementById('password').value;
      const err = document.getElementById('errorMsg');
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        if (data.user.branchId !== 'all') {
          localStorage.setItem('activeBranch', data.user.branchId);
        }
        window.location.href = '/';
      } catch (e) {
        err.textContent = e.message;
      }
    });
  </script>
</body>
</html>`;
fs.writeFileSync(path.join(publicDir, 'login.html'), loginHtml);

// 2. Modify app.js to use token
const appJsPath = path.join(publicDir, 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

if (!appJs.includes("localStorage.getItem('token')")) {
  const tokenInject = `
function getToken() {
  const t = localStorage.getItem('token');
  if (!t && window.location.pathname !== '/login.html') {
    window.location.href = '/login.html';
  }
  return t;
}`;

  appJs = appJs.replace(/function getActiveBranch\(\) \{/, tokenInject + '\n\nfunction getActiveBranch() {');
  
  appJs = appJs.replace(/headers: \{ 'Content-Type': 'application\/json', 'X-Branch-Id': getActiveBranch\(\) \}/, 
                        `headers: { 'Content-Type': 'application/json', 'X-Branch-Id': getActiveBranch(), 'Authorization': 'Bearer ' + getToken() }`);
  
  appJs = appJs.replace(/headers: \{ 'X-Branch-Id': getActiveBranch\(\) \}/, 
                        `headers: { 'X-Branch-Id': getActiveBranch(), 'Authorization': 'Bearer ' + getToken() }`);
                        
  const redirectLogic = `
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
  }`;
  
  appJs = appJs.replace(/if \(!response\.ok\) throw new Error/, redirectLogic + '\n  if (!response.ok) throw new Error');
  appJs = appJs.replace(/if \(!response\.ok\) throw new Error/, redirectLogic + '\n  if (!response.ok) throw new Error'); // second occurrence
}

// 3. Socket.io integration and Logout UI
if (!appJs.includes('io(')) {
  const socketLogic = `
// ==================== REAL-TIME & AUTH UI ====================
document.addEventListener('DOMContentLoaded', () => {
  const userStr = localStorage.getItem('user');
  if (userStr) {
    const user = JSON.parse(userStr);
    const headerDiv = document.querySelector('header .header-controls');
    if (headerDiv) {
      headerDiv.innerHTML += \`<div style="margin-left: 15px; display: inline-block;">
        <span style="font-weight: bold; margin-right: 10px;">👤 \${user.username}</span>
        <button id="logoutBtn" class="btn" style="padding: 6px 12px; background: #e2e8f0; color: #475569; border:none;"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>\`;
      
      document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
      });
      
      // If not admin, hide branch controls
      if (user.role !== 'admin') {
        const newB = document.getElementById('newBranchBtn');
        const delB = document.getElementById('delBranchBtn');
        const renB = document.getElementById('renameBranchBtn');
        if (newB) newB.style.display = 'none';
        if (delB) delB.style.display = 'none';
        if (renB) renB.style.display = 'none';
        const branchSel = document.getElementById('branchSelector');
        if (branchSel && user.branchId !== 'all') {
          branchSel.disabled = true;
        }
      }
    }
  }

  // Socket.io integration
  if (typeof io !== 'undefined') {
    const socket = io();
    socket.on('data_updated', (data) => {
      const active = getActiveBranch();
      if (data.branchId === active || data.branchId === 'all') {
        showToast('🔄 Dữ liệu vừa được làm mới...', 'success');
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.click();
      }
    });
  }
});
`;
  appJs += '\n' + socketLogic;
}

fs.writeFileSync(appJsPath, appJs);

// 4. Update index.html to include socket.io script
const indexHtmlPath = path.join(publicDir, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
if (!indexHtml.includes('socket.io.js')) {
  indexHtml = indexHtml.replace('</head>', '  <script src="/socket.io/socket.io.js"></script>\n</head>');
}

// 5. Make server.js redirect / to /login.html if they directly hit it?
// Usually, index.html is served, then JS redirects.
// However, since express.static serves index.html, we can leave it to frontend JS.
// Wait, if frontend is slow, it might flash the UI. To prevent this, we could add middleware for `/` but `app.use(express.static('public'))` handles it.
// Let's just use frontend redirect.

fs.writeFileSync(indexHtmlPath, indexHtml);
console.log('Frontend auth logic added');
