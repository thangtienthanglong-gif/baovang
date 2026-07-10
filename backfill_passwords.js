require('dotenv').config();
const { initializeApp, cert } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const path = require('path');

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
const sa = require(serviceAccountPath);

// Find out which URL works
const dbUrl = process.env.FIREBASE_DATABASE_URL || `https://${sa.project_id}-default-rtdb.asia-southeast1.firebasedatabase.app`;

const app = initializeApp({
  credential: cert(sa),
  databaseURL: dbUrl
});
const db = getDatabase(app);

async function backfill() {
  try {
    const rootRef = db.ref('/');
    const snap = await rootRef.once('value');
    const data = snap.val() || {};
    let updated = false;
    
    if (data.users) {
      if (data.users['admin'] && !data.users['admin'].plainPassword) {
        data.users['admin'].plainPassword = 'admin';
        updated = true;
      }
      if (data.users['vanphong'] && !data.users['vanphong'].plainPassword) {
        data.users['vanphong'].plainPassword = '(Đã mã hóa cũ)';
        updated = true;
      }
      if (data.users['tansonnhat'] && !data.users['tansonnhat'].plainPassword) {
        data.users['tansonnhat'].plainPassword = '(Đã mã hóa cũ)';
        updated = true;
      }
      
      if (updated) {
        await rootRef.child('users').set(data.users);
        console.log('Backfilled plainPassword successfully');
      } else {
        console.log('No passwords needed backfilling');
      }
    } else {
       console.log('No users found in database');
    }
  } catch (err) {
    console.error('Error during backfill:', err.message);
  }
  process.exit(0);
}

backfill();
