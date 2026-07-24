const fs = require('fs');
let examsJs = fs.readFileSync('public/exams.js', 'utf8');
examsJs = examsJs.replace("if (!cls) {", "if (!cls || cls === 'ALL') {");
fs.writeFileSync('public/exams.js', examsJs, 'utf8');
console.log('Fixed exams.js ALL check');
