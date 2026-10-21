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
  assert.deepEqual(app.operations, [
    { type: 'read', path: '/branches/main' },
    { type: 'transaction', path: '/branches/main' }
  ]);
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
  assert.deepEqual(app.stored.branches.main.absences.map(row => row.id), ['a1', 'first', 'second']);
  assert.deepEqual(app.stored.branches.main.notificationLogs.map(row => row.id), ['log-first', 'log-second']);
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
  await app.save(editing);
  assert.deepEqual(app.stored.branches.main.absences, [{ id: 'newer', studentId: 's2' }]);
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

test('Firebase transaction retries merge against the newer branch without duplicating logs', async () => {
  const app = setup();
  const db = await app.read();
  db.notificationLogs.push({ id: 'local-log' });
  const live = app.stored.branches.main;
  app.context.getDatabase = () => ({ ref: () => ({ transaction: async callback => {
    assert.equal(callback(null), null);
    callback(structuredClone(live)); // A rejected attempt must have no side effects.
    live.notificationLogs = [{ id: 'remote-log' }];
    const next = callback(structuredClone(live));
    assert.deepEqual(Array.from(next.notificationLogs, row => row.id), ['remote-log', 'local-log']);
    return { committed: true, snapshot: { val: () => next } };
  } }) });
  await app.save(db);
  assert.deepEqual(Array.from(db.notificationLogs, row => row.id), ['local-log']);
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
