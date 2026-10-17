const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { buildAttendanceAlerts } = require('../lib/attendance-alerts');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const alertsSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'attendance-alerts.js'), 'utf8');

function fixture() {
  return buildAttendanceAlerts({
    students: [{ id: 's1', className: '8T3M+', fullName: 'Nguyễn An <script>', phone1: '0901234567' }],
    absences: [
      { id: 'a1', studentId: 's1', date: '2026-10-10', session: 'Tối', absenceStatus: 'Vắng' },
      { id: 'a2', studentId: 's1', date: '2026-10-12', session: 'Tối', absenceStatus: 'Vắng' }
    ]
  }, { endDate: '2026-10-14' });
}

function setup(initial = fixture()) {
  const fields = {};
  const requests = [];
  const messages = [];
  let apiHandler = async () => initial;
  let branch = 'main';
  let init;
  let renders = 0;
  for (const id of [...alertsSource.matchAll(/\$\('#([a-zA-Z]+)'\)/g)].map(match => match[1])) {
    fields[id] = {
      value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, listeners: {}, dataset: {},
      addEventListener(type, handler) { this.listeners[type] = handler; }, reset() {},
      showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }
    };
  }
  const context = {
    renderTuitionReminderBadge: () => '', tuitionQueueChecked: () => true,
    state: { students: [{ id: 's1', fullName: 'Nguyễn An', className: '8T3M+' }], scheduleExceptions: [] },
    document: { addEventListener: (type, handler) => { init = handler; } },
    $: selector => fields[selector.slice(1)], clientTodayISO: () => '2026-10-14',
    getActiveBranch: () => branch, activeTabId: () => 'absenceTab', setInterval() {},
    queryString: params => new URLSearchParams(params).toString(),
    escapeHtml: value => String(value ?? '').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatDateTime: value => value, renderRoster: () => { renders++; },
    absenceForStudent: () => null, normalizeAbsenceStatus: value => value, absenceStatusLabel: value => value,
    selectedDate: () => '2026-10-14', selectedDay: () => 'ALL',
    scheduleExceptionMatchesStudent: () => false, scheduleExceptionAppliesToDate: () => false,
    toast: (message, type) => messages.push({ message, type }),
    api: async (url, options) => { requests.push({ url, options }); return apiHandler(url, options); }
  };
  vm.createContext(context);
  for (const [begin, end] of [['function getClassSubjectKey(', 'function normalizeComparableText('],
    ['function renderRosterStudent(', 'function noticeTimeLine(']]) {
    const offset = frontend.indexOf(begin);
    vm.runInContext(frontend.slice(offset, frontend.indexOf(end, offset)), context);
  }
  vm.runInContext(alertsSource, context);
  init();
  const badge = () => ({ disabled: false, dataset: { attendanceAlertId: initial.alerts[0].id } });
  return { fields, context, requests, messages, badge,
    handler: fn => { apiHandler = fn; }, branch: value => { branch = value; }, renders: () => renders };
}

test('the roster warning sits between student details and the attendance selector, with no separate menu', async () => {
  const app = setup();
  await app.context.refreshRosterAttendanceAlerts();
  const html = app.context.renderRosterStudent(app.context.state.students[0]);
  assert.match(html, /warning is-pending/);
  assert.match(html, /Cần xử lý · 2 buổi/);
  assert.ok(html.indexOf('student-main') < html.indexOf('student-attendance-alert'));
  assert.ok(html.indexOf('student-attendance-alert') < html.indexOf('student-status-control'));
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(page, /attendanceAlertsTab|attendanceAlertFilters|attendanceAlertRows/);
});

