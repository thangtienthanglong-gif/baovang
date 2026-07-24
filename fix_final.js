const fs = require('fs');

// --- 1. Modify index.html ---
let index = fs.readFileSync('public/index.html', 'utf8');

// Set Bù cố định as default
index = index.replace('<option value="bu_tam">Bù tạm (1 buổi)</option>', '<option value="bu_tam">Bù tạm (1 buổi)</option>'); // unchanged
index = index.replace('<option value="hoc_bu">Học bù (Cố định)</option>', '<option value="hoc_bu" selected>Học bù (Cố định)</option>');

// Change Thứ học bù to Buổi học bù
index = index.replace('<label>Thứ học bù</label>', '<label>Buổi học bù</label>');

// Change Hủy to Đóng
index = index.replace(`onclick="document.getElementById('makeupModal').style.display='none'">Hủy</button>`, `onclick="document.getElementById('makeupModal').style.display='none'">Đóng</button>`);

fs.writeFileSync('public/index.html', index, 'utf8');

// --- 2. Modify app.js ---
let app = fs.readFileSync('public/app.js', 'utf8');

const oldModalFunc = `let sessionHint = 'Khác';
  if (originalClass.includes('S')) sessionHint = 'Sáng';
  else if (originalClass.includes('C')) sessionHint = 'Chiều';
  else if (originalClass.includes('T')) sessionHint = 'Tối';
  
  const hintEl = document.getElementById('makeupModalClassHint');
  if (hintEl) {
    hintEl.textContent = 'Gợi ý: Lớp ' + originalClass + ' thường học ca ' + sessionHint;
  }`;

const newModalFunc = `const sched = getClassScheduleInfo(originalClass, state.today);
  let hintText = 'Gợi ý: Lớp ' + originalClass + ' thường học ' + sched.sessionName.toLowerCase();
  if (sched.daysStr) {
    const daysArr = sched.daysStr.split('').map(d => d === 'C' ? 'CN' : ('thứ ' + d));
    hintText += ' (' + daysArr.join(' và ') + '), nên thường chỉ kẹt ' + daysArr.join(' hoặc ');
  }
  
  const hintEl = document.getElementById('makeupModalClassHint');
  if (hintEl) {
    hintEl.textContent = hintText;
  }`;

app = app.replace(oldModalFunc, newModalFunc);
fs.writeFileSync('public/app.js', app, 'utf8');

// --- 3. Modify exams.js (Remove duplicate exams) ---
let examsJs = fs.readFileSync('public/exams.js', 'utf8');

const oldExportExams = `const data = [];
        // Header
        const headerRow = ["Họ và Tên", "Điện Thoại"];
        exams.forEach(ex => {
          headerRow.push("Điểm thi");
          headerRow.push("Nhận xét");
        });`;

const newExportExams = `const uniqueExamsMap = {};
        exams.forEach(ex => uniqueExamsMap[ex.examName] = ex);
        const uniqueExams = Object.values(uniqueExamsMap);
        
        const data = [];
        // Header
        const headerRow = ["Họ và Tên", "Điện Thoại"];
        uniqueExams.forEach(ex => {
          headerRow.push("Điểm thi");
          headerRow.push("Nhận xét");
        });`;

examsJs = examsJs.replace(oldExportExams, newExportExams);

// Replace the loop for rows too
const oldRowExams = `exams.forEach(ex => {
            const scoreObj = ex.scores.find(s => s.studentId === student.id);`;
const newRowExams = `uniqueExams.forEach(ex => {
            const scoreObj = ex.scores.find(s => s.studentId === student.id);`;

examsJs = examsJs.replace(oldRowExams, newRowExams);

// Replace the column width loop
const oldWidthExams = `exams.forEach(ex => {
          wscols.push({wch: 10}); // Diem thi`;
const newWidthExams = `uniqueExams.forEach(ex => {
          wscols.push({wch: 10}); // Diem thi`;

examsJs = examsJs.replace(oldWidthExams, newWidthExams);

fs.writeFileSync('public/exams.js', examsJs, 'utf8');
console.log('Fixed everything');
