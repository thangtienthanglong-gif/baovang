const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const frontend = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const reminders = fs.readFileSync(path.join(__dirname, '../public/tuition-reminders.js'), 'utf8');

function setup() {
  let clock = Date.parse('2026-10-14T08:00:00Z'), branch = 'main';
  let api = async () => ({ reminders: {}, identities: {}, serverTime: new Date(clock).toISOString() });
  let initialize, poll, renders = 0;
  const messages = [], fields = {}, displayed = [];
  for (const id of ['absenceRows', 'tuitionReminderDialog', 'tuitionReminderClose', 'tuitionReminderStudent']) {
    fields[id] = { innerHTML: '', textContent: '', open: false, addEventListener() {},
      showModal() { this.open = true; }, close() { this.open = false; } };
  }
  const reminder = { eventId: 'notice:sent', lastContactAt: '2026-10-13T08:00:00Z',
    expiresAt: '2026-10-20T08:00:00Z', className: '9VT3', channel: 'Zalo cá nhân' };
  const row = { id: 'tuition', studentId: 'toan', studentName: 'Nguyễn An', className: '9T4',
    phone1: '0901234567', absenceStatus: 'Học phí', noticeStatus: 'Chưa gửi' };
  const context = {
    URLSearchParams,
    state: { tuitionReminders: { toan: reminder }, tuitionRemindersLoaded: true,
      students: [{ id: 'toan', fullName: 'Nguyễn An', className: '9T4', phone1: row.phone1 }], absences: [row], scheduleExceptions: [] },
    Date: class extends Date { static now() { return clock; } constructor(...args) { super(...(args.length ? args : [clock])); } },
    $: selector => fields[selector.slice(1)] || null,
    document: { hidden: false, addEventListener(type, handler) { if (type === 'DOMContentLoaded') initialize = handler; },
      querySelectorAll: selector => selector.includes('tuition-expires-at') ? displayed : [] },
    api: (...args) => api(...args), getActiveBranch: () => branch,
    activeTabId: () => 'absenceTab', setInterval: callback => { poll = callback; },
    toast: (...args) => messages.push(args), renderRoster: () => { renders++; },
    setHistoryRows: (...args) => { context.historyArgs = args; }, handleHistoryPageClick() {},
    normalizeAbsenceStatus: value => value, absenceStatusLabel: value => value,
    absenceForStudent: () => null, selectedDate: () => '2026-10-14', selectedDay: () => 'ALL',
    scheduleExceptionMatchesStudent: () => false
  };
  vm.createContext(context);
  function load(start, end) {
    const from = frontend.indexOf(start);
    vm.runInContext(frontend.slice(from, frontend.indexOf(end, from)), context);
  }
  load('function escapeHtml(', 'function getToken(');
  load('function statusClass(', 'function options(');
  load('function renderRosterStudent(', 'function noticeTimeLine(');
  load('function noticeTimeLine(', 'function getWeekRange(');
  vm.runInContext(reminders, context);
  initialize();
  return { context, reminder, row, fields, messages, displayed, poll: () => poll(), renders: () => renders,
    clock: value => { clock = Date.parse(value); }, branch: value => { branch = value; }, api: handler => { api = handler; } };
}

test('the shared badge displays original contact details in another class and opens its consolidated history', async () => {
  const app = setup();
  const html = app.context.renderRosterStudent(app.context.state.students[0]);
  assert.match(html, /Đã nhắc học phí/);
  assert.match(html, /9VT3/);
  assert.match(html, /className|9T4/);
  app.api(async url => { assert.equal(url, '/api/tuition-reminders/toan/history'); return [{ time: app.reminder.lastContactAt, className: '9VT3', channel: 'Zalo', status: 'Đã gửi' }]; });
  await app.context.openTuitionReminderHistory({ dataset: { tuitionStudentId: 'toan' } });
  assert.equal(app.fields.tuitionReminderDialog.open, true);
  assert.equal(app.context.historyArgs[2].length, 1);
});

test('recent tuition starts unchecked; explicit staff choices survive refresh and reset for a new success', () => {
  const app = setup(), { context, row } = app;
  context.renderAbsences();
  const input = app.fields.absenceRows.innerHTML.match(/<input[^>]+>/)[0];
  assert.doesNotMatch(input, /\schecked\b/);
  assert.equal(context.tuitionQueueChecked({ ...row, absenceStatus: 'Vắng' }), true);
  context.rememberTuitionQueueChoice({ dataset: { id: row.id }, checked: true });
  assert.equal(context.tuitionQueueChecked(row), true);
  context.state.tuitionReminders.toan = { ...app.reminder, eventId: 'notice:repeat' };
  assert.equal(context.tuitionQueueChecked(row), false);
});

test('expiry hides the badge on an open roster and re-enables default queue selection', async () => {
  const app = setup();
  app.displayed.push({ dataset: { tuitionExpiresAt: app.reminder.expiresAt } });
  app.clock(app.reminder.expiresAt);
  await app.poll();
  assert.equal(app.renders(), 1);
  assert.equal(app.context.renderTuitionReminderBadge('toan'), '');
  assert.equal(app.context.tuitionQueueChecked(app.row), true);
});

test('failed metadata reads default tuition unchecked and manual selection still works', async () => {
  const app = setup();
  app.context.state.tuitionReminders = {};
  app.api(async () => { throw new Error('offline'); });
  await app.context.loadTuitionReminders();
  assert.equal(app.context.tuitionQueueChecked(app.row), false);
  assert.equal(app.messages.length, 1);
  app.context.rememberTuitionQueueChoice({ dataset: { id: app.row.id }, checked: true });
  assert.equal(app.context.tuitionQueueChecked(app.row), true);
});

test('late metadata from a previous branch cannot overwrite the selected branch', async () => {
  const app = setup();
  let finish;
  app.api(() => new Promise(resolve => { finish = resolve; }));
  const request = app.context.loadTuitionReminders();
  app.branch('other');
  finish({ reminders: {}, identities: {}, serverTime: '2026-10-14T08:00:00Z' });
  await request;
  assert.equal(app.context.state.tuitionReminders.toan.eventId, 'notice:sent');
});

test('server time controls expiry even when the device clock is wrong', async () => {
  const app = setup();
  app.clock('2030-01-01T00:00:00Z');
  app.api(async () => ({ reminders: { toan: app.reminder }, identities: {}, serverTime: '2026-10-14T08:00:00Z' }));
  await app.context.loadTuitionReminders();
  assert.ok(app.context.recentTuitionReminder('toan'));
});

test('student and contact text is escaped in the badge and history rows', async () => {
  const app = setup();
  app.reminder.className = '<img onerror=alert(1)>';
  assert.doesNotMatch(app.context.renderTuitionReminderBadge('toan'), /<img/);
  app.api(async () => [{ time: app.reminder.lastContactAt, className: '<script>', channel: '<script>', status: 'Đã gửi', caller: '<script>' }]);
  await app.context.openTuitionReminderHistory({ dataset: { tuitionStudentId: 'toan' } });
  const html = app.context.historyArgs[3](app.context.historyArgs[2][0]);
  assert.doesNotMatch(html, /<script>/);
});
