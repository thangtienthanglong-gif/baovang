const fs = require('fs');

// --- 1. Modify index.html ---
let index = fs.readFileSync('public/index.html', 'utf8');

const hintDivRegex = /<div id="makeupModalClassHint"[^>]*><\/div>/g;
index = index.replace(hintDivRegex, '');

fs.writeFileSync('public/index.html', index, 'utf8');

// --- 2. Modify app.js ---
let app = fs.readFileSync('public/app.js', 'utf8');

// Find the hint generation logic inside openMakeupModal
const oldHintLogic = `const sched = getClassScheduleInfo(originalClass, state.today);
  let hintText = 'Gợi ý: Lớp ' + originalClass + ' thường học ' + sched.sessionName.toLowerCase();
  if (sched.daysStr) {
    const daysArr = sched.daysStr.split('').map(d => d === 'C' ? 'CN' : ('thứ ' + d));
    hintText += ' (' + daysArr.join(' và ') + '), nên thường chỉ kẹt ' + daysArr.join(' hoặc ');
  }
  
  const hintEl = document.getElementById('makeupModalClassHint');
  if (hintEl) {
    hintEl.textContent = hintText;
  }`;

const newDropdownLogic = `const sched = getClassScheduleInfo(originalClass, state.today);
  const stuckDayEl = document.getElementById('makeupModalStuckDay');
  if (stuckDayEl) {
    if (sched.daysStr) {
      const daysArr = sched.daysStr.split('');
      stuckDayEl.innerHTML = daysArr.map(d => \`<option value="\${d}">\${d === 'C' ? 'Chủ Nhật' : 'Thứ ' + d}</option>\`).join('');
    } else {
      stuckDayEl.innerHTML = \`<option value="2">Thứ 2</option>
      <option value="3">Thứ 3</option>
      <option value="4">Thứ 4</option>
      <option value="5">Thứ 5</option>
      <option value="6">Thứ 6</option>
      <option value="7">Thứ 7</option>
      <option value="C">Chủ Nhật</option>\`;
    }
  }`;

app = app.replace(oldHintLogic, newDropdownLogic);
fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed dynamic dropdown');
