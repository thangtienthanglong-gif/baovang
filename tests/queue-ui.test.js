const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function setup() {
  const els = {
    absenceRows: { innerHTML: '' },
    queueNavBadge: { textContent: '', hidden: true },
    queueCountLine: { textContent: '' },
    bulkSendZaloBtn: { textContent: 'Gửi Zalo hàng loạt', dataset: {} }
  };
  let boxes = [];
  const context = {
    URLSearchParams,
    state: { absences: [] },
    $: selector => els[selector.slice(1)] || null,
    document: {
      querySelectorAll: selector => {
        if (selector === '#absenceRows .bulk-select') return boxes;
        if (selector === '#absenceRows .bulk-select:checked') return boxes.filter(b => b.checked);
        return [];
      },
      addEventListener() {}
    }
  };
  vm.createContext(context);
  const load = (start, end) => {
    const offset = source.indexOf(start);
    assert.ok(offset >= 0, 'missing ' + start);
    const stop = source.indexOf(end, offset);
    assert.ok(stop > offset, 'missing ' + end);
    vm.runInContext(source.slice(offset, stop), context);
  };
  load('function escapeHtml(', 'function getToken(');
  load('function statusClass(', 'function options(');
  load('function noticeTimeLine(', 'function getWeekRange(');
  return {
    context, els,
    setAbsences: rows => { context.state.absences = rows; },
    setBoxes: list => { boxes = list; }
  };
}

const ROWS = [
  {
    id: 'a1', studentId: 's1', studentName: 'Phạm Tuyết Ngân',
    phone1: '0906905915', phone2: '', className: '8S1', session: 'Tối',
    absenceStatus: 'Vắng không phép', noticeStatus: 'Lỗi gửi',
    initialReason: '', date: '2026-10-12'
  },
  {
    id: 'a2', studentId: 's2', studentName: 'Nguyễn Văn An',
    phone1: '', phone2: '0912 345 678', className: '6S2', session: 'Sáng',
    absenceStatus: 'Vắng có phép', noticeStatus: 'Chưa gửi',
    initialReason: 'Vắng chưa rõ lý do', date: '2026-10-12',
    noticeSentAt: '2026-10-12T21:27:00+07:00'
  }
];

test('Lỗi gửi maps to the red error badge class', () => {
  const app = setup();
  assert.equal(app.context.statusClass('Lỗi gửi'), 'error');
  assert.equal(app.context.statusClass('Chưa gửi'), 'pending');
});

test('queue rows render selection checkbox, class after the name and phone below without a session chip', () => {
  const app = setup();
  app.setAbsences(ROWS);
  app.context.renderAbsences();
  const html = app.els.absenceRows.innerHTML;
  assert.ok(html.includes('class="bulk-select"'), 'missing bulk checkbox');
  assert.ok(html.includes('data-id="a1"'), 'checkbox missing data-id');
  assert.ok(html.includes('href="tel:0906905915"'), 'phone should be a tel: link');
  assert.ok(html.includes('href="tel:0912345678"'), 'phone spaces should be stripped in tel: link');
  assert.ok(html.includes('mini-chip') && html.includes('8S1'), 'missing class chip');
  assert.ok(html.indexOf('Phạm Tuyết Ngân</div>') < html.indexOf('>8S1</span>'), 'class follows the name');
  assert.match(html, />8S1<\/span>\s*<\/div>\s*<div class="student-phone">/);
  assert.equal(html.includes('Buổi Tối'), false, 'session chip should be removed');
  assert.ok(html.includes('Vắng chưa rõ lý do'), 'different initial reason should be shown');
});

test('Lỗi gửi badge is a red retry button, manual send button does not wrap', () => {
  const app = setup();
  app.setAbsences(ROWS);
  app.context.renderAbsences();
  const html = app.els.absenceRows.innerHTML;
  assert.ok(html.includes('class="badge error retry-zalo-btn"'), 'Lỗi gửi should be a clickable red badge');
  assert.ok(html.includes('title="Bấm để gửi lại Zalo ngay"'), 'retry badge needs a hint');
  assert.ok(html.includes('retry-zalo-btn nowrap'), 'Gửi thủ công must not wrap');
  assert.ok(html.includes('Gửi thủ công'), 'manual send button missing');
  assert.ok(html.includes('notice-time subtle'), 'processing time should be subtle');
});

test('queue badge and result count update with the list', () => {
  const app = setup();
  app.setAbsences(ROWS);
  app.context.renderAbsences();
  assert.equal(app.els.queueNavBadge.textContent, '2');
  assert.equal(app.els.queueNavBadge.hidden, false);
  assert.equal(app.els.queueCountLine.textContent, 'Tìm thấy 2 học sinh');
});

test('an emptied queue clears the previous badge, result count and bulk selection count', () => {
  const app = setup();
  app.setAbsences(ROWS);
  app.setBoxes([{ checked: true }, { checked: true }]);
  app.context.renderAbsences();
  assert.equal(app.els.queueNavBadge.hidden, false);
  assert.equal(app.els.bulkSendZaloBtn.textContent, 'Gửi Zalo hàng loạt (2)');
  app.setAbsences([]);
  app.setBoxes([]);
  app.context.renderAbsences();
  assert.ok(app.els.absenceRows.innerHTML.includes('Hàng xử lý trống'));
  assert.equal(app.els.queueNavBadge.textContent, '0');
  assert.equal(app.els.queueNavBadge.hidden, true);
  assert.equal(app.els.queueCountLine.textContent, '');
  assert.equal(app.els.bulkSendZaloBtn.textContent, 'Gửi Zalo hàng loạt');
});
test('bulk send button label reflects the checked count', () => {
  const app = setup();
  app.setBoxes([{ checked: true }, { checked: false }, { checked: true }]);
  app.context.updateBulkSendCount();
  assert.equal(app.els.bulkSendZaloBtn.textContent, 'Gửi Zalo hàng loạt (2)');
  app.setBoxes([]);
  app.context.updateBulkSendCount();
  assert.equal(app.els.bulkSendZaloBtn.textContent, 'Gửi Zalo hàng loạt');
});
