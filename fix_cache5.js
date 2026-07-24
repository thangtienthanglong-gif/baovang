const fs = require('fs');
let index = fs.readFileSync('public/index.html', 'utf8');
index = index.replace('/app.js?v=20260724-4', '/app.js?v=20260724-5');
fs.writeFileSync('public/index.html', index, 'utf8');
console.log('Fixed cache buster 5');
