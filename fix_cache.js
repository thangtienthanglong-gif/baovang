const fs = require('fs');
let index = fs.readFileSync('public/index.html', 'utf8');
index = index.replace('/app.js?v=20260724-1', '/app.js?v=20260724-2');
if (!index.includes('?v=')) {
  index = index.replace('<script src="/app.js"></script>', '<script src="/app.js?v=20260724-2"></script>');
}
fs.writeFileSync('public/index.html', index, 'utf8');
console.log('Fixed cache buster');
