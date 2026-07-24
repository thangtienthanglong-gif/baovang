const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const anchor = `    const sessions = db.branches[branchId]?.teaching_sessions || [];`;
const insert = `
    const studentExams = [];
    (db.branches[branchId]?.exams || []).forEach(ex => {
      const scoreObj = (ex.scores || []).find(s => s.studentId === studentId);
      if (scoreObj) {
        studentExams.push({
          examName: ex.examName,
          score: scoreObj.score,
          comment: scoreObj.comment,
          date: ex.date
        });
      }
    });
`;

if (!server.includes('studentExams = []')) {
  server = server.replace(anchor, anchor + insert);
  fs.writeFileSync('server.js', server, 'utf8');
  console.log('Fixed server.js reference error');
}
