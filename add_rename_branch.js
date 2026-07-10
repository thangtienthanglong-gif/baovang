const fs = require('fs');
const path = require('path');

// 1. Update server.js
const serverFile = path.join(__dirname, 'server.js');
let serverCode = fs.readFileSync(serverFile, 'utf8');

const renameApi = `
app.put('/api/branches/:id', async (req, res, next) => {
  try {
    const rootDb = await readDb();
    const branchId = req.params.id;
    let newName = String(req.body.name || '').trim();
    if (!newName) throw new Error('Tên chi nhánh không được để trống');
    if (!rootDb.branches || !rootDb.branches[branchId]) throw new Error('Không tìm thấy chi nhánh');
    
    if (!rootDb.branches[branchId].settings) {
      rootDb.branches[branchId].settings = defaultSettings();
    }
    rootDb.branches[branchId].settings.branchName = newName;
    
    await writeDb(rootDb);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
`;

if (!serverCode.includes("app.put('/api/branches/:id'")) {
  serverCode = serverCode.replace(/app\.delete\('\/api\/branches\/:id'[\s\S]*?res\.json\(\{ success: true \}\);\n  \} catch \(error\) \{\n    next\(error\);\n  \}\n\}\);/, match => match + '\n' + renameApi);
  fs.writeFileSync(serverFile, serverCode, 'utf8');
}


// 2. Update index.html
const uiFile = path.join(__dirname, 'public', 'index.html');
let uiHtml = fs.readFileSync(uiFile, 'utf8');

const renameBtnHtml = `<button class="btn" id="renameBranchBtn" type="button" style="margin-right: 8px; padding: 6px 12px; background: #e0e7ff; color: #4338ca; border-color: #c7d2fe;" title="Đổi tên chi nhánh"><i class="fa-solid fa-pen"></i></button>`;

if (!uiHtml.includes('id="renameBranchBtn"')) {
  uiHtml = uiHtml.replace(/(<button class="btn danger" id="delBranchBtn" [^>]+>.*?<\/button>)/, `$1\n          ${renameBtnHtml}`);
  fs.writeFileSync(uiFile, uiHtml, 'utf8');
}


// 3. Update app.js
const appJsFile = path.join(__dirname, 'public', 'app.js');
let appJsCode = fs.readFileSync(appJsFile, 'utf8');

const renameLogic = `
  const renameBranchBtn = document.getElementById('renameBranchBtn');
  if (renameBranchBtn) {
    renameBranchBtn.addEventListener('click', async () => {
      const branchId = getActiveBranch();
      const currentName = branchSelector.options[branchSelector.selectedIndex]?.text || '';
      const newName = prompt('Nhập tên mới cho chi nhánh này:', currentName);
      if (!newName || newName === currentName) return;
      try {
        await api('/api/branches/' + branchId, { method: 'PUT', body: JSON.stringify({ name: newName }) });
        showToast('Đã đổi tên chi nhánh thành công!');
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
`;

if (!appJsCode.includes("renameBranchBtn")) {
  appJsCode = appJsCode.replace(/(const delBranchBtn = document.getElementById\('delBranchBtn'\);[\s\S]*?\}\);\n  \})/m, `$1\n${renameLogic}`);
  fs.writeFileSync(appJsFile, appJsCode, 'utf8');
}

console.log('Added rename branch functionality successfully!');
