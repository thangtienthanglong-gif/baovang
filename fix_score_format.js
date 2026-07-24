const fs = require('fs');

// 1. Fix exams.js input type
let examsJs = fs.readFileSync('public/exams.js', 'utf8');
examsJs = examsJs.replace(/type="number" step="0.1" min="0" max="10"/g, 'type="text"');
examsJs = examsJs.replace(/width: 80px;/g, 'width: 120px;');
fs.writeFileSync('public/exams.js', examsJs, 'utf8');
console.log('Fixed exams.js');

// 2. Fix app.js score display
let appJs = fs.readFileSync('public/app.js', 'utf8');
appJs = appJs.replace(/\$\{e\.score\}\/10/g, '${escapeHtml(String(e.score))}');
fs.writeFileSync('public/app.js', appJs, 'utf8');
console.log('Fixed app.js');
