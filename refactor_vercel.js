const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, 'server.js');
let code = fs.readFileSync(serverPath, 'utf8');

// 1. Remove socket.io import and initialization
code = code.replace(/const { Server } = require\('socket\.io'\);\n/, '');
code = code.replace(/const io = new Server\(server, { cors: { origin: '\*' } }\);\n/, '');

// 2. Remove middleware that attaches io to req
code = code.replace(/app\.use\(\(req, res, next\) => {\n  req\.io = io;\n  next\(\);\n}\);\n/, '');

// 3. Remove socket connection listeners
const ioOnConnectionRegex = /io\.on\('connection', \(socket\) => \{[\s\S]*?\}\);\n/;
code = code.replace(ioOnConnectionRegex, '');

// 4. Change server.listen to module.exports
const listenRegex = /server\.listen\(PORT, \(\) => \{[\s\S]*?\}\);/;
const moduleExports = `
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(\`App đang chạy tại http://localhost:\${PORT}\`);
  });
} else {
  module.exports = app;
}
`;
code = code.replace(listenRegex, moduleExports);

// 5. Replace references to req.io.emit with nothing (they are just notifications, they won't break the app if removed, but maybe we should just mock req.io so we don't have to remove every req.io.emit call)
const mockIoRegex = /const app = express\(\);/;
const mockIoCode = `const app = express();\n\n// Mock req.io for Vercel Serverless (Disable real-time sync)\napp.use((req, res, next) => {\n  req.io = {\n    emit: () => {}\n  };\n  next();\n});\n`;
code = code.replace(mockIoRegex, mockIoCode);


fs.writeFileSync(serverPath, code);
console.log('Refactored server.js for Vercel');
