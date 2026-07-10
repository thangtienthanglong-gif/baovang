require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Student = require('./models/Student');
const Absence = require('./models/Absence');
const CallLog = require('./models/CallLog');
const NotificationLog = require('./models/NotificationLog');
const Setting = require('./models/Setting');

const DB_FILE = path.join(__dirname, 'data', 'db.json');

async function migrate() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/baovang';
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB.');

    if (!fs.existsSync(DB_FILE)) {
      console.log('No db.json found, skipping migration.');
      process.exit(0);
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

    // Migrate Settings
    if (db.settings) {
      await Setting.deleteMany({});
      await Setting.create(db.settings);
      console.log('Migrated settings.');
    }

    // Migrate Students
    if (db.students && db.students.length > 0) {
      await Student.deleteMany({});
      await Student.insertMany(db.students);
      console.log(`Migrated ${db.students.length} students.`);
    }

    // Migrate Absences
    if (db.absences && db.absences.length > 0) {
      await Absence.deleteMany({});
      await Absence.insertMany(db.absences);
      console.log(`Migrated ${db.absences.length} absences.`);
    }

    // Migrate Call Logs
    if (db.callLogs && db.callLogs.length > 0) {
      await CallLog.deleteMany({});
      await CallLog.insertMany(db.callLogs);
      console.log(`Migrated ${db.callLogs.length} call logs.`);
    }

    // Migrate Notification Logs
    if (db.notificationLogs && db.notificationLogs.length > 0) {
      await NotificationLog.deleteMany({});
      await NotificationLog.insertMany(db.notificationLogs);
      console.log(`Migrated ${db.notificationLogs.length} notification logs.`);
    }

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
