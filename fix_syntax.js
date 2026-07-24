const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

// Fix badEvals
html = html.replace(/\.slice\(0,3\) : \[\];/g, '.slice(0,3);');

fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed syntax error in ketbu_eval.html');
