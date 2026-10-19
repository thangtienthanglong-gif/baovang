(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AttendanceMessage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ABSENT_STATUSES = new Set(['Vắng', 'Có phép', 'Vắng không phép', 'Vắng có phép', 'Không phép', 'Cả ngày']);
  const DEFAULT_MAKEUP_NOTICE_TEMPLATE = 'Học sinh có thể đi bù từ {makeupStartDay} ngày {makeupStartDate} đến {makeupEndDay} ngày {makeupEndDate}.';

  function makeupNotice(status, now = new Date(), template = DEFAULT_MAKEUP_NOTICE_TEMPLATE, attendance = {}) {
    if (!ABSENT_STATUSES.has(status)) return '';
    // Calendar dates follow Vietnam time even when the server runs in UTC.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = name => Number(parts.find(row => row.type === name).value);
    const sendDate = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
    const rawDate = String(attendance.attendanceDate || '');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? new Date(`${rawDate}T00:00:00Z`) : null;
    const absenceDate = parsedDate && Number.isFinite(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === rawDate
      ? parsedDate : sendDate;
    const weekday = absenceDate.getUTCDay();
    if (weekday === 0 || sendDate.getUTCDay() === 0) return '';
    const end = new Date(absenceDate);
    end.setUTCDate(end.getUTCDate() + 7 - weekday);
    const start = new Date(absenceDate);
    const session = String(attendance.session || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/^buoi\s+/, '');
    let startSession = session === 'sang' ? 'chiều' : session === 'chieu' ? 'tối' : '';
    if (session === 'toi' || session === 'ca ngay' || status === 'Cả ngày') {
      start.setUTCDate(start.getUTCDate() + 1);
      startSession = '';
    }
    // A retry cannot offer past dates or extend the absence's original week.
    if (start < sendDate) {
      start.setTime(sendDate.getTime());
      startSession = '';
    }
    if (start > end) return '';
    const display = date => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
    const values = {
      makeupStartDay: `${startSession ? `${startSession} ` : ''}${start.getUTCDay() === 0 ? 'Chủ nhật' : `thứ ${start.getUTCDay() + 1}`}`, makeupStartDate: display(start),
      makeupEndDay: 'Chủ nhật', makeupEndDate: display(end)
    };
    const text = String(template || '').trim() || DEFAULT_MAKEUP_NOTICE_TEMPLATE;
    return text.replace(/\{(makeupStartDay|makeupStartDate|makeupEndDay|makeupEndDate)\}/g, (_, key) => values[key]);
  }

  function renderTemplate(template, data, now = new Date(), makeupTemplate) {
    const notice = makeupNotice(data.absenceStatus, now, makeupTemplate, data);
    const values = { ...data, makeupNotice: notice };
    const message = template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '').trim();
    return notice && !template.includes('{makeupNotice}') ? `${message}\n${notice}` : message;
  }

  return { makeupNotice, renderTemplate, DEFAULT_MAKEUP_NOTICE_TEMPLATE };
});
