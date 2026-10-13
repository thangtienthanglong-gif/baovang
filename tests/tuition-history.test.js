const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function slice(source, start, end) {
  const offset = source.indexOf(start);
  const finish = source.indexOf(end, offset);
  assert.ok(offset >= 0 && finish > offset);
  return source.slice(offset, finish);
}

function fixture() {
  return {
    students: [{ id: 's1', fullName: 'Hồ Hoàng Long', className: '9VT2' }],
    absences: [
      { id: 'a1', studentId: 's1', date: '2026-10-01', absenceStatus: 'Học phí' },
      { id: 'a2', absenceStatus: 'Trễ học phí' }, { id: 'a3', absenceStatus: 'Học phí' },
      { id: 'attendance', absenceStatus: 'Vắng' }
    ],
    notificationLogs: [
      { id: 'long', absenceId: 'a1', date: '2026-10-01', time: '2026-10-12T13:16:00Z', studentName: 'Hồ Hoàng Long', status: 'Đã gửi', channel: 'Zalo cá nhân' },
      { id: 'ngoc', absenceId: 'a2', date: '2026-10-01', time: '2026-10-12T13:14:00Z', studentName: 'Trương Bảo (C) Ngọc', status: 'Đã gửi', channel: 'Zalo OA' },
      { id: 'cuong', absenceId: 'a3', date: '2026-10-01', time: '2026-10-12T13:13:00Z', studentName: 'Kraikitrat Giáp Cường', status: 'Đã gửi' },
      { id: 'absence', absenceId: 'attendance', date: '2026-10-12', time: '2026-10-12T13:17:00Z', status: 'Đã gửi' },
      { id: 'yesterday', absenceId: 'a1', date: '2026-10-12', time: '2026-10-11T16:59:59Z', status: 'Đã gửi' },
      { id: 'midnight', absenceId: 'a1', date: '2026-10-11', time: '2026-10-11T17:00:00Z', status: 'Lỗi gửi', studentName: 'Học sinh gửi lỗi' },
      { id: 'tomorrow', absenceId: 'a1', date: '2026-10-12', time: '2026-10-12T17:00:00Z', status: 'Đã gửi' }
    ],
    callLogs: [{ id: 'call1', date: '2026-10-12', time: '2026-10-12T13:00:00Z', studentName: 'Học sinh cần gọi', callStatus: 'Đã gọi' }]
  };
}

