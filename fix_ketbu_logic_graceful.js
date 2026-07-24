const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

// The new logic block
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

// Inject before "let warningBanner"
if (!html.includes('Lọc ra các đánh giá từ mốc "Đã báo phụ huynh"')) {
    html = html.replace("let warningBanner = '';", newFilter + "\n            let warningBanner = '';");
}

// Replace res.history ? res.history.filter(...) with relevantHistory.filter(...)
// for both badEvals and goodEvals!
// Using replace with a global regex for `res.history ? res.history.filter`
html = html.replace(/res\.history \? res\.history\.filter/g, 'relevantHistory.filter');

// Now inject the button inside the warning banners!
const btnHtml = `<button onclick="markAsNotified('${studentId}')" style="margin-top:8px; background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;"><i class="fa-solid fa-check"></i> Đã báo phụ huynh</button>`;

html = html.replace('Đề nghị xem xét báo phụ huynh.</span></div>`;', 'Đề nghị xem xét báo phụ huynh.</span><br>' + btnHtml + '</div>`;');
html = html.replace('Đề nghị quản lý xem xét chuyển lớp.</span></div>`;', 'Đề nghị quản lý xem xét chuyển lớp.</span><br>' + btnHtml + '</div>`;');
html = html.replace('?? ngh< xem xAct bAo ph huynh.</span></div>`;', '?? ngh< xem xAct bAo ph huynh.</span><br>' + btnHtml + '</div>`;');
html = html.replace('?? ngh< qun lA xem xAct chuyn l>p.</span></div>`;', '?? ngh< qun lA xem xAct chuyn l>p.</span><br>' + btnHtml + '</div>`;');

fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed ketbu_eval.html logic gracefully');
