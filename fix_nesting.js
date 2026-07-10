const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Extract staffTab
const startStaff = html.indexOf('<section id="staffTab" class="tab-panel">');
const endStaff = html.indexOf('</section>', startStaff) + 10;
const staffHtml = html.substring(startStaff, endStaff);

// 2. Remove staffTab from current position
html = html.substring(0, startStaff) + html.substring(endStaff);

// 3. Insert staffTab before guideTab (so it's a sibling of historyTab)
const guideStart = html.indexOf('<section id="guideTab" class="tab-panel">');
html = html.substring(0, guideStart) + staffHtml + '\n    ' + html.substring(guideStart);

fs.writeFileSync('public/index.html', html);
console.log('Fixed nesting of staffTab');
