const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

// The line for filterAbsenceStatus
app = app.replace(
  /...state.absenceStatuses.map\(status => `<option value="\${escapeHtml\(status\)}">\${escapeHtml\(status.replace\(\/\\s\*\\\(Cả ngày\\\)\/gi, ''\)\)}<\/option>`\)/,
  `...state.absenceStatuses.filter(s => s !== 'Cả ngày').map(status => \`<option value="\${escapeHtml(status)}">\${escapeHtml(status.replace(/\\s*\\(Cả ngày\\)/gi, ''))}</option>\`)`
);

// The line for absenceStatus
app = app.replace(
  /\$\('#absenceStatus'\).innerHTML = state.absenceStatuses.map\(status => `<option>\${escapeHtml\(status\)}<\/option>`\).join\(''\);/,
  `$('#absenceStatus').innerHTML = state.absenceStatuses.filter(s => s !== 'Cả ngày').map(status => \`<option>\${escapeHtml(status)}</option>\`).join('');`
);

fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed cả ngày completely');
