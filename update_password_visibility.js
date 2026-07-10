const fs = require('fs');
const path = require('path');

// 1. Update server.js
const serverJsPath = path.join(__dirname, 'server.js');
let serverJs = fs.readFileSync(serverJsPath, 'utf8');

serverJs = serverJs.replace(
  "users = Object.values(rootDb.users || {}).map(u => ({ username: u.username, role: u.role, branchId: u.branchId }));",
  "users = Object.values(rootDb.users || {}).map(u => ({ username: u.username, role: u.role, branchId: u.branchId, plainPassword: u.plainPassword }));"
);

serverJs = serverJs.replace(
  "password: hashedPassword,",
  "password: hashedPassword,\n      plainPassword: password,"
);

fs.writeFileSync(serverJsPath, serverJs);

// 2. Update app.js
const appJsPath = path.join(__dirname, 'public', 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

appJs = appJs.replace(
  "👤 ${u.username}</strong>",
  "👤 ${u.username} \${u.plainPassword ? `<span style=\\\"font-size: 0.85em; font-weight: normal; color: #64748b; margin-left: 8px;\\\">🔑 Mật khẩu: <b>\${u.plainPassword}</b></span>` : ''}</strong>"
);

fs.writeFileSync(appJsPath, appJs);

console.log("Updated API and frontend to show passwords.");
