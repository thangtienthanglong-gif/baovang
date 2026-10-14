const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
function element() {
  const listeners = new Map();
  return { open: false, textContent: '', value: '',
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = { preventDefault() {} }) { for (const fn of [...listeners.get(type) || []]) fn(event); },
    showModal() { this.open = true; }, close() { const open = this.open; this.open = false; if (open) this.emit('close'); }, focus() {} };
}
function setup(type = 'Kiểm tra định kì') {
  const fields = Object.fromEntries(['studentNotificationDialog', 'studentNotificationForm', 'studentNotificationCancel', 'studentNotificationTitle', 'studentNotificationStudent', 'studentNotificationMessage'].map(id => [id, element()]));
  const requests = [], sends = [], refreshes = [];
  let branch = 'main';
  const student = { id: 's1', fullName: 'Trương Bảo (C) Ngọc', className: '8T3M+', status: 'Đang học' };
  const attendance = { id: 'a1', absenceStatus: 'Vắng' };
  const context = {
    $: selector => fields[selector.slice(1)], state: { students: [student], settings: { zaloMode: 'personal-real' } },
    normalizeAbsenceStatus: value => value, absenceForStudent: () => attendance,
    getActiveBranch: () => branch, selectedDate: () => '2026-10-14', selectedDay: () => 'Wed',
    getClassScheduleInfo: () => ({ sessionName: 'Tối' }), queryString: params => new URLSearchParams(params).toString(),
    api: async (url, options) => {
      requests.push({ url, options });
      if (!options) return { type, message: 'Kiểm tra ngày 20/10', studentName: student.fullName, className: student.className };
      const send = JSON.parse(options.body).sendNow;
      return { request: { id: 'notice-1', noticeStatus: 'Chưa gửi' }, noticeLog: send
        ? { id: 'log-1', status: 'Chờ gửi thủ công', studentName: student.fullName, className: student.className, message: 'Kiểm tra ngày 20/10', responsePayload: { phone: '0977686959' } } : null };
    },
    sendSingleViaZaloExtension: async item => sends.push(item), toast() {},
    loadBootstrap: async () => refreshes.push('bootstrap'), loadGeneralNotificationHistory: async () => refreshes.push('history')
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function requestStudentNotificationPreview(', 'function requestWithdrawalReason('],
    ['async function updateRosterStatus(', 'function bulkZaloMessage(']
  ]) { const from = source.indexOf(start); vm.runInContext(source.slice(from, source.indexOf(end, from)), context); }
  const select = { value: type, dataset: { studentId: 's1', attendanceClass: student.className, absenceId: attendance.id } };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { fields, requests, sends, refreshes, context, select, student, attendance, flush, setBranch: value => { branch = value; } };
}

for (const type of ['Đăng ký mới']) {
  for (const action of ['queue', 'send']) {
    test(`${type}: selecting ${action} reviews the student and message without changing the existing absence`, async () => {
      const app = setup(type), original = structuredClone(app.attendance);
      const pending = app.context.updateRosterStatus(app.select);
      await app.flush();
      assert.equal(app.select.value, 'Vắng');
      assert.equal(app.fields.studentNotificationDialog.open, true);
      assert.match(app.fields.studentNotificationStudent.textContent, /Trương Bảo \(C\) Ngọc/);
      const event = { preventDefault() {}, submitter: { value: action } };
      app.fields.studentNotificationForm.emit('submit', event);
      app.fields.studentNotificationForm.emit('submit', event);
      await pending;
      assert.equal(app.requests.length, 2);
      assert.match(app.requests[1].url, /^\/api\/students\/s1\/notifications$/);
      const body = JSON.parse(app.requests[1].options.body);
      assert.equal(body.type, type);
      assert.equal(body.sendNow, action === 'send');
      assert.equal(body.message, 'Kiểm tra ngày 20/10');
      assert.deepEqual(app.attendance, original);
      assert.equal(app.sends.length, action === 'send' ? 1 : 0);
      if (action === 'send') { assert.equal(app.sends[0].absenceId, 'notice-1'); assert.equal(app.sends[0].id, 'log-1'); }
      assert.deepEqual(app.refreshes, ['bootstrap', 'history']);
    });
  }
}

test('selecting periodic exam automatically queues its saved content without a dialog or immediate Zalo send', async () => {
  const app = setup('Kiểm tra định kì');
  const original = structuredClone(app.attendance);
  app.context.requestStudentNotificationPreview = () => assert.fail('Exam notices must not open a dialog');
  await app.context.updateRosterStatus(app.select);
  assert.equal(app.fields.studentNotificationDialog.open, false);
  assert.equal(app.requests.length, 2);
  assert.match(app.requests[1].url, /^\/api\/students\/s1\/notifications$/);
  const body = JSON.parse(app.requests[1].options.body);
  assert.equal(body.type, 'Kiểm tra định kì');
  assert.equal(body.sendNow, false);
  assert.equal(body.message, 'Kiểm tra ngày 20/10');
  assert.equal(body.date, '2026-10-14');
  assert.equal(body.session, 'Tối');
  assert.equal(app.sends.length, 0);
  assert.equal(app.select.value, 'Vắng');
  assert.deepEqual(app.attendance, original);
  assert.deepEqual(app.refreshes, ['bootstrap', 'history']);
});

test('a failed template load or a changed branch cannot create an automatic exam notification', async () => {
  for (const variant of ['template-error', 'branch-change']) {
    const app = setup('Kiểm tra định kì');
    const originalApi = app.context.api;
    app.context.api = async (...args) => {
      const result = await originalApi(...args);
      if (variant === 'template-error') throw new Error('Không tải được mẫu thông báo');
      app.setBranch('other');
      return result;
    };
    await assert.rejects(app.context.updateRosterStatus(app.select), variant === 'template-error' ? /mẫu thông báo/ : /Chi nhánh/);
    assert.equal(app.requests.length, 1);
    assert.equal(app.sends.length, 0);
    assert.equal(app.fields.studentNotificationDialog.open, false);
    assert.equal(app.select.value, 'Vắng');
    assert.equal(app.attendance.absenceStatus, 'Vắng');
    assert.deepEqual(app.refreshes, []);
  }
});

test('cancelling preview or changing branches while reviewing creates no notification and sends nothing', async () => {
  for (const action of ['cancel', 'escape', 'branch']) {
    const app = setup('Đăng ký mới');
    const pending = app.context.updateRosterStatus(app.select);
    await app.flush();
    if (action === 'cancel') app.fields.studentNotificationCancel.emit('click');
    if (action === 'escape') app.fields.studentNotificationDialog.close();
    if (action === 'branch') {
      app.setBranch('other');
      app.fields.studentNotificationForm.emit('submit', { preventDefault() {}, submitter: { value: 'send' } });
      await assert.rejects(pending, /Chi nhánh/);
    } else await pending;
    assert.equal(app.requests.length, 1);
    assert.equal(app.sends.length, 0);
    assert.equal(app.fields.studentNotificationDialog.open, false);
  }
});

test('notification-only queue rows never replace the roster attendance value', () => {
  const context = { state: { absences: [
    { studentId: 's1', date: '2026-10-14', className: '8T3M+', notificationOnly: true },
    { studentId: 's1', date: '2026-10-14', className: '8T3M+', absenceStatus: 'Vắng' }
  ] }, selectedDate: () => '2026-10-14' };
  const start = source.indexOf('function absenceForStudent(');
  vm.runInNewContext(source.slice(start, source.indexOf('function selectedSession(', start)), context);
  assert.equal(context.absenceForStudent('s1', '8T3M+').absenceStatus, 'Vắng');
});
