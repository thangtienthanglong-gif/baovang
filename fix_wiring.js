const fs = require('fs');

// --- 1. Modify index.html ---
let indexHtml = fs.readFileSync('public/index.html', 'utf8');
const modals = `
<!-- Edit Student Modal -->
<div id="editStudentModal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#fff; padding:20px; border-radius:8px; width:400px; max-width:90%; position: relative;">
    <button type="button" onclick="document.getElementById('editStudentModal').style.display='none'" style="position: absolute; top: 15px; right: 15px; background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; line-height: 1;">&times;</button>
    <h3 style="margin-top:0;">Sửa thông tin học sinh</h3>
    <form id="editStudentForm">
      <input type="hidden" id="editStudentId">
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Mã HS</label>
        <input type="text" id="editStudentCode" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Tên học sinh</label>
        <input type="text" id="editStudentName" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Lớp (Không sửa ở đây)</label>
        <input type="text" id="editStudentClass" readonly style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; background: #e2e8f0; color: #475569;">
      </div>
      <div class="form-group" style="margin-bottom: 10px;">
        <label>Trường chính</label>
        <input type="text" id="editStudentParent" style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <div class="form-group" style="margin-bottom: 15px;">
        <label>Số điện thoại</label>
        <input type="text" id="editStudentPhone" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
      </div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn primary">Lưu Thay Đổi</button>
      </div>
    </form>
  </div>
</div>

<!-- Transfer Class Modal -->
<div id="transferClassModal" class="modal-overlay" style="display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); z-index:9999; justify-content:center; align-items:center;">
  <div style="background:#fff; padding:20px; border-radius:8px; width:400px; max-width:90%; position: relative;">
    <button type="button" onclick="document.getElementById('transferClassModal').style.display='none'" style="position: absolute; top: 15px; right: 15px; background: none; border: none; font-size: 24px; cursor: pointer; color: #94a3b8; line-height: 1;">&times;</button>
    <h3 style="margin-top:0;">Chuyển lớp</h3>
    <form id="transferClassForm">
      <input type="hidden" id="transferStudentId">
      <div style="margin-bottom: 15px;">Học sinh: <strong id="transferStudentName"></strong></div>
      <div style="margin-bottom: 15px;">Lớp hiện tại: <strong id="transferCurrentClass"></strong></div>
      <div class="form-group" style="margin-bottom: 15px;">
        <label>Chuyển sang lớp</label>
        <select id="transferTargetClass" required style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
        </select>
      </div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="submit" class="btn primary">Xác nhận chuyển</button>
      </div>
    </form>
  </div>
</div>
</body>`;
if (!indexHtml.includes('editStudentModal')) {
    indexHtml = indexHtml.replace('</body>', modals);
    fs.writeFileSync('public/index.html', indexHtml, 'utf8');
}

