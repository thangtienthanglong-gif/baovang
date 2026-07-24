const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');
const oldLogic = `const classNames = [...new Set(activeStudents().map(s => s.className).filter(c => c))].sort();`;
const newLogic = `const classNames = [...new Set(activeStudents().map(s => s.className).filter(c => c && c !== originalClass))].sort();`;
app = app.replace(oldLogic, newLogic);
fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed target class dropdown');
