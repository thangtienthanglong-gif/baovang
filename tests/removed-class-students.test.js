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
  const sameName = 'Nguyễn An';
  let stored = { branches: {
    main: {
      students: [{ id: 's1', fullName: sameName, className: '7C26M' }, { id: 's2', fullName: sameName, className: '7AS7' }],
      absences: [{ id: 'a1', studentId: 's1', attendanceClass: '7C26M', noticeStatus: 'Chờ gửi', autoNotice: true, noticeDueAt: 'later' }, { id: 'sent', studentId: 's1', noticeStatus: 'Đã gửi' }],
      notificationLogs: [{ studentId: 's1', status: 'Chờ gửi thủ công' }, { studentId: 's1', status: 'Đã gửi', message: 'Thông báo cũ' }],
      exams: [{ className: '7C26M', scores: [{ studentId: 's1', score: 8 }] }],
      evaluations: [{ studentId: 's1', status: 'Tốt (T)' }],
      scheduleExceptions: [{ studentId: 's1', originalClass: '7C26M', makeupClass: '7AS7' }]
    },
    other: { students: [{ id: 's1', fullName: sameName, className: '7C26M' }], absences: [] }
  } };
  const routes = new Map();
  const context = {
    app: Object.fromEntries(['get', 'post'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    getApps: () => [{}], getDatabase: () => ({ ref: () => ({
      once: async () => ({ val: () => structuredClone(stored) }),
      update: async changes => {
        for (const [key, value] of Object.entries(changes)) stored.branches[key.slice(9)] = structuredClone(value);
      }
    }) }),
    cleanText: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
    defaultSettings: () => ({}), normalizeAbsenceStatus: value => value,
    normalizeSearchText: value => String(value || '').toLowerCase(),
    nowISO: () => '2026-10-09T04:00:00Z', console
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['const dbSnapshots = new WeakMap();', 'function defaultSettings()'],
    ['function isActiveStudent(', 'function quitStudentDetails('],
    ['function getBranchClasses(', "app.get('/api/bootstrap'"],
    ["app.get('/api/removed-class-students'", "app.post('/api/students/:id/transfer'"],
    ["app.post('/api/exams'", "app.delete('/api/exams/:id'"]
  ]) vm.runInContext(slice(server, start, end), context);
  async function remove({ branch = 'main', id = 's1', className = '7C26M' } = {}) {
    let data;
    await routes.get('post /api/students/:id/remove-from-class')(
      { headers: { 'x-branch-id': branch }, body: { className }, params: { id } },
      { json(value) { data = value; } }, error => { throw error; }
    );
    return data;
  }
  async function history({ branch = 'main', date = '', q = '' } = {}) {
    let data;
    await routes.get('get /api/removed-class-students')(
      { headers: { 'x-branch-id': branch }, query: { date, q } },
      { json(value) { data = value; } }, error => { throw error; }
    );
    return data;
  }
  async function saveExam(body) {
    let data;
    await routes.get('post /api/exams')(
      { headers: { 'x-branch-id': 'main' }, body },
      { json(value) { data = value; } }, error => { throw error; }
    );
    return data;
  }
  return { context, remove, history, saveExam, stored: () => stored };
}

test('removing a name affects only its enrollment and branch while preserving history and the empty class', async () => {
  const app = setupServer();
  const before = structuredClone(app.stored());
  const result = await app.remove();
  const db = app.stored().branches.main;
  assert.equal(result.success, true);
  assert.equal(db.students[0].removedFromClass, true);
  assert.equal(db.students[0].removedFromClassAt, '2026-10-09T04:00:00Z');
  assert.equal(db.students[0].className, '7C26M');
  assert.equal(app.context.isActiveStudent(db.students[0]), false);
  assert.deepEqual(db.students[1], before.branches.main.students[1]);
  assert.deepEqual(app.stored().branches.other, before.branches.other);
  for (const key of ['exams', 'evaluations', 'scheduleExceptions']) assert.deepEqual(db[key], before.branches.main[key]);
  assert.equal(db.absences.length, 2);
  assert.equal(db.absences[0].noticeStatus, 'Không gửi');
  assert.equal(db.absences[0].autoNotice, false);
  assert.equal(db.absences[0].noticeDueAt, '');
  assert.deepEqual(db.absences[1], before.branches.main.absences[1]);
  assert.equal(db.notificationLogs[0].status, 'Không gửi');
  assert.deepEqual(db.notificationLogs[1], before.branches.main.notificationLogs[1]);
  assert.ok(result.classes.includes('7C26M'));
  assert.equal(db.classRemovalHistory.length, 1);
  assert.equal(db.classRemovalHistory[0].studentId, 's1');
  assert.equal(db.classRemovalHistory[0].removedDate, '2026-10-09');
});

test('removal creates a separate history entry without any absence and keeps the original class snapshot', async () => {
  const app = setupServer();
  app.stored().branches.main.absences = [];
  await app.remove();
  assert.equal(app.stored().branches.main.absences.length, 0);
  app.stored().branches.main.students[0].className = '7NEW';
  const history = await app.history({ date: '2026-10-09', q: '7c26m' });
  assert.equal(history.length, 1);
  assert.equal(history[0].className, '7C26M');
  assert.equal(history[0].fullName, 'Nguyễn An');
  assert.equal((await app.history({ date: '2026-10-08' })).length, 0);
  assert.equal((await app.history({ branch: 'other' })).length, 0);
});

