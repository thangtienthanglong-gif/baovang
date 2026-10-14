const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const dates = require('../lib/history-date-range');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function setup() {
  const branches = { main: {
    students: ['09', '10', '11', '12', '13'].map(day => ({ id: `s${day}`, status: 'Nghỉ học', fullName: 'An', quitDate: `2026-10-${day}` })),
    absences: [{ id: 'legacy', studentId: 'legacy', absenceStatus: 'Nghỉ học', date: '2026-10-12', note: 'Chuyển trường' }],
    callLogs: ['09', '10', '11', '12', '13'].map(day => ({ id: `c${day}`, absenceStatus: 'Vắng', date: `2026-10-${day}`, time: `2026-10-${day}T10:00:00Z` })),
    notificationLogs: ['09', '10', '11', '12', '13'].map(day => ({ id: `n${day}`, absenceStatus: 'Vắng', date: `2026-10-${day}`, time: `2026-10-${day}T10:00:00Z` }))
  }, other: { students: [{ id: 's10', status: 'Nghỉ học', quitDate: '2026-10-10' }], callLogs: [], notificationLogs: [] } };
  branches.main.students.push({ id: 'legacy', fullName: 'An', status: 'Nghỉ học' },
    { id: 'unknown', fullName: 'An', status: 'Nghỉ học' }, { id: 'active', fullName: 'An', status: 'Đang học' });
  const routes = new Map();
  let saves = 0;
  const context = {
    ...dates, cleanText: value => String(value ?? '').trim(), normalizeAbsenceStatus: value => value,
    normalizeSearchText: value => String(value ?? '').toLowerCase(),
    getBranchDb: async req => branches[req.branch], saveBranchDb: async () => { saves++; },
    app: Object.fromEntries(['get', 'delete'].map(method => [method, (route, handler) => routes.set(`${method} ${route}`, handler)]))
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function quitStudentDetails(', 'function markStudentWithdrawn('],
    ['function filterCallLogs(', 'function sendWorkbook('],
    ['function filterQuitStudents(', 'async function saveHandledAttendanceAlert('],
    ['function filterRemovedClassStudents(', "app.post('/api/students/:id/remove-from-class'"],
    ["app.get('/api/call-logs'", "app.post('/api/call-logs/:id/result'"],
    ["app.delete('/api/notification-logs'", '// ==================== AUTHENTICATION & USERS']
  ]) {
    const offset = source.indexOf(start), finish = source.indexOf(end, offset);
    assert.ok(offset >= 0 && finish > offset);
    vm.runInContext(source.slice(offset, finish), context);
  }
  return { context, branches, saves: () => saves, async remove(route, query) {
    let response;
    await routes.get(`delete ${route}`)({ branch: 'main', query }, { json: value => { response = value; } }, error => { throw error; });
    return response;
  } };
}

test('intervals support inclusive, one-sided, all-date and legacy single-date filters', () => {
  assert.equal(dates.matchesHistoryDate('2026-10-10', dates.historyDateRange({ dateStart: '2026-10-10', dateEnd: '2026-10-12' })), true);
  assert.equal(dates.matchesHistoryDate('2026-10-12', dates.historyDateRange({ dateStart: '2026-10-10', dateEnd: '2026-10-12' })), true);
  assert.equal(dates.matchesHistoryDate('2026-10-09', dates.historyDateRange({ dateStart: '2026-10-10' })), false);
  assert.equal(dates.matchesHistoryDate('2026-10-13', dates.historyDateRange({ dateEnd: '2026-10-12' })), false);
  assert.equal(dates.matchesHistoryDate('', dates.historyDateRange({})), true);
  assert.equal(dates.matchesHistoryDate('', dates.historyDateRange({ dateEnd: '2026-10-12' })), false);
  assert.equal(dates.matchesHistoryDate('2026-10-11', dates.historyDateRange({ date: '2026-10-10' })), false);
  for (const query of [{ dateStart: '2026-10-14', dateEnd: '2026-10-01' }, { dateEnd: '2026-02-30' }, { dateStart: {} }]) {
    assert.throws(() => dates.historyDateRange(query), error => error.status === 400);
  }
});

test('tuition ranges use Vietnam send days and call ranges retain original notice dates', () => {
  const app = setup();
  const db = app.branches.main;
  db.notificationLogs = [
    { id: 'start', absenceStatus: 'Học phí', date: '2026-09-01', time: '2026-10-09T17:00:00Z' },
    { id: 'end', absenceStatus: 'Học phí', date: '2026-09-01', time: '2026-10-12T16:59:59Z' },
    { id: 'outside', absenceStatus: 'Học phí', date: '2026-10-12', time: '2026-10-12T17:00:00Z' },
    { id: 'source', absenceStatus: 'Vắng', date: '2026-10-10', time: '2026-10-13T10:00:00Z' }
  ];
  const range = { dateStart: '2026-10-10', dateEnd: '2026-10-12' };
  assert.deepEqual(Array.from(app.context.filterNotificationLogs(db, { ...range, absenceStatus: 'Học phí', dateBasis: 'time' }), row => row.id), ['end', 'start']);
  db.callLogs = [{ id: 'linked', notificationLogId: 'source', date: '2026-10-13', time: '2026-10-13T10:00:00Z' }];
  assert.equal(app.context.filterCallLogs(db, range).length, 1);
  assert.equal(app.context.filterCallLogs(db, range)[0].date, '2026-10-10');
});

test('filtered deletion preserves other dates, branches, unknown withdrawal dates and active students', async () => {
  const app = setup();
  const other = structuredClone(app.branches.other);
  const range = { dateStart: '2026-10-10', dateEnd: '2026-10-12' };
  const quitRows = app.context.filterQuitStudents(app.branches.main, range);
  assert.equal(quitRows.length, 4);
  assert.equal(quitRows.find(row => row.id === 'legacy').quitReason, 'Chuyển trường');
  await app.remove('/api/quit-students/clear', range);
  assert.deepEqual(app.branches.main.students.map(row => row.id), ['s09', 's13', 'unknown', 'active']);
  await app.remove('/api/call-logs', range);
  assert.deepEqual(app.branches.main.callLogs.map(row => row.id), ['c09', 'c13']);
  await app.remove('/api/notification-logs', range);
  assert.deepEqual(app.branches.main.notificationLogs.map(row => row.id), ['n09', 'n13']);
  assert.deepEqual(app.branches.other, other);
});

test('invalid intervals reject destructive requests before saving anything', async () => {
  const app = setup();
  const before = structuredClone(app.branches);
  for (const route of ['/api/quit-students/clear', '/api/call-logs', '/api/notification-logs']) {
    await assert.rejects(app.remove(route, { dateStart: '2026-10-14', dateEnd: '2026-10-01' }), error => error.status === 400);
  }
  assert.equal(app.saves(), 0);
  assert.deepEqual(app.branches, before);
});
