const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public/app.js'), 'utf8');
function slice(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0 && source.indexOf(end, from) > from);
  return source.slice(from, source.indexOf(end, from));
}

function setup() {
  const requests = [];
  let branch = 'main', date = '2026-10-21';
  const context = {
    state: { students: [{ id: 's1', className: '8A' }], absences: [], summary: {} },
    syncAutomaticDate: () => false, normalizeAbsenceStatus: value => value,
    getActiveBranch: () => branch,
    getAttendanceFilters: () => ({ date, className: '8A' }),
    selectedDate: () => date, selectedDay: () => 'ALL', queryString: params => new URLSearchParams(params).toString(),
    getClassScheduleInfo: () => ({ sessionName: 'Tối' }),
    api: async (url, options) => {
      requests.push({ url, options });
      return options ? { absence: { id: 'saved', date, className: '8A', studentId: 's1', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi', callStatus: 'Chưa gọi' } }
        : { absences: [{ id: 'saved', studentId: 's1', absenceStatus: 'Vắng' }], summary: { total: 1 } };
    },
    loadBootstrap: async () => { throw Error('Full bootstrap must not run after ordinary attendance'); },
    toast() {}, queuedMessage: () => '', renderSummary() {}, renderAbsences() {}, renderClassDropdown() {}, renderRoster() {}, renderFilters() {}
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'async function loadAttendanceAbsences()', 'async function loadStudents('), context);
  vm.runInContext(slice(frontend, 'async function updateRosterStatus(', 'function bulkZaloMessage('), context);
  return { context, requests, setBranch: value => { branch = value; }, setDate: value => { date = value; } };
}

for (const absenceId of ['', 'a1']) {
  test(`ordinary attendance updates the queue from its saved response without a second API (${absenceId || 'new'})`, async () => {
    const app = setup();
    await app.context.updateRosterStatus({ value: 'Vắng', dataset: { studentId: 's1', attendanceClass: '8A', absenceId } });
    assert.equal(app.requests.length, 1);
    assert.equal(app.requests[0].options.method, absenceId ? 'PUT' : 'POST');
    assert.equal(app.context.state.absences[0].id, 'saved');
    assert.equal(app.context.state.summary.total, 1);
    assert.equal(app.context.state.summary.noticeWaiting, 1);
  });
}

test('returning to studying updates the queue without another read', async () => {
  const app = setup();
  await app.context.updateRosterStatus({ value: 'Đang học', dataset: { studentId: 's1', attendanceClass: '8A', absenceId: 'a1' } });
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.method, 'DELETE');
});

for (const change of ['branch', 'date']) {
  test(`a delayed attendance refresh cannot overwrite a newly selected ${change}`, async () => {
    const app = setup();
    let finish;
    app.context.api = () => new Promise(resolve => { finish = resolve; });
    const pending = app.context.loadAttendanceAbsences();
    if (change === 'branch') app.setBranch('other');
    else app.setDate('2026-10-22');
    finish({ absences: [{ id: 'stale' }], summary: { total: 99 } });
    await pending;
    assert.equal(app.context.state.absences.length, 0);
    assert.equal(app.context.state.summary.total, undefined);
  });
}

test('Zalo OA send timeouts remain unconfirmed and have a bounded wait', async () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const db = { students: [{ id: 's1', zaloUserId: 'parent' }], settings: {},
    absences: [{ id: 'a1', studentId: 's1', absenceStatus: 'Vắng' }], notificationLogs: [] };
  let timeout;
  const context = {
    getZaloRuntimeConfig: () => ({ mode: 'oa', enabled: true, accessToken: 'test', endpoint: 'mock' }),
    buildMessage: () => 'Message', nowISO: () => '2026-10-21T00:00:00Z', id: () => 'log',
    normalizeAbsenceStatus: value => value, isWithdrawnAbsence: () => false,
    AbortSignal: { timeout: ms => { timeout = ms; return 'timeout-signal'; } },
    fetch: async (_url, options) => {
      assert.equal(options.signal, 'timeout-signal');
      throw Object.assign(new Error('Timeout'), { name: 'TimeoutError' });
    }
  };
  vm.createContext(context);
  vm.runInContext(slice(server, 'async function sendZaloNotice(', 'let noticeSchedulerRunning'), context);
  const result = await context.sendZaloNotice(db, 'a1');
  assert.equal(timeout, 15000);
  assert.equal(result.status, 'Lỗi gửi');
  assert.match(result.result, /kiểm tra Zalo trước khi gửi lại/);
  assert.equal(db.absences[0].noticeSentAt, '');
});
