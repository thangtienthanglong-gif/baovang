const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

// 1. Remove the old exam block
const oldExamBlock = `
            html += \`<h4 style="margin: 20px 0 10px 0; color:#8b5cf6; font-size:15px;"><i class="fa-solid fa-star"></i> Lịch sử điểm thi</h4>\`;
            if (!res.exams || res.exams.length === 0) {
                html += \`<div style="font-size:13px; color:#94a3b8; font-style:italic;">Chưa có dữ liệu điểm thi.</div>\`;
            } else {
                html += res.exams.reverse().map(e => \`
                  <div style="border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
                    <strong style="color: #3b82f6;">\${e.examName}</strong>: <span style="font-weight:bold; color:#0f172a;">\${e.score}</span>
                    <div style="font-size: 12px; color: #475569; margin-top: 4px; font-style: italic;">\${e.comment || ''}</div>
                  </div>
                \`).join('');
            }
`;
html = html.replace(oldExamBlock, '');

// 2. Prepare the new deduplicated block
const newExamBlock = `
                    \${(function(){
                        if (!res.exams || res.exams.length === 0) return '';
                        const seen = new Set();
                        const unique = [];
                        [...res.exams].reverse().forEach(e => {
                            if(!seen.has(e.examName)) {
                                seen.add(e.examName);
                                unique.push(e);
                            }
                        });
                        let examHtml = \`<h4 style="margin: 20px 0 10px 0; color:#8b5cf6; font-size:15px;"><i class="fa-solid fa-star"></i> Lịch sử điểm thi</h4>\`;
                        examHtml += unique.map(e => \`
                          <div style="border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px; margin-bottom: 8px;">
                            <strong style="color: #3b82f6;">\${e.examName}</strong>: <span style="font-weight:bold; color:#0f172a;">\${e.score}</span>
                            <div style="font-size: 12px; color: #475569; margin-top: 4px; font-style: italic;">\${e.comment || ''}</div>
                          </div>
                        \`).join('');
                        return examHtml;
                    })()}
`;

// 3. Insert before warningBanner in the template literal
const templateAnchor = '                    ${warningBanner}';
html = html.replace(templateAnchor, newExamBlock + '\n' + templateAnchor);

fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
console.log('Fixed ketbu_eval.html layout');
