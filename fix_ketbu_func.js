const fs = require('fs');
let html = fs.readFileSync('public/ketbu_eval.html', 'utf8');

const markFunc = `
    async function markAsNotified(studentId) {
        if (!confirm('Đánh dấu là đã báo phụ huynh? Hành động này sẽ tạo một mốc lịch sử và xóa cảnh báo hiện tại.')) return;
        try {
            const evUrl = window.studentEvidenceUrls ? window.studentEvidenceUrls[studentId] : '';
            await apiRequest('/api/evaluations', 'POST', {
                sessionId: currentSession ? currentSession.id : null,
                studentId,
                location: 'Hệ thống',
                status: 'Đã báo phụ huynh',
                part: 'Thông báo',
                evidenceUrl: evUrl || ''
            });
            showToast('Đã lưu mốc lịch sử thành công!');
            // Reload the history panel
            setTimeout(() => openHistoryPanel(studentId), 500);
        } catch(e) {
            console.error(e);
            showToast('Lỗi: ' + e.message);
        }
    }
`;

if (!html.includes('function markAsNotified')) {
    html = html.replace('function closeHistoryPanel', markFunc + '\n    function closeHistoryPanel');
    fs.writeFileSync('public/ketbu_eval.html', html, 'utf8');
    console.log('Added markAsNotified to ketbu_eval.html');
}
