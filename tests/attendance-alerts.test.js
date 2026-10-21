const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildAttendanceAlerts, alertRange, subjectForClass, registerAttendanceAlertRoutes } = require('../lib/attendance-alerts');

const now = new Date('2026-10-13T03:00:00Z');
const query = { endDate: '2026-10-13' };
const student = (overrides = {}) => ({ id: 's1', code: 'AUTO-ABC', fullName: 'Nguyễn An', className: '8T3M+', phone1: '0901234567', ...overrides });
const absence = (overrides = {}) => ({ id: 'a1', studentId: 's1', date: '2026-10-10', session: 'Tối', attendanceClass: '8T3M+', absenceStatus: 'Vắng', ...overrides });
const fixture = () => ({ students: [student()], absences: [absence(), absence({ id: 'a2', date: '2026-10-12' })], settings: { schoolName: 'Trung tâm' } });

test('two unexcused sessions alert by subject; excused, late, withdrawn and made-up states never count', () => {
  const db = fixture();
  db.absences.push(...['Có phép', 'Vắng có phép', 'Đi trễ', 'Về sớm', 'Nghỉ học', 'Đã bù', 'Học phí', 'Cả ngày', '', 'Vắng chưa rõ lý do']
    .map((absenceStatus, i) => absence({ id: `other${i}`, date: `2026-10-${String(i + 1).padStart(2, '0')}`, session: 'Sáng', absenceStatus })));
  let result = buildAttendanceAlerts(db, query, now);
  assert.equal(result.alerts.length, 1);
  assert.equal(result.alerts[0].count, 2);
  assert.equal(result.alerts[0].level, 'warning');
  db.absences.push(absence({ id: 'a3', date: '2026-10-13', absenceStatus: 'Vắng không phép' }));
  result = buildAttendanceAlerts(db, query, now);
  assert.equal(result.alerts[0].count, 3);
  assert.equal(result.alerts[0].level, 'danger');
  assert.equal(result.alerts[0].subject, 'Toán');
});

test('one math session plus one literature session does not trigger any alert', () => {
  const db = fixture();
  db.absences[1].attendanceClass = '8VT2';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.absences.push(absence({ id: 'a3', date: '2026-10-13', attendanceClass: '8NS3' }));
  const alerts = buildAttendanceAlerts(db, query, now).alerts;
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].count, 2);
  assert.equal(subjectForClass('8NS3').key, 'TOAN');
  assert.equal(subjectForClass('9KCCB').label, 'KHTN');
  assert.equal(subjectForClass('9AT2').label, 'Anh');
});

test('duplicate attendance saves and repeated contacts do not inflate sessions, but separate shifts count', () => {
  const db = fixture();
  db.absences.push(absence({ id: 'duplicate', session: 'Buổi Tối' }));
  db.notificationLogs = Array.from({ length: 5 }, (_, i) => ({ id: `n${i}`, absenceId: 'a1' }));
  db.callLogs = [{ absenceId: 'a1' }, { absenceId: 'a1' }];
  assert.equal(buildAttendanceAlerts(db, query, now).alerts[0].count, 2);
  db.absences.push(absence({ id: 'morning', session: 'Sáng' }));
  assert.equal(buildAttendanceAlerts(db, query, now).alerts[0].count, 3);
});

test('the newest correction to excused or present status removes a duplicated session', () => {
  const db = fixture();
  db.absences.push(absence({ id: 'correction', absenceStatus: 'Có phép', updatedAt: '2026-10-13T03:00:00Z' }));
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.absences.at(-1).absenceStatus = 'Đang học';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.absences.pop();
  db.absences[0].absenceStatus = 'Đã bù';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
});

test('30-day ranges include both boundary days and exclude future or invalid attendance dates', () => {
  assert.equal(alertRange(query, now).startDate, '2026-09-14');
  const db = fixture();
  db.absences = ['2026-09-13', '2026-09-14', '2026-10-13', '2026-10-14', '2026-02-30', 'invalid']
    .map((date, i) => absence({ id: `a${i}`, date }));
  assert.equal(buildAttendanceAlerts(db, query, now).alerts[0].count, 2);
  assert.equal(buildAttendanceAlerts(db, { ...query, period: 'all' }, now).alerts[0].count, 3);
  assert.equal(buildAttendanceAlerts(db, { ...query, period: 'month' }, now).alerts.length, 0);
  assert.equal(alertRange({}, new Date('2026-10-12T17:01:00Z')).endDate, '2026-10-13');
  for (const options of [{ period: 'bad' }, { endDate: '2026-02-30' }, { endDate: {} }]) {
    assert.throws(() => alertRange(options, now), error => error.status === 400);
  }
});

