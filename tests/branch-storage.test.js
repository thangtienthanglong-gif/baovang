const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { firebaseFixture } = require('./helpers/firebase');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function setup(stored = { branches: { main: {
  students: [{ id: 's1', fullName: 'Original', className: '8A' }],
  absences: [{ id: 'a1', studentId: 's1', absenceStatus: 'Vắng', note: '' }]
}, other: { students: [{ id: 'other' }] } }, ketbu_state: { unrelated: 'not read' } }) {
  const fixture = firebaseFixture(stored);
  const context = { getApps: () => [{}], getDatabase: fixture.getDatabase, defaultSettings: () => ({}), console };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const dbSnapshots = new WeakMap();'), source.indexOf('function defaultSettings()')), context);
  const req = { headers: { 'x-branch-id': 'main' } };
  return { ...fixture, context, req, read: () => context.getBranchDb(req), save: db => context.saveBranchDb(req, db) };
}

test('a normal attendance read and save access only the selected branch', async () => {
  const app = setup();
  const db = await app.read();
  db.absences[0].absenceStatus = 'Có phép';
  await app.save(db);
  assert.equal(app.operations.filter(operation => operation.type === 'transaction').length, 0);
  assert.equal(app.operations.filter(operation => operation.type === 'read' && operation.path === '/branches/main').length, 1);
  const writes = app.operations.filter(operation => operation.type === 'update');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].changes, { 'absences/0/absenceStatus': 'Có phép' });
  assert.ok(writes[0].bytes < 100, 'a status update must not include the whole branch');
  assert.equal(app.stored.branches.main.absences[0].absenceStatus, 'Có phép');
  assert.equal(app.stored.branches.other.students[0].id, 'other');
  assert.equal(app.stored.ketbu_state.unrelated, 'not read');
});

test('simultaneous attendance additions and send logs are retained across stale reads', async () => {
  const app = setup();
  const first = await app.read(), second = await app.read();
  first.absences.push({ id: 'first', studentId: 's2' });
  first.notificationLogs.push({ id: 'log-first', absenceId: 'first', status: 'Đã gửi' });
  second.absences.push({ id: 'second', studentId: 's3' });
  second.notificationLogs.push({ id: 'log-second', absenceId: 'second', status: 'Chờ gửi thủ công' });
  await app.save(first);
  await app.save(second);
  assert.deepEqual(Object.values(app.stored.branches.main.absences).map(row => row.id), ['a1', 'first', 'second']);
  assert.deepEqual(Object.values(app.stored.branches.main.notificationLogs).map(row => row.id), ['log-first', 'log-second']);
});

test('a send confirmation retains concurrent notes, student edits and alert resolutions', async () => {
  const app = setup();
  const first = await app.read(), second = await app.read();
  first.absences[0].note = 'Teacher note';
  first.students[0].fullName = 'Edited name';
  second.absences[0].noticeStatus = 'Đã gửi';
  await app.save(first);
  app.stored.branches.main.attendanceAlertActions = [{ id: 'handled', sessionKeys: ['a1'] }];
  await app.save(second);
  const saved = app.stored.branches.main;
  assert.equal(saved.absences[0].note, 'Teacher note');
  assert.equal(saved.absences[0].noticeStatus, 'Đã gửi');
  assert.equal(saved.students[0].fullName, 'Edited name');
  assert.equal(saved.attendanceAlertActions[0].id, 'handled');
});

test('deleting an attendance record does not drop another request addition or resurrect a removed row', async () => {
  const app = setup();
  const deleting = await app.read(), editing = await app.read();
  deleting.absences = [];
  editing.absences[0].note = 'Late edit';
  app.stored.branches.main.absences.push({ id: 'newer', studentId: 's2' });
  await app.save(deleting);
  await assert.rejects(app.save(editing), error => error.status === 409);
  assert.deepEqual(Object.values(app.stored.branches.main.absences), [{ id: 'newer', studentId: 's2' }]);
});

test('an unknown branch is rejected without reading the root or creating a branch', async () => {
  const app = setup();
  await assert.rejects(app.context.getBranchDb({ headers: { 'x-branch-id': 'missing' } }), error => error.status === 404);
  assert.deepEqual(app.operations, [{ type: 'read', path: '/branches/missing' }]);
  assert.equal(app.stored.branches.missing, undefined);
});

