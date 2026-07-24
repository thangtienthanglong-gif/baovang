const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

// Update openTransferClassModal
const openOld = `  document.getElementById('transferTargetClass').innerHTML = classNames.map(c => '<option value="' + c + '">' + c + '</option>').join('');
  
  document.getElementById('transferClassModal').style.display = 'flex';`;
const openNew = `  document.getElementById('transferTargetClass').innerHTML = classNames.map(c => '<option value="' + c + '">' + c + '</option>').join('');
  
  if (localStorage.getItem('savedTransferTeacher')) {
    document.getElementById('transferTeacherName').value = localStorage.getItem('savedTransferTeacher');
  }
  
  document.getElementById('transferClassModal').style.display = 'flex';`;
app = app.replace(openOld, openNew);

// Update transfer form submit
const submitOld = `  const newClass = document.getElementById('transferTargetClass').value;
  
  const payload = { ...student, className: newClass };`;
const submitNew = `  const newClass = document.getElementById('transferTargetClass').value;
  const teacherName = document.getElementById('transferTeacherName').value.trim();
  localStorage.setItem('savedTransferTeacher', teacherName);
  
  const payload = { ...student, className: newClass };`;
app = app.replace(submitOld, submitNew);

// Update transfer history API call
const apiOld = `body: JSON.stringify({ fromClass: student.className, toClass: newClass, date: state.today })`;
const apiNew = `body: JSON.stringify({ fromClass: student.className, toClass: newClass, date: state.today, teacher: teacherName })`;
app = app.replace(apiOld, apiNew);

// Update transfer history rendering
const renderOld = `escapeHtml(h.toClass) + '</strong> (Ngày ' + escapeHtml(h.date) + ')</div>'`;
const renderNew = `escapeHtml(h.toClass) + '</strong> (Ngày ' + escapeHtml(h.date) + ') - GV: <strong>' + escapeHtml(h.teacher || 'Không rõ') + '</strong></div>'`;
app = app.replace(renderOld, renderNew);

fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed app.js for transfer');

// Update server.js
let server = fs.readFileSync('server.js', 'utf8');
const serverOld = `      toClass: req.body.toClass,
      date: req.body.date,
      timestamp: Date.now()`;
const serverNew = `      toClass: req.body.toClass,
      date: req.body.date,
      teacher: req.body.teacher,
      timestamp: Date.now()`;
server = server.replace(serverOld, serverNew);

fs.writeFileSync('server.js', server, 'utf8');
console.log('Fixed server.js for transfer');