// --- 2. Modify app.js ---
let appJs = fs.readFileSync('public/app.js', 'utf8');
const appLogic = `
// --- Modal Logic: Edit & Transfer ---
function openEditStudentModal(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;
  document.getElementById('editStudentId').value = student.id;
  document.getElementById('editStudentCode').value = student.code;
  document.getElementById('editStudentName').value = student.fullName || student.name;
  document.getElementById('editStudentClass').value = student.className;
  document.getElementById('editStudentParent').value = student.parentName || '';
  document.getElementById('editStudentPhone').value = student.phone1 || '';
  
  document.getElementById('editStudentModal').style.display = 'flex';
}

document.getElementById('editStudentForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('editStudentId').value;
  const payload = {
    code: document.getElementById('editStudentCode').value,
    fullName: document.getElementById('editStudentName').value,
    className: document.getElementById('editStudentClass').value,
    parentName: document.getElementById('editStudentParent').value,
    phone1: document.getElementById('editStudentPhone').value
  };
  
  try {
    const res = await api('/api/students/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const idx = state.students.findIndex(s => s.id === id);
    if (idx !== -1) state.students[idx] = res;
    
    document.getElementById('editStudentModal').style.display = 'none';
    toast('Cập nhật thành công!', 'success');
    renderRoster();
    openStudentProfile(id);
  } catch(err) {
    console.error(err);
    toast(err.message || 'Lỗi cập nhật', 'error');
  }
});

function openTransferClassModal(studentId) {
  const student = state.students.find(s => s.id === studentId);
  if (!student) return;
  document.getElementById('transferStudentId').value = student.id;
  document.getElementById('transferStudentName').textContent = student.fullName || student.name;
  document.getElementById('transferCurrentClass').textContent = student.className;
  
  const classNames = state.classes.map(c => c.name).filter(c => c !== student.className);
  document.getElementById('transferTargetClass').innerHTML = classNames.map(c => '<option value="' + c + '">' + c + '</option>').join('');
  
  document.getElementById('transferClassModal').style.display = 'flex';
}

document.getElementById('transferClassForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('transferStudentId').value;
  const student = state.students.find(s => s.id === id);
  const newClass = document.getElementById('transferTargetClass').value;
  
  const payload = { ...student, className: newClass };
  
  try {
    const res = await api('/api/students/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    await api('/api/students/' + id + '/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromClass: student.className, toClass: newClass, date: state.today })
    }).catch(err => console.warn(err));
    
    const idx = state.students.findIndex(s => s.id === id);
    if (idx !== -1) state.students[idx] = res;
    
    document.getElementById('transferClassModal').style.display = 'none';
    document.getElementById('studentProfileDrawer').classList.remove('open');
    document.getElementById('studentDrawerBackdrop').classList.remove('show');
    toast('Chuyển lớp thành công!', 'success');
    renderRoster();
  } catch(err) {
    console.error(err);
    toast(err.message || 'Lỗi chuyển lớp', 'error');
  }
});
`;
if (!appJs.includes('openEditStudentModal(studentId) {')) {
    appJs = appJs + '\n' + appLogic;
}

// Inject transfer history into openStudentProfile
const historyTarget = "const historyList = document.getElementById('drawerAbsenceHistory');";
const historyLogic = `
  // Populate transfer history
  const transferHistoryList = document.getElementById('drawerTransferHistory');
  if (transferHistoryList) {
    transferHistoryList.innerHTML = '<div class="empty muted">Đang tải...</div>';
    try {
      const hist = await api('/api/students/' + student.id + '/transfer');
      if (!hist || hist.length === 0) {
        transferHistoryList.innerHTML = '<div class="empty muted">Chưa có lịch sử chuyển lớp.</div>';
      } else {
        transferHistoryList.innerHTML = hist.map(h => '<div style="font-size: 13px; color: #475569; margin-bottom: 4px;">Từ <strong>' + escapeHtml(h.fromClass) + '</strong> sang <strong>' + escapeHtml(h.toClass) + '</strong> (Ngày ' + escapeHtml(h.date) + ')</div>').join('');
      }
    } catch(e) {
      console.error(e);
      transferHistoryList.innerHTML = '<div class="empty muted">Lỗi tải dữ liệu</div>';
    }
  }

  const historyList = document.getElementById('drawerAbsenceHistory');`;
if (!appJs.includes('drawerTransferHistory')) {
    appJs = appJs.replace(historyTarget, historyLogic);
}
fs.writeFileSync('public/app.js', appJs, 'utf8');

// --- 3. Modify server.js ---
let serverJs = fs.readFileSync('server.js', 'utf8');
const transferApi = `
app.post('/api/students/:id/transfer', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    if (!db.transferHistory) db.transferHistory = [];
    db.transferHistory.push({
      studentId: req.params.id,
      fromClass: req.body.fromClass,
      toClass: req.body.toClass,
      date: req.body.date,
      timestamp: Date.now()
    });
    await saveBranchDb(req, db);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/students/:id/transfer', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    const history = (db.transferHistory || []).filter(t => t.studentId === req.params.id);
    res.json(history);
  } catch (error) {
    next(error);
  }
});
`;
if (!serverJs.includes('/api/students/:id/transfer')) {
    serverJs = serverJs.replace("app.delete('/api/students/:id'", transferApi + "\napp.delete('/api/students/:id'");
    fs.writeFileSync('server.js', serverJs, 'utf8');
}
console.log('All files updated.');
