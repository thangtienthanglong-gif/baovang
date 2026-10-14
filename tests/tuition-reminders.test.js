const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildTuitionReminders, selectTuitionContacts, registerTuitionReminderRoutes,
  resolveTuitionTemplate, DEFAULT_TUITION_TEMPLATE } = require('../lib/tuition-reminders');

const now = '2026-10-14T08:00:00Z';
function fixture() {
  return { students: [
    { id: 'van', fullName: 'Nguyễn Văn An', code: 'AUTO-V', className: '9VT3', phone1: '0901234567' },
    { id: 'toan', fullName: '  NGUYỄN  VĂN AN ', code: 'AUTO-T', className: '9T4', phone1: '+84 901 234 567' },
    { id: 'sibling', fullName: 'Nguyễn Văn Bình', className: '8T4', phone1: '0901234567' }
  ], absences: [], contactRequests: [], callLogs: [], notificationLogs: [
    { id: 'sent', studentId: 'van', absenceStatus: 'Học phí', status: 'Đã gửi', time: '2026-10-13T08:00:00Z', className: '9VT3', channel: 'Zalo cá nhân' }
  ] };
}
const build = db => buildTuitionReminders(db, { now });

test('a general tuition contact shares its badge across subject enrollments without merging siblings', () => {
  const db = fixture(), before = structuredClone(db);
  const { reminders, identities } = build(db);
  assert.deepEqual(reminders.toan, reminders.van);
  assert.equal(reminders.toan.className, '9VT3');
  assert.equal(identities.van, identities.toan);
  assert.equal(reminders.sibling, undefined);
  assert.deepEqual(db, before, 'read models must never modify stored history');
});

test('the same name with a different phone and generated codes remains separate', () => {
  const db = fixture();
  db.students[1].phone1 = '0901111111';
  assert.equal(build(db).reminders.toan, undefined);
});

test('explicit person IDs link classes and conflicting IDs are never merged', () => {
  const db = fixture();
  db.students[0].personId = 'person-a';
  assert.ok(build(db).reminders.toan, 'unique explicit identity can resolve its other enrollment');
  db.students[1].personId = 'person-b';
  assert.equal(build(db).reminders.toan, undefined);
  db.students[1].personId = 'person-a';
  db.students[1].phone1 = '0901111111';
  assert.ok(build(db).reminders.toan);
});

test('a real shared student code can link enrollments without phone data', () => {
  const db = fixture();
  for (const student of db.students.slice(0, 2)) { student.phone1 = ''; student.code = 'HS-123'; }
  assert.ok(build(db).reminders.toan);
  db.students[1].code = 'AUTO-123';
  assert.equal(build(db).reminders.toan, undefined);
});

test('the badge expires exactly seven days after success, independently of history filters', () => {
  const db = fixture();
  const last = Date.parse(db.notificationLogs[0].time);
  assert.ok(buildTuitionReminders(db, { now: last + 7 * 86400000 - 1 }).reminders.toan);
  const expired = buildTuitionReminders(db, { now: last + 7 * 86400000 });
  assert.deepEqual(expired.reminders, {});
  assert.equal(expired.contacts.length, 1, 'expired badges do not delete history');
});

test('a repeat successful reminder resets the deadline across all classes', () => {
  const db = fixture();
  db.notificationLogs.push({ ...db.notificationLogs[0], id: 'repeat', studentId: 'toan', time: now, className: '9T4' });
  assert.equal(build(db).reminders.van.expiresAt, '2026-10-21T08:00:00.000Z');
  assert.equal(build(db).reminders.van.className, '9T4');
});

test('failed, pending, dry-run and unrelated contacts do not start or extend the reminder period', () => {
  const db = fixture();
  const previous = build(db).reminders.van;
  for (const status of ['Lỗi gửi', 'Chờ gửi thủ công', 'Chạy thử', 'Không gửi']) {
    db.notificationLogs.push({ ...db.notificationLogs[0], id: status, status, time: now });
  }
  db.notificationLogs.push({ ...db.notificationLogs[0], id: 'absence', time: now, absenceStatus: 'Vắng' });
  assert.deepEqual(build(db).reminders.toan, previous);
  db.notificationLogs = db.notificationLogs.filter(row => row.id !== 'sent');
  assert.deepEqual(build(db).reminders, {});
});

test('only a successful call counts, and converted notices are represented once', () => {
  for (const outcome of ['Đã báo', 'Không bắt máy', 'Không liên lạc được']) {
    const db = fixture();
    db.notificationLogs[0].callLogId = 'call';
    db.callLogs = [{ id: 'call', notificationLogId: 'sent', studentId: 'van', time: now,
      callStatus: 'Đã gọi', callResult: outcome, caller: 'nhanvien' }];
    const result = build(db);
    assert.equal(result.contacts.length, 1);
    assert.equal(Boolean(result.reminders.toan), outcome === 'Đã báo');
  }
});

