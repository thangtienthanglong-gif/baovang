const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, 'server.js');
let serverJs = fs.readFileSync(serverJsPath, 'utf8');

const oldCode = `const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  initializeApp({
    credential: cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || \`https://\${serviceAccount.project_id}-default-rtdb.firebaseio.com\`
  });
  console.log('Connected to Firebase Realtime Database');
} else {
  console.error('LỖI: Không tìm thấy file serviceAccountKey.json.');
  console.error('Vui lòng tạo file này để kết nối Firebase.');
  // Do not exit because maybe they want to see the UI or error out gracefully, actually it's a backend so maybe exit?
  // Let's just log an error.
}`;

const newCode = `let serviceAccount;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else {
    const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
    if (fs.existsSync(serviceAccountPath)) {
      serviceAccount = require(serviceAccountPath);
    }
  }
  
  if (serviceAccount) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || \`https://\${serviceAccount.project_id}-default-rtdb.firebaseio.com\`
    });
    console.log('Connected to Firebase Realtime Database');
  } else {
    console.error('LỖI: Không tìm thấy Firebase Service Account.');
  }
} catch (error) {
  console.error('Lỗi khi đọc cấu hình Firebase:', error);
}`;

if (serverJs.includes('const serviceAccountPath = path.join(process.cwd(), \'serviceAccountKey.json\');')) {
  serverJs = serverJs.replace(oldCode, newCode);
  fs.writeFileSync(serverJsPath, serverJs);
  console.log("Updated server.js to support FIREBASE_SERVICE_ACCOUNT env var");
} else {
  console.log("Could not find the block to replace.");
}
