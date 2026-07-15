const fs = require('fs');
let c = fs.readFileSync('c:/Users/XUANVU/Downloads/baovang/baovang/public/index.html', 'utf8');
const search = '<div id="exportLateHistoryBtn" style="padding: 10px 16px; cursor: pointer; color: var(--text-color); font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'transparent\'" onclick="this.parentElement.style.display=\'none\'">Xuất Excel HS đi trễ</div>';
const replace = search + '\n            <div id="exportExcusedHistoryBtn" style="padding: 10px 16px; cursor: pointer; color: var(--text-color); font-size: 14px; transition: background 0.2s;" onmouseover="this.style.background=\'#f1f5f9\'" onmouseout="this.style.background=\'transparent\'" onclick="this.parentElement.style.display=\'none\'">Xuất Excel HS có phép</div>';
c = c.replace(search, replace);
fs.writeFileSync('c:/Users/XUANVU/Downloads/baovang/baovang/public/index.html', c);
