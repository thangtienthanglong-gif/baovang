const fs = require('fs');
let examsJs = fs.readFileSync('public/exams.js', 'utf8');
examsJs = examsJs.replace(/parseFloat\(score\)/g, 'score');
fs.writeFileSync('public/exams.js', examsJs, 'utf8');
console.log('Fixed exams.js parseFloat');
