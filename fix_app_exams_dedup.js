const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

const oldLogic = `      const exams = await api('/api/exams?className=' + encodeURIComponent(student.className));
      const studentExams = [];
      exams.forEach(ex => {
        const scoreObj = (ex.scores || []).find(s => s.studentId === student.id);
        if (scoreObj) {
          studentExams.push({ examName: ex.examName, score: scoreObj.score, comment: scoreObj.comment, date: ex.date });
        }
      });`;

const newLogic = `      const exams = await api('/api/exams?className=' + encodeURIComponent(student.className));
      const studentExams = [];
      const seenExams = new Set();
      // Reverse first to get the latest duplicate, then deduplicate
      [...exams].reverse().forEach(ex => {
        const scoreObj = (ex.scores || []).find(s => s.studentId === student.id);
        if (scoreObj && !seenExams.has(ex.examName)) {
          seenExams.add(ex.examName);
          studentExams.push({ examName: ex.examName, score: scoreObj.score, comment: scoreObj.comment, date: ex.date });
        }
      });
      // Reverse back for display order if needed, but the original code mapped over studentExams.reverse()
      studentExams.reverse();`;

if (app.includes(oldLogic)) {
  app = app.replace(oldLogic, newLogic);
  fs.writeFileSync('public/app.js', app, 'utf8');
  console.log('Fixed app.js deduplication');
} else {
  console.log('Could not find old logic in app.js');
}
