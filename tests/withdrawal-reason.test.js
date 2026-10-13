const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function element() {
  const listeners = new Map();
  return {
    value: '', textContent: '', open: false, error: '', focused: false,
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    emit(type, event = { preventDefault() {} }) { for (const fn of [...listeners.get(type) || []]) fn(event); },
    showModal() { this.open = true; },
    close() { const wasOpen = this.open; this.open = false; if (wasOpen) this.emit('close'); },
    setCustomValidity(message) { this.error = message; }, reportValidity() {}, focus() { this.focused = true; },
    listenerCount() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); }
  };
}

function setup(absenceId = '') {
  const fields = Object.fromEntries(['withdrawalReasonDialog', 'withdrawalReasonForm', 'withdrawalReasonInput', 'withdrawalReasonCancel', 'withdrawalReasonStudent'].map(id => [id, element()]));
  const student = { id: 's1', fullName: 'Thái Song Quang', className: '8T3M+', status: 'Đang học' };
  const requests = [], refreshes = [];
  let branch = 'main', date = '2026-10-13';
  const context = {
    $: selector => fields[selector.slice(1)], state: { students: [student] },
    normalizeAbsenceStatus: value => value, getActiveBranch: () => branch,
    absenceForStudent: () => absenceId ? { id: absenceId, absenceStatus: 'Vắng' } : null,
    selectedDate: () => date, selectedDay: () => 'Tue',
    getClassScheduleInfo: () => ({ sessionName: 'Tối' }),
    api: async (url, options) => { requests.push({ url, options }); return {}; },
    toast() {}, loadBootstrap: async () => refreshes.push('roster'), loadQuitStudents: async () => refreshes.push('history')
  };
  vm.createContext(context);
  const start = source.indexOf('function requestWithdrawalReason(');
  vm.runInContext(source.slice(start, source.indexOf('function bulkZaloMessage(', start)), context);
  const select = { value: 'Nghỉ học', dataset: { studentId: 's1', attendanceClass: student.className, absenceId } };
  return { context, fields, requests, refreshes, student, select,
    setDate(value) { date = value; }, setBranch(value) { branch = value; } };
}

for (const absenceId of ['', 'existing']) {
  test(`saving a roster withdrawal waits for a reason then refreshes history (${absenceId || 'new'})`, async () => {
    const app = setup(absenceId);
    const pending = app.context.updateRosterStatus(app.select);
    assert.equal(app.fields.withdrawalReasonDialog.open, true);
    assert.equal(app.requests.length, 0);
    assert.match(app.fields.withdrawalReasonStudent.textContent, /Thái Song Quang/);
    app.fields.withdrawalReasonInput.value = '  Thay đổi lịch học.  ';
    app.fields.withdrawalReasonForm.emit('submit');
    app.fields.withdrawalReasonForm.emit('submit'); // Double clicks cannot save twice.
    await pending;
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].url, absenceId ? '/api/absences/existing/status' : '/api/absences');
    const body = JSON.parse(app.requests[0].options.body);
    assert.equal(body.note, 'Thay đổi lịch học.');
    assert.equal(body.absenceStatus, 'Nghỉ học');
    assert.equal(body.sendZalo, false);
    assert.deepEqual(app.refreshes, ['roster', 'history']);
    assert.equal(app.fields.withdrawalReasonDialog.open, false);
    for (const field of Object.values(app.fields)) assert.equal(field.listenerCount(), 0);
  });
}

for (const dismiss of ['button', 'escape']) {
  test(`cancelling the reason dialog preserves enrollment and makes no request (${dismiss})`, async () => {
    const app = setup('existing');
    const pending = app.context.updateRosterStatus(app.select);
    if (dismiss === 'button') app.fields.withdrawalReasonCancel.emit('click');
    else app.fields.withdrawalReasonDialog.close();
    await pending;
    assert.equal(app.select.value, 'Vắng');
    assert.equal(app.student.status, 'Đang học');
    assert.equal(app.requests.length, 0);
    assert.deepEqual(app.refreshes, []);
  });
}

test('a whitespace-only reason cannot save and editing clears its validation error', async () => {
  const app = setup();
  const pending = app.context.updateRosterStatus(app.select);
  app.fields.withdrawalReasonInput.value = ' \n ';
  app.fields.withdrawalReasonForm.emit('submit');
  assert.equal(app.fields.withdrawalReasonDialog.open, true);
  assert.match(app.fields.withdrawalReasonInput.error, /nhập lý do/);
  assert.equal(app.requests.length, 0);
  app.fields.withdrawalReasonInput.value = 'Chuyển trường';
  app.fields.withdrawalReasonInput.emit('input');
  assert.equal(app.fields.withdrawalReasonInput.error, '');
  app.fields.withdrawalReasonForm.emit('submit');
  await pending;
  assert.equal(app.requests.length, 1);
});

test('a changed branch cancels saving to prevent withdrawing a student from another branch', async () => {
  const app = setup();
  const pending = app.context.updateRosterStatus(app.select);
  app.setBranch('other');
  app.fields.withdrawalReasonInput.value = 'Chuyển trường';
  app.fields.withdrawalReasonForm.emit('submit');
  await assert.rejects(pending, /Chi nhánh đã thay đổi/);
  assert.equal(app.requests.length, 0);
});

test('the selected day is retained if the date changes while entering the withdrawal reason', async () => {
  const app = setup();
  const pending = app.context.updateRosterStatus(app.select);
  app.setDate('2026-10-14');
  app.fields.withdrawalReasonInput.value = 'Chuyển trường';
  app.fields.withdrawalReasonForm.emit('submit');
  await pending;
  assert.equal(JSON.parse(app.requests[0].options.body).date, '2026-10-13');
});

test('a save failure does not show a successful withdrawal or refresh history', async () => {
  const app = setup();
  app.context.api = async () => { throw new Error('Không lưu được'); };
  const pending = app.context.updateRosterStatus(app.select);
  app.fields.withdrawalReasonInput.value = 'Chuyển trường';
  app.fields.withdrawalReasonForm.emit('submit');
  await assert.rejects(pending, /Không lưu được/);
  assert.equal(app.student.status, 'Đang học');
  assert.equal(app.select.value, 'Đang học');
  assert.deepEqual(app.refreshes, []);
});