function setupServer(db = fixture()) {
  const routes = new Map();
  const branches = { main: db, other: { absences: [], notificationLogs: [] } };
  const context = {
    ABSENCE_STATUSES: ['Vắng', 'Học phí', 'Trễ học phí'],
    cleanText: value => String(value ?? '').trim(),
    app: Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    getBranchDb: async req => branches[req.headers['x-branch-id']],
    saveBranchDb: async (req, branchDb) => { branches[req.headers['x-branch-id']] = branchDb; },
    normalizePhone: value => value, nowISO: () => '2026-10-12T13:16:00Z',
    id: () => 'new-log', defaultSettings: () => ({}), buildMessage: () => 'Thông tin học phí',
    studentByIdMap: () => ({}), enrichAbsence: absence => absence,
    getZaloRuntimeConfig: () => ({ mode: 'personal-test' }), isWithdrawnAbsence: () => false
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function normalizeAbsenceStatus(', 'function normalizeInitialReason('],
    ['function filterCallLogs(', 'function sendWorkbook('],
    ['async function sendZaloNotice(', 'let noticeSchedulerRunning'],
    ["app.post('/api/absences/:id/zalo/manual-sent'", "app.post('/api/absences/:id/zalo'"],
    ["app.get('/api/notification-logs'", '// ==================== AUTHENTICATION & USERS']
  ]) vm.runInContext(slice(server, start, end), context);
  async function call(method, route, { query = {}, body = {}, branch = 'main', id = 'a1' } = {}) {
    let data;
    await routes.get(`${method} ${route}`)(
      { headers: { 'x-branch-id': branch }, query, body, params: { id } },
      { json(value) { data = value; } }, error => { throw error; }
    );
    return data;
  }
  return { context, call, db, branches };
}

const tuitionQuery = { date: '2026-10-12', absenceStatus: 'Học phí', dateBasis: 'time' };

test('tuition history includes the three reported sends by send day and excludes other days and attendance notices', async () => {
  const app = setupServer();
  const before = structuredClone(app.db);
  const rows = await app.call('get', '/api/notification-logs', { query: tuitionQuery });
  assert.deepEqual(Array.from(rows, row => row.id), ['long', 'ngoc', 'cuong', 'midnight']);
  assert.deepEqual(app.db, before);
  assert.equal((await app.call('get', '/api/notification-logs', { query: tuitionQuery, branch: 'other' })).length, 0);
  const search = await app.call('get', '/api/notification-logs', { query: { ...tuitionQuery, q: 'hồ hoàng' } });
  assert.deepEqual(Array.from(search, row => row.id), ['long']);
});

test('tuition date filtering follows Vietnam midnight, supports all dates and uses a legacy date when time is missing', () => {
  const app = setupServer();
  assert.equal(app.context.notificationLogDate({ time: '2026-10-11T16:59:59Z' }), '2026-10-11');
  assert.equal(app.context.notificationLogDate({ time: '2026-10-11T17:00:00Z' }), '2026-10-12');
  assert.equal(app.context.notificationLogDate({ time: '2026-10-13T00:00:00+07:00' }), '2026-10-13');
  for (const time of ['', 'invalid']) {
    assert.equal(app.context.notificationLogDate({ date: '2026-10-12', time }), '2026-10-12');
  }
  const rows = app.context.filterNotificationLogs(app.db, { ...tuitionQuery, date: '' });
  assert.equal(rows.length, 6);
  const attendanceDay = app.context.filterNotificationLogs(app.db, { date: '2026-10-01' });
  assert.deepEqual(Array.from(attendanceDay, row => row.id), ['long', 'ngoc', 'cuong']);
});

test('recorded message types survive an edited or removed attendance record', () => {
  const app = setupServer();
  app.db.notificationLogs.push(
    { id: 'removed', absenceId: 'deleted', absenceStatus: 'Học phí', date: '2026-10-01', time: '2026-10-12T13:20:00Z' },
    { id: 'changed', absenceId: 'attendance', absenceStatus: 'Trễ học phí', time: '2026-10-12T13:21:00Z' }
  );
  const rows = app.context.filterNotificationLogs(app.db, tuitionQuery);
  assert.ok(rows.some(row => row.id === 'removed'));
  assert.ok(rows.some(row => row.id === 'changed'));
});

test('new sends and manual success or failure capture the tuition message type', async () => {
  for (const route of ['', '/api/absences/:id/zalo/manual-sent', '/api/absences/:id/zalo/manual-error']) {
    const app = setupServer();
    const log = route
      ? (await app.call('post', route)).log
      : await app.context.sendZaloNotice(app.db, 'a1');
    assert.equal(log.absenceStatus, 'Học phí');
    app.db.absences = [];
    assert.ok(app.context.filterNotificationLogs(app.db, tuitionQuery).some(row => row.id === log.id));
  }
});

test('confirming an old send retains its original type even after attendance was changed', async () => {
  for (const route of ['/api/absences/:id/zalo/manual-sent', '/api/absences/:id/zalo/manual-error']) {
    const app = setupServer();
    app.db.absences[0].absenceStatus = 'Vắng';
    app.db.notificationLogs.push({ id: 'pending-old', absenceId: 'a1', channel: 'Zalo cá nhân', status: 'Chờ gửi thủ công', message: 'Trường thông báo học phí/tiền nợ của em Kim, lớp 9T2D+ hiện tại là: 500.000 VNĐ.' });
    const { log } = await app.call('post', route, { body: { logId: 'pending-old' } });
    assert.equal(log.absenceStatus, 'Học phí');
  }
});

test('clearing tuition history deletes only matching tuition sends in the selected branch and day', async () => {
  const app = setupServer();
  const otherBefore = structuredClone(app.branches.other);
  const callsBefore = structuredClone(app.db.callLogs);
  const result = await app.call('delete', '/api/notification-logs', { query: tuitionQuery });
  assert.equal(result.deleted, 4);
  assert.deepEqual(app.db.notificationLogs.map(row => row.id), ['absence', 'yesterday', 'tomorrow']);
  assert.deepEqual(app.db.callLogs, callsBefore);
  assert.deepEqual(app.branches.other, otherBefore);
});

function setupFrontend() {
  const backend = setupServer();
  const table = () => ({ innerHTML: '', addEventListener(type, listener) { this[type] = listener; } });
  const fields = { historyKeyword: { value: '' }, historyRows: table(), callHistoryRows: table(), noticeRows: table(), noticePagination: table() };
  const requests = [];
  const copied = [];
  let branch = 'main';
  let confirmed = true;
  const context = {
    $: selector => fields[selector.slice(1)], selectedHistoryDate: () => '2026-10-12',
    getActiveBranch: () => branch, queryString: params => new URLSearchParams(params).toString(),
    escapeHtml: value => String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatDateTime: value => value, statusClass: () => 'sent', absenceStatusLabel: value => value,
    confirm: () => confirmed, toast() {}, loadAbsences() {}, state: {},
    navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
    api: async (url, options = {}) => {
      requests.push({ url, options });
      const request = new URL(url, 'https://example.test');
      const query = Object.fromEntries(request.searchParams);
      if (request.pathname === '/api/call-logs') return backend.context.filterCallLogs(backend.db, query);
      const manualSent = request.pathname.match(/^\/api\/absences\/([^/]+)\/zalo\/manual-sent$/);
      if (manualSent) return backend.call('post', '/api/absences/:id/zalo/manual-sent', {
        id: manualSent[1], body: JSON.parse(options.body)
      });
      return backend.call(options.method === 'DELETE' ? 'delete' : 'get', '/api/notification-logs', { query });
    }
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'function formatDateTime(', 'function formatDelay('), context);
  vm.runInContext(slice(frontend, 'async function loadHistory(', 'async function updateCallResult('), context);
  vm.runInContext(slice(frontend, 'function groupFailedNoticeRows(', 'async function markUnfriended('), context);
  vm.runInContext(slice(frontend, 'async function clearCallHistory(', 'async function clearNoticeHistory('), context);
  vm.runInContext(slice(frontend, 'async function clearNoticeHistory(', 'function normalizeChatText('), context);
  vm.runInContext(slice(frontend, '  const handleNoticeActions = async event => {', "  $('#filterClass').addEventListener"), context);
  return { context, fields, requests, backend, copied,
    changeBranch: () => { branch = 'other'; }, cancelDelete: () => { confirmed = false; } };
}

