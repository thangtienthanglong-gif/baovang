const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const oldCode = `    const absences = (db.branches[branchId]?.absences || []).filter(a => a.studentId === studentId);
    const evaluations = (db.branches[branchId]?.evaluations || []).filter(e => e.studentId === studentId);`;

const newCode = `    const absences = (db.branches[branchId]?.absences || []).filter(a => a.studentId === studentId);
    const evaluations = (db.branches[branchId]?.evaluations || []).filter(e => e.studentId === studentId);
    
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
    });`;

server = server.replace(oldCode, newCode);

const oldResponse = `res.json({ student, history, absences });`;
const newResponse = `res.json({ student, history, absences, exams: studentExams });`;
server = server.replace(oldResponse, newResponse);

fs.writeFileSync('server.js', server, 'utf8');
console.log('Fixed server.js');