test('a branch object cannot be saved to a different branch', async () => {
  const app = setup();
  const db = await app.read();
  db.absences[0].note = 'Changed';
  await assert.rejects(app.context.saveBranchDb({ headers: { 'x-branch-id': 'other' } }, db));
  assert.equal(app.operations.length, 1);
});

test('a branch deleted after reading cannot be recreated by a stale save', async () => {
  const app = setup();
  const db = await app.read();
  db.absences[0].note = 'Changed';
  delete app.stored.branches.main;
  await assert.rejects(app.save(db), error => error.status === 409);
  assert.equal(app.stored.branches.main, undefined);
});

test('repeated saves keep new keyed rows stable and retain logs appended by another request', async () => {
  const app = setup();
  const db = await app.read();
  db.notificationLogs.push({ id: 'local-log' });
  app.stored.branches.main.notificationLogs = { remote: { id: 'remote-log' } };
  await app.save(db);
  db.notificationLogs[0].status = 'Đã gửi';
  await app.save(db);
  await app.save(db);
  const reloaded = await app.read();
  assert.deepEqual(Array.from(reloaded.notificationLogs, row => row.id).sort(), ['local-log', 'remote-log']);
  assert.equal(reloaded.notificationLogs.find(row => row.id === 'local-log').status, 'Đã gửi');
});

test('partial attendance reads skip large send history and append logs without replacing unread history', async () => {
  const app = setup();
  app.stored.branches.main.settings = { zaloMode: 'personal-real' };
  app.stored.branches.main.notificationLogs = [{ id: 'old', message: 'x'.repeat(1000000) }];
  const db = await app.context.getBranchDb(app.req, ['students', 'absences', 'settings']);
  assert.ok(app.operations.every(operation => !operation.path.includes('notificationLogs')));
  db.notificationLogs.push({ id: 'new', status: 'Chờ gửi thủ công' });
  await app.save(db);
  assert.equal(Object.values(app.stored.branches.main.notificationLogs).length, 2);
  assert.ok(app.operations.find(operation => operation.type === 'update').bytes < 200);
  assert.equal((await app.read()).notificationLogs[0].message.length, 1000000);
});

test('root-based teacher saves preserve keyed attendance and concurrent edits', async () => {
  const app = setup();
  const branch = await app.read();
  branch.absences.push({ id: 'keyed', studentId: 's1' });
  await app.save(branch);
  const root = await app.context.readDb();
  root.branches.main.students[0].fullName = 'New teacher edit';
  const keyed = Object.values(app.stored.branches.main.absences).find(row => row.id === 'keyed');
  keyed.noticeStatus = 'Đã gửi';
  await app.context.writeDb(root);
  assert.equal(keyed.noticeStatus, 'Đã gửi');
  assert.equal(app.stored.branches.main.students[0].fullName, 'New teacher edit');
  assert.ok(app.operations.filter(operation => operation.type === 'update').every(operation => !Object.hasOwn(operation.changes, 'branches/main')));
});

test('two stale class additions retain both classes and remain arrays at the API boundary', async () => {
  const app = setup();
  const first = await app.read(), second = await app.read();
  first.classes = ['8A'];
  second.classes = ['9A'];
  await app.save(first);
  await app.save(second);
  assert.deepEqual(Array.from((await app.read()).classes), ['8A', '9A']);
});

test('send history preserves creation order across legacy arrays and new records with arbitrary IDs', async () => {
  const app = setup();
  app.stored.branches.main.notificationLogs = [{ id: 'legacy' }];
  let db = await app.read();
  db.notificationLogs.push({ id: 'z-first', time: '2026-10-21T00:00:00Z' });
  await app.save(db);
  db = await app.read();
  db.notificationLogs.push({ id: 'a-second', time: '2026-10-21T00:00:00Z' });
  await app.save(db);
  db = await app.read();
  db.notificationLogs[1].time = '2026-10-21T01:00:00Z';
  await app.save(db);
  assert.deepEqual(Array.from((await app.read()).notificationLogs, row => row.id), ['legacy', 'z-first', 'a-second']);
});

test('legacy root data still seeds the main branch on its first explicit save', async () => {
  const app = setup({ students: [{ id: 'legacy' }], absences: [], settings: {} });
  const db = await app.read();
  db.absences.push({ id: 'new', studentId: 'legacy' });
  await app.save(db);
  assert.equal(app.stored.branches.main.students[0].id, 'legacy');
  assert.equal(app.stored.branches.main.absences[0].id, 'new');
  assert.equal(app.stored.students[0].id, 'legacy');
});