test('the tuition panel renders existing sent and failed notifications while call records stay in their own panel', async () => {
  const app = setupFrontend();
  await app.context.loadHistory();
  for (const name of ['Hồ Hoàng Long', 'Trương Bảo (C) Ngọc', 'Kraikitrat Giáp Cường', 'Học sinh gửi lỗi']) {
    assert.ok(app.fields.historyRows.innerHTML.includes(name));
  }
  assert.match(app.fields.historyRows.innerHTML, /Đã gửi/);
  assert.match(app.fields.historyRows.innerHTML, /Lỗi gửi/);
  assert.match(app.fields.historyRows.innerHTML, /20:16/);
  assert.match(app.fields.historyRows.innerHTML, /12\/10\/2026/);
  assert.doesNotMatch(app.fields.historyRows.innerHTML, /Học sinh cần gọi|updateCallResult/);
  assert.match(app.fields.callHistoryRows.innerHTML, /Học sinh cần gọi|updateCallResult/);
});

test('tuition history does not render a stale response after switching branches', async () => {
  const app = setupFrontend();
  const loading = app.context.loadTuitionHistory();
  app.changeBranch();
  await loading;
  assert.equal(app.fields.historyRows.innerHTML, '');
});

test('tuition deletion uses the same type, keyword and send date filters as the displayed history and respects cancellation', async () => {
  const app = setupFrontend();
  app.fields.historyKeyword.value = 'Hồ Hoàng';
  await app.context.clearTuitionHistory();
  const deleted = app.requests.find(request => request.options.method === 'DELETE');
  const url = new URL(deleted.url, 'https://example.test');
  assert.equal(url.pathname, '/api/notification-logs');
  assert.deepEqual(Object.fromEntries(url.searchParams), { ...tuitionQuery, q: 'Hồ Hoàng' });
  assert.ok(app.backend.db.notificationLogs.some(row => row.id === 'ngoc'));
  assert.equal(app.backend.db.notificationLogs.some(row => row.id === 'long'), false);
  const cancelled = setupFrontend();
  cancelled.cancelDelete();
  await cancelled.context.clearTuitionHistory();
  assert.equal(cancelled.requests.length, 0);
});

