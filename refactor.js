const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'server.js');
let code = fs.readFileSync(file, 'utf8');

// Add getBranchId, getBranchDb, saveBranchDb near readDb/writeDb
const newDbFunctions = `
function getBranchId(req) {
  const branch = req ? (req.headers['x-branch-id'] || req.query.branchId || req.body.branchId) : null;
  return branch ? String(branch).trim().toLowerCase().replace(/[^a-z0-9-]/g, '') : 'main';
}

async function getBranchDb(req) {
  const rootDb = await readDb();
  const branchId = getBranchId(req);
  if (!rootDb.branches) rootDb.branches = {};
  if (!rootDb.branches[branchId]) {
    rootDb.branches[branchId] = { students: [], absences: [], callLogs: [], notificationLogs: [], settings: defaultSettings() };
  }
  return rootDb.branches[branchId];
}

async function saveBranchDb(req, branchDb) {
  const rootDb = await readDb();
  const branchId = getBranchId(req);
  if (!rootDb.branches) rootDb.branches = {};
  rootDb.branches[branchId] = branchDb;
  await writeDb(rootDb);
}
`;

// Insert the new functions after writeDb
code = code.replace(/async function writeDb\(db\) \{[\s\S]*?\n\}\n/, match => match + newDbFunctions);

// Replace readDb migration logic
code = code.replace(/async function readDb\(\) \{[\s\S]*?return \{[\s\S]*?\}\;\n  \} catch \(err\) \{/m, 
`async function readDb() {
  if (!getApps().length) return { branches: {} };
  try {
    const snapshot = await getDatabase().ref('/').once('value');
    const db = snapshot.val() || {};
    
    // Migration: If old data exists at root, move to 'main' branch
    if (db.students || db.absences || db.settings) {
      if (!db.branches) db.branches = {};
      db.branches['main'] = {
        students: db.students || [],
        absences: db.absences || [],
        callLogs: db.callLogs || [],
        notificationLogs: db.notificationLogs || [],
        settings: db.settings || defaultSettings()
      };
      delete db.students;
      delete db.absences;
      delete db.callLogs;
      delete db.notificationLogs;
      delete db.settings;
      await getDatabase().ref('/').set(db); // Save migrated structure immediately
    }
    
    if (!db.branches) db.branches = {};
    return db;
  } catch (err) {`);

// Now replace all `await readDb()` with `await getBranchDb(req)` inside API routes.
// We only want to replace it in Express route handlers where `req` is available.
// We can use a regex that matches `app.(get|post|put|delete)(..., async (req, ... { ... })` and replace inside it.
// Actually, it's easier to just replace all `const db = await readDb();` with `const db = await getBranchDb(req);`
// and all `await writeDb(db);` with `await saveBranchDb(req, db);`
// because almost every call to readDb() is inside a request handler that has `req`.

// Let's check which ones DON'T have `req`
// - processDueNotices
// - AI context builder (buildAiContext) - wait, buildAiContext doesn't call readDb, it receives `db`.

code = code.replace(/const db = await readDb\(\);/g, 'const db = await getBranchDb(req);');
code = code.replace(/await writeDb\(db\);/g, 'await saveBranchDb(req, db);');

// Fix processDueNotices
const oldProcessNotices = `async function processDueNotices() {
  if (noticeSchedulerRunning) return;
  noticeSchedulerRunning = true;
  try {
    const db = await getBranchDb(req); // wait, it got replaced, let's match the replaced version
    const now = Date.now();
    const dueAbsences = (db.absences || []).filter(absence =>
      absence.autoNotice
      && absence.noticeStatus === 'Chờ gửi'
      && absence.noticeDueAt
      && !Number.isNaN(new Date(absence.noticeDueAt).getTime())
      && new Date(absence.noticeDueAt).getTime() <= now
    );

    if (!dueAbsences.length) return;

    for (const absence of dueAbsences) {
      await sendZaloNotice(db, absence.id, 'scheduled_delay');
    }

    await saveBranchDb(req, db);
  } finally {
    noticeSchedulerRunning = false;
  }
}`;

const newProcessNotices = `async function processDueNotices() {
  if (noticeSchedulerRunning) return;
  noticeSchedulerRunning = true;
  try {
    const rootDb = await readDb();
    if (!rootDb.branches) return;
    const now = Date.now();
    let changed = false;
    
    for (const branchId of Object.keys(rootDb.branches)) {
      const db = rootDb.branches[branchId];
      const dueAbsences = (db.absences || []).filter(absence =>
        absence.autoNotice
        && absence.noticeStatus === 'Chờ gửi'
        && absence.noticeDueAt
        && !Number.isNaN(new Date(absence.noticeDueAt).getTime())
        && new Date(absence.noticeDueAt).getTime() <= now
      );

      if (!dueAbsences.length) continue;

      for (const absence of dueAbsences) {
        await sendZaloNotice(db, absence.id, 'scheduled_delay');
      }
      changed = true;
    }

    if (changed) {
      await writeDb(rootDb);
    }
  } finally {
    noticeSchedulerRunning = false;
  }
}`;

code = code.replace(/async function processDueNotices\(\) \{[\s\S]*?noticeSchedulerRunning = false;\n  \}\n\}/, newProcessNotices);

// Also we need an API to list branches for the frontend to display the dropdown.
const branchApi = `
app.get('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branches = Object.keys(rootDb.branches || {}).map(id => ({ id, name: id === 'main' ? 'Cơ sở chính (Main)' : id }));
    if (!branches.find(b => b.id === 'main')) branches.unshift({ id: 'main', name: 'Cơ sở chính (Main)' });
    res.json(branches);
  } catch (error) {
    next(error);
  }
});

app.post('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    let branchId = String(req.body.branchId || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!branchId) throw new Error('Mã chi nhánh không hợp lệ (chỉ gồm a-z, 0-9 và dấu -)');
    if (!rootDb.branches) rootDb.branches = {};
    if (rootDb.branches[branchId]) throw new Error('Chi nhánh này đã tồn tại');
    
    rootDb.branches[branchId] = { students: [], absences: [], callLogs: [], notificationLogs: [], settings: defaultSettings() };
    await writeDb(rootDb);
    res.json({ success: true, branchId });
  } catch (error) {
    next(error);
  }
});
`;

code = code.replace(/app\.use\(\(req, res\) => \{/, branchApi + '\napp.use((req, res) => {');

fs.writeFileSync(file, code, 'utf8');
console.log('Refactored server.js for multi-branch successfully!');
