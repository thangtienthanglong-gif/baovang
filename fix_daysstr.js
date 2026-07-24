const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');
app = app.replace('return { sessionName, matchesDate };', 'return { sessionName, matchesDate, daysStr };');
fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed daysStr return');
