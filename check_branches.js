require('dotenv').config();
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const fs = require('fs');
const path = require('path');

const serviceAccountPath = path.join(process.cwd(), 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
  const serviceAccount = require(serviceAccountPath);
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
    });
  }
}

async function run() {
  try {
    const snapshot = await getDatabase().ref('/').once('value');
    const db = snapshot.val() || {};
    
    if (db.branches) {
      for (const branchId of Object.keys(db.branches)) {
        console.log(\`Branch ID: \${branchId}, Name: \${db.branches[branchId]?.settings?.branchName}\`);
      }
    } else {
      console.log('No branches found.');
    }
  } catch(e) {
    console.error(e);
  }
  process.exit();
}

run();