test('legacy tuition calls linked to an absence and legacy amount messages still count', () => {
  const db = fixture();
  db.notificationLogs = [];
  db.absences = [{ id: 'tuition', studentId: 'van', absenceStatus: 'Trễ học phí' }];
  db.callLogs = [{ id: 'call', absenceId: 'tuition', studentId: 'van', callStatus: 'Đã gọi', time: now }];
  assert.ok(build(db).reminders.toan);
  db.callLogs = [];
  db.notificationLogs = [{ id: 'old', studentName: 'Nguyễn Văn An', phone1: '0901234567', status: 'Đã gửi', time: now,
    message: 'Kính gửi phụ huynh, thông báo học phí/tiền nợ của em Nguyễn Văn An' }];
  assert.ok(build(db).reminders.toan);
});

test('unidentifiable, invalid and future logs cannot create badges for another student', () => {
  const db = fixture();
  db.notificationLogs[0].time = 'invalid';
  db.notificationLogs.push({ ...db.notificationLogs[0], id: 'future', time: '2030-01-01' },
    { ...db.notificationLogs[0], id: 'name-only', time: now, studentId: '', studentName: 'Nguyễn Văn An' });
  assert.deepEqual(build(db).reminders, {});
  assert.throws(() => buildTuitionReminders(db, { now: 'invalid' }));
});

test('default bulk skips recent tuition, explicit selection allows repeat, and one person receives once per batch', () => {
  const db = fixture();
  const rows = [{ id: 'v', studentId: 'van', absenceStatus: 'Học phí' },
    { id: 't', studentId: 'toan', absenceStatus: 'Trễ học phí' },
    { id: 's', studentId: 'sibling', absenceStatus: 'Học phí' },
    { id: 'a', studentId: 'van', absenceStatus: 'Vắng' }];
  const automatic = selectTuitionContacts(db, rows, { now });
  assert.deepEqual(automatic.candidates.map(row => row.id), ['s', 'a']);
  assert.equal(automatic.reminded, 2);
  const manual = selectTuitionContacts(db, rows, { now, allowRecent: true });
  assert.deepEqual(manual.candidates.map(row => row.id), ['v', 's', 'a']);
  assert.equal(manual.duplicates, 1);
});

test('metadata and consolidated history routes are read-only and scoped to the requested branch', async () => {
  const branches = { main: fixture(), other: { students: [{ id: 'toan' }] } };
  const routes = new Map();
  registerTuitionReminderRoutes({ get: (url, handler) => routes.set(url, handler) },
    { getBranchDb: async req => branches[req.branch] });
  const before = structuredClone(branches);
  async function request(path, branch, id) {
    let data, status = 200;
    await routes.get(path)({ branch, params: { id } },
      { json: value => { data = value; }, status: value => { status = value; return { json: value => { data = value; } }; } },
      error => { throw error; });
    return { data, status };
  }
  assert.equal((await request('/api/tuition-reminders/:id/history', 'main', 'toan')).data.length, 1);
  assert.equal((await request('/api/tuition-reminders/:id/history', 'other', 'toan')).data.length, 0);
  assert.equal((await request('/api/tuition-reminders/:id/history', 'other', 'van')).status, 404);
  assert.deepEqual((await request('/api/tuition-reminders', 'other')).data.reminders, {});
  assert.deepEqual(branches, before);
});

test('general default template contains no amounts and custom wording remains intact', () => {
  assert.equal(resolveTuitionTemplate(''), DEFAULT_TUITION_TEMPLATE);
  assert.doesNotMatch(DEFAULT_TUITION_TEMPLATE, /tuitionDebt|hiện tại là:/);
  const old = 'Kính gửi Quý phụ huynh, {schoolName} thông báo học phí/tiền nợ của em {studentName}, lớp {className} hiện tại là: {tuitionDebt}.\nVui lòng hoàn thành sớm. Trân trọng!';
  assert.equal(resolveTuitionTemplate(old), DEFAULT_TUITION_TEMPLATE);
  assert.equal(resolveTuitionTemplate('Mời {studentName} hoàn thành học phí.'), 'Mời {studentName} hoàn thành học phí.');
});

test('scheduled reminders re-check cross-class history and cancel an old queued automatic send', async () => {
  const db = fixture();
  db.absences = [{ id: 'queued', studentId: 'toan', absenceStatus: 'Học phí', autoNotice: true,
    noticeStatus: 'Chờ gửi', noticeDueAt: '2026-10-14T07:00:00Z' }];
  let sent = 0, saved = 0;
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const context = { readDb: async () => ({ branches: { main: db } }), writeDb: async () => { saved++; },
    Date: class extends Date { static now() { return Date.parse(now); } },
    normalizeAbsenceStatus: value => value, buildTuitionReminders: value => build(value),
    sendZaloNotice: async () => { sent++; } };
  const start = source.indexOf('let noticeSchedulerRunning = false;');
  vm.runInNewContext(source.slice(start, source.indexOf('function getCell(', start)), context);
  await context.processDueNotices();
  assert.equal(sent, 0);
  assert.equal(saved, 1);
  assert.equal(db.absences[0].autoNotice, false);
  assert.equal(db.absences[0].noticeDueAt, '');
  assert.equal(db.notificationLogs.length, 1);
  db.notificationLogs[0].time = '2026-10-01T08:00:00Z';
  db.absences[0].autoNotice = true;
  db.absences[0].noticeStatus = 'Chờ gửi';
  db.absences[0].noticeDueAt = '2026-10-14T07:00:00Z';
  await context.processDueNotices();
  assert.equal(sent, 1, 'expired reminders do not suppress a scheduled tuition notice');
});
