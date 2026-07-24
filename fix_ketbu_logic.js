const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

// The logic where badEvals and goodEvals are calculated
// We need to insert a milestone filter right before it.

const anchorFilter = `            let warningBanner = '';
            if (cachedSt.trend_status === 'down') {
                const checkParts = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];`;

const newFilter = `            let warningBanner = '';
            
            // Lọc ra các đánh giá từ mốc "Đã báo phụ huynh" gần nhất
            let relevantHistory = res.history || [];
            const checkParts = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
            const partHistory = relevantHistory.filter(h => checkParts.includes(h.part));
            const lastNotifiedIdx = partHistory.findIndex(h => h.status === 'Đã báo phụ huynh');
            if (lastNotifiedIdx !== -1) {
                relevantHistory = partHistory.slice(0, lastNotifiedIdx);
            } else {
                relevantHistory = partHistory;
            }

            if (cachedSt.trend_status === 'down') {
                const badEvals = relevantHistory.filter(h => ['Sai hơn', 'Kém (K)', 'Chép bài'].includes(h.status)).slice(0,3);`;

const regexFilter = /            let warningBanner = '';\s*if \(cachedSt\.trend_status === 'down'\) \{\s*const checkParts = \['H1', 'H2'\]\.includes\(currentPart\) \? \['H1', 'H2'\] : \[currentPart\];\s*const badEvals = res\.history \? res\.history\.filter\(h => checkParts\.includes\(h\.part\) && \['Sai h.n', 'KAcm \(K\)', 'ChAcp bA.i', 'Sai hơn', 'Kém \(K\)', 'Chép bài'\]\.includes\(h\.status\)\)\.slice\(0,3\) : \[\];/;

html = html.replace(regexFilter, newFilter);

// Also replace for goodEvals
const goodAnchor = `            } else if (cachedSt.trend_status === 'up') {
                const checkParts = ['H1', 'H2'].includes(currentPart) ? ['H1', 'H2'] : [currentPart];
                const goodEvals = res.history ? res.history.filter(h => checkParts.includes(h.part) && ['Đúng', 'Tốt (T)', '?Ang', 'T`t (T)'].includes(h.status)).slice(0,3) : [];`;

const newGoodAnchor = `            } else if (cachedSt.trend_status === 'up') {
                const goodEvals = relevantHistory.filter(h => ['Đúng', 'Tốt (T)', '?Ang', 'T`t (T)'].includes(h.status)).slice(0,3);`;
html = html.replace(/            \} else if \(cachedSt\.trend_status === 'up'\) \{\s*const checkParts = \['H1', 'H2'\].includes\(currentPart\) \? \['H1', 'H2'\] : \[currentPart\];\s*const goodEvals = res\.history \? res\.history\.filter\(h => checkParts\.includes\(h\.part\) && \['.*?'\].includes\(h\.status\)\)\.slice\(0,3\) : \[\];/, newGoodAnchor);

// Now inject the button inside the warning banners!
const btnHtml = `<button onclick="markAsNotified('${studentId}')" style="margin-top:8px; background:#ef4444; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;"><i class="fa-solid fa-check"></i> Đã báo phụ huynh</button>`;

html = html.replace('Đề nghị xem xét báo phụ huynh.</span></div>`;', 'Đề nghị xem xét báo phụ huynh.</span><br>' + btnHtml + '</div>`;');
html = html.replace('Đề nghị quản lý xem xét chuyển lớp.</span></div>`;', 'Đề nghị quản lý xem xét chuyển lớp.</span><br>' + btnHtml + '</div>`;');

fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed ketbu_eval.html logic');
