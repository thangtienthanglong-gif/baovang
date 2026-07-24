const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

const anchorOld = 'warningBanner = `<div style="background:#fef2f2; border-left:4px solid #ef4444; padding:10px; margin-bottom:15px; border-radius:4px;"><strong style="color:#b91c1c;">${title}:</strong> <br><span style="font-size:13px; color:#7f1d1d;">${reason}. ${suggestion}</span></div>`;';

const btnHtml = '<button onclick="markAsNotified(\\'${studentId}\\')" style="margin-top:8px; background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;"><i class="fa-solid fa-check"></i> Đã báo phụ huynh</button>';

const anchorNew = 'warningBanner = `<div style="background:#fef2f2; border-left:4px solid #ef4444; padding:10px; margin-bottom:15px; border-radius:4px;"><strong style="color:#b91c1c;">${title}:</strong> <br><span style="font-size:13px; color:#7f1d1d;">${reason}. ${suggestion}</span><br>' + btnHtml + '</div>`;';

html = html.replace(anchorOld, anchorNew);
fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed warningBanner html');
