const $ = document.querySelector.bind(document);
const $$ = document.querySelectorAll.bind(document);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

$('#loginBtn').addEventListener('click', async () => {
    const studentName = $('#studentName').value.trim();
    const parentPhone = $('#parentPhone').value.trim();
    const errorMsg = $('#errorMsg');
    
    if (!studentName || !parentPhone) {
        errorMsg.textContent = 'Vui lòng nhập đầy đủ Tên học sinh và Số điện thoại.';
        errorMsg.style.display = 'block';
        return;
    }
    
    $('#loginBtn').disabled = true;
    $('#loginBtn').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang xử lý...';
    
    try {
        const res = await fetch('/api/parent/lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentName, parentPhone })
        });
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Không tìm thấy thông tin. Vui lòng kiểm tra lại Tên và SĐT.');
        }
        
        renderDashboard(data);
        
    } catch (e) {
        errorMsg.textContent = e.message;
        errorMsg.style.display = 'block';
    } finally {
        $('#loginBtn').disabled = false;
        $('#loginBtn').innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Đăng Nhập';
    }
});

function renderDashboard(data) {
    $('#loginView').style.display = 'none';
    $('#dashboardView').style.display = 'block';
    
    const s = data.student;
    $('#dStudentName').textContent = s.name;
    $('#dClassName').textContent = 'Lớp: ' + (s.className || 'Chưa xếp lớp');
    
    let warningBanner = '';
    if (data.history && data.history.length > 0) {
        const checkParts = ['H1', 'H2']; 
        const badEvals = data.history.filter(h => checkParts.includes(h.part) && ['Sai hẳn', 'Kém (K)', 'Chép bài'].includes(h.status)).slice(0, 3);
        
        if (badEvals.length >= 2) {
            let reason = 'Học sinh liên tục đạt kết quả yếu';
            let suggestion = 'Đề nghị quản lý xem xét chuyển lớp.';
            let title = `⚠️ CẢNH BÁO CHUYỂN XUỐNG LỚP (Phần ${checkParts.join(' & ')})`;
            
            const statusCount = {};
            const locCount = {};
            badEvals.forEach(h => {
                let st = h.status;
                if (h.location === 'Khảo Bài') {
                    if (st === 'Kém (K)') st = 'Không thuộc';
                }
                statusCount[st] = (statusCount[st]||0)+1;
                if (h.location) locCount[h.location] = (locCount[h.location]||0)+1;
            });
            const topStatus = Object.keys(statusCount).sort((a,b) => statusCount[b]-statusCount[a])[0];
            const topLoc = Object.keys(locCount).sort((a,b) => locCount[b]-locCount[a])[0];
            
            const locText = topLoc ? `ở [${topLoc}] ` : '';
            reason = `Học sinh liên tục bị ${topStatus} ${locText}nhiều lần`;
            
            if (topLoc === 'Khảo Bài') {
                title = `⚠️ CẢNH BÁO KHẢO BÀI (Phần ${checkParts.join(' & ')})`;
                if (statusCount['Không thuộc'] >= 3) {
                    suggestion = 'Đề nghị xem xét báo phụ huynh.';
                } else {
                    suggestion = 'Cần chú ý nhắc nhở học sinh học bài.';
                }
            }
            
            warningBanner = `<div style="background:#fef2f2; border-left:4px solid #ef4444; padding:12px; margin-bottom:15px; border-radius:4px;"><strong style="color:#b91c1c; font-size:16px;">${title}:</strong> <br><span style="font-size:15px; color:#7f1d1d; display:inline-block; margin-top:5px;">${reason}. ${suggestion}</span></div>`;
        }
    }
    
    // Avatar init
    const parts = s.name.trim().split(' ');
    const lastWord = parts[parts.length - 1];
    $('#dAvatar').textContent = lastWord.charAt(0).toUpperCase();
    
    // Render Evals (History)
    const evalTab = $('#evalTab');
    if (data.history && data.history.length > 0) {
        let html = '';
        
        // Group history by date
        const grouped = {};
        data.history.forEach(h => {
            const d = h.date || 'Không rõ ngày';
            if (!grouped[d]) grouped[d] = [];
            grouped[d].push(h);
        });
        
        // Sort dates descending
        const dates = Object.keys(grouped).sort((a,b) => {
            if(a === 'Không rõ ngày') return 1;
            if(b === 'Không rõ ngày') return -1;
            return new Date(b) - new Date(a);
        });
        
        dates.forEach(dateKey => {
            const dateStr = dateKey !== 'Không rõ ngày' ? new Date(dateKey).toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit', year:'numeric'}) : dateKey;
            
            html += `<div style="margin-top: 15px; margin-bottom: 10px; font-weight:bold; font-size: 15px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 5px;">Ngày ${dateStr}</div>`;
            
            const deduplicated = {};
            grouped[dateKey].forEach(h => {
                const key = `${h.part}|${h.location}|${h.status}|${h.lessonName}`;
                if(!deduplicated[key]) deduplicated[key] = {...h, count: 1};
                else deduplicated[key].count++;
            });
            
            html += Object.values(deduplicated).map(h => {
                let displayStatus = h.status;
                let color = '#333';
                if (['Sai hẳn', 'Kém (K)', 'Chép bài'].includes(h.status)) color = '#ef4444';
                else if (['Đúng', 'Tốt'].includes(h.status)) color = '#10b981';
                else if (h.status === 'Tự làm được') color = '#3b82f6';
                else if (h.status === 'Thầy chữa mới hiểu') color = '#f59e0b';
                else if (h.status === '1 sao') color = '#d97706';
                else if (h.status === 'Điểm') color = '#2563eb';

                let countTag = h.count > 1 ? ` (x${h.count})` : '';
                return `
                <div style="background: white; border: 1px solid #e2e8f0; padding: 10px; border-radius: 6px; margin-bottom: 8px; font-size: 14px;">
                    <strong>[${escapeHtml(h.location || 'Khác')}] ${escapeHtml(h.part)}:</strong> 
                    <span style="color: ${color}; font-weight:bold;">${escapeHtml(displayStatus)}${countTag}</span>
                    ${h.lessonName ? `<div style="color:#64748b; font-size: 12px; margin-top:3px;">Bài học: ${escapeHtml(h.lessonName)}</div>` : ''}
                    ${h.teacherName ? `<div style="color:#64748b; font-size: 12px;">GV: ${escapeHtml(h.teacherName)}</div>` : ''}
                </div>
                `;
            }).join('');
        });
        evalTab.innerHTML = warningBanner + html;
        
    } else {
        evalTab.innerHTML = warningBanner + `
            <div class="empty-state">
                <i class="fa-solid fa-clipboard-check"></i>
                <p>Chưa có lịch sử đánh giá nào</p>
            </div>
        `;
    }
    
    // Render Absences
    const absTab = $('#absenceTab');
    if (data.absences && data.absences.length > 0) {
        data.absences.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        let html = `<h4 style="margin-top:0; margin-bottom:10px; color:#ef4444; font-size:16px;"><i class="fa-solid fa-triangle-exclamation"></i> Lịch sử gần đây (Chuyên cần)</h4>`;
        
        html += data.absences.map(a => {
            const dateStr = new Date(a.date).toLocaleDateString('vi-VN');
            let statusText = '';
            if ((a.absenceStatus === 'Về sớm' || a.absenceStatus === 'Đi trễ') && a.initialReason && (a.initialReason.startsWith('Về sớm lúc') || a.initialReason.startsWith('Đi trễ lúc'))) {
                statusText = a.initialReason;
            } else {
                statusText = (a.absenceStatus || 'Không rõ') + ((a.initialReason && a.initialReason !== a.absenceStatus) ? ' (' + a.initialReason + ')' : '');
            }
            
            return `
            <div style="padding: 12px; margin-bottom: 10px; border: 1px solid #fee2e2; border-radius: 6px; background: #fef2f2;">
                <div style="color: #991b1b; font-weight:bold; margin-bottom: 5px; font-size: 15px;">${dateStr}</div>
                <div style="color: #991b1b; font-weight:bold; font-size: 15px;">Trạng thái: ${escapeHtml(statusText)}</div>
            </div>
            `;
        }).join('');
        
        absTab.innerHTML = html;
    } else {
        absTab.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-check-double"></i>
                <p>Học viên đi học đầy đủ, chưa vắng buổi nào</p>
            </div>
        `;
    }
}

// Tab logic
$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'));
        $$('.tab-content').forEach(c => c.classList.remove('active'));
        
        tab.classList.add('active');
        $('#' + tab.dataset.tab).classList.add('active');
    });
});

$('#logoutBtn').addEventListener('click', () => {
    $('#loginView').style.display = 'flex';
    $('#dashboardView').style.display = 'none';
    $('#studentName').value = '';
    $('#parentPhone').value = '';
    $('#errorMsg').style.display = 'none';
});
