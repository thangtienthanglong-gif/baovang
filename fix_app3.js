const fs = require('fs');
let content = fs.readFileSync('public/app.js', 'utf8');

// Make function async
content = content.replace('function openStudentProfile(studentId) {', 'async function openStudentProfile(studentId) {');

// Add Kẹt Bù button into the drawer body (where it was supposed to be)
const targetInfo = "document.getElementById('drawerStudentParent').textContent = student.parentName || 'Chưa cập nhật';";
const addBtn = `document.getElementById('drawerStudentParent').textContent = student.parentName || 'Chưa cập nhật';

  // Bind edit buttons in header
  const openEditStudentBtn = document.getElementById('openEditStudentBtn');
  if (openEditStudentBtn) openEditStudentBtn.onclick = () => openEditStudentModal(studentId);
  const openTransferClassBtn = document.getElementById('openTransferClassBtn');
  if (openTransferClassBtn) openTransferClassBtn.onclick = () => openTransferClassModal(studentId);
  const openMakeupBtn = document.getElementById('openMakeupBtn');
  if (openMakeupBtn) openMakeupBtn.onclick = () => openMakeupModal(student.id, student.fullName || student.name, student.className);
`;
content = content.replace(targetInfo, addBtn);

// Add exam history at the end of the function before it adds the 'open' class
const targetHistory = "backdrop.classList.add('show');";
const addExam = `
  // Populate exam history
  const examHistoryList = document.getElementById('drawerExamHistory');
  if (examHistoryList) {
    examHistoryList.innerHTML = '<div class="empty muted">Đang tải...</div>';
    try {
      const exams = await api('/api/exams?className=' + encodeURIComponent(student.className));
      const studentExams = [];
      exams.forEach(ex => {
        const scoreObj = (ex.scores || []).find(s => s.studentId === student.id);
        if (scoreObj) {
          studentExams.push({ examName: ex.examName, score: scoreObj.score, comment: scoreObj.comment, date: ex.date });
        }
      });
      if (studentExams.length === 0) {
        examHistoryList.innerHTML = '<div class="empty muted">Chưa có dữ liệu điểm thi.</div>';
      } else {
        examHistoryList.innerHTML = studentExams.reverse().map(e => \`
          <div class="drawer-history-item" style="border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
            <strong style="color: #3b82f6;">\${escapeHtml(e.examName)}</strong>: <span style="font-weight:bold; color:#0f172a;">\${e.score}/10</span>
            <div style="font-size: 12px; color: #475569; margin-top: 4px; font-style: italic;">\${escapeHtml(e.comment || '')}</div>
          </div>
        \`).join('');
      }
    } catch(e) {
      console.error(e);
      examHistoryList.innerHTML = '<div class="empty muted">Lỗi tải dữ liệu.</div>';
    }
  }

  backdrop.classList.add('show');`;
content = content.replace(targetHistory, addExam);

fs.writeFileSync('public/app.js', content, 'utf8');
console.log('Done modifying app.js');
