
// ==================== STAFF MANAGEMENT ====================
document.addEventListener("DOMContentLoaded", () => {
  const userStr = localStorage.getItem("user");
  if (!userStr) return;
  const user = JSON.parse(userStr);
  
  if (user.role === "admin") {
    const manageStaffBtn = document.getElementById("manageStaffBtn");
    const staffModal = document.getElementById("staffModal");
    const closeStaffModal = document.getElementById("closeStaffModal");
    const createStaffForm = document.getElementById("createStaffForm");
    const staffList = document.getElementById("staffList");
    const staffBranch = document.getElementById("staffBranch");
    
    if (manageStaffBtn) {
      manageStaffBtn.addEventListener("click", async () => {
        staffModal.style.display = "block";
        loadStaffList();
        
        const branches = await api("/api/branches");
        let options = "<option value='all'>Tất cả chi nhánh (Quyền Quản lý)</option>";
        branches.forEach(b => {
          options += `<option value="${b.id}">${b.name}</option>`;
        });
        staffBranch.innerHTML = options;
      });
    }
    
    if (closeStaffModal) {
      closeStaffModal.addEventListener("click", () => {
        staffModal.style.display = "none";
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
      try {
        const users = await api("/api/users");
        const branches = await api("/api/branches");
        const branchMap = { "all": "Tất cả" };
        branches.forEach(b => branchMap[b.id] = b.name);
        
        staffList.innerHTML = users.map(u => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid #eee; background: #f9fafb; margin-bottom: 5px; border-radius: 4px;">
            <div>
              <strong>${u.username}</strong><br>
              <span style="font-size: 0.85em; color: #666;">Quản lý: ${branchMap[u.branchId] || u.branchId}</span>
            </div>
            ${u.username !== 'admin' ? `<button class="btn danger" onclick="deleteStaff('${u.username}')" style="padding: 4px 8px; font-size: 12px;"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        `).join("");
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
});
