const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function fixture() {
  return {
    students: [{ id: 's1', fullName: 'Vũ Hoàng (A) Yến', className: '9KC4B', phone1: '0938163279' }],
    absences: [{ id: 'a1', studentId: 's1', date: '2026-10-14', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi thủ công' }],
    notificationLogs: [{ id: 'pending', absenceId: 'a1', status: 'Chờ gửi thủ công', channel: 'Zalo cá nhân', time: '2026-10-14T07:53:00Z' }]
  };
}

function setup(db = fixture()) {
  let handler, saves = 0, created = 0;
  const context = {
    app: { post(route, fn) { handler = fn; } },
    getBranchDb: async () => db, saveBranchDb: async () => { saves++; },
    cleanText: value => String(value ?? '').trim(),
    nowISO: () => '2026-10-14T07:54:00Z', id: () => `created-${++created}`,
    defaultSettings: () => ({}), buildMessage: () => 'Thông báo vắng',
    notificationLogAbsenceStatus: (log, absence) => log.absenceStatus || absence.absenceStatus,
    studentByIdMap: () => ({}), enrichAbsence: absence => absence
  };
  vm.createContext(context);
  const start = server.indexOf("app.post('/api/absences/:id/zalo/manual-sent'");
  const end = server.indexOf("app.post('/api/absences/:id/zalo/manual-error'", start);
  vm.runInContext(server.slice(start, end), context);
  return { db, saves: () => saves, async report(body = {}, absenceId = 'a1') {
    let result;
    await handler({ params: { id: absenceId }, body }, { json: value => { result = value; } }, error => { throw error; });
    return result;
  } };
}

test('a repeated exact success report returns the original log without adding history or rewriting its time', async () => {
  const app = setup();
  await app.report({ logId: 'pending' });
  const saved = structuredClone(app.db);
  const response = await app.report({ logId: 'pending', formattingWarning: 'Repeated report' });
  assert.equal(response.log.id, 'pending');
  assert.equal(response.log.status, 'Đã gửi');
  assert.deepEqual(structuredClone(app.db), saved);
  assert.equal(app.db.notificationLogs.length, 1);
  assert.equal(app.saves(), 1);
});

test('repeating an older acknowledgement does not mark a newer pending message as sent', async () => {
  const app = setup();
  await app.report({ logId: 'pending' });
  app.db.notificationLogs.push({ id: 'newer', absenceId: 'a1', status: 'Chờ gửi thủ công', channel: 'Zalo cá nhân' });
  app.db.absences[0].noticeStatus = 'Chờ gửi thủ công';
  const before = structuredClone(app.db);
  await app.report({ logId: 'pending' });
  assert.deepEqual(structuredClone(app.db), before);
  assert.equal(app.saves(), 1);
});

test('legacy confirmations without an ID reuse the latest attempt, including an already-confirmed send', async () => {
  const app = setup();
  app.db.notificationLogs.unshift({ id: 'older', absenceId: 'a1', status: 'Lỗi gửi', channel: 'Zalo cá nhân' });
  await app.report();
  const before = structuredClone(app.db);
  assert.equal((await app.report()).log.id, 'pending');
  assert.deepEqual(structuredClone(app.db), before);
  assert.equal(app.db.notificationLogs[0].status, 'Lỗi gửi');
});

test('a first legacy confirmation creates one log and repeated clicks create none', async () => {
  const db = fixture(); db.notificationLogs = []; db.absences[0].attendanceClass = '9MAKEUP';
  const app = setup(db);
  await app.report();
  await app.report();
  assert.equal(db.notificationLogs.length, 1);
  assert.equal(db.notificationLogs[0].className, '9MAKEUP');
  assert.equal(db.notificationLogs[0].absenceStatus, 'Vắng');
  assert.equal(app.saves(), 1);
});

test('unknown, mismatched, OA and resolved call log IDs are rejected without consuming another pending attempt', async () => {
  for (const variant of ['missing', 'wrong-absence', 'wrong-channel', 'called', 'linked-call']) {
    const app = setup();
    if (variant === 'wrong-absence') app.db.notificationLogs[0].absenceId = 'a2';
    if (variant === 'wrong-channel') app.db.notificationLogs[0].channel = 'Zalo OA';
    if (variant === 'called') app.db.notificationLogs[0].status = 'Đã gọi';
    if (variant === 'linked-call') app.db.notificationLogs[0].callLogId = 'c1';
    const before = structuredClone(app.db);
    await assert.rejects(app.report({ logId: variant === 'missing' ? 'unknown' : 'pending' }), error => error.status === 409);
    assert.deepEqual(app.db, before);
    assert.equal(app.saves(), 0);
  }
});

test('a delayed successful send updates its own log and leaves a newer attempt and queue state intact', async () => {
  const app = setup();
  app.db.notificationLogs.push({ id: 'newer', absenceId: 'a1', status: 'Lỗi gửi', channel: 'Zalo cá nhân' });
  app.db.absences[0].noticeStatus = 'Lỗi gửi';
  const absence = structuredClone(app.db.absences[0]);
  const latest = structuredClone(app.db.notificationLogs[1]);
  const response = await app.report({ logId: 'pending' });
  assert.equal(response.log.status, 'Đã gửi');
  assert.deepEqual(app.db.absences[0], absence);
  assert.deepEqual(app.db.notificationLogs[1], latest);
});

test('a new retry still gets its own confirmation after the previous attempt succeeded', async () => {
  const app = setup();
  await app.report({ logId: 'pending' });
  app.db.notificationLogs.push({ id: 'retry', absenceId: 'a1', status: 'Lỗi gửi', channel: 'Zalo cá nhân' });
  await app.report({ logId: 'retry' });
  assert.equal(app.db.notificationLogs.length, 2);
  assert.ok(app.db.notificationLogs.every(log => log.status === 'Đã gửi'));
  assert.equal(app.saves(), 2);
});
