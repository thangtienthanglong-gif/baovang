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

function setupServer() {
  const branches = {
    main: { settings: { zaloMode: 'personal-real' }, rows: [
      { id: 'one', className: '9VT2', noticeStatus: 'Chưa gửi' },
      { id: 'two', className: '9VT2', noticeStatus: 'Lỗi gửi' },
      { id: 'sent', className: '9VT2', noticeStatus: 'Đã gửi' },
      { id: 'withdrawn', className: '9VT2', absenceStatus: 'Nghỉ học' },
      { id: 'made-up', className: '9VT2', absenceStatus: 'Đã bù' },
      { id: 'outside', className: '8OTHER', noticeStatus: 'Chưa gửi' }
    ] },
    other: { settings: {}, rows: [{ id: 'one', className: '9VT2', noticeStatus: 'Chưa gửi' }] }
  };
  let handler;
  const sent = [];
  const saves = [];
  const context = {
    app: { post(url, callback) { assert.equal(url, '/api/absences/zalo/bulk'); handler = callback; } },
    getBranchDb: async req => branches[req.branch], saveBranchDb: async req => saves.push(req.branch),
    studentByIdMap: () => ({}), normalizeAbsenceStatus: value => value,
    isWithdrawnAbsence: row => row.absenceStatus === 'Nghỉ học', defaultSettings: () => ({}),
    filterAbsences: (db, filters) => db.rows.filter(row => !filters.className || row.className === filters.className),
    sendZaloNotice: async (db, id) => {
      sent.push({ branch: db === branches.main ? 'main' : 'other', id });
      return { id, status: 'Chờ gửi thủ công' };
    }
  };
  Object.assign(context, require('../lib/tuition-reminders'));
  vm.createContext(context);
  vm.runInContext(slice(server, 'function selectBulkZaloCandidates(', "app.post('/api/absences/:id/zalo/manual-sent'"), context);
  async function call(body, branch = 'main') {
    let result;
    await handler({ body, branch, query: {} }, { json(value) { result = value; } }, error => { throw error; });
    return result;
  }
  return { call, sent, saves, branches };
}

test('bulk default skips cross-class tuition reminders while explicit choices allow one repeat per person', async () => {
  for (const explicit of [false, true]) {
    const app = setupServer();
    const db = app.branches.main;
    db.students = [{ id: 'van', fullName: 'Nguyễn An', phone1: '0901234567' },
      { id: 'toan', fullName: 'Nguyễn An', phone1: '0901234567' }];
    db.notificationLogs = [{ id: 'old', studentId: 'van', time: new Date(Date.now() - 86400000).toISOString(), absenceStatus: 'Học phí', status: 'Đã gửi' }];
    db.rows = [{ id: 'v', studentId: 'van', absenceStatus: 'Học phí' },
      { id: 't', studentId: 'toan', absenceStatus: 'Học phí' }];
    const result = await app.call(explicit ? { ids: ['v', 't'] } : {});
    assert.equal(result.processed, explicit ? 1 : 0);
    assert.equal(result.tuitionAlreadyReminded, explicit ? 0 : 2);
    assert.equal(result.tuitionDuplicates, explicit ? 1 : 0);
    assert.equal(result.skipped, explicit ? 1 : 2);
    assert.deepEqual(app.sent.map(row => row.id), explicit ? ['v'] : []);
  }
});

test('bulk selection only sends checked IDs that match the selected class and keeps sent or inactive students out', async () => {
  const app = setupServer();
  const result = await app.call({ filters: { className: '9VT2' }, ids: ['one', 'one', 'sent', 'withdrawn', 'made-up', 'outside', 'missing'] });
  assert.deepEqual(app.sent, [{ branch: 'main', id: 'one' }]);
  assert.equal(result.total, 2);
  assert.equal(result.processed, 1);
  assert.equal(result.skipped, 1);
});

test('an explicitly empty or unmatched selection never falls back to sending the full filtered list', async () => {
  for (const ids of [[], ['missing'], ['', 42, null]]) {
    const app = setupServer();
    const result = await app.call({ filters: { className: '9VT2' }, ids });
    assert.equal(result.total, 0);
    assert.equal(result.processed, 0);
    assert.equal(app.sent.length, 0);
  }
});

test('invalid selection types fail before sending or saving while omitted IDs retain compatibility with existing clients', async () => {
  for (const ids of ['one', {}, null, 42]) {
    const app = setupServer();
    await assert.rejects(app.call({ ids }), error => error.status === 400);
    assert.equal(app.sent.length, 0);
    assert.equal(app.saves.length, 0);
  }
  const legacy = setupServer();
  const result = await legacy.call({ filters: { className: '9VT2' } });
  assert.deepEqual(legacy.sent.map(row => row.id), ['one', 'two']);
  assert.equal(result.total, 3);
  assert.equal(result.skipped, 1);
});

test('selected IDs use only the branch loaded for the request', async () => {
  const app = setupServer();
  await app.call({ filters: { className: '9VT2' }, ids: ['one', 'two'] }, 'other');
  assert.deepEqual(app.sent, [{ branch: 'other', id: 'one' }]);
  assert.deepEqual(app.saves, ['other']);
});

function setupFrontend(boxes, failure = false) {
  const requests = [];
  const warnings = [];
  const button = { disabled: false };
  const context = {
    document: { querySelectorAll: () => boxes }, state: { settings: {} },
    getFilters: () => ({ date: '2026-10-12', className: '9VT2' }),
    toast: message => warnings.push(message), bulkZaloMessage: () => 'Đã xử lý',
    renderManualSendPanel() {}, loadAbsences() {},
    api: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw new Error('Network error');
      return { logs: [] };
    }
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'async function sendBulkZalo(', 'function startZaloExtensionAuto('), context);
  return { context, requests, warnings, button };
}

test('the bulk button sends only checked student IDs and is enabled again after success or failure', async () => {
  const boxes = [{ dataset: { id: 'one' }, checked: true }, { dataset: { id: 'two' }, checked: false }];
  const app = setupFrontend(boxes);
  await app.context.sendBulkZalo(app.button);
  assert.equal(app.requests[0].url, '/api/absences/zalo/bulk');
  assert.deepEqual(JSON.parse(app.requests[0].options.body), {
    filters: { date: '2026-10-12', className: '9VT2' }, ids: ['one']
  });
  assert.equal(app.button.disabled, false);
  const failed = setupFrontend(boxes, true);
  await assert.rejects(failed.context.sendBulkZalo(failed.button), /Network error/);
  assert.equal(failed.button.disabled, false);
});

test('the bulk button makes no request when nothing is checked or the displayed queue is empty', async () => {
  for (const boxes of [[], [{ dataset: { id: 'one' }, checked: false }]]) {
    const app = setupFrontend(boxes);
    await app.context.sendBulkZalo(app.button);
    assert.equal(app.requests.length, 0);
    assert.match(app.warnings[0], /chọn ít nhất/);
    assert.equal(app.button.disabled, false);
  }
});
