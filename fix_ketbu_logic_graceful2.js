const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

const newFilter = `
            // Lọc ra các đánh giá từ mốc "Đã báo phụ huynh" gần nhất
            let relevantHistory = res.history || [];
            const checkPartsForHistory = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
            const partHistory = relevantHistory.filter(h => checkPartsForHistory.includes(h.part));
            const lastNotifiedIdx = partHistory.findIndex(h => h.status === 'Đã báo phụ huynh');
            if (lastNotifiedIdx !== -1) {
                relevantHistory = partHistory.slice(0, lastNotifiedIdx);
            } else {
                relevantHistory = partHistory;
            }
`;

if (!html.includes('Lọc ra các đánh giá từ mốc "Đã báo phụ huynh"')) {
    html = html.replace("let warningBanner = '';", newFilter + "\n            let warningBanner = '';");
}

html = html.replace(/res\.history \? res\.history\.filter/g, 'relevantHistory.filter');

// NOTE THE ESCAPING OF DOLLAR SIGN: \${studentId} in JS string becomes literally ${studentId} which is what we want in the HTML template literal!
const btnHtml = `<button onclick="markAsNotified('\\${studentId}')" style="margin-top:8px; background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;"><i class="fa-solid fa-check"></i> Đã báo phụ huynh</button>`;

html = html.replace('Đề nghị xem xét báo phụ huynh.</span></div>`;', 'Đề nghị xem xét báo phụ huynh.</span><br>' + btnHtml + '</div>`;');
html = html.replace('Đề nghị quản lý xem xét chuyển lớp.</span></div>`;', 'Đề nghị quản lý xem xét chuyển lớp.</span><br>' + btnHtml + '</div>`;');
html = html.replace('?? ngh< xem xAct bAo ph huynh.</span></div>`;', '?? ngh< xem xAct bAo ph huynh.</span><br>' + btnHtml + '</div>`;');
html = html.replace('?? ngh< qun lA xem xAct chuyn l>p.</span></div>`;', '?? ngh< qun lA xem xAct chuyn l>p.</span><br>' + btnHtml + '</div>`;');

fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed ketbu_eval.html logic gracefully 2');
