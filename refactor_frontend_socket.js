const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, 'public', 'app.js');
let code = fs.readFileSync(appPath, 'utf8');

// Remove socket io init
code = code.replace(/const socket = io\(\);\n/g, '');

// Remove socket listeners
const socketListenersRegex = /\/\/ --- SOCKET\.IO REALTIME SYNC ---[\s\S]*?socket\.on\('updateHistory', \(\) => \{\n\s*loadHistory\(\);\n\}\);\n/g;
code = code.replace(socketListenersRegex, '');

fs.writeFileSync(appPath, code);
console.log('Removed Socket.io from frontend');
