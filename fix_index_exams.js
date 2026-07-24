const fs = require('fs');
let index = fs.readFileSync('public/index.html', 'utf8');

const absenceSection = `<div class="drawer-section">
        <h3>Lịch sử gần đây</h3>
        <div id="drawerAbsenceHistory" class="drawer-history-list">
          <div class="empty muted">Chưa tải lịch sử...</div>
        </div>
      </div>`;

const examSection = `<div class="drawer-section">
        <h3>Lịch sử điểm thi</h3>
        <div id="drawerExamHistory" class="drawer-history-list">
          <div class="empty muted">Chưa tải lịch sử...</div>
        </div>
      </div>`;

if (index.includes(absenceSection) && !index.includes('drawerExamHistory')) {
  index = index.replace(absenceSection, absenceSection + '\n\n      ' + examSection);
  fs.writeFileSync('public/index.html', index, 'utf8');
  console.log('Fixed index.html exam history');
} else {
  console.log('Could not find anchor or already exists');
}
