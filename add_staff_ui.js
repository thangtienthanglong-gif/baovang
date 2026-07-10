const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

const staffBtnHtml = \`<button class="btn admin-only" id="manageStaffBtn" type="button" style="margin-right: 8px; padding: 6px 12px; background: #fef08a; color: #854d0e; border-color: #fde047;" title="Quản lý Nhân sự"><i class="fa-solid fa-users"></i> Nhân sự</button>\`;

// Inject button next to refreshBtn if not exists
if (!indexHtml.includes('id="manageStaffBtn"')) {
  indexHtml = indexHtml.replace(/(<button class="btn secondary" id="refreshBtn")/, staffBtnHtml + '\\n          $1');
}

// Inject Modal
const modalHtml = \`
  <!-- Modal Quản lý nhân sự -->
  <div id="staffModal" class="modal">
    <div class="modal-content" style="max-width: 600px;">
      <div class="modal-header">
        <h2>👥 Quản lý Nhân sự</h2>
        <span class="close" id="closeStaffModal">&times;</span>
      </div>
      <div class="modal-body">
        <div style="display: flex; gap: 20px;">
          <!-- Form tạo mới -->
          <div style="flex: 1; border-right: 1px solid #ddd; padding-right: 20px;">
            <h3 style="margin-top: 0;">Tạo tài khoản</h3>
            <form id="createStaffForm">
              <div class="form-group" style="margin-bottom: 10px;">
                <label>Tên đăng nhập</label>
                <input type="text" id="staffUsername" required style="width: 100%; padding: 5px;">
              </div>
              <div class="form-group" style="margin-bottom: 10px;">
                <label>Mật khẩu</label>
                <input type="password" id="staffPassword" required style="width: 100%; padding: 5px;">
              </div>
              <div class="form-group" style="margin-bottom: 10px;">
                <label>Quản lý chi nhánh</label>
                <select id="staffBranch" style="width: 100%; padding: 5px;">
                  <option value="all">Tất cả chi nhánh (Quyền Quản lý)</option>
                  <!-- Branches will be injected here -->
                </select>
              </div>
              <button type="submit" class="btn primary" style="width: 100%;">Tạo tài khoản</button>
            </form>
          </div>
          <!-- Danh sách -->
          <div style="flex: 1;">
            <h3 style="margin-top: 0;">Danh sách nhân viên</h3>
            <div id="staffList" style="max-height: 300px; overflow-y: auto;">
              <!-- Users will be injected here -->
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
\`;

if (!indexHtml.includes('id="staffModal"')) {
  indexHtml = indexHtml.replace('</body>', modalHtml + '\\n</body>');
}
fs.writeFileSync(indexHtmlPath, indexHtml);


// Update app.js
const appJsPath = path.join(__dirname, 'public', 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

const staffLogic = \`
// ==================== STAFF MANAGEMENT ====================
document.addEventListener('DOMContentLoaded', () => {
  const userStr = localStorage.getItem('user');
  if (!userStr) return;
  const user = JSON.parse(userStr);
  
  if (user.role === 'admin') {
    const manageStaffBtn = document.getElementById('manageStaffBtn');
    const staffModal = document.getElementById('staffModal');
    const closeStaffModal = document.getElementById('closeStaffModal');
    const createStaffForm = document.getElementById('createStaffForm');
    const staffList = document.getElementById('staffList');
    const staffBranch = document.getElementById('staffBranch');
    
    if (manageStaffBtn) {
      manageStaffBtn.addEventListener('click', async () => {
        staffModal.style.display = 'block';
        loadStaffList();
        
        // Load branches for dropdown
        const branches = await api('/api/branches');
        let options = '<option value="all">Tất cả chi nhánh (Quuyền Quản lý)</option>';
        branches.forEach(b => {
          options += \\\`<option value="\\\${b.id}">\\\${b.name}</option>\\\`;
        });
        staffBranch.innerHTML = options;
      });
    }
    
    if (closeStaffModal) {
      closeStaffModal.addEventListener('click', () => {
        staffModal.style.display = 'none';
      });
    }
    
    if (createStaffForm) {
      createStaffForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('staffUsername').value;
        const password = document.getElementById('staffPassword').value;
        const branchId = document.getElementById('staffBranch').value;
        const role = branchId === 'all' ? 'admin' : 'staff';
        
        try {
          await api('/api/users', {
            method: 'POST',
            body: JSON.stringify({ username, password, role, branchId })
          });
          showToast('Tạo tài khoản thành công!');
          createStaffForm.reset();
          loadStaffList();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }
    
    async function loadStaffList() {
      try {
        const users = await api('/api/users');
        const branches = await api('/api/branches');
        const branchMap = { 'all': 'Tất cả' };
        branches.forEach(b => branchMap[b.id] = b.name);
        
        staffList.innerHTML = users.map(u => \\\`
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee; background: #f9fafb; margin-bottom: 5px; border-radius: 4px;">
            <div>
              <strong>\\\${u.username}</strong><br>
              <span style="font-size: 0.85em; color: #666;">Quản lý: \\\${branchMap[u.branchId] || u.branchId}</span>
            </div>
            \\\${u.username !== 'admin' ? \\\`<button class="btn danger" onclick="deleteStaff('\\\${u.username}')" style="padding: 4px 8px; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>\\\` : ''}
          </div>
        \\\`).join('');
      } catch (err) {
        console.error(err);
      }
    }
    
    window.deleteStaff = async function(username) {
      if (!confirm('Bạn có chắc chắn muốn xóa tài khoản ' + username + ' không?')) return;
      try {
        await api('/api/users/' + username, { method: 'DELETE' });
        showToast('Đã xóa tài khoản');
        loadStaffList();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  } else {
    // Hide admin only buttons
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
});
\`;

if (!appJs.includes('STAFF MANAGEMENT')) {
  appJs += '\\n' + staffLogic;
  fs.writeFileSync(appJsPath, appJs);
}

console.log('Staff management UI added.');
