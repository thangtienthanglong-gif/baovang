const fs = require('fs');
let index = fs.readFileSync('public/index.html', 'utf8');
index = index.replace('/app.js?v=20260724-2', '/app.js?v=20260724-3');
fs.writeFileSync('public/index.html', index, 'utf8');
console.log('Fixed cache buster again');
