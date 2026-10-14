const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function setup() {
  const context = { cleanText: value => String(value ?? '').trim(), ABSENCE_STATUSES: ['Vắng', 'Có phép', 'Học phí'] };
  Object.assign(context, require('../lib/history-date-range'));
  vm.createContext(context);
  for (const [start, end] of [
    ['function normalizeAbsenceStatus(', 'function normalizeInitialReason('],
    ['function notificationLogDate(', 'function sendWorkbook(']
  ]) {
    const offset = source.indexOf(start);
    vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
  }
  return context;
}

test('recorded types take precedence over an edited attendance record or message', () => {
  const app = setup();
  assert.equal(app.notificationLogAbsenceStatus({ absenceStatus: 'Học phí', message: 'Học sinh: Vắng không phép - Tối ngày 12/10/2026.' }, { absenceStatus: 'Có phép' }), 'Học phí');
});

test('legacy messages recover explicit attendance types when the linked record is absent', () => {
  const app = setup();
  for (const [label, expected] of [['Vắng không phép', 'Vắng'], ['Vắng có phép', 'Có phép'], ['Đi trễ', 'Đi trễ'], ['Về sớm', 'Về sớm'], ['Học phí', 'Học phí']]) {
    const message = `Kính gửi Quý phụ huynh.\nHọc sinh: ${label} - Tối ngày 12/10/2026.\nTrân trọng!`;
    assert.equal(app.notificationLogAbsenceStatus({ message }), expected);
  }
  assert.equal(app.notificationLogAbsenceStatus({ responsePayload: { message: 'Học sinh: Vắng có phép' } }), 'Có phép');
  assert.equal(app.notificationLogAbsenceStatus({ message: 'HỌC SINH: VẮNG KHÔNG PHÉP - Tối ngày 12/10/2026.' }), 'Vắng');
  assert.equal(app.notificationLogAbsenceStatus({ message: 'Học sinh: Vắng có phép'.normalize('NFD') }), 'Có phép');
});

test('explicit original messages remain accurate after the linked attendance changes', () => {
  const app = setup();
  assert.equal(app.notificationLogAbsenceStatus({ message: 'Học sinh: Vắng không phép - Tối ngày 12/10/2026.' }, { absenceStatus: 'Học phí' }), 'Vắng');
});

test('recognizable legacy tuition messages stay out of Zalo history and remain filterable without changing stored data', () => {
  const app = setup();
  const db = { absences: [], notificationLogs: [
    { id: 'tuition', date: '2026-10-12', time: '2026-10-12T13:11:00Z', message: 'Trường thông báo học phí/tiền nợ của em Kim, lớp 9T2D+ hiện tại là: 500.000 VNĐ.' },
    { id: 'absence', date: '2026-10-12', time: '2026-10-12T13:09:00Z', message: 'Học sinh: Vắng có phép - Tối ngày 12/10/2026.' }
  ] };
  const before = structuredClone(db);
  assert.deepEqual(Array.from(app.filterNotificationLogs(db, { absenceStatus: 'Học phí', dateBasis: 'time', date: '2026-10-12' }), row => row.id), ['tuition']);
  assert.deepEqual(Array.from(app.filterNotificationLogs(db, { excludeAbsenceStatus: 'Học phí' }), row => row.id), ['absence']);
  assert.deepEqual(db, before);
});

test('ambiguous text and unrecognized messages keep an unknown type, while linked records remain usable', () => {
  const app = setup();
  for (const message of ['', 'Nhắc học phí và ngày nghỉ của học sinh.', 'Học sinh: Vắng Mai', 'Nội dung: Học sinh: Vắng không phép', 'Phụ huynh cho phép học sinh nghỉ.', 'Học sinh: Học phí bổ sung chưa xác minh']) {
    assert.equal(app.notificationLogAbsenceStatus({ message }), 'Khác');
  }
  assert.equal(app.notificationLogAbsenceStatus({ message: 'Nội dung tùy chỉnh' }, { absenceStatus: 'Trễ học phí' }), 'Trễ học phí');
});

test('unknown notification types do not obscure the actual send status or its actions', () => {
  const app = { escapeHtml: value => String(value ?? ''), formatDateTime: value => value, absenceStatusLabel: value => value, statusClass: () => 'waiting' };
  vm.createContext(app);
  const start = frontend.indexOf('function renderNoticeActions(');
  vm.runInContext(frontend.slice(start, frontend.indexOf('let noticePage =', start)), app);
  const html = app.renderNoticeHistoryRow({ absenceStatus: 'Khác', studentName: 'Kim', status: 'Chờ gửi thủ công', absenceId: 'a1', id: 'log1', channel: 'Zalo cá nhân', message: 'Nội dung tùy chỉnh' });
  assert.doesNotMatch(html, /Chưa rõ loại|Khác|notice-history-reason/);
  assert.match(html, /Chờ gửi thủ công/);
  assert.match(html, /copy-log-msg-btn/);
  assert.match(html, /confirm-zalo-sent-btn/);
  const failed = app.renderNoticeHistoryRow({ absenceStatus: 'Khác', studentName: 'Kim', status: 'Lỗi gửi', absenceId: 'a1', id: 'log2', channel: 'Zalo cá nhân' });
  assert.match(failed, /Lỗi gửi/);
  assert.match(failed, /retry-zalo-btn/);
  assert.doesNotMatch(failed, /Chưa rõ loại|Khác|notice-history-reason/);
});
