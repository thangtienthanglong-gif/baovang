const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

const anchor = `      if (part) {
        const checkParts = ['H1', 'H2'].includes(part) ? ['H1', 'H2'] : [part];`;

const replacement = `      if (part) {
        const checkParts = ['H1', 'H2'].includes(part) ? ['H1', 'H2'] : [part];
        
        // Find latest notified time
        const studentEvalsAll = evals.filter(e => e.studentId === st.id && checkParts.includes(e.part)).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        const lastNotifiedIdx = studentEvalsAll.findIndex(e => e.status === 'Đã báo phụ huynh');
        const lastNotifiedTime = lastNotifiedIdx !== -1 ? new Date(studentEvalsAll[lastNotifiedIdx].timestamp) : new Date(0);
        
        const studentWarnings = warnings.filter(w => w.studentId === st.id && checkParts.includes(w.part) && new Date(w.timestamp) > lastNotifiedTime).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        if (studentWarnings.length > 0) {
          trend_status = studentWarnings[0].type;
          trend_parts = [...new Set(studentWarnings.map(w => w.part))];
        } else {
          const studentEvals = lastNotifiedIdx !== -1 ? studentEvalsAll.slice(0, lastNotifiedIdx) : studentEvalsAll;
          if (studentEvals.length >= 2) {
             const badStatuses = ['Sai hơn', 'Kém (K)', 'Chép bài'];
             if (badStatuses.includes(studentEvals[0].status) && badStatuses.includes(studentEvals[1].status)) {
                 trend_status = 'down';
                 trend_message = 'Đang yếu';
                 trend_parts = [...new Set([studentEvals[0].part, studentEvals[1].part])];
             }
          }
        }
`;

const fullAnchor = `      if (part) {
        const checkParts = ['H1', 'H2'].includes(part) ? ['H1', 'H2'] : [part];
        const studentWarnings = warnings.filter(w => w.studentId === st.id && checkParts.includes(w.part)).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (studentWarnings.length > 0) {
          trend_status = studentWarnings[0].type;
          trend_parts = [...new Set(studentWarnings.map(w => w.part))];
        } else {
          const studentEvals = evals.filter(e => e.studentId === st.id && checkParts.includes(e.part)).sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
          if (studentEvals.length >= 2) {
             const badStatuses = ['Sai h3n', 'KAcm (K)', 'ChAcp bAi'];
             if (badStatuses.includes(studentEvals[0].status) && badStatuses.includes(studentEvals[1].status)) {
                 trend_status = 'down';
                 trend_message = '?ang yu';
                 trend_parts = [...new Set([studentEvals[0].part, studentEvals[1].part])];
             }
          }
        }
      }`;

// Since string matching is hard with encoding, regex is safer.
server = server.replace(/      if \(part\) \{[\s\S]*?        \}\n      \}/, replacement + "      }");

fs.writeFileSync('server.js', server, 'utf8');
console.log('Fixed server trend logic');