test('class transfers preserve counts per subject, including legacy records lacking a class snapshot', () => {
  const db = fixture();
  db.students[0].className = '8AT2';
  delete db.absences[0].attendanceClass;
  delete db.absences[1].attendanceClass;
  db.transferHistory = [{ studentId: 's1', fromClass: '8T3M+', toClass: '8AT2', date: '2026-10-13', timestamp: now.getTime() }];
  const result = buildAttendanceAlerts(db, query, now);
  assert.equal(result.alerts[0].subject, 'Toán');
  assert.deepEqual(result.alerts[0].classes, ['8T3M+']);
  assert.equal(result.alerts[0].currentClass, '8AT2');
  db.absences.push(absence({ id: 'new-math', date: '2026-10-13', attendanceClass: '8NT2' }));
  assert.equal(buildAttendanceAlerts(db, query, now).alerts[0].count, 3);
});

test('shared real student identities join enrollments; names or parent phones alone cannot join siblings', () => {
  const db = fixture();
  db.students.push(student({ id: 's2', code: 'AUTO-DEF', fullName: 'Nguyễn Bình' }));
  db.absences[1].studentId = 's2';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.students[1].fullName = 'Nguyễn An';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.students.forEach(row => { row.code = 'HS001'; });
  assert.equal(buildAttendanceAlerts(db, query, now).alerts[0].count, 2);
  db.students[1].fullName = 'Nguyễn Bình';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
});

test('unmapped classes are kept separate rather than combining unrelated subjects', () => {
  const db = fixture();
  db.absences[0].attendanceClass = 'CUSTOM-A';
  db.absences[1].attendanceClass = 'CUSTOM-B';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.absences.push(absence({ id: 'a3', date: '2026-10-13', attendanceClass: 'CUSTOM-A' }));
  assert.equal(buildAttendanceAlerts(db, { ...query, subject: 'OTHER' }, now).alerts.length, 1);
});

test('inactive students and orphan records are excluded, with accent-insensitive class and name filtering', () => {
  const db = fixture();
  const before = structuredClone(db);
  assert.equal(buildAttendanceAlerts(db, { ...query, q: 'nguyen an', subject: 'TOAN', className: '8T3M+' }, now).alerts.length, 1);
  assert.equal(buildAttendanceAlerts(db, { ...query, subject: 'V' }, now).alerts.length, 0);
  assert.equal(buildAttendanceAlerts(db, { ...query, q: '0901234567' }, now).alerts.length, 1);
  assert.deepEqual(db, before);
  db.students[0].status = 'Nghỉ học';
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.students[0].status = 'Đang học'; db.students[0].removedFromClass = true;
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
  db.students = [];
  assert.equal(buildAttendanceAlerts(db, query, now).alerts.length, 0);
});

function routesFixture() {
  const branches = { main: fixture(), other: { students: [], absences: [] } };
  const routes = new Map();
  let saves = 0;
  let counter = 0;
  let failSave = false;
  registerAttendanceAlertRoutes({
    get: (route, handler) => routes.set(`GET ${route}`, handler),
    post: (route, handler) => routes.set(`POST ${route}`, handler)
  }, {
    getBranchDb: async req => {
      const branch = branches[req.headers['x-branch-id']];
      if (!branch) { const error = new Error('Unknown branch'); error.status = 404; throw error; }
      return structuredClone(branch);
    },
    saveHandledAlert: async (req, action) => {
      if (failSave) throw new Error('Save failed');
      (branches[req.headers['x-branch-id']].attendanceAlertActions ||= []).push(structuredClone(action)); saves++;
    },
    nowISO: () => now.toISOString(), id: prefix => `${prefix}-${++counter}`,

  });
  const current = () => buildAttendanceAlerts(branches.main, query, now).alerts[0];
  async function request(action = '', body = {}, branch = 'main') {
    let response;
    const alert = current();
    const route = action ? `POST /api/attendance-alerts/:id/${action}` : 'GET /api/attendance-alerts';
    await routes.get(route)({
      headers: { 'x-branch-id': branch }, params: { id: alert?.id || 'missing' }, query,
      body: { ...query, revision: alert?.revision, requestId: 'request-12345678', ...body }, user: { username: 'teacher' }
    }, { json: data => { response = data; } }, error => { throw error; });
    return response;
  }
  return { branches, request, current, saves: () => saves, failSave: () => { failSave = true; } };
}

