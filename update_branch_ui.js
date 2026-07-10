const fs = require('fs');
const path = require('path');

const serverFile = path.join(__dirname, 'server.js');
let serverCode = fs.readFileSync(serverFile, 'utf8');

const newBranchApi = `
app.get('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branches = Object.keys(rootDb.branches || {}).map(id => {
      let bSettings = rootDb.branches[id].settings || {};
      let bName = bSettings.branchName || (id === 'main' ? 'Cơ sở chính (Main)' : id);
      return { id, name: bName };
    });
    if (!branches.find(b => b.id === 'main')) branches.unshift({ id: 'main', name: 'Cơ sở chính (Main)' });
    res.json(branches);
  } catch (error) {
    next(error);
  }
});

app.post('/api/branches', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    let branchName = String(req.body.name || '').trim();
    if (!branchName) throw new Error('Tên chi nhánh không được để trống');
    
    // Tạo ID ngẫu nhiên hoặc dựa trên thời gian
    let branchId = 'branch_' + Date.now();
    
    if (!rootDb.branches) rootDb.branches = {};
    const settings = defaultSettings();
    settings.branchName = branchName; // Lưu tên tiếng Việt
    
    rootDb.branches[branchId] = { students: [], absences: [], callLogs: [], notificationLogs: [], settings };
    await writeDb(rootDb);
    res.json({ success: true, branchId });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/branches/:id', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branchId = req.params.id;
    if (branchId === 'main') throw new Error('Không thể xóa cơ sở chính');
    if (!rootDb.branches || !rootDb.branches[branchId]) throw new Error('Không tìm thấy chi nhánh');
    
    delete rootDb.branches[branchId];
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
`;

serverCode = serverCode.replace(/app\.get\('\/api\/branches'[\s\S]*?res\.json\(\{ success: true, branchId \}\);\n  \} catch \(error\) \{\n    next\(error\);\n  \}\n\}\);/, newBranchApi.trim());
fs.writeFileSync(serverFile, serverCode, 'utf8');


const uiFile = path.join(__dirname, 'public', 'index.html');
let uiHtml = fs.readFileSync(uiFile, 'utf8');

const newBranchUI = `
          <select id="branchSelector" style="padding: 6px; border-radius: 6px; border: 1px solid var(--border-color); background: white; margin-right: 8px;">
            <option value="main">Cơ sở chính (Main)</option>
          </select>
          <button class="btn" id="newBranchBtn" type="button" style="margin-right: 8px; padding: 6px 12px;" title="Thêm chi nhánh mới"><i class="fa-solid fa-plus"></i></button>
          <button class="btn danger" id="delBranchBtn" type="button" style="margin-right: 8px; padding: 6px 12px; background: #fee2e2; color: #dc2626; border-color: #fca5a5; display: none;" title="Xóa chi nhánh này"><i class="fa-solid fa-trash"></i></button>
          <button class="btn secondary" id="refreshBtn" type="button">`;

uiHtml = uiHtml.replace(/<select id="branchSelector"[\s\S]*?<button class="btn secondary" id="refreshBtn" type="button">/, newBranchUI);
fs.writeFileSync(uiFile, uiHtml, 'utf8');


const appJsFile = path.join(__dirname, 'public', 'app.js');
let appJsCode = fs.readFileSync(appJsFile, 'utf8');

const newAppJsLoadBranches = `
async function loadBranches() {
  try {
    const branches = await api('/api/branches');
    const branchSelector = document.getElementById('branchSelector');
    if (!branchSelector) return;
    
    branchSelector.innerHTML = branches.map(b => \`<option value="\${b.id}">\${b.name}</option>\`).join('');
    
    const active = getActiveBranch();
    if (branches.find(b => b.id === active)) {
      branchSelector.value = active;
    } else {
      branchSelector.value = 'main';
      localStorage.setItem('activeBranch', 'main');
    }
    
    const delBtn = document.getElementById('delBranchBtn');
    if (delBtn) {
      delBtn.style.display = branchSelector.value === 'main' ? 'none' : 'inline-block';
    }
  } catch (err) {
    console.error('Không tải được danh sách chi nhánh', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBranches();
  
  const branchSelector = document.getElementById('branchSelector');
  if (branchSelector) {
    branchSelector.addEventListener('change', (e) => {
      localStorage.setItem('activeBranch', e.target.value);
      location.reload(); // Reload the page to fetch new branch data
    });
  }
  
  const newBranchBtn = document.getElementById('newBranchBtn');
  if (newBranchBtn) {
    // Override the old event listener by replacing or we can just make sure it uses the new logic
    // Since we're injecting this, wait, the old event listener is still in appJsCode.
    // Let's replace the ENTIRE loadBranches block in appJsCode.
`;

appJsCode = appJsCode.replace(/async function loadBranches\(\) \{[\s\S]*?\}\);\n  \}\n\}\);/, `
async function loadBranches() {
  try {
    const branches = await api('/api/branches');
    const branchSelector = document.getElementById('branchSelector');
    if (!branchSelector) return;
    
    branchSelector.innerHTML = branches.map(b => \`<option value="\${b.id}">\${b.name}</option>\`).join('');
    
    const active = getActiveBranch();
    if (branches.find(b => b.id === active)) {
      branchSelector.value = active;
    } else {
      branchSelector.value = 'main';
      localStorage.setItem('activeBranch', 'main');
    }
    
    const delBtn = document.getElementById('delBranchBtn');
    if (delBtn) {
      delBtn.style.display = branchSelector.value === 'main' ? 'none' : 'inline-block';
    }
  } catch (err) {
    console.error('Không tải được danh sách chi nhánh', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBranches();
  
  const branchSelector = document.getElementById('branchSelector');
  if (branchSelector) {
    branchSelector.addEventListener('change', (e) => {
      localStorage.setItem('activeBranch', e.target.value);
      location.reload(); // Reload the page to fetch new branch data
    });
  }
  
  const newBranchBtn = document.getElementById('newBranchBtn');
  if (newBranchBtn) {
    newBranchBtn.addEventListener('click', async () => {
      const branchName = prompt('Nhập tên chi nhánh mới (có thể viết tiếng Việt có dấu):');
      if (!branchName) return;
      try {
        const res = await api('/api/branches', { method: 'POST', body: JSON.stringify({ name: branchName }) });
        showToast('Đã tạo chi nhánh mới thành công!');
        localStorage.setItem('activeBranch', res.branchId);
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
  
  const delBranchBtn = document.getElementById('delBranchBtn');
  if (delBranchBtn) {
    delBranchBtn.addEventListener('click', async () => {
      const branchId = getActiveBranch();
      if (branchId === 'main') return;
      if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu của chi nhánh này không? Hành động này không thể hoàn tác!')) return;
      try {
        await api('/api/branches/' + branchId, { method: 'DELETE' });
        showToast('Đã xóa chi nhánh thành công!');
        localStorage.setItem('activeBranch', 'main');
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
});
`);

fs.writeFileSync(appJsFile, appJsCode, 'utf8');
console.log('Update custom branch name and delete button successfully!');
