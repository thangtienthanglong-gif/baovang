const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { firebaseFixture } = require('./helpers/firebase');
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function slice(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}

for (const status of ['Đã bù', 'Nghỉ học']) {
  test(`partial attendance reads still cancel queued logs for ${status}`, async () => {
    const stored = { branches: { main: {
      settings: { zaloMode: 'personal-real', zaloDelayMinutes: 10 },
      students: [{ id: 's1', className: '8A', status: 'Đang học' }],
      absences: [{ id: 'a1', studentId: 's1', date: '2026-10-21', attendanceClass: '8A', absenceStatus: 'Vắng', noticeStatus: 'Chờ gửi' }],
      notificationLogs: [{ id: 'n1', studentId: 's1', absenceId: 'a1', status: 'Chờ gửi thủ công' }]
    } } };
    const fixture = firebaseFixture(stored);
    let handler;
    const context = {
      getDatabase: fixture.getDatabase, getApps: () => [{}], defaultSettings: () => ({}), console,
      app: { put: (_route, callback) => { handler = callback; } }, requireFields() {},
      normalizeAbsenceStatus: value => value, normalizeInitialReason: value => value || '',
      cleanText: value => String(value || ''), nowISO: () => '2026-10-21T00:00:00Z',
      isWithdrawnAbsence: row => row.absenceStatus === 'Nghỉ học',
      enrichAbsence: row => row, studentByIdMap: () => ({})
    };
    vm.createContext(context);
    for (const [start, end] of [
      ['const dbSnapshots = new WeakMap();', 'function defaultSettings()'],
      ['function markStudentWithdrawn(', 'function enrichAbsence('],
      ["app.put('/api/absences/:id/status'", 'function selectBulkZaloCandidates(']
    ]) vm.runInContext(slice(start, end), context);
    await handler({ headers: { 'x-branch-id': 'main' }, params: { id: 'a1' },
      body: { absenceStatus: status, sendZalo: false } }, { json() {} }, error => { throw error; });
    assert.equal(stored.branches.main.notificationLogs[0].status, 'Không gửi');
    assert.equal(stored.branches.main.absences[0].autoNotice, false);
    assert.equal(fixture.operations.filter(operation => operation.type === 'transaction').length, 0);
    assert.equal(fixture.operations.filter(operation => operation.type === 'update').length, 1);
  });
}