test('handled status persists, survives narrower date filters and reopens for a new or backdated session', async () => {
  const app = routesFixture();
  await app.request('handled', { note: 'Đã trao đổi với phụ huynh' });
  assert.equal(app.current().handled, true);
  assert.equal(app.current().handledBy, 'teacher');
  assert.equal(app.current().note, 'Đã trao đổi với phụ huynh');
  await app.request('handled');
  assert.equal(app.saves(), 1);
  assert.equal(buildAttendanceAlerts(app.branches.main, { ...query, status: 'pending' }, now).alerts.length, 0);
  assert.equal(buildAttendanceAlerts(app.branches.main, { ...query, status: 'handled' }, now).alerts.length, 1);
  app.branches.main.absences.push(absence({ id: 'new', date: '2026-10-11' }));
  assert.equal(app.current().handled, false);
  await app.request('handled');
  assert.equal(app.current().handled, true);
});

test('removed attendance is recomputed immediately without altering saved contact history', async () => {
  const app = routesFixture();
  await app.request('handled');
  app.branches.main.absences.pop();
  const actions = structuredClone(app.branches.main.attendanceAlertActions);
  assert.equal((await app.request()).alerts.length, 0);
  assert.deepEqual(app.branches.main.attendanceAlertActions, actions);
});

test('wrong branches, stale warnings and save failures cannot resolve an alert', async () => {
  const app = routesFixture();
  const before = structuredClone(app.branches);
  await assert.rejects(app.request('handled', {}, 'other'), error => error.status === 409);
  await assert.rejects(app.request('handled', { revision: 'stale' }), error => error.status === 409);
  await assert.rejects(app.request('handled', { period: 'invalid' }), error => error.status === 400);
  assert.deepEqual(app.branches, before);
  app.failSave();
  await assert.rejects(app.request('handled'), /Save failed/);
  assert.equal(app.current().handled, false);
});

test('handling updates only the alert action list and preserves concurrent attendance changes', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('async function saveHandledAttendanceAlert(');
  const branch = fixture();
  const writes = [];
  const context = {
    readDb: async () => ({ branches: { main: branch } }),
    resolveValidBranchId: () => 'main',
    getDatabase: () => ({ ref: route => ({ transaction: async callback => {
      writes.push(route);
      branch.absences[0].note = 'Another teacher changed attendance';
      const result = callback(branch.attendanceAlertActions);
      if (result) branch.attendanceAlertActions = result;
    } }) })
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, source.indexOf('registerAttendanceAlertRoutes(', start)), context);
  const action = { alertId: 'alert', sessionKeys: ['a', 'b'], username: 'teacher' };
  await context.saveHandledAttendanceAlert({}, action);
  await context.saveHandledAttendanceAlert({}, action);
  assert.equal(branch.attendanceAlertActions.length, 1);
  assert.equal(branch.absences[0].note, 'Another teacher changed attendance');
  assert.deepEqual(writes, ['/branches/main/attendanceAlertActions', '/branches/main/attendanceAlertActions']);
});

test('an attendance save from an older read retains a teacher resolution saved in the meantime', async () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'server.js'), 'utf8');
  const branch = fixture();
  const olderRead = structuredClone(branch);
  branch.attendanceAlertActions = [{ id: 'handled-1', alertId: 'alert', sessionKeys: ['a', 'b'] }];
  const rootDb = { branches: { main: branch } };
  olderRead.absences[0].note = 'Updated attendance';
  const { getDatabase } = require('./helpers/firebase').firebaseFixture(rootDb);
  const context = { getApps: () => [{}], getDatabase, defaultSettings: () => ({}), console };
  const vm = require('node:vm');
  vm.createContext(context);
  const offset = source.indexOf('const dbSnapshots = new WeakMap();');
  vm.runInContext(source.slice(offset, source.indexOf('function defaultSettings(', offset)), context);
  const req = { headers: {} };
  const read = await context.getBranchDb(req);
  read.absences[0].note = olderRead.absences[0].note;
  // Another request handles the alert after the attendance request's read.
  rootDb.branches.main.attendanceAlertActions.push({ id: 'handled-2', alertId: 'second', sessionKeys: ['c'] });
  await context.saveBranchDb(req, read);
  assert.equal(rootDb.branches.main.absences[0].note, 'Updated attendance');
  assert.equal(rootDb.branches.main.attendanceAlertActions[0].id, 'handled-1');
  assert.equal(rootDb.branches.main.attendanceAlertActions[1].id, 'handled-2');
});

