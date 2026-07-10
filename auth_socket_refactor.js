const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let code = fs.readFileSync(serverFile, 'utf8');

// 1. Add dependencies at the top
if (!code.includes("require('socket.io')")) {
  code = code.replace(/const express = require\('express'\);/, `const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');`);
}

// 2. Wrap app with server and socket.io
if (!code.includes("const server = http.createServer(app)")) {
  code = code.replace(/const app = express\(\);/, `const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const JWT_SECRET = process.env.JWT_SECRET || 'baovang_secret_key_12345';

// Serve login.html for root if not authenticated
// Actually we will serve index.html statically, and index.html will redirect to login.html if no token
`);
}

// 3. Change app.listen to server.listen
code = code.replace(/app\.listen\(PORT, \(\) => \{/g, 'server.listen(PORT, () => {');

// 4. Update saveBranchDb to emit socket event
const newSaveBranch = `async function saveBranchDb(req, branchDb) {
  const rootDb = await readDb();
  const branchId = getBranchId(req);
  if (!rootDb.branches) rootDb.branches = {};
  rootDb.branches[branchId] = branchDb;
  await writeDb(rootDb);
  io.emit('data_updated', { branchId }); // Emit realtime event
}`;
code = code.replace(/async function saveBranchDb\(req, branchDb\) \{[\s\S]*?await writeDb\(rootDb\);\n\}/, newSaveBranch);

// 5. Add auth middleware & endpoints
const authLogic = `
// ==================== AUTHENTICATION & USERS ====================

// Khởi tạo tài khoản admin mặc định
async function ensureAdminUser() {
  const rootDb = await readDb();
  if (!rootDb.users) rootDb.users = {};
  if (!rootDb.users['admin']) {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin', salt);
    rootDb.users['admin'] = {
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      branchId: 'all' // Admin có thể vào mọi nhánh
    };
    await writeDb(rootDb);
  }
}
setTimeout(ensureAdminUser, 2000);

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const rootDb = await readDb();
    const users = rootDb.users || {};
    const user = users[username];

    if (!user) {
      return res.status(401).json({ error: 'Tài khoản không tồn tại' });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Sai mật khẩu' });
    }

    const token = jwt.sign({ username: user.username, role: user.role, branchId: user.branchId }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, user: { username: user.username, role: user.role, branchId: user.branchId } });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  // Cho phép bỏ qua xác thực với một số đường dẫn (webhook, login...)
  if (req.path.startsWith('/api/import') || req.path === '/api/login' || req.path.startsWith('/api/chat') || req.path.startsWith('/api/webhook')) {
    return next();
  }

  if (token == null) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Phiên đăng nhập hết hạn hoặc không hợp lệ' });
    req.user = user;
    
    // Kiểm tra quyền truy cập chi nhánh
    const targetBranch = getBranchId(req);
    if (user.role !== 'admin' && user.branchId !== 'all' && user.branchId !== targetBranch) {
       // Allow fetching branch list so they can see their branch
       if (req.path !== '/api/branches') {
         return res.status(403).json({ error: 'Bạn không có quyền truy cập chi nhánh này' });
       }
    }
    next();
  });
};

app.use('/api', authenticateToken);

app.get('/api/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới xem được' });
  const rootDb = await readDb();
  const users = Object.values(rootDb.users || {}).map(u => ({ username: u.username, role: u.role, branchId: u.branchId }));
  res.json(users);
});

app.post('/api/users', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới tạo được tài khoản' });
  try {
    const { username, password, role, branchId } = req.body;
    if (!username || !password) throw new Error('Thiếu thông tin');
    
    const rootDb = await readDb();
    if (!rootDb.users) rootDb.users = {};
    if (rootDb.users[username]) throw new Error('Tài khoản đã tồn tại');

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    rootDb.users[username] = {
      username,
      password: hashedPassword,
      role: role || 'staff',
      branchId: branchId || 'main'
    };
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/users/:username', async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới xóa được tài khoản' });
  try {
    const target = req.params.username;
    if (target === 'admin') throw new Error('Không thể xóa admin');
    const rootDb = await readDb();
    if (rootDb.users && rootDb.users[target]) {
      delete rootDb.users[target];
      await writeDb(rootDb);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ================================================================
`;

// Insert authLogic right before the first API route
if (!code.includes('/api/login')) {
  code = code.replace(/app\.get\('\/api\/branches'/, match => authLogic + '\n' + match);
}

fs.writeFileSync(serverFile, code, 'utf8');
console.log('Backend refactored for Auth & Socket.io');
