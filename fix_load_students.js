const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'public', 'app.js');
let code = fs.readFileSync(appPath, 'utf8');

code = code.replace(
  /async function loadStudents\(q = ''\) {\n  const rows = await api\('\/api\/students\?' \+ queryString\(\{ q \}\)\);\n  state\.students = rows;\n  renderStudentSelect\(\);\n  renderClassDropdown\(\);\n  renderRoster\(\);\n}/,
  `async function loadStudents(q = '') {
  const rows = await api('/api/students?' + queryString({ q }));
  state.students = rows;
  renderStudentSelect();
  renderClassDropdown();
  renderRoster();
  renderFilters(); // ADDED: Refresh the class filter dropdown after loading students
}`
);

fs.writeFileSync(appPath, code);
console.log('Fixed loadStudents in app.js');
