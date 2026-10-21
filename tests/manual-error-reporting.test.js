const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function fixture() {
  return { students: [{ id: 's1', fullName: 'Kim' }], absences: [{ id: 'a1', studentId: 's1', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi thủ công' }], notificationLogs: [
    { id: 'old', absenceId: 'a1', status: 'Chờ gửi thủ công', channel: 'Zalo cá nhân', message: 'Tin cũ' },
    { id: 'new', absenceId: 'a1', status: 'Chờ gửi thủ công', channel: 'Zalo cá nhân', message: 'Tin mới' }
  ] };
}

function backend(db = fixture()) {
  let handler, saves = 0;
  const context = { app: { post: (route, fn) => { handler = fn; } },
    getBranchDb: async () => db, saveBranchDb: async () => { saves++; },
    cleanText: value => String(value ?? '').trim(), ABSENCE_STATUSES: ['Vắng', 'Học phí'],
    nowISO: () => '2026-10-12T13:11:00Z', id: () => 'created',
    defaultSettings: () => ({}), buildMessage: () => 'Tin mới',
    studentByIdMap: () => ({}), enrichAbsence: value => value
  };
  Object.assign(context, require('../lib/history-date-range'));
  vm.createContext(context);
  for (const [start, end] of [
    ['function normalizeAbsenceStatus(', 'function normalizeInitialReason('],
    ['function notificationLogDate(', 'function sendWorkbook('],
    ["app.post('/api/absences/:id/zalo/manual-error'", "app.post('/api/absences/:id/zalo'"]
  ]) { const offset = server.indexOf(start); vm.runInContext(server.slice(offset, server.indexOf(end, offset)), context); }
  return { db, saves: () => saves, async report(body, absenceId = 'a1') {
    let result;
    await handler({ params: { id: absenceId }, body }, { json: value => { result = value; } }, error => { throw error; });
    return result;
  } };
}

test('an extension error updates the exact pending log instead of the first pending log', async () => {
  const app = backend();
  const older = structuredClone(app.db.notificationLogs[0]);
  const response = await app.report({ logId: 'new', error: 'Không tìm thấy số điện thoại' });
  assert.equal(response.log.id, 'new');
  assert.equal(response.log.status, 'Lỗi gửi');
  assert.deepEqual(app.db.notificationLogs[0], older);
  assert.equal(app.db.absences[0].noticeStatus, 'Lỗi gửi');
  assert.equal(app.saves(), 1);
});

test('legacy clients without a log ID update the most recent pending attempt', async () => {
  const app = backend();
  assert.equal((await app.report({ error: 'Lỗi Zalo' })).log.id, 'new');
  assert.equal(app.db.notificationLogs[0].status, 'Chờ gửi thủ công');
});

test('a delayed failure for an older attempt preserves a newer pending attempt and the queue state', async () => {
  const app = backend();
  const newest = structuredClone(app.db.notificationLogs[1]);
  const absence = structuredClone(app.db.absences[0]);
  await app.report({ logId: 'old', error: 'Lỗi gửi lượt cũ' });
  assert.equal(app.db.notificationLogs[0].status, 'Lỗi gửi');
  assert.deepEqual(app.db.notificationLogs[1], newest);
  assert.deepEqual(app.db.absences[0], absence);
});

test('a report with a missing, mismatched or already-sent log ID does not change data', async () => {
  for (const variant of ['missing', 'wrong-absence', 'sent', 'wrong-channel']) {
    const app = backend();
    if (variant === 'wrong-absence') app.db.notificationLogs[1].absenceId = 'a2';
    if (variant === 'sent') app.db.notificationLogs[1].status = 'Đã gửi';
    if (variant === 'wrong-channel') app.db.notificationLogs[1].channel = 'Zalo OA';
    const before = structuredClone(app.db);
    await assert.rejects(app.report({ logId: variant === 'missing' ? 'missing' : 'new' }), error => error.status === 409);
    assert.deepEqual(app.db, before);
    assert.equal(app.saves(), 0);
  }
});

test('an exact error report updates an orphaned legacy log without recreating attendance', async () => {
  const db = fixture(); db.absences = [];
  const app = backend(db);
  const response = await app.report({ logId: 'new', error: 'Zalo không tìm thấy số' });
  assert.equal(response.absence, null);
  assert.equal(response.log.status, 'Lỗi gửi');
  assert.equal(response.log.absenceStatus, undefined);
  assert.equal(db.notificationLogs[0].status, 'Chờ gửi thủ công');
  assert.deepEqual(db.absences, []);
  assert.equal(app.saves(), 1);
});

function extensionBridge() {
  const requests = [], timers = new Map(); let listener;
  const window = { addEventListener: (type, fn) => { listener = fn; }, removeEventListener() {}, postMessage() {} };
  const context = { window, console, toast() {}, getActiveBranch: () => 'main',
    api: async (url, options) => { requests.push({ url, body: JSON.parse(options.body) }); },
    setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: timer => timers.delete(timer)
  };
  vm.createContext(context);
  const start = frontend.indexOf('function startZaloExtensionAuto(');
  vm.runInContext(frontend.slice(start, frontend.indexOf('function exportLateAbsences(', start)), context);
  return { requests, timers, context, event: data => listener({ source: window, data: { source: 'baovang-zalo-extension', ...data } }) };
}

test('extension success, failure and stopped-queue reports carry the corresponding log IDs', async () => {
  const app = extensionBridge();
  const completed = app.context.startZaloExtensionAuto([
    { id: 'log-success', absenceId: 'a1' }, { id: 'log-failure', absenceId: 'a2' }, { id: 'log-stopped', absenceId: 'a3' }
  ]);
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-failure', ok: false, error: 'Không tìm thấy Zalo' });
  app.event({ type: 'BAOVANG_EXTENSION_STATUS', status: 'stopped' });
  await completed;
  assert.deepEqual(app.requests.map(request => request.body.logId), ['log-success', 'log-failure', 'log-stopped']);
  assert.match(app.requests[0].url, /manual-sent$/);
  assert.match(app.requests[1].url, /manual-error$/);
  assert.match(app.requests[2].url, /manual-error$/);
});

test('timeout failure reports identify each unreported pending log', async () => {
  const app = extensionBridge();
  const completed = app.context.startZaloExtensionAuto([{ id: 'log-timeout', absenceId: 'a1' }]);
  app.timers.get(30000)();
  await completed;
  assert.deepEqual(app.requests.map(request => request.body.logId), ['log-timeout']);
});

test('duplicate and contradictory extension result events persist a completed item only once', async () => {
  const app = extensionBridge();
  const completed = app.context.startZaloExtensionAuto([{ id: 'log-success', absenceId: 'a1' }]);
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: false, error: 'Duplicate error' });
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'unknown', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_STATUS', status: 'completed' });
  await completed;
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].body.logId, 'log-success');
  assert.match(app.requests[0].url, /manual-sent$/);
});

