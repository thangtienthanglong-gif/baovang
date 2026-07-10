const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'public', 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. Remove modal
const modalStart = indexHtml.indexOf('<!-- Modal Quản lý nhân sự -->');
if (modalStart !== -1) {
  const modalEnd = indexHtml.indexOf('</div>\n    </div>\n  </div>', modalStart);
  if (modalEnd !== -1) {
    indexHtml = indexHtml.substring(0, modalStart) + indexHtml.substring(modalEnd + 31);
  }
}

// 2. Remove manageStaffBtn from header
indexHtml = indexHtml.replace(/<button class="btn admin-only" id="manageStaffBtn".*?<\/button>\n\s*/, '');

// 3. Add to sidebar
if (!indexHtml.includes('data-tab="staffTab"')) {
  indexHtml = indexHtml.replace(/(<button class="tab" data-tab="historyTab".*?<\/button>)/, '$1\n        <button class="tab admin-only" data-tab="staffTab" type="button" style="display:none;"><span class="nav-icon"><i class="fa-solid fa-users"></i></span> Nhân sự</button>');
}

// 4. Add section staffTab
const staffTabHtml = `
    <section id="staffTab" class="tab-panel">
      <div class="panel-heading">
        <h2>👥 Quản lý Nhân sự</h2>
        <p>Quản lý tài khoản đăng nhập của giáo viên và phân quyền chi nhánh.</p>
      </div>
      <div style="display: flex; gap: 20px;">
        <div class="card" style="flex: 1;">
          <h3>Tạo tài khoản mới</h3>
          <form id="createStaffForm">
            <div class="form-group" style="margin-bottom: 10px;">
              <label>Tên đăng nhập</label>
              <input type="text" id="staffUsername" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div class="form-group" style="margin-bottom: 10px;">
              <label>Mật khẩu</label>
              <input type="password" id="staffPassword" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            </div>
            <div class="form-group" style="margin-bottom: 15px;">
              <label>Quyền quản lý (Chi nhánh)</label>
              <select id="staffBranch" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                <option value="all">Tất cả chi nhánh (Quản trị viên)</option>
              </select>
            </div>
            <button type="submit" class="btn primary" style="width: 100%;">Tạo tài khoản</button>
          </form>
        </div>
        <div class="card" style="flex: 2;">
          <h3>Danh sách nhân sự</h3>
          <div id="staffList" style="margin-top: 10px;"></div>
        </div>
      </div>
    </section>
`;

if (!indexHtml.includes('id="staffTab"')) {
  indexHtml = indexHtml.replace(/(<section id="historyTab".*?<\/section>)/s, '$1\n' + staffTabHtml);
}

fs.writeFileSync(indexHtmlPath, indexHtml);

// 5. Update app.js
const appJsPath = path.join(__dirname, 'public', 'app.js');
let appJs = fs.readFileSync(appJsPath, 'utf8');

const staffLogicStart = appJs.indexOf('// ==================== STAFF MANAGEMENT ====================');
if (staffLogicStart !== -1) {
  const newStaffLogic = `// ==================== STAFF MANAGEMENT ====================
document.addEventListener("DOMContentLoaded", () => {
  const userStr = localStorage.getItem("user");
  if (!userStr) return;
  const user = JSON.parse(userStr);
  
  if (user.role === "admin") {
    // Show admin-only elements
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "");
    
    const staffTabBtn = document.querySelector('[data-tab="staffTab"]');
    const createStaffForm = document.getElementById("createStaffForm");
    const staffList = document.getElementById("staffList");
    const staffBranch = document.getElementById("staffBranch");
    
    if (staffTabBtn) {
      staffTabBtn.addEventListener("click", async () => {
        loadStaffList();
        const branches = await api("/api/branches");
        let options = "<option value='all'>Tất cả chi nhánh (Quản trị viên)</option>";
        branches.forEach(b => {
          if (b.id !== 'main') {
            options += \`<option value="\${b.id}">\${b.name}</option>\`;
          } else {
             options += \`<option value="main">Cơ sở chính (Main)</option>\`;
          }
        });
        staffBranch.innerHTML = options;
      });
    }
    
    if (createStaffForm) {
      createStaffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("staffUsername").value;
        const password = document.getElementById("staffPassword").value;
        const branchId = document.getElementById("staffBranch").value;
        const role = branchId === "all" ? "admin" : "staff";
        
        try {
          await api("/api/users", {
            method: "POST",
            body: JSON.stringify({ username, password, role, branchId })
          });
          showToast("Tạo tài khoản thành công!");
          createStaffForm.reset();
          loadStaffList();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }
    
    async function loadStaffList() {
      if (!staffList) return;
      try {
        const users = await api("/api/users");
        const branches = await api("/api/branches");
        const branchMap = { "all": "Tất cả chi nhánh", "main": "Cơ sở chính" };
        branches.forEach(b => branchMap[b.id] = b.name);
        
        staffList.innerHTML = users.map(u => \`
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e2e8f0; background: #fff; margin-bottom: 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            <div style="display: flex; flex-direction: column;">
              <strong style="font-size: 1.1em; color: #1e293b;">👤 \${u.username}</strong>
              <span style="font-size: 0.9em; color: #64748b; margin-top: 4px;">
                \${u.role === 'admin' ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 6px;border-radius:4px;font-size:0.8em;font-weight:bold;">Admin</span>' : '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px;font-size:0.8em;font-weight:bold;">Nhân viên</span>'}
                &nbsp;•&nbsp; Phụ trách: \${branchMap[u.branchId] || u.branchId}
              </span>
            </div>
            \${u.username !== 'admin' ? \`<button class="btn danger" onclick="deleteStaff('\${u.username}')" style="padding: 6px 10px;"><i class="fa-solid fa-trash"></i></button>\` : ''}
          </div>
        \`).join("");
      } catch (err) {
        console.error(err);
      }
    }
    
    window.deleteStaff = async function(username) {
      if (!confirm("Bạn có chắc chắn muốn xóa tài khoản " + username + " không?")) return;
      try {
        await api("/api/users/" + username, { method: "DELETE" });
        showToast("Đã xóa tài khoản");
        loadStaffList();
      } catch (err) {
        showToast(err.message, "error");
      }
    }
  } else {
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
  }
});`;
  appJs = appJs.substring(0, staffLogicStart) + newStaffLogic;
  fs.writeFileSync(appJsPath, appJs);
}

console.log('Converted staff UI to tab successfully.');
