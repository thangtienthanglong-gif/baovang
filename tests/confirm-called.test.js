const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const slice = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const time = '2026-10-12T17:05:00Z'; // 00:05 on October 13 in Vietnam.

function fixture() {
  return {
    absences: [{ id: 'a1', studentId: 's1', date: '2026-10-01', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi', autoNotice: true, noticeDueAt: 'old' }],
    notificationLogs: [{ id: 'failed', absenceId: 'a1', studentId: 's1', studentName: 'Nguyễn Đặng Thiên (A) Kim', studentCode: 'AUTO-1',
      className: '9T2D+', date: '2026-10-01', time: '2026-10-12T13:09:00Z', absenceStatus: 'Học phí', phone1: '0909630582',
      responsePayload: { phone: '0909630582' }, status: 'Lỗi gửi', channel: 'Zalo cá nhân', result: 'Không tìm thấy số điện thoại', message: 'Tin gốc' }],
    callLogs: []
  };
}

function backend(db = fixture()) {
  const branches = { main: db, other: { absences: [], notificationLogs: [], callLogs: [] } };
  const routes = new Map();
  let saves = 0;
  const context = {
    app: { post: (route, handler) => routes.set(route, handler) },
    getBranchDb: async req => branches[req.branch], saveBranchDb: async () => { saves++; },
    cleanText: value => String(value ?? '').trim(), normalizePhone: value => String(value).replace(/\D/g, ''),
    nowISO: () => time, id: () => 'call-new',
    normalizeAbsenceStatus: value => value
  };
  vm.createContext(context);
  vm.runInContext(slice(server, 'function filterCallLogs(', 'function sendWorkbook('), context);
  vm.runInContext(slice(server, "app.post('/api/call-logs/:id/result'", "app.get('/api/notification-logs'"), context);
  vm.runInContext(slice(server, "app.post('/api/notification-logs/:id/confirm-called'", "app.post('/api/notification-logs/:id/mark-unfriended'"), context);
  return { db, context, saves: () => saves, async confirm(logId = 'failed', branch = 'main', result = 'Đã báo', absenceStatus) {
    let data, status = 200;
    const res = { status(code) { status = code; return this; }, json(value) { data = value; } };
    await routes.get('/api/notification-logs/:id/confirm-called')(
      { branch, params: { id: logId }, user: { username: 'nhanvien-truc' }, body: { caller: 'spoofed', result, absenceStatus } }, res,
      error => { throw error; }
    );
    return { status, data };
  }, async update(result, callId = 'call-new', branch = 'main') {
    let data, status = 200;
    const res = { status(code) { status = code; return this; }, json(value) { data = value; } };
    await routes.get('/api/call-logs/:id/result')(
      { branch, params: { id: callId }, user: { username: 'nhanvien-khac' }, body: { result } }, res,
      error => { throw error; }
    );
    return { status, data };
  } };
}

test('confirming a failed send saves the actual phone, original type and authenticated caller in call history', async () => {
  const app = backend();
  const { status, data } = await app.confirm();
  assert.equal(status, 200);
  assert.equal(data.log.status, 'Đã gọi');
  assert.equal(data.log.previousStatus, 'Lỗi gửi');
  assert.equal(data.log.previousResult, 'Không tìm thấy số điện thoại');
  assert.equal(data.log.message, 'Tin gốc');
  assert.equal(data.log.time, '2026-10-12T13:09:00Z');
  assert.equal(data.log.calledAt, time);
  assert.equal(data.callLog.caller, 'nhanvien-truc');
  assert.equal(data.callLog.absenceStatus, 'Học phí');
  assert.equal(data.callLog.phoneCalled, '0909630582');
  assert.equal(data.callLog.callStatus, 'Đã gọi');
  assert.equal(data.callLog.callResult, 'Đã báo');
  assert.equal(data.callLog.date, '2026-10-13');
  assert.equal(data.callLog.absenceDate, '2026-10-01');
  assert.equal(app.db.absences[0].noticeStatus, 'Đã gọi');
  assert.equal(app.db.absences[0].callStatus, 'Đã gọi');
  assert.equal(app.db.absences[0].autoNotice, false);
  assert.equal(app.db.absences[0].noticeDueAt, '');
  assert.equal(app.saves(), 1);
  assert.equal(app.context.filterCallLogs(app.db, { date: '2026-10-13', q: 'nhanvien-truc' }).length, 1);
  assert.equal(app.context.filterCallLogs(app.db, { date: '2026-10-12' }).length, 0);
});

test('duplicate confirmation returns the existing call without changing its time or creating another history entry', async () => {
  const app = backend();
  await app.confirm();
  const before = structuredClone(app.db);
  assert.equal((await app.confirm()).status, 200);
  assert.deepEqual(structuredClone(app.db), before);
  assert.equal(app.saves(), 1);
});

test('confirmation cannot target a different branch, missing log or a non-failed send', async () => {
  const app = backend();
  const before = structuredClone(app.db);
  assert.equal((await app.confirm('missing')).status, 404);
  assert.equal((await app.confirm('failed', 'other')).status, 404);
  assert.deepEqual(app.db, before);
  for (const status of ['Đã gửi', 'Chờ gửi thủ công', 'Chạy thử']) {
    app.db.notificationLogs[0].status = status;
    const state = structuredClone(app.db);
    assert.equal((await app.confirm()).status, 409);
    assert.deepEqual(app.db, state);
  }
  assert.equal(app.saves(), 0);
});

test('the selected call outcome is saved consistently to call, notice and attendance history', async () => {
  for (const [result, status] of [['Đã báo', 'Đã gọi'], ['Không bắt máy', 'Không nghe máy'], ['Không liên lạc được', 'Không liên lạc được']]) {
    const app = backend();
    const { status: responseStatus, data } = await app.confirm('failed', 'main', result);
    assert.equal(responseStatus, 200);
    assert.equal(data.callLog.callResult, result);
    assert.equal(data.callLog.callStatus, status);
    assert.equal(data.log.status, status);
    assert.equal(app.db.absences[0].callResult, result);
    assert.equal(app.db.absences[0].noticeStatus, status);
    assert.equal(app.db.notificationLogs[0].status, status);
  }
});

test('confirming from tuition history records a tuition call even if linked attendance is an absence', async () => {
  const app = backend();
  app.db.notificationLogs[0].absenceStatus = 'Vắng không phép';
  const { status, data } = await app.confirm('failed', 'main', 'Không bắt máy', 'Học phí');
  assert.equal(status, 200);
  assert.equal(data.callLog.absenceStatus, 'Học phí');
  assert.equal(app.context.filterCallLogs(app.db, { absenceStatus: 'Học phí' }).length, 1);
  assert.equal(app.context.filterCallLogs(app.db, { excludeAbsenceStatus: 'Học phí' }).length, 0);
});

test('missing or invalid call outcomes do not change history', async () => {
  for (const result of ['', 'Đã gọi', 'Khác']) {
    const app = backend();
    const before = structuredClone(app.db);
    assert.equal((await app.confirm('failed', 'main', result)).status, 400);
    assert.deepEqual(app.db, before);
    assert.equal(app.saves(), 0);
  }
});

test('grouped failed attempts resolve together but other students, sessions and channels stay unchanged', async () => {
  const db = fixture();
  const original = db.notificationLogs[0];
  db.notificationLogs.unshift({ ...original, id: 'older', time: '2026-10-12T13:00:00Z' });
  db.notificationLogs.unshift(
    { ...original, id: 'different-student', studentId: 's2' },
    { ...original, id: 'different-session', absenceId: 'a2' },
    { ...original, id: 'different-channel', channel: 'Zalo OA' },
    { ...original, id: 'different-type', absenceStatus: 'Vắng' },
    { ...original, id: 'different-phone', phone1: '0900000000' }
  );
  const untouched = structuredClone(db.notificationLogs.slice(0, 5));
  const app = backend(db);
  await app.confirm();
  assert.deepEqual(db.notificationLogs.slice(0, 5), untouched);
  assert.equal(db.notificationLogs.at(-2).status, 'Đã gọi');
  assert.equal(db.notificationLogs.at(-1).status, 'Đã gọi');
  assert.equal((await app.confirm('older')).status, 200);
  assert.equal(db.callLogs.length, 1);
});

test('an orphaned historical error can be confirmed without recreating attendance', async () => {
  const db = fixture(); db.absences = [];
  const app = backend(db);
  assert.equal((await app.confirm()).status, 200);
  assert.equal(db.callLogs[0].studentName, 'Nguyễn Đặng Thiên (A) Kim');
  assert.deepEqual(db.absences, []);
});

test('confirming an older failure preserves a newer send and current queue state', async () => {
  const db = fixture();
  db.notificationLogs.push({ ...db.notificationLogs[0], id: 'newer', status: 'Chờ gửi thủ công' });
  const currentAbsence = structuredClone(db.absences[0]);
  const newestLog = structuredClone(db.notificationLogs[1]);
  const app = backend(db);
  await app.confirm();
  assert.deepEqual(db.absences[0], currentAbsence);
  assert.deepEqual(db.notificationLogs[1], newestLog);
  assert.equal(db.callLogs.length, 1);
});

test('a resolved phone call is excluded from subsequent bulk Zalo sends', async () => {
  const app = backend();
  await app.confirm();
  Object.assign(app.context, {
    studentByIdMap: () => ({}), filterAbsences: db => db.absences,
    isWithdrawnAbsence: () => false, defaultSettings: () => ({})
  });
  vm.runInContext(slice(server, 'function selectBulkZaloCandidates(', 'async function runBulkZaloAction('), app.context);
  const selection = app.context.selectBulkZaloCandidates(app.db, {});
  assert.equal(selection.candidates.length, 0);
  assert.equal(selection.alreadySent, 1);
});

test('changing to no answer keeps call history and synchronizes linked notice and attendance outcomes', async () => {
  const app = backend();
  await app.confirm();
  const callTime = app.db.callLogs[0].time;
  for (const [result, status] of [['Không bắt máy', 'Không nghe máy'], ['Không liên lạc được', 'Không liên lạc được'], ['Đã gọi', 'Đã gọi']]) {
    assert.equal((await app.update(result)).status, 200);
    assert.equal(app.db.callLogs.length, 1);
    assert.equal(app.db.callLogs[0].time, callTime);
    assert.equal(app.db.callLogs[0].caller, 'nhanvien-truc');
    assert.equal(app.db.callLogs[0].resultUpdatedBy, 'nhanvien-khac');
    assert.equal(app.db.callLogs[0].callStatus, status);
    assert.equal(app.db.callLogs[0].callResult, result);
    assert.equal(app.db.notificationLogs[0].status, status);
    assert.equal(app.db.absences[0].callStatus, status);
    assert.equal(app.db.absences[0].noticeStatus, status);
    assert.equal(app.context.filterCallLogs(app.db, { date: '2026-10-13' }).length, 1);
    assert.equal((await app.confirm()).status, 200);
    assert.equal(app.db.callLogs.length, 1);
    assert.equal(app.db.callLogs[0].callStatus, status);
  }
});

test('editing a call does not change other calls or newer attendance and send attempts', async () => {
  const app = backend();
  await app.confirm();
  app.db.callLogs.push({ id: 'newer-call', absenceId: 'a1', time: '2026-10-13T10:00:00Z', callStatus: 'Đã gọi' });
  app.db.notificationLogs.push({ id: 'newer-notice', absenceId: 'a1', status: 'Đã gửi' });
  const absence = structuredClone(app.db.absences[0]);
  const newestCall = structuredClone(app.db.callLogs[1]);
  const newestNotice = structuredClone(app.db.notificationLogs[1]);
  await app.update('Không bắt máy');
  assert.deepEqual(app.db.absences[0], absence);
  assert.deepEqual(app.db.callLogs[1], newestCall);
  assert.deepEqual(app.db.notificationLogs[1], newestNotice);
  assert.equal(app.db.notificationLogs[0].status, 'Không nghe máy');
});

test('invalid results, unknown IDs and wrong branches leave all history intact', async () => {
  const app = backend();
  await app.confirm();
  const before = structuredClone(app.db);
  assert.equal((await app.update('INVALID')).status, 400);
  assert.equal((await app.update('Không bắt máy', 'missing')).status, 404);
  assert.equal((await app.update('Không bắt máy', 'call-new', 'other')).status, 404);
  assert.deepEqual(structuredClone(app.db), before);
  assert.equal(app.saves(), 1);
});

test('legacy no-answer outcomes show the correct status without rewriting or removing stored history', () => {
  const app = backend();
  app.db.callLogs = [
    { id: 'old-1', callStatus: 'Lỗi gọi', callResult: 'Không bắt máy' },
    { id: 'old-2', callStatus: 'Lỗi gọi', callResult: 'Không liên lạc được' }
  ];
  const before = structuredClone(app.db);
  const rows = app.context.filterCallLogs(app.db, {});
  assert.deepEqual(Array.from(rows, row => row.callStatus), ['Không nghe máy', 'Không liên lạc được']);
  assert.deepEqual(app.db, before);
  assert.equal(app.saves(), 0);
});

function ui() {
  const events = {}, fields = {}, requests = [], refreshes = [];
  for (const id of ['noticeRows', 'historyRows', 'callHistoryRows', 'noticePagination', 'callHistoryPagination', 'callHistoryTypeTabs', 'historyKeyword']) {
    fields[id] = { value: '', innerHTML: '', addEventListener: (type, handler) => { events[`${id}:${type}`] = handler; } };
  }
  fields.callHistoryTypeTabs.querySelectorAll = () => [];
  const app = {
    $: selector => fields[selector.slice(1)], escapeHtml: value => String(value ?? '').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    formatDateTime: value => value, absenceStatusLabel: value => value, toast() {},
    getActiveBranch: () => 'main', selectedHistoryDate: () => '2026-10-13', queryString: () => '',
    api: async (url, options) => { requests.push({ url, options }); return []; }
  };
  vm.createContext(app);
  vm.runInContext(slice(frontend, 'function statusClass(', 'function options('), app);
  vm.runInContext(slice(frontend, 'async function loadHistory(', 'async function updateCallResult('), app);
  vm.runInContext(slice(frontend, 'function groupFailedNoticeRows(', 'async function markUnfriended('), app);
  for (const name of ['loadNotices', 'loadTuitionHistory', 'loadCallHistory', 'loadAbsences']) app[name] = async () => { refreshes.push(name); };
  vm.runInContext(slice(frontend, '  const handleNoticeActions = async event => {', "  $('#filterClass').addEventListener"), app);
  return { app, fields, events, requests, refreshes };
}

test('Zalo and tuition failed rows both offer call confirmation and resolved rows show the green called badge', () => {
  const { app } = ui();
  for (const absenceStatus of ['Học phí', 'Vắng']) {
    const row = { ...fixture().notificationLogs[0], absenceStatus };
    assert.match(app.renderNoticeHistoryRow(row), /confirm-called-btn/);
    const resolved = app.renderNoticeHistoryRow({ ...row, status: 'Đã gọi' });
    assert.match(resolved, /class="badge called"[^>]*>Đã gọi/);
    assert.doesNotMatch(resolved, /confirm-called-btn|retry-zalo-btn|confirm-zalo-sent-btn/);
  }
  assert.match(app.renderNoticeActions({ id: 'orphan', status: 'Lỗi gửi' }), /confirm-called-btn/);
});

test('both history tables reveal call outcomes and save the selected result', async () => {
  const { events, requests, refreshes } = ui();
  for (const table of ['noticeRows', 'historyRows']) {
    const previousRequests = requests.length;
    const button = { dataset: { logid: 'failed' }, disabled: false };
    const select = { dataset: { logid: 'failed', absenceStatus: 'Học phí' }, disabled: false, hidden: true, value: '', focus() {} };
    button.parentElement = { querySelector: selector => selector === '.confirm-called-result' ? select : null };
    const event = { target: { closest: selector => selector === '.confirm-called-btn' ? button : null } };
    await events[`${table}:click`](event);
    assert.equal(requests.length, previousRequests);
    assert.equal(select.hidden, false);
    select.value = 'Không bắt máy';
    await events[`${table}:change`]({ target: { closest: selector => selector === '.confirm-called-result' ? select : null } });
    assert.equal(requests.at(-1).url, '/api/notification-logs/failed/confirm-called');
    assert.equal(requests.at(-1).options.method, 'POST');
    assert.deepEqual(JSON.parse(requests.at(-1).options.body), { result: 'Không bắt máy', absenceStatus: 'Học phí' });
  }
  assert.deepEqual(refreshes, Array(2).fill(['loadNotices', 'loadTuitionHistory', 'loadCallHistory', 'loadAbsences']).flat());
});

test('a failed call-result save keeps the selector open for retry', async () => {
  const { app, events, refreshes } = ui();
  app.api = async () => { throw new Error('Không lưu được'); };
  const button = { dataset: { logid: 'failed' }, disabled: false };
  const select = { dataset: { logid: 'failed' }, disabled: false, hidden: false, value: 'Đã báo' };
  select.parentElement = { querySelector: selector => selector === '.confirm-called-btn' ? button : null };
  await events['noticeRows:change']({ target: { closest: selector => selector === '.confirm-called-result' ? select : null } });
  assert.equal(button.disabled, false);
  assert.equal(select.disabled, false);
  assert.equal(select.hidden, false);
  assert.deepEqual(refreshes, []);
});

test('call history keeps compact identity and passive result badge without AUTO codes', async () => {
  const { app, fields } = ui();
  app.api = async () => [{ id: 'call-1', studentName: 'Kim', studentCode: 'AUTO-HIDDEN', className: '9T2D+', phoneCalled: '0909630582',
    absenceStatus: 'Học phí', callStatus: 'Đã gọi', caller: 'nhanvien-truc', callResult: 'Đã gọi', note: 'Đã liên hệ phụ huynh' }];
  vm.runInContext(slice(frontend, 'async function loadCallHistory(', 'function tuitionHistoryParams('), app);
  await app.loadCallHistory();
  const html = fields.callHistoryRows.innerHTML;
  assert.equal((html.match(/<td(?:\s[^>]*)?>/g) || []).length, 3);
  assert.match(html, /mini-chip.*9T2D\+/);
  assert.match(html, /student-phone.*0909630582/);
  assert.match(html, /class="badge called">Đã gọi/);
  assert.match(html, /Học phí/);
  assert.doesNotMatch(html, /nhanvien-truc|Đã liên hệ phụ huynh|Chi tiết cuộc gọi|Ngày vắng|<details/);
  assert.doesNotMatch(html, /call-history-edit|call-history-result|data-call-logid/);
  assert.doesNotMatch(html, /AUTO-HIDDEN/);
});

test('call history shows a saved no-answer result as a passive badge', async () => {
  const { app, fields, refreshes } = ui();
  const rows = Array.from({ length: 32 }, (_, i) => ({
    id: `call-${i + 1}`, studentName: `HS-${i + 1}`, callResult: 'Đã gọi', callStatus: 'Đã gọi'
  }));
  rows[31].callStatus = 'Không nghe máy';
  app.api = async (url, options) => {
    if (!options) return rows;
    const row = rows.find(row => url.includes(`/${row.id}/`));
    row.callResult = JSON.parse(options.body).result;
    row.callStatus = 'Không nghe máy';
    return row;
  };
  vm.runInContext(slice(frontend, 'async function loadCallHistory(', 'function tuitionHistoryParams('), app);
  vm.runInContext(slice(frontend, 'async function updateCallResult(', 'async function loadQuitStudents('), app);
  await app.loadCallHistory();
  app.handleHistoryPageClick({ target: { closest: () => ({ dataset: { page: '3' }, closest: () => ({ id: 'callHistoryPagination' }) }) } });
  assert.match(fields.callHistoryPagination.innerHTML, /Hiển thị 31–32 \/ tổng 32/);
  assert.match(fields.callHistoryRows.innerHTML, /HS-32/);
  assert.match(fields.callHistoryRows.innerHTML, /class="badge no-answer">Không nghe máy/);
  assert.doesNotMatch(fields.callHistoryRows.innerHTML, /call-history-edit|call-history-result|data-call-logid/);
  assert.deepEqual(refreshes, []);
});

test('a failed result update keeps the history page and restores the prior selection', async () => {
  const { app, fields } = ui();
  app.api = async () => [{ id: 'call-1', callResult: 'Đã gọi', callStatus: 'Đã gọi' }];
  vm.runInContext(slice(frontend, 'async function loadCallHistory(', 'function tuitionHistoryParams('), app);
  vm.runInContext(slice(frontend, 'async function updateCallResult(', 'async function loadQuitStudents('), app);
  app.console = { error() {} };
  await app.loadCallHistory();
  const before = fields.callHistoryRows.innerHTML;
  app.api = async () => { throw new Error('Network error'); };
  const select = { value: 'Không bắt máy', disabled: false };
  await app.updateCallResult('call-1', select.value, select);
  assert.equal(select.value, 'Đã gọi');
  assert.equal(select.disabled, false);
  assert.equal(select.hidden, false);
  assert.equal(fields.callHistoryRows.innerHTML, before);
});

test('linked call outcomes stay in contact history even when attendance has a call-only status', async () => {
  const { app, fields } = ui();
  app.api = async () => [
    { id: 'linked', status: 'Không nghe máy', callLogId: 'call-1', absenceCallStatus: 'Không nghe máy', studentName: 'Kim' },
    { id: 'unfriended', status: 'Chưa kết bạn - Cần gọi', studentName: 'Other' }
  ];
  vm.runInContext(slice(frontend, 'async function loadNotices(', 'async function markUnfriended('), app);
  await app.loadNotices();
  assert.match(fields.noticeRows.innerHTML, /Kim/);
  assert.match(fields.noticeRows.innerHTML, /Không nghe máy/);
  assert.doesNotMatch(fields.noticeRows.innerHTML, /Other/);
});

test('switching call history type requests the correct scope and starts at page one', async () => {
  const { app, fields, events, requests } = ui();
  app.queryString = params => new URLSearchParams(params).toString();
  app.api = async url => {
    requests.push({ url });
    const tuition = new URL(url, 'http://localhost').searchParams.get('absenceStatus') === 'Học phí';
    return Array.from({ length: tuition ? 17 : 32 }, (_, i) => ({ id: `call-${i}`, studentName: `${tuition ? 'Tuition' : 'Absence'}-${i}`, callStatus: 'Đã gọi' }));
  };
  vm.runInContext(slice(frontend, 'async function loadCallHistory(', 'function tuitionHistoryParams('), app);
  await app.loadCallHistory();
  assert.equal(new URL(requests.at(-1).url, 'http://localhost').searchParams.get('excludeAbsenceStatus'), 'Học phí');
  app.handleHistoryPageClick({ target: { closest: () => ({ dataset: { page: '3' }, closest: () => ({ id: 'callHistoryPagination' }) }) } });
  const click = type => events['callHistoryTypeTabs:click']({ target: { closest: () => ({ dataset: { callType: type } }) } });
  await click('tuition');
  assert.equal(new URL(requests.at(-1).url, 'http://localhost').searchParams.get('absenceStatus'), 'Học phí');
  assert.match(fields.callHistoryPagination.innerHTML, /Hiển thị 1–15 \/ tổng 17/);
  assert.match(fields.callHistoryRows.innerHTML, /Tuition-0/);
  assert.doesNotMatch(fields.callHistoryRows.innerHTML, /Absence-/);
  await click('absence');
  assert.match(fields.callHistoryPagination.innerHTML, /Hiển thị 1–15 \/ tổng 32/);
  assert.match(fields.callHistoryRows.innerHTML, /Absence-0/);
});