test('saving class exam scores later preserves scores of removed students', async () => {
  const app = setupServer();
  app.stored().branches.main.exams[0].id = 'exam1';
  await app.remove();
  const exam = await app.saveExam({ id: 'exam1', className: '7C26M', examName: 'Bài kiểm tra', date: '2026-10-09', scores: [{ studentId: 's2', score: 9 }] });
  assert.deepEqual(Array.from(exam.scores, row => ({ ...row })), [{ studentId: 's2', score: 9 }, { studentId: 's1', score: 8 }]);
});

test('missing students, mismatched classes, invalid inputs and unknown branches cannot remove anyone', async () => {
  const app = setupServer();
  const before = structuredClone(app.stored());
  for (const [options, status] of [
    [{ id: 'missing' }, 404], [{ className: '7AS7' }, 409],
    [{ className: '' }, 400], [{ className: {} }, 400], [{ branch: 'missing' }, 404]
  ]) await assert.rejects(app.remove(options), error => error.status === status);
  assert.deepEqual(app.stored(), before);
});

test('repeated removal is idempotent', async () => {
  const app = setupServer();
  await app.remove();
  const before = structuredClone(app.stored());
  await app.remove();
  assert.deepEqual(app.stored(), before);
});

function setupFrontend(confirmed, api) {
  const student = { id: 's1', fullName: 'Nguyễn An', className: '7C26M' };
  const select = { value: 'REMOVE_FROM_CLASS', dataset: { studentId: 's1', attendanceClass: '7C26M', absenceId: 'a1' } };
  const context = {
    state: { students: [student], classes: ['7C26M'], absences: [{ id: 'a1', studentId: 's1' }] },
    normalizeAbsenceStatus: value => value, absenceForStudent: () => ({ absenceStatus: 'Vắng' }),
    confirm: () => confirmed, getActiveBranch: () => 'main', api,
    rebuildQuickSearchIndex() {}, renderClassDropdown() {}, renderRoster() {}, renderStudentSelect() {}, renderAbsences() {},
    loadBootstrap: async () => {}, toast() {}
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'async function updateRosterStatus(', 'function bulkZaloMessage('), context);
  return { context, student, select, submit: () => context.updateRosterStatus(select) };
}

test('canceling removal restores the previous status and makes no request', async () => {
  let calls = 0;
  const form = setupFrontend(false, async () => { calls++; });
  await form.submit();
  assert.equal(calls, 0);
  assert.equal(form.select.value, 'Vắng');
  assert.equal(form.student.removedFromClass, undefined);
});

test('confirmed removal uses its own endpoint without creating an absence', async () => {
  const form = setupFrontend(true, async (url, options) => {
    assert.equal(url, '/api/students/s1/remove-from-class');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { className: '7C26M' });
    return { student: { removedFromClass: true }, classes: ['7C26M'] };
  });
  await form.submit();
  assert.equal(form.student.removedFromClass, true);
  assert.equal(form.context.state.absences[0].studentRemovedFromClass, true);
  assert.equal(form.context.state.absences.length, 1);
});

test('a failed removal preserves the student and a response from another branch cannot change state', async () => {
  const failed = setupFrontend(true, async () => { throw new Error('Không thể lưu'); });
  await assert.rejects(failed.submit(), /Không thể lưu/);
  assert.equal(failed.student.removedFromClass, undefined);
  const changed = setupFrontend(true, async () => {
    changed.context.getActiveBranch = () => 'other';
    return { student: { removedFromClass: true }, classes: [] };
  });
  await changed.submit();
  assert.equal(changed.student.removedFromClass, undefined);
});

test('removed names are excluded from active students and quick-search rosters', () => {
  const context = { state: { students: [{ id: 'removed', removedFromClass: true }, { id: 'active' }] } };
  vm.runInNewContext(slice(frontend, 'function isActiveStudent(', 'function normalizeAbsenceStatus('), context);
  assert.deepEqual(Array.from(context.activeStudents(), row => row.id), ['active']);
});

test('the removal choice appears in regular student statuses and stays out of makeup attendance', () => {
  const context = {
    state: { scheduleExceptions: [] }, absenceForStudent: () => null,
    normalizeAbsenceStatus: value => value, absenceStatusLabel: value => value,
    selectedDate: () => '2026-10-09', selectedDay: () => 'ALL', escapeHtml: value => value
  };
  vm.runInNewContext(slice(frontend, 'function renderRosterStudent(', 'function noticeTimeLine('), context);
  const student = { id: 's1', className: '7C26M', fullName: 'Nguyễn An' };
  assert.match(context.renderRosterStudent(student), /value="REMOVE_FROM_CLASS"[^>]*>Xóa khỏi danh sách lớp/);
  assert.doesNotMatch(context.renderRosterStudent({ ...student, isMakeupAttendance: true }), /REMOVE_FROM_CLASS/);
});
