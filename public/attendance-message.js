(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AttendanceMessage = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ABSENT_STATUSES = new Set(['Vắng', 'Có phép', 'Vắng không phép', 'Vắng có phép', 'Không phép', 'Cả ngày']);

  function makeupNotice(status, now = new Date()) {
    if (!ABSENT_STATUSES.has(status)) return '';
    // Send date follows Vietnam time even when the server runs in UTC.
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(now);
    const part = name => Number(parts.find(row => row.type === name).value);
    const start = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
    const weekday = start.getUTCDay();
    if (weekday === 0) return '';
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7 - weekday);
    const display = date => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
    return `Học sinh có thể đi bù từ thứ ${weekday + 1} ngày ${display(start)} đến Chủ nhật ngày ${display(end)}.`;
  }

  function renderTemplate(template, data, now = new Date()) {
    const notice = makeupNotice(data.absenceStatus, now);
    const values = { ...data, makeupNotice: notice };
    const message = template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '').trim();
    return notice && !template.includes('{makeupNotice}') ? `${message}\n${notice}` : message;
  }

  return { makeupNotice, renderTemplate };
});
