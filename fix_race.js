const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const oldPost = `app.post('/api/students/:id/transfer', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    if (!db.transferHistory) db.transferHistory = [];
    db.transferHistory.push({
      studentId: req.params.id,
      fromClass: req.body.fromClass,
      toClass: req.body.toClass,
      date: req.body.date,
      teacher: req.body.teacher,
      timestamp: Date.now()
    });
    await saveBranchDb(req, db);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});`;

const newPost = `app.post('/api/students/:id/transfer', async (req, res, next) => {
  try {
    const db = await getBranchDb(req);
    
    // Update student class directly to avoid race conditions with PUT
    const index = (db.students || []).findIndex(s => s.id === req.params.id);
    let updatedStudent = null;
    if (index !== -1) {
      const oldClass = db.students[index].className;
      db.students[index].className = req.body.toClass;
      updatedStudent = db.students[index];
      
      if (oldClass !== req.body.toClass && db.scheduleExceptions) {
        db.scheduleExceptions = db.scheduleExceptions.filter(e => e.studentId !== req.params.id);
      }
    }
    
    if (!db.transferHistory) db.transferHistory = [];
    db.transferHistory.push({
      studentId: req.params.id,
      fromClass: req.body.fromClass,
      toClass: req.body.toClass,
      date: req.body.date,
      teacher: req.body.teacher,
      timestamp: Date.now()
    });
    await saveBranchDb(req, db);
    res.json(updatedStudent || { success: true });
  } catch (error) {
    next(error);
  }
});`;

code = code.replace(oldPost, newPost);
fs.writeFileSync('server.js', code, 'utf8');
console.log("Updated server.js POST transfer route.");
