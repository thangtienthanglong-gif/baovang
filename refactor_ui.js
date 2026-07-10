const fs = require('fs');
const path = require('path');

// 1. Refactor index.html
const indexFile = path.join(__dirname, 'public', 'index.html');
let indexHtml = fs.readFileSync(indexFile, 'utf8');

const branchUI = `
          <select id="branchSelector" style="padding: 6px; border-radius: 6px; border: 1px solid var(--border-color); background: white; margin-right: 8px;">
            <option value="main">Cơ sở chính (Main)</option>
          </select>
          <button class="btn" id="newBranchBtn" type="button" style="margin-right: 8px; padding: 6px 12px;" title="Thêm chi nhánh mới"><i class="fa-solid fa-plus"></i></button>
          <button class="btn secondary" id="refreshBtn" type="button">`;

indexHtml = indexHtml.replace(/<button class="btn secondary" id="refreshBtn" type="button">/, branchUI);
fs.writeFileSync(indexFile, indexHtml, 'utf8');


// 2. Refactor app.js
const appFile = path.join(__dirname, 'public', 'app.js');
let appJs = fs.readFileSync(appFile, 'utf8');

const fetchOverride = `
function getActiveBranch() {
  return localStorage.getItem('activeBranch') || 'main';
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Branch-Id': getActiveBranch() },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Có lỗi xảy ra.');
  return data;
}

async function apiForm(path, formData) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'X-Branch-Id': getActiveBranch() },
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Có lỗi xảy ra.');
  return data;
}
`;

// Replace api and apiForm functions
appJs = appJs.replace(/async function api\(path, options = \{\}\) \{[\s\S]*?return data;\n\}\n\nasync function apiForm\(path, formData\) \{[\s\S]*?return data;\n\}/, fetchOverride.trim());

const loadBranchesFn = `
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
      const branchId = prompt('Nhập mã chi nhánh mới (viết liền không dấu, vd: chinhanh2, hcm, hn):');
      if (!branchId) return;
      try {
        await api('/api/branches', { method: 'POST', body: JSON.stringify({ branchId }) });
        showToast('Đã tạo chi nhánh mới thành công!');
        localStorage.setItem('activeBranch', branchId);
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
});
`;

// Append loadBranches logic at the end of the file
appJs += '\n' + loadBranchesFn;

fs.writeFileSync(appFile, appJs, 'utf8');
console.log('Refactored frontend successfully!');
