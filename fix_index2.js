const fs = require('fs');
let content = fs.readFileSync('public/index.html', 'utf8');

// 1. Drawer Header
const oldHeader = /<header class="drawer-header">\s*<h2 id="drawerStudentName">Tên học sinh<\/h2>\s*<button class="drawer-close" id="closeStudentDrawer" type="button" aria-label="Đóng">&times;<\/button>\s*<\/header>/;
const newHeader = `<header class="drawer-header" style="display: flex; flex-direction: column; gap: 12px; position: relative;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <h2 id="drawerStudentName" style="margin: 0; line-height: 1.2; padding-right: 20px;">Tên học sinh</h2>
        <button class="drawer-close" id="closeStudentDrawer" type="button" aria-label="Đóng" style="margin-left: 0; margin-top: -5px;">&times;</button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button id="openMakeupBtn" type="button" style="padding: 6px 12px; font-size: 13px; background: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"><i class="fa-solid fa-repeat"></i> Kẹt & Bù</button>
        <button id="openTransferClassBtn" type="button" style="padding: 6px 12px; font-size: 13px; background: #0d9488; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"><i class="fa-solid fa-right-left"></i> Chuyển lớp</button>
        <button id="openEditStudentBtn" type="button" style="padding: 6px 12px; font-size: 13px; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 500;"><i class="fa-solid fa-pen"></i> Sửa</button>
      </div>
    </header>`;
content = content.replace(oldHeader, newHeader);

// 2. Buttons in Roster Header
const oldExport = /<button class="btn ghost export-btn" type="button">Xuất danh sách<\/button>/;
const newExport = `<button class="btn primary btn-exam" id="openExamSelectBtn" type="button" style="margin-right: 8px;"><i class="fa-solid fa-star"></i> Nhập điểm thi</button>
              <button class="btn secondary" id="exportExamBtn" type="button" style="margin-right: 8px; background: #e2e8f0; color: #475569; border: none; padding: 6px 12px; border-radius: 4px;"><i class="fa-solid fa-file-excel"></i> Xuất Điểm</button>
              <button class="btn ghost export-btn" type="button">Xuất danh sách</button>`;
content = content.replace(oldExport, newExport);

// 3. Drawer history
const oldDrawerHistory = /<div class="drawer-section">\s*<h3>Lịch sử chuyển lớp<\/h3>\s*<div id="drawerTransferHistory" class="drawer-history-list">\s*<div class="empty muted">Chưa có lịch sử chuyển lớp.<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/aside>/;
const newDrawerHistory = `<div class="drawer-section">
        <h3>Lịch sử chuyển lớp</h3>
        <div id="drawerTransferHistory" class="drawer-history-list">
          <div class="empty muted">Chưa có lịch sử chuyển lớp.</div>
        </div>
      </div>
      <div class="drawer-section">
        <h3>Lịch sử thi</h3>
        <div id="drawerExamHistory" class="drawer-history-list">
          <div class="empty muted">Chưa có dữ liệu điểm thi.</div>
        </div>
      </div>
    </div>
  </aside>`;
content = content.replace(oldDrawerHistory, newDrawerHistory);

// 4. Modals and scripts
const modals = `
<!-- Exam Select Modal -->
<div id="examSelectModal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#fff; padding:20px; border-radius:8px; width:400px; max-width:90%; color: #0f172a; position: relative;">
    <button type="button" onclick="document.getElementById('examSelectModal').style.display='none'" style="position: absolute; top: 15px; right: 15px; background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; line-height: 1;">&times;</button>
    <h3 style="margin-top:0; color: #1e293b;">Chọn Kỳ Thi</h3>
    <form id="examSelectForm">
      <input type="hidden" id="examSelectClass">
      <div class="form-group" style="margin-bottom: 15px;">
        <label style="display: block; margin-bottom: 5px; font-weight: 500;">Chọn hoặc nhập tên kỳ thi</label>
        <select id="examSelectDropdown" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; margin-bottom: 10px;" onchange="if(this.value==='Khác...'){document.getElementById('examCustomNameContainer').style.display='block';}else{document.getElementById('examCustomNameContainer').style.display='none';}">
          <option value="Thi đầu vào">Thi đầu vào</option>
          <option value="Thi giữa kì 1">Thi giữa kì 1</option>
          <option value="Thi cuối kì 1">Thi cuối kì 1</option>
          <option value="Thi giữa kì 2">Thi giữa kì 2</option>
          <option value="Thi cuối kì 2">Thi cuối kì 2</option>
          <option value="Thi đầu ra">Thi đầu ra</option>
          <option value="Khác...">Khác...</option>
        </select>
        <div id="examCustomNameContainer" style="display:none;">
          <input type="text" id="examCustomName" placeholder="Nhập tên kỳ thi phát sinh..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;">
        </div>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
        <button type="submit" class="btn primary">Bắt đầu nhập điểm</button>
      </div>
    </form>
  </div>
</div>

<!-- Exam Input Modal -->
<div id="examInputModal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#f8fafc; border-radius:8px; width:600px; max-width:95%; max-height: 90vh; display:flex; flex-direction: column; color: #0f172a; position: relative;">
    <div style="padding: 15px 20px; border-bottom: 1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; background:#fff; border-radius: 8px 8px 0 0;">
      <h3 id="examInputTitle" style="margin:0; color: #1e293b;">Nhập điểm thi</h3>
      <button type="button" onclick="document.getElementById('examInputModal').style.display='none'" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; line-height: 1;">&times;</button>
    </div>
    
    <div id="examInputList" style="padding: 20px; overflow-y: auto; flex: 1;">
    </div>
    
    <div style="padding: 15px 20px; border-top: 1px solid #e2e8f0; background:#fff; border-radius: 0 0 8px 8px; display: flex; gap: 10px; justify-content: space-between; align-items: center;">
      <button type="button" class="btn success" id="btnSendExamZalo"><i class="fa-solid fa-paper-plane"></i> Gửi Zalo toàn lớp</button>
      <div style="display:flex; gap:10px;">
        <button type="button" class="btn" onclick="document.getElementById('examInputModal').style.display='none'" style="background:#e2e8f0; color:#475569;">Đóng</button>
        <button type="button" class="btn primary" id="btnSaveExam">Lưu Bảng Điểm</button>
      </div>
    </div>
  </div>
</div>
</body>`;
if (!content.includes('examSelectModal')) {
    content = content.replace('</body>', modals);
}

content = content.replace(/<script src="\/app\.js\?v=[0-9-]+"><\/script>/, '<script src="/app.js?v=20260724-1"></script>\n  <script src="/exams.js"></script>');

fs.writeFileSync('public/index.html', content, 'utf8');
console.log('index.html updated successfully.');
