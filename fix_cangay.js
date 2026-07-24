const fs = require('fs');
let app = fs.readFileSync('public/app.js', 'utf8');

// Remove ['Cả ngày', 'Cả ngày'], from statusOptions
app = app.replace(/\s*\['Cả ngày', 'Cả ngày'\],/, '');

// Add replace logic to normalizeAbsenceStatus
const oldNormalize = `const status = String(value || '').trim();`;
const newNormalize = `let status = String(value || '').trim();\n  status = status.replace(/\\s*\\(Cả ngày\\)/gi, '');`;
app = app.replace(oldNormalize, newNormalize);

// Also remove from filterAbsenceStatus dropdown display
const oldFilter = `...state.absenceStatuses.map(status => \`<option value="\${escapeHtml(status)}">\${escapeHtml(status)}</option>\`)`;
const newFilter = `...state.absenceStatuses.map(status => \`<option value="\${escapeHtml(status)}">\${escapeHtml(status.replace(/\\s*\\(Cả ngày\\)/gi, ''))}</option>\`)`;
app = app.replace(oldFilter, newFilter);

fs.writeFileSync('public/app.js', app, 'utf8');
console.log('Fixed cả ngày');