test('all tuition send statuses and legacy late-tuition logs appear only in tuition history', async () => {
  const app = setupFrontend();
  const before = structuredClone(app.backend.db);
  await Promise.all([app.context.loadTuitionHistory(), app.context.loadNotices()]);
  for (const name of ['Hồ Hoàng Long', 'Trương Bảo (C) Ngọc', 'Kraikitrat Giáp Cường', 'Học sinh gửi lỗi']) {
    assert.ok(app.fields.historyRows.innerHTML.includes(name));
    assert.ok(!app.fields.noticeRows.innerHTML.includes(name));
  }
  assert.equal((app.fields.noticeRows.innerHTML.match(/<tr>/g) || []).length, 1);
  assert.match(app.fields.noticePagination.innerHTML, /tổng 1/);
  assert.deepEqual(app.backend.db, before);
  const query = new URL(app.requests.find(request => request.url.includes('excludeAbsenceStatus')).url, 'http://localhost').searchParams;
  assert.equal(query.get('excludeAbsenceStatus'), 'Học phí');
});

test('clearing Zalo history preserves tuition records in every send state', async () => {
  const app = setupFrontend();
  const tuitionBefore = structuredClone(app.backend.db.notificationLogs.filter(log => log.id !== 'absence'));
  await app.context.clearNoticeHistory();
  assert.deepEqual(app.backend.db.notificationLogs, tuitionBefore);
  const deleted = app.requests.find(request => request.options.method === 'DELETE');
  assert.equal(new URL(deleted.url, 'http://localhost').searchParams.get('excludeAbsenceStatus'), 'Học phí');
});

test('tuition pending and failed sends retain copy, retry and manual confirmation actions', async () => {
  const app = setupFrontend();
  app.backend.db.notificationLogs.push({
    id: 'pending-tuition', absenceId: 'a1', studentName: 'Học sinh chờ gửi',
    absenceStatus: 'Học phí', date: '2026-10-12', time: '2026-10-12T13:30:00Z',
    status: 'Chờ gửi thủ công', channel: 'Zalo cá nhân', message: '<Thông tin học phí>'
  });
  const failure = app.backend.db.notificationLogs.find(log => log.id === 'midnight');
  failure.channel = 'Zalo cá nhân';
  await app.context.loadTuitionHistory();
  assert.match(app.fields.historyRows.innerHTML, /copy-log-msg-btn.*data-msg="&lt;Thông tin học phí&gt;"/);
  assert.match(app.fields.historyRows.innerHTML, /retry-zalo-btn/);
  assert.match(app.fields.historyRows.innerHTML, /data-logid="pending-tuition"/);
  assert.match(app.fields.historyRows.innerHTML, /data-logid="midnight"/);
  await app.fields.historyRows.click({ target: { closest: selector => selector === '.copy-log-msg-btn' ? { dataset: { msg: '<Thông tin học phí>' } } : null } });
  assert.deepEqual(app.copied, ['<Thông tin học phí>']);
  const button = { dataset: { id: 'a1', logid: 'pending-tuition' }, disabled: false };
  await app.fields.historyRows.click({ target: { closest: selector => selector === '.confirm-zalo-sent-btn' ? button : null } });
  assert.equal(app.backend.db.notificationLogs.find(log => log.id === 'pending-tuition').status, 'Đã gửi');
  assert.ok(!app.fields.noticeRows.innerHTML.includes('Học sinh chờ gửi'));
  const uncertain = app.context.renderNoticeActions({ ...failure, result: 'Đã bấm Gửi, chưa xác nhận được nội dung' });
  assert.doesNotMatch(uncertain, /retry-zalo-btn/);
  assert.match(uncertain, /Kiểm tra tin trong Zalo/);
});