test('history export opens filters before downloading and prevents duplicate submissions', async () => {
  const app = setup();
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const historyStart = page.indexOf('<section id="historyTab"');
  const buttonPosition = page.indexOf('id="exportRepeatedAbsencesBtn"');
  assert.ok(buttonPosition > historyStart);
  assert.equal(page.match(/id="exportRepeatedAbsencesBtn"/g).length, 1);
  const downloads = [];
  let finish;
  app.context.downloadUrl = (url, params) => {
    downloads.push({ url, params });
    return new Promise(resolve => { finish = resolve; });
  };
  await app.fields.exportRepeatedAbsencesBtn.listeners.click();
  assert.equal(downloads.length, 0);
  assert.equal(app.fields.attendanceExportDialog.open, true);
  assert.equal(app.fields.attendanceExportMinSessions.value, '2');
  const button = app.fields.attendanceExportSubmit;
  const event = { preventDefault() {} };
  const pending = app.fields.attendanceExportForm.listeners.submit(event);
  assert.equal(button.disabled, true);
  await app.fields.attendanceExportForm.listeners.submit(event);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].url, '/api/attendance-alerts/export');
  assert.deepEqual(JSON.parse(JSON.stringify(downloads[0].params)), {
    period: 'month', endDate: '2026-10-14', className: 'ALL', subject: 'ALL', minSessions: 2
  });
  finish();
  await pending;
  assert.equal(button.disabled, false);
});

test('export class options follow the subject and the chosen class, subject and threshold reach the download', async () => {
  const app = setup();
  app.handler(async url => url === '/api/bootstrap'
    ? { classes: ['8T3M+', '8AT2', '9KCCB', 'CUSTOM', '8VT2'] } : fixture());
  await app.fields.exportRepeatedAbsencesBtn.listeners.click();
  app.fields.attendanceExportSubject.value = 'A';
  app.fields.attendanceExportClass.value = '8T3M+';
  app.fields.attendanceExportSubject.listeners.change();
  assert.match(app.fields.attendanceExportClass.innerHTML, /8AT2/);
  assert.doesNotMatch(app.fields.attendanceExportClass.innerHTML, /8T3M\+|8VT2|9KCCB|CUSTOM/);
  assert.equal(app.fields.attendanceExportClass.value, 'ALL');
  app.fields.attendanceExportClass.value = '8AT2';
  app.fields.attendanceExportMinSessions.value = '4';
  let params;
  app.context.downloadUrl = async (_url, filters) => { params = filters; };
  await app.fields.attendanceExportForm.listeners.submit({ preventDefault() {} });
  assert.equal(params.subject, 'A');
  assert.equal(params.className, '8AT2');
  assert.equal(params.minSessions, 4);
  app.fields.attendanceExportSubject.value = 'OTHER';
  app.fields.attendanceExportSubject.listeners.change();
  assert.match(app.fields.attendanceExportClass.innerHTML, /CUSTOM/);
  assert.doesNotMatch(app.fields.attendanceExportClass.innerHTML, /8AT2|8T3M\+/);
});

test('invalid thresholds and branch changes cannot submit an export for a stale branch', async () => {
  const app = setup();
  let downloads = 0;
  app.context.downloadUrl = async () => { downloads++; };
  await app.fields.exportRepeatedAbsencesBtn.listeners.click();
  for (const value of ['1', '2.5', '', 'invalid']) {
    app.fields.attendanceExportMinSessions.value = value;
    await app.fields.attendanceExportForm.listeners.submit({ preventDefault() {} });
  }
  assert.equal(downloads, 0);
  app.fields.attendanceExportMinSessions.value = '3';
  app.branch('other');
  await app.fields.attendanceExportForm.listeners.submit({ preventDefault() {} });
  assert.equal(downloads, 0);
  assert.equal(app.fields.attendanceExportDialog.open, false);
  assert.match(app.messages.at(-1).message, /Cơ sở đã thay đổi/);
});

test('changing branches while export options load prevents stale filters from opening', async () => {
  const app = setup();
  let finish;
  app.handler(url => url === '/api/bootstrap' ? { classes: ['8AT2'] } : new Promise(resolve => { finish = resolve; }));
  const opening = app.fields.exportRepeatedAbsencesBtn.listeners.click();
  app.branch('other');
  finish(fixture());
  await opening;
  assert.notEqual(app.fields.attendanceExportDialog.open, true);
  assert.equal(app.fields.exportRepeatedAbsencesBtn.disabled, false);
});

