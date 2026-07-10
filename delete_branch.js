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
      const targetName = 'tnthihip';
      let deleted = false;
      for (const branchId of Object.keys(db.branches)) {
        if (branchId === targetName || db.branches[branchId]?.settings?.branchName === targetName) {
          console.log('Found branch to delete:', branchId);
          delete db.branches[branchId];
          deleted = true;
        }
      }
      if (deleted) {
        await getDatabase().ref('/').set(db);
        console.log('Successfully deleted', targetName);
      } else {
        console.log('Could not find branch:', targetName);
      }
    }
  } catch(e) {
    console.error(e);
  }
  process.exit();
}

run();
