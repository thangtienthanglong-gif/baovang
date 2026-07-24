const fs = require('fs');

// 1. Fix app.js (transfer class undefined issue)
let appJs = fs.readFileSync('public/app.js', 'utf8');
const oldTransferLogic = "const classNames = state.classes.map(c => c.name).filter(c => c !== student.className);";
const newTransferLogic = "const classNames = state.classes.filter(c => c !== student.className);";
appJs = appJs.replace(oldTransferLogic, newTransferLogic);
fs.writeFileSync('public/app.js', appJs, 'utf8');
console.log('Fixed app.js');

// 2. Fix exams.js (classSelect issue)
let examsJs = fs.readFileSync('public/exams.js', 'utf8');
examsJs = examsJs.replace(/getElementById\('classSelect'\)/g, "getElementById('filterClass')");
fs.writeFileSync('public/exams.js', examsJs, 'utf8');
console.log('Fixed exams.js');