test('a confirmed send appears in the queue before the rest of the batch completes', async () => {
  const app = extensionBridge();
  let renders = 0;
  app.context.state = { absences: [{ id: 'a1', noticeStatus: 'Chờ gửi thủ công' }] };
  app.context.renderAbsences = () => { renders++; };
  app.context.renderRoster = () => {};
  let confirm;
  app.context.api = () => new Promise(resolve => { confirm = resolve; });
  const completed = app.context.startZaloExtensionAuto([{ id: 'log-success', absenceId: 'a1' }]);
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.context.state.absences[0].noticeStatus, 'Chờ gửi thủ công');
  confirm({ absence: { id: 'a1', noticeStatus: 'Đã gửi' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.context.state.absences[0].noticeStatus, 'Đã gửi');
  assert.equal(renders, 1);
  app.event({ type: 'BAOVANG_EXTENSION_STATUS', status: 'completed' });
  assert.equal(await completed, true);
});

test('switching branches keeps reports on the sending branch and does not redraw another branch', async () => {
  const app = extensionBridge();
  let branch = 'main', renders = 0;
  const headers = [];
  app.context.getActiveBranch = () => branch;
  app.context.state = { absences: [{ id: 'a1', noticeStatus: 'Chờ gửi thủ công' }] };
  app.context.renderAbsences = () => { renders++; };
  app.context.renderRoster = () => {};
  app.context.api = async (_url, options) => {
    headers.push(options.headers['X-Branch-Id']);
    return { absence: { id: 'a1', noticeStatus: 'Đã gửi' } };
  };
  const completed = app.context.startZaloExtensionAuto([{ id: 'log-success', absenceId: 'a1' }]);
  branch = 'other';
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_STATUS', status: 'completed' });
  await completed;
  assert.deepEqual(headers, ['main']);
  assert.equal(renders, 0);
  assert.equal(app.context.state.absences[0].noticeStatus, 'Chờ gửi thủ công');
});

test('a failed save of a successful send warns the user and does not announce completion', async () => {
  const app = extensionBridge();
  const notices = [];
  app.context.console = { error() {} };
  app.context.toast = (message, type) => notices.push({ message, type });
  app.context.api = async () => { throw Error('Offline'); };
  const completed = app.context.startZaloExtensionAuto([{ id: 'log-success', absenceId: 'a1' }]);
  app.event({ type: 'BAOVANG_EXTENSION_RESULT', itemId: 'log-success', ok: true });
  app.event({ type: 'BAOVANG_EXTENSION_STATUS', status: 'completed' });
  assert.equal(await completed, false);
  assert.ok(notices.some(notice => notice.type === 'error' && /Chưa lưu được/.test(notice.message)));
  assert.ok(notices.every(notice => !/hoàn tất/.test(notice.message)));
});
