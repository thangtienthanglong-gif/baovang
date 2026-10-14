const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function setup() {
  const db = {
    absences: [{ id: 'a1', absenceStatus: 'Học phí' }, { id: 'a2', absenceStatus: 'Vắng' }],
    notificationLogs: [{ id: 'tuition-send', absenceId: 'a2', absenceStatus: 'Học phí' }],
    callLogs: [
      { id: 'absence', absenceId: 'a1', absenceStatus: 'Vắng', date: '2026-10-13', studentName: 'Kim', time: '2026-10-13T01:00:00Z' },
      { id: 'tuition', absenceId: 'a1', absenceStatus: 'Học phí', date: '2026-10-13', studentName: 'Ngọc', time: '2026-10-13T02:00:00Z' },
      { id: 'late-tuition', absenceStatus: 'Trễ học phí', date: '2026-10-13', studentName: 'Long' },
      { id: 'legacy-tuition', absenceId: 'a2', notificationLogId: 'tuition-send', date: '2026-10-13', studentName: 'Ngọc' },
      { id: 'unknown', date: '2026-10-13', studentName: 'Unknown' },
      { id: 'yesterday', absenceStatus: 'Học phí', date: '2026-10-12', studentName: 'Ngọc' }
    ]
  };
  const routes = new Map(), branches = { main: db, other: { absences: [], notificationLogs: [], callLogs: [] } };
  const context = {
    app: Object.fromEntries(['get', 'post', 'delete'].map(method => [method, (route, handler) => routes.set(`${method} ${route}`, handler)])),
    getBranchDb: async req => branches[req.branch], saveBranchDb: async () => {},
    cleanText: value => String(value ?? '').trim(), ABSENCE_STATUSES: ['Vắng', 'Học phí', 'Trễ học phí']
  };
  Object.assign(context, require('../lib/history-date-range'));
  vm.createContext(context);
  vm.runInContext(slice('function normalizeAbsenceStatus(', 'function normalizeInitialReason('), context);
  vm.runInContext(slice('function filterCallLogs(', 'function sendWorkbook('), context);
  vm.runInContext(slice("app.get('/api/call-logs'", "app.post('/api/call-logs/:id/result'"), context);
  return { db, async call(method, query, branch = 'main') {
    let data;
    await routes.get(`${method} /api/call-logs`)({ query, branch }, { json(value) { data = value; } }, error => { throw error; });
    return data;
  } };
}

test('call history separates tuition from absence, preserving snapshots and recovering legacy type', async () => {
  const app = setup();
  const before = structuredClone(app.db);
  const tuition = await app.call('get', { absenceStatus: 'Học phí', date: '2026-10-13' });
  assert.deepEqual(Array.from(tuition, row => row.id).sort(), ['late-tuition', 'legacy-tuition', 'tuition']);
  const absence = await app.call('get', { excludeAbsenceStatus: 'Học phí', date: '2026-10-13' });
  assert.deepEqual(Array.from(absence, row => row.id).sort(), ['absence', 'unknown']);
  assert.deepEqual(app.db, before);
  assert.equal((await app.call('get', { absenceStatus: 'Học phí' }, 'other')).length, 0);
});

test('tuition call deletion affects only its selected date and keyword, retaining absence calls and other dates', async () => {
  const app = setup();
  const result = await app.call('delete', { absenceStatus: 'Học phí', date: '2026-10-13', q: 'Ngọc' });
  assert.equal(result.deleted, 2);
  assert.deepEqual(app.db.callLogs.map(row => row.id), ['absence', 'late-tuition', 'unknown', 'yesterday']);
});

test('absence call deletion leaves all tuition calls intact', async () => {
  const app = setup();
  const result = await app.call('delete', { excludeAbsenceStatus: 'Học phí' });
  assert.equal(result.deleted, 2);
  assert.deepEqual(app.db.callLogs.map(row => row.id), ['tuition', 'late-tuition', 'legacy-tuition', 'yesterday']);
});
