const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const XLSX = require('xlsx-js-style');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture() {
  return { students: [{ id: 's1', code: 'TEST-1', fullName: 'Học sinh nghỉ', className: '8AT3', parentName: 'Phụ huynh', phone1: '0900000000', status: 'Đang học' }],
    absences: [], notificationLogs: [], settings: { zaloMode: 'personal-real' } };
}

function setup(db) {
  const routes = new Map();
  let saves = 0;
  let networkCalls = 0;
  let nextId = 0;
  const context = {
    app: Object.fromEntries(['get', 'post', 'put'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    getBranchDb: async () => db, saveBranchDb: async () => { saves += 1; },
    cleanText: value => String(value || '').trim(), normalizePhone: value => String(value || ''),
    normalizeAbsenceStatus: value => value, normalizeInitialReason: (value, fallback) => value || fallback,
    normalizeSearchText: value => String(value || '').toLowerCase(),
    requireFields(body, fields) { for (const key of fields) if (!body[key]) throw new Error(`Missing ${key}`); },
    defaultSettings: () => ({}), delayMinutesFromSettings: () => db.settings.delay || 0,
    addMinutesISO: () => '2026-10-06T12:00:00Z', nowISO: () => '2026-10-06T10:00:00Z', todayISO: () => '2026-10-06',
    id: prefix => `${prefix}-${++nextId}`, MAKEUP_ATTENDANCE_STATUSES: new Set(['Vắng', 'Có phép']),
    getZaloRuntimeConfig: settings => ({ mode: settings.zaloMode, enabled: true }), buildMessage: () => 'Thông báo kiểm tra',
    fetch: async () => { networkCalls += 1; throw new Error('Unexpected network send'); },
    XLSX, Date
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function sanitizeStudent(', 'function getSummary('],
    ['function getSummary(', 'function filterCallLogs('],
    ['function sendWorkbook(', 'function buildMessage('],
    ['async function sendZaloNotice(', 'let noticeSchedulerRunning'],
    ["app.get('/api/quit-students',", "app.delete('/api/quit-students/clear'"],
    ["app.put('/api/students/:id',", "app.post('/api/students/:id/transfer'"],
    ["app.post('/api/absences',", "async function runBulkZaloAction("]
  ]) vm.runInContext(slice(start, end), context);
  async function call(method, url, { body = {}, id = '', query = {} } = {}) {
    let data;
    let status = 200;
    const res = { status(value) { status = value; return this; }, json(value) { data = value; }, setHeader() {}, send(value) { data = value; } };
    await routes.get(`${method} ${url}`)({ body, params: { id }, query }, res, error => { throw error; });
    return { data, status };
  }
  return { context, call, saves: () => saves, networkCalls: () => networkCalls };
}

const withdrawal = { date: '2026-10-06', studentId: 's1', session: 'Tối', absenceStatus: 'Nghỉ học', sendZalo: true };

for (const delay of [0, 15]) {
  test(`made-up attendance keeps enrollment and never sends or schedules a notice (delay ${delay})`, async () => {
    const db = fixture();
    db.settings.delay = delay;
    const app = setup(db);
    const result = await app.call('post', '/api/absences', { body: { ...withdrawal, absenceStatus: 'Đã bù' } });
    assert.equal(result.status, 201);
    assert.equal(result.data.absence.absenceStatus, 'Đã bù');
    assert.equal(result.data.absence.date, '2026-10-06');
    assert.equal(db.students[0].status, 'Đang học');
    assert.equal(db.students[0].className, '8AT3');
    assert.equal(db.students[0].quitDate, undefined);
    assert.equal(db.absences[0].noticeStatus, 'Không gửi');
    assert.equal(db.absences[0].autoNotice, false);
    assert.equal(db.absences[0].noticeDueAt, '');
    assert.equal(db.notificationLogs.length, 0);
    assert.equal(app.networkCalls(), 0);
    assert.equal(app.context.getSummary(app.context.filterAbsences(db, {})).total, 0);
  });
}

test('marking an existing absence made up cancels only that record and keeps sent message history', async () => {
  const db = fixture();
  db.absences = [
    { id: 'today', studentId: 's1', date: '2026-10-06', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi', autoNotice: true, noticeDueAt: 'later' },
    { id: 'other-day', studentId: 's1', date: '2026-10-05', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi', autoNotice: true }
  ];
  db.notificationLogs = [
    { absenceId: 'today', studentId: 's1', status: 'Chờ gửi thủ công' },
    { absenceId: 'today', studentId: 's1', status: 'Đã gửi', message: 'Tin đã gửi' },
    { absenceId: 'other-day', studentId: 's1', status: 'Chờ gửi thủ công' }
  ];
  const untouched = structuredClone(db.absences[1]);
  const app = setup(db);
  await app.call('put', '/api/absences/:id/status', { id: 'today', body: { absenceStatus: 'Đã bù', sendZalo: true } });
  assert.equal(db.absences[0].absenceStatus, 'Đã bù');
  assert.equal(db.absences[0].autoNotice, false);
  assert.equal(db.absences[0].noticeDueAt, '');
  assert.equal(db.absences[0].noticeStatus, 'Không gửi');
  assert.deepEqual(db.absences[1], untouched);
  assert.deepEqual(db.notificationLogs.map(row => row.status), ['Không gửi', 'Đã gửi', 'Chờ gửi thủ công']);
  assert.equal(db.notificationLogs[1].message, 'Tin đã gửi');
  assert.equal(app.networkCalls(), 0);
});

test('posting made-up status over an existing attendance cancels its pending notice without adding a record', async () => {
  const db = fixture();
  db.absences = [{ ...withdrawal, id: 'existing', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi', autoNotice: true, noticeDueAt: 'later' }];
  const app = setup(db);
  await app.call('post', '/api/absences', { body: { ...withdrawal, absenceStatus: 'Đã bù' } });
  assert.equal(db.absences.length, 1);
  assert.equal(db.absences[0].absenceStatus, 'Đã bù');
  assert.equal(db.absences[0].noticeStatus, 'Không gửi');
  assert.equal(db.absences[0].noticeDueAt, '');
  assert.equal(app.networkCalls(), 0);
});

test('made-up status blocks bulk and direct retries while other absences remain actionable', async () => {
  const db = fixture();
  db.absences = [
    { id: 'made-up', studentId: 's1', absenceStatus: 'Đã bù', noticeStatus: 'Lỗi gửi' },
    { id: 'actual-absence', studentId: 's1', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi' }
  ];
  const app = setup(db);
  assert.deepEqual(Array.from(app.context.selectBulkZaloCandidates(db, {}).candidates, row => row.id), ['actual-absence']);
  for (const mode of ['personal-real', 'oa']) {
    db.settings.zaloMode = mode;
    const result = await app.context.sendZaloNotice(db, 'made-up', 'manual_resend');
    assert.equal(result.status, 'Không gửi');
    assert.equal(result.responsePayload.blocked, true);
  }
  assert.equal(app.networkCalls(), 0);
  assert.equal(app.context.getSummary(app.context.filterAbsences(db, {})).total, 1);
});

for (const delay of [0, 15]) {
  test(`new withdrawal never sends or schedules Zalo, even if sendZalo=true (delay ${delay})`, async () => {
    const db = fixture();
    db.settings.delay = delay;
    const app = setup(db);
    const result = await app.call('post', '/api/absences', { body: withdrawal });
    assert.equal(result.status, 201);
    assert.equal(db.students[0].status, 'Nghỉ học');
    assert.equal(db.students[0].quitDate, '2026-10-06');
    assert.equal(result.data.absence.studentStatus, 'Nghỉ học');
    assert.equal(db.absences[0].noticeStatus, 'Không gửi');
    assert.equal(db.absences[0].autoNotice, false);
    assert.equal(db.absences[0].noticeDueAt, '');
    assert.equal(db.notificationLogs.length, 0);
    assert.equal(app.networkCalls(), 0);
    assert.equal(app.saves(), 1);
  });
}

test('changing an existing record to withdrawn cancels all pending notices but preserves sent history', async () => {
  const db = fixture();
  db.absences = [
    { id: 'a1', studentId: 's1', date: '2026-10-06', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi', autoNotice: true, noticeDueAt: '2026-10-06T12:00:00Z' },
    { id: 'a2', studentId: 's1', date: '2026-10-05', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi thủ công' },
    { id: 'sent', studentId: 's1', date: '2026-10-04', absenceStatus: 'Vắng', noticeStatus: 'Đã gửi' }
  ];
  db.notificationLogs = [{ studentId: 's1', status: 'Chờ gửi thủ công' }, { studentId: 's1', status: 'Đã gửi' }];
  const app = setup(db);
  await app.call('put', '/api/absences/:id/status', { id: 'a1', body: { absenceStatus: 'Nghỉ học', sendZalo: true } });
  assert.equal(db.students[0].quitDate, '2026-10-06');
  assert.deepEqual(db.absences.map(row => row.noticeStatus), ['Không gửi', 'Không gửi', 'Đã gửi']);
  assert.equal(db.absences[0].noticeDueAt, '');
  assert.equal(db.absences[0].autoNotice, false);
  assert.deepEqual(db.notificationLogs.map(row => row.status), ['Không gửi', 'Đã gửi']);
  assert.equal(app.context.selectBulkZaloCandidates(db, {}).candidates.length, 0);
  const summary = app.context.getSummary(app.context.filterAbsences(db, {}));
  assert.equal(summary.total, 0);
  assert.equal(summary.pending, 0);
});

test('posting withdrawal over a duplicate attendance record still saves quit date and cancels notices', async () => {
  const db = fixture();
  db.absences = [{ ...withdrawal, id: 'existing', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi', autoNotice: true }];
  const app = setup(db);
  await app.call('post', '/api/absences', { body: withdrawal });
  assert.equal(db.absences.length, 1);
  assert.equal(db.students[0].quitDate, '2026-10-06');
  assert.equal(db.absences[0].noticeStatus, 'Không gửi');
  assert.equal(db.absences[0].autoNotice, false);
});

test('bulk and direct retries exclude withdrawn students, including their older absence records', async () => {
  const db = fixture();
  db.students[0].status = 'Nghỉ học';
  db.students.push({ id: 's2', status: 'Đang học', fullName: 'Đang học' });
  db.absences = [
    { id: 'old', studentId: 's1', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi' },
    { id: 'quit', studentId: 's2', absenceStatus: 'Nghỉ học', noticeStatus: 'Chờ gửi' },
    { id: 'active', studentId: 's2', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi' }
  ];
  const app = setup(db);
  assert.deepEqual(Array.from(app.context.selectBulkZaloCandidates(db, {}).candidates, row => row.id), ['active']);
  for (const mode of ['personal-real', 'oa']) {
    db.settings.zaloMode = mode;
    for (const id of ['old', 'quit']) {
      const result = await app.context.sendZaloNotice(db, id, 'manual_resend');
      assert.equal(result.status, 'Không gửi');
      assert.equal(result.responsePayload.blocked, true);
    }
  }
  assert.equal(app.networkCalls(), 0);
});

test('history and the actual Excel workbook recover a legacy quit date from attendance records', async () => {
  const db = fixture();
  db.students[0].status = 'Nghỉ học';
  db.absences = [{ studentId: 's1', absenceStatus: 'Nghỉ học', date: '2026-10-06', note: 'Chuyển trường' }];
  const app = setup(db);
  const history = await app.call('get', '/api/quit-students');
  assert.equal(history.data[0].quitDate, '2026-10-06');
  const file = await app.call('get', '/api/quit-students/export');
  const workbook = XLSX.read(file.data, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['HS Nghi Hoc']);
  assert.equal(rows[0]['Ngày nghỉ'], '06/10/2026');
  assert.equal(rows[0]['Lý do'], 'Chuyển trường');
  assert.equal(rows[0]['SĐT'], '0900000000');
});

test('removed class names stay out of notice retries and reject new attendance without deleting history', async () => {
  const db = fixture();
  db.students[0].removedFromClass = true;
  db.absences = [{ id: 'old', studentId: 's1', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi' }];
  const app = setup(db);
  assert.equal(app.context.selectBulkZaloCandidates(db, {}).candidates.length, 0);
  const retry = await app.context.sendZaloNotice(db, 'old', 'manual_resend');
  assert.equal(retry.status, 'Không gửi');
  assert.equal(retry.responsePayload.blocked, true);
  await assert.rejects(app.call('post', '/api/absences', { body: { ...withdrawal, absenceStatus: 'Vắng' } }), error => error.status === 409);
  assert.equal(db.absences.length, 1);
  assert.equal(app.networkCalls(), 0);
  assert.equal(app.context.getSummary(app.context.filterAbsences(db, {})).total, 0);
});

test('editing student contact fields cannot silently reactivate a withdrawn student', async () => {
  const db = fixture();
  db.students[0].status = 'Nghỉ học';
  db.students[0].quitDate = '2026-10-06';
  const app = setup(db);
  await app.call('put', '/api/students/:id', { id: 's1', body: { code: 'TEST-1', fullName: 'Tên mới', className: '8AT3', parentName: 'Trường chính', phone1: '0900000000' } });
  assert.equal(db.students[0].status, 'Nghỉ học');
  assert.equal(db.students[0].quitDate, '2026-10-06');
});

test('the processing queue hides withdrawal records and older records of withdrawn students', () => {
  const container = { innerHTML: '' };
  const context = { state: { absences: [
    { studentName: 'Không được xuất hiện', absenceStatus: 'Nghỉ học', noticeStatus: 'Không gửi' },
    { studentName: 'Không được xuất hiện', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi', studentStatus: 'Nghỉ học' }
  ] }, $: () => container, normalizeAbsenceStatus: value => value };
  const start = frontend.indexOf('function renderAbsences()');
  vm.runInNewContext(frontend.slice(start, frontend.indexOf('function getWeekRange(', start)), context);
  context.renderAbsences();
  assert.match(container.innerHTML, /Hàng xử lý trống/);
  assert.doesNotMatch(container.innerHTML, /Không được xuất hiện/);
});
