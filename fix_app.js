const fs = require('fs');
let content = fs.readFileSync('public/app.js', 'utf8');

// 3. Make openStudentProfile async and bind button
const oldProfileFn = `function openStudentProfile(studentId) {
  const drawer = document.getElementById('studentProfileDrawer');
  const student = state.students.find(s => s.id === studentId);
  
  if (!student) return;

  // Header info
  document.getElementById('drawerStudentName').textContent = student.fullName || student.name || 'Chưa cập nhật tên';

  // Bind edit buttons in header
  const openEditStudentBtn = document.getElementById('openEditStudentBtn');
  if (openEditStudentBtn) {
    openEditStudentBtn.onclick = () => openEditStudentModal(studentId);
  }
  const openTransferClassBtn = document.getElementById('openTransferClassBtn');
  if (openTransferClassBtn) {
    openTransferClassBtn.onclick = () => openTransferClassModal(studentId);
  }`;
const newProfileFn = `async function openStudentProfile(studentId) {
  const drawer = document.getElementById('studentProfileDrawer');
  const student = state.students.find(s => s.id === studentId);
  
  if (!student) return;

  // Header info
  document.getElementById('drawerStudentName').textContent = student.fullName || student.name || 'Chưa cập nhật tên';

  // Bind edit buttons in header
  const openEditStudentBtn = document.getElementById('openEditStudentBtn');
  if (openEditStudentBtn) {
    openEditStudentBtn.onclick = () => openEditStudentModal(studentId);
  }
  const openTransferClassBtn = document.getElementById('openTransferClassBtn');
  if (openTransferClassBtn) {
    openTransferClassBtn.onclick = () => openTransferClassModal(studentId);
  }
  const openMakeupBtn = document.getElementById('openMakeupBtn');
  if (openMakeupBtn) {
    openMakeupBtn.onclick = () => openMakeupModal(student.id, student.fullName || student.name, student.className);
  }`;
content = content.replace(oldProfileFn, newProfileFn);

// 4. Add exam history to drawer
const oldDrawerHistory = "    `).join('');\n  }\n\n  // Open drawer\n  drawer.classList.add('open');";
const newDrawerHistory = "    `).join('');\n  }\n\n  // Populate exam history\n  const examHistoryList = document.getElementById('drawerExamHistory');\n  if (examHistoryList) {\n    examHistoryList.innerHTML = '<div class=\"empty muted\">Đang tải...</div>';\n    try {\n      const exams = await api('/api/exams?className=' + encodeURIComponent(student.className));\n      const studentExams = [];\n      exams.forEach(ex => {\n        const scoreObj = (ex.scores || []).find(s => s.studentId === student.id);\n        if (scoreObj) {\n          studentExams.push({ examName: ex.examName, score: scoreObj.score, comment: scoreObj.comment, date: ex.date });\n        }\n      });\n      if (studentExams.length === 0) {\n        examHistoryList.innerHTML = '<div class=\"empty muted\">Chưa có dữ liệu điểm thi.</div>';\n      } else {\n        examHistoryList.innerHTML = studentExams.reverse().map(e => '<div class=\"drawer-history-item\" style=\"border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;\">\\n            <strong style=\"color: #3b82f6;\">' + escapeHtml(e.examName) + '</strong>: <span style=\"font-weight:bold; color:#0f172a;\">' + e.score + '/10</span>\\n            <div style=\"font-size: 12px; color: #475569; margin-top: 4px; font-style: italic;\">' + escapeHtml(e.comment || '') + '</div>\\n          </div>').join('');\n      }\n    } catch(e) {\n      console.error(e);\n      examHistoryList.innerHTML = '<div class=\"empty muted\">Lỗi tải dữ liệu.</div>';\n    }\n  }\n\n  // Open drawer\n  drawer.classList.add('open');";
content = content.replace(oldDrawerHistory, newDrawerHistory);

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('app.js updated successfully.');
