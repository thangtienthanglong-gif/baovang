const fs = require('fs');

// --- 1. Modify index.html ---
let index = fs.readFileSync('public/index.html', 'utf8');

const exportBtnRegex = /<button class="btn ghost export-btn" type="button">Xuất danh sách<\/button>/;
index = index.replace(exportBtnRegex, '');

const oldKẹt = '<label>Thứ bị kẹt (Lớp gốc)</label>';
const newKẹt = '<label>Buổi bị kẹt (Lớp gốc)</label>\n        <div id="makeupModalClassHint" style="font-size:12px; color:#10b981; font-weight:500; margin-bottom:5px; margin-top:-3px;"></div>';
index = index.replace(oldKẹt, newKẹt);

if (!index.includes('xlsx.full.min.js')) {
    index = index.replace('<script src="/app.js', '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>\n  <script src="/app.js');
}

fs.writeFileSync('public/index.html', index, 'utf8');

// --- 2. Modify app.js ---
let app = fs.readFileSync('public/app.js', 'utf8');

const oldModalFunc = "document.getElementById('makeupModalStudentName').textContent = studentName + ' (' + originalClass + ')';";
const newModalFunc = `document.getElementById('makeupModalStudentName').textContent = studentName + ' (' + originalClass + ')';
  
  let sessionHint = 'Khác';
  if (originalClass.includes('S')) sessionHint = 'Sáng';
  else if (originalClass.includes('C')) sessionHint = 'Chiều';
  else if (originalClass.includes('T')) sessionHint = 'Tối';
  
  const hintEl = document.getElementById('makeupModalClassHint');
  if (hintEl) {
    hintEl.textContent = 'Gợi ý: Lớp ' + originalClass + ' thường học ca ' + sessionHint;
  }`;
app = app.replace(oldModalFunc, newModalFunc);

fs.writeFileSync('public/app.js', app, 'utf8');

// --- 3. Modify exams.js ---
let exams = fs.readFileSync('public/exams.js', 'utf8');

const oldExport = `        let csvContent = "Mã HS,Tên Học Sinh,Số Điện Thoại";
        exams.forEach(ex => {
          csvContent += "," + ex.examName + " (Điểm)," + ex.examName + " (Nhận xét)";
        });
        csvContent += "\\n";
        
        classStudents.forEach(student => {
          let row = \`"\${student.code}","\${student.fullName || student.name}","\${student.phone1 || student.phone2 || ''}"\`;
          
          exams.forEach(ex => {
            const scoreObj = ex.scores.find(s => s.studentId === student.id);
            if (scoreObj) {
              row += \`,"\${scoreObj.score}","\${(scoreObj.comment || '').replace(/"/g, '""')}"\`;
            } else {
              row += \`,"",""\`;
            }
          });
          
          csvContent += row + "\\n";
        });
        
        const blob = new Blob(["\\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", \`Bang_Diem_\${cls}_\${new Date().toISOString().split('T')[0]}.csv\`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);`;

const newExport = `        if (typeof XLSX === 'undefined') {
          toast('Đang tải thư viện Excel, vui lòng thử lại sau...', 'warning');
          return;
        }
        
        const data = [];
        // Header
        const headerRow = ["Họ và Tên", "Điện Thoại"];
        exams.forEach(ex => {
          headerRow.push("Điểm thi");
          headerRow.push("Nhận xét");
        });
        data.push(headerRow);
        
        // Data rows
        classStudents.forEach(student => {
          const row = [student.fullName || student.name || '', student.phone1 || student.phone2 || ''];
          exams.forEach(ex => {
            const scoreObj = ex.scores.find(s => s.studentId === student.id);
            if (scoreObj) {
              row.push(scoreObj.score || '');
              row.push(scoreObj.comment || '');
            } else {
              row.push('');
              row.push('');
            }
          });
          data.push(row);
        });
        
        const ws = XLSX.utils.aoa_to_sheet(data);
        
        // Column widths
        const wscols = [
          {wch: 25}, // Ho va Ten
          {wch: 15}, // Dien thoai
        ];
        exams.forEach(ex => {
          wscols.push({wch: 10}); // Diem thi
          wscols.push({wch: 35}); // Nhan xet
        });
        ws['!cols'] = wscols;
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Bang Diem");
        XLSX.writeFile(wb, \`Bang_Diem_\${cls}_\${new Date().toISOString().split('T')[0]}.xlsx\`);`;

// I need to use regex because of the character encoding issues (Mã HS, v.v.).
// Let's replace everything between `let csvContent =` and `document.body.removeChild(link);`
const startIdx = exams.indexOf('let csvContent = ');
const endStr = 'document.body.removeChild(link);';
const endIdx = exams.indexOf(endStr);

if (startIdx !== -1 && endIdx !== -1) {
  const toReplace = exams.substring(startIdx, endIdx + endStr.length);
  exams = exams.replace(toReplace, newExport);
  fs.writeFileSync('public/exams.js', exams, 'utf8');
  console.log('Fixed exams.js');
} else {
  console.log('Could not find export logic to replace!');
}