test('the badge shows only its class subject, and handled warnings stop blinking', async () => {
  const app = setup();
  await app.context.refreshRosterAttendanceAlerts();
  const row = app.context.state.students[0];
  row.attendanceAlerts.push({ id: 'other', subjectKey: 'V', count: 3, level: 'danger', handled: false });
  assert.doesNotMatch(app.context.renderRosterStudent(row), /danger is-pending/);
  row.attendanceAlerts[0].handled = true;
  const html = app.context.renderRosterStudent(row);
  assert.match(html, /attendance-alert-badge handled/);
  assert.match(html, /Đã xử lý · 2 buổi/);
  assert.doesNotMatch(html, /is-pending/);
  row.attendanceAlerts = [];
  row.recentAbsenceCount = 5;
  assert.doesNotMatch(app.context.renderRosterStudent(row), /attendance-alert-badge|⚠️/);
});

test('clicking a badge opens exact absence dates; closing makes no mutation', async () => {
  const app = setup();
  await app.context.openRosterAttendanceAlert(app.badge());
  assert.equal(app.fields.attendanceAlertDialog.open, true);
  assert.match(app.fields.attendanceAlertDates.innerHTML, /12\/10\/2026/);
  assert.match(app.fields.attendanceAlertDates.innerHTML, /10\/10\/2026/);
  assert.equal(app.fields.attendanceAlertSave.hidden, false);
  assert.doesNotMatch(app.fields.attendanceAlertDialogStudent.textContent, /&lt;/);
  app.fields.attendanceAlertCancel.listeners.click();
  assert.equal(app.requests.filter(row => row.options?.method === 'POST').length, 0);
});

test('a successful handled save captures the shown period, closes the popup and refreshes the badge', async () => {
  const app = setup();
  const result = fixture();
  app.handler(async (url, options) => {
    if (options?.method === 'POST') { result.alerts[0].handled = true; return { success: true }; }
    return result;
  });
  await app.context.openRosterAttendanceAlert(app.badge());
  app.fields.attendanceAlertNote.value = 'Đã trao đổi';
  await app.context.saveAttendanceAlertAction({ preventDefault() {} });
  assert.equal(app.fields.attendanceAlertDialog.open, false);
  assert.equal(app.context.state.students[0].attendanceAlerts[0].handled, true);
  const request = app.requests.find(row => row.options?.method === 'POST');
  const body = JSON.parse(request.options.body);
  assert.equal(body.endDate, '2026-10-14');
  assert.equal(body.period, '30days');
  assert.equal(body.note, 'Đã trao đổi');
  assert.equal(body.revision, result.alerts[0].revision);
});

test('save failures keep the popup and note for retry instead of changing the warning', async () => {
  const app = setup();
  await app.context.openRosterAttendanceAlert(app.badge());
  app.fields.attendanceAlertNote.value = 'Ghi chú';
  app.handler(async () => { throw new Error('Save failed'); });
  await app.context.saveAttendanceAlertAction({ preventDefault() {} });
  assert.equal(app.fields.attendanceAlertDialog.open, true);
  assert.equal(app.fields.attendanceAlertNote.value, 'Ghi chú');
  assert.equal(app.fields.attendanceAlertSave.disabled, false);
  assert.equal(app.fields.attendanceAlertActionError.textContent, 'Save failed');
  assert.equal(app.context.state.students[0].attendanceAlerts[0].handled, false);
});

test('branch changes cancel an open action and stale requests cannot change roster warnings', async () => {
  const app = setup();
  await app.context.openRosterAttendanceAlert(app.badge());
  app.branch('other');
  await app.context.saveAttendanceAlertAction({ preventDefault() {} });
  assert.equal(app.requests.filter(row => row.options?.method === 'POST').length, 0);
  app.branch('main');
  let resolve;
  app.handler(async () => new Promise(done => { resolve = done; }));
  const pending = app.context.refreshRosterAttendanceAlerts();
  app.handler(async () => ({ ...fixture(), alerts: [] }));
  await app.context.refreshRosterAttendanceAlerts();
  resolve(fixture()); await pending;
  assert.equal(app.context.state.students[0].attendanceAlerts.length, 0);
});

test('unchanged polling results do not redraw status selectors, and corrected absences clear warnings', async () => {
  const app = setup();
  await app.context.refreshRosterAttendanceAlerts();
  await app.context.refreshRosterAttendanceAlerts();
  assert.equal(app.renders(), 1);
  app.handler(async () => ({ ...fixture(), alerts: [] }));
  await app.context.refreshRosterAttendanceAlerts();
  assert.equal(app.renders(), 2);
  assert.equal(app.context.state.students[0].attendanceAlerts.length, 0);
});
