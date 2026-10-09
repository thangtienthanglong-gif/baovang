const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function slice(source, start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  return source.slice(offset, source.indexOf(end, offset));
}

function setupServer(main = { students: [{ id: 's1', className: '9VT3' }], absences: [] }) {
  let stored = { branches: {
    main,
    other: { students: [], absences: [], classes: ['9VT6'] }
  } };
  const routes = new Map();
  const context = {
    app: Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    getApps: () => [{}],
    getDatabase: () => ({ ref: () => ({
      once: async () => ({ val: () => structuredClone(stored) }),
      update: async changes => {
        for (const [key, value] of Object.entries(changes)) {
          if (key.startsWith('branches/')) stored.branches[key.slice(9)] = structuredClone(value);
          else stored[key] = structuredClone(value);
        }
      }
    }) }),
    cleanText: value => String(value ?? '').replace(/\s+/g, ' ').trim(),
    isActiveStudent: student => student && student.status !== 'Nghỉ học',
    defaultSettings: () => ({}), publicSettings: value => value,
    filterAbsences: () => [], getSummary: () => ({}), todayISO: () => '2026-10-08',
    ABSENCE_STATUSES: [], console
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['const dbSnapshots = new WeakMap();', 'function defaultSettings()'],
    ['function getBranchClasses(', "app.put('/api/settings',"],
    ["app.post('/api/classes',", "app.get('/api/import/students/template'"]
  ]) vm.runInContext(slice(server, start, end), context);
  async function call(method, url, { branch = 'main', body = {}, className = '' } = {}) {
    let data;
    let status = 200;
    await routes.get(`${method} ${url}`)(
      { headers: { 'x-branch-id': branch }, query: {}, body, params: { className } },
      { status(value) { status = value; return this; }, json(value) { data = value; } },
      error => { throw error; }
    );
    return { data, status };
  }
  return { call, stored: () => stored };
}

test('an empty class persists across bootstrap reads in its selected branch', async () => {
  const app = setupServer();
  const result = await app.call('post', '/api/classes', { body: { className: ' 9vt6 ' } });
  assert.equal(result.status, 201);
  assert.equal(result.data.className, '9VT6');
  assert.deepEqual(app.stored().branches.main.classes, ['9VT6']);
  assert.equal(app.stored().branches.main.students.length, 1);
  assert.deepEqual(app.stored().branches.other.classes, ['9VT6']);
  const bootstrap = await app.call('get', '/api/bootstrap');
  assert.deepEqual(Array.from(bootstrap.data.classes), ['9VT3', '9VT6']);
  const other = await app.call('get', '/api/bootstrap', { branch: 'other' });
  assert.deepEqual(Array.from(other.data.classes), ['9VT6']);
});

test('legacy student classes remain available and duplicate codes are rejected', async () => {
  const app = setupServer();
  assert.deepEqual(Array.from((await app.call('get', '/api/bootstrap')).data.classes), ['9VT3']);
  await assert.rejects(app.call('post', '/api/classes', { body: { className: '9vt3' } }), error => error.status === 409);
  await app.call('post', '/api/classes', { body: { className: '9VT6' } });
  await assert.rejects(app.call('post', '/api/classes', { body: { className: ' 9vt6 ' } }), error => error.status === 409);
  assert.deepEqual(app.stored().branches.main.classes, ['9VT6']);
});

test('invalid codes and unknown branches cannot create a class', async () => {
  const app = setupServer();
  for (const className of ['', '  ', 'all', 'A'.repeat(51), 123, {}, null]) {
    await assert.rejects(app.call('post', '/api/classes', { body: { className } }), error => error.status === 400);
  }
  await assert.rejects(app.call('post', '/api/classes', { branch: 'missing', body: { className: '9VT6' } }), error => error.status === 404);
  assert.equal(app.stored().branches.main.classes, undefined);
});

test('single delete removes an empty class without touching the same code in another branch', async () => {
  const app = setupServer();
  await app.call('post', '/api/classes', { body: { className: '9VT6' } });
  const result = await app.call('delete', '/api/classes/:className', { className: '9vt6' });
  assert.equal(result.data.deletedCount, 0);
  assert.deepEqual(Array.from((await app.call('get', '/api/bootstrap')).data.classes), ['9VT3']);
  assert.deepEqual(app.stored().branches.other.classes, ['9VT6']);
});

test('bulk delete removes registered empty classes and student classes together', async () => {
  const app = setupServer();
  await app.call('post', '/api/classes', { body: { className: '9VT6' } });
  const result = await app.call('post', '/api/classes/bulk-delete', { body: { classNames: ['9vt3', '9vt6'] } });
  assert.equal(result.data.deletedStudents, 1);
  assert.deepEqual(Array.from((await app.call('get', '/api/bootstrap')).data.classes), []);
  assert.deepEqual(app.stored().branches.other.classes, ['9VT6']);
});

test('renaming a class preserves student IDs and linked attendance, makeup, exam and lesson records', async () => {
  const app = setupServer({
    classes: ['9VT3', '8ACC'],
    students: [{ id: 's1', className: '9VT3' }, { id: 's2', className: '9vt3', status: 'Nghỉ học' }, { id: 's3', className: '8ACC' }],
    absences: [{ id: 'a1', studentId: 's1', attendanceClass: '9VT3', absenceStatus: 'Vắng' }],
    scheduleExceptions: [{ studentId: 's1', originalClass: '9VT3', makeupClass: '8ACC' }, { studentId: 's3', originalClass: '8ACC', makeupClass: '9VT3' }],
    exams: [{ id: 'e1', className: '9VT3', scores: { s1: 8 } }],
    teaching_sessions: [{ id: 't1', className: '9VT3', lessonName: 'Bài 1' }],
    transferHistory: [{ studentId: 's1', fromClass: '8ACC', toClass: '9VT3' }],
    callLogs: [{ id: 'c1', className: '9VT3' }],
    notificationLogs: [{ id: 'n1', className: '9VT3', message: 'Lớp 9VT3' }]
  });
  const result = await app.call('put', '/api/classes/:className', { className: '9vt3', body: { className: ' 9vt6 ' } });
  assert.equal(result.data.className, '9VT6');
  assert.equal(result.data.updatedStudents, 2);
  const db = app.stored().branches.main;
  assert.deepEqual(db.students, [{ id: 's1', className: '9VT6' }, { id: 's2', className: '9VT6', status: 'Nghỉ học' }, { id: 's3', className: '8ACC' }]);
  assert.deepEqual(db.absences, [{ id: 'a1', studentId: 's1', attendanceClass: '9VT6', absenceStatus: 'Vắng' }]);
  assert.equal(db.scheduleExceptions[0].originalClass, '9VT6');
  assert.equal(db.scheduleExceptions[0].makeupClass, '8ACC');
  assert.equal(db.scheduleExceptions[1].makeupClass, '9VT6');
  assert.deepEqual(db.exams, [{ id: 'e1', className: '9VT6', scores: { s1: 8 } }]);
  assert.equal(db.teaching_sessions[0].className, '9VT6');
  assert.equal(db.transferHistory[0].toClass, '9VT6');
  assert.equal(db.callLogs[0].className, '9VT6');
  assert.equal(db.notificationLogs[0].className, '9VT6');
  assert.equal(db.notificationLogs[0].message, 'Lớp 9VT3');
  assert.deepEqual(app.stored().branches.other.classes, ['9VT6']);
  assert.deepEqual(Array.from((await app.call('get', '/api/bootstrap')).data.classes), ['8ACC', '9VT6']);
});

test('an empty class can be renamed and still persists after bootstrap', async () => {
  const app = setupServer();
  await app.call('post', '/api/classes', { body: { className: '8ACC' } });
  const result = await app.call('put', '/api/classes/:className', { className: '8ACC', body: { className: '8AS7' } });
  assert.equal(result.data.updatedStudents, 0);
  assert.deepEqual(Array.from((await app.call('get', '/api/bootstrap')).data.classes), ['8AS7', '9VT3']);
});

test('invalid, duplicate and missing class renames do not change stored data', async () => {
  const app = setupServer();
  await app.call('post', '/api/classes', { body: { className: '8ACC' } });
  const before = structuredClone(app.stored());
  for (const className of ['', ' ', 'all', 'A'.repeat(51), 123, {}, null]) {
    await assert.rejects(app.call('put', '/api/classes/:className', { className: '9VT3', body: { className } }), error => error.status === 400);
  }
  await assert.rejects(app.call('put', '/api/classes/:className', { className: '9VT3', body: { className: '8acc' } }), error => error.status === 409);
  await assert.rejects(app.call('put', '/api/classes/:className', { className: 'missing', body: { className: '9VT6' } }), error => error.status === 404);
  await assert.rejects(app.call('put', '/api/classes/:className', { branch: 'missing', className: '9VT3', body: { className: '9VT6' } }), error => error.status === 404);
  assert.deepEqual(app.stored(), before);
});

function setupEditForm(api) {
  const fields = {
    editClassModal: { dataset: { className: '9VT3', branchId: 'main' }, style: { display: 'flex' } },
    editClassCode: { value: ' 9vt6 ', focus() {}, disabled: false },
    saveClassCodeBtn: { disabled: false }, editClassCancelBtn: { disabled: false },
    editClassError: { style: {} }, searchClassInput: { value: '9VT3' }
  };
  const select = { value: '9VT3', options: [{ value: '9VT3', textContent: '9VT3 - 1 học sinh' }] };
  const context = {
    window: {}, document: { getElementById: id => fields[id], querySelectorAll: () => [select] },
    state: { classes: ['9VT3'], students: [{ id: 's1', className: '9VT3' }], absences: [{ id: 'a1', className: '9VT3', attendanceClass: '9VT3' }], scheduleExceptions: [{ originalClass: '9VT3', makeupClass: '8ACC' }] },
    getActiveBranch: () => 'main', api, rebuildQuickSearchIndex() {}, renderFilters() {},
    renderClassDropdown() {}, renderRoster() {}, renderStudentSelect() {}, renderAbsences() {}, renderManageClassList() {}, toast() {}
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'window.saveClassCode =', 'window.openManageClassesModal ='), context);
  return { context, fields, select, submit: () => context.window.saveClassCode({ preventDefault() {} }) };
}

test('editing submits once and updates the selected class, students and attendance after saving', async () => {
  let complete;
  let requests = 0;
  const form = setupEditForm(async (url, options) => {
    requests++;
    assert.equal(url, '/api/classes/9VT3');
    assert.equal(options.method, 'PUT');
    assert.equal(JSON.parse(options.body).className, '9VT6');
    return new Promise(resolve => { complete = resolve; });
  });
  const first = form.submit();
  assert.equal(form.fields.editClassCancelBtn.disabled, true);
  await form.submit();
  assert.equal(requests, 1);
  complete({ className: '9VT6', classes: ['9VT6'] });
  await first;
  assert.equal(form.context.state.students[0].id, 's1');
  assert.equal(form.context.state.students[0].className, '9VT6');
  assert.equal(form.context.state.absences[0].attendanceClass, '9VT6');
  assert.equal(form.context.state.scheduleExceptions[0].originalClass, '9VT6');
  assert.equal(form.select.value, '9VT6');
  assert.equal(form.fields.editClassModal.style.display, 'none');
  assert.equal(form.fields.saveClassCodeBtn.disabled, false);
});

test('a failed rename keeps the editor and input available for correction', async () => {
  const form = setupEditForm(async () => { throw new Error('Mã lớp đã tồn tại.'); });
  await form.submit();
  assert.equal(form.fields.editClassError.textContent, 'Mã lớp đã tồn tại.');
  assert.equal(form.fields.editClassCode.value, ' 9vt6 ');
  assert.equal(form.fields.editClassModal.style.display, 'flex');
  assert.equal(form.context.state.students[0].className, '9VT3');
  assert.equal(form.fields.editClassCode.disabled, false);
});

test('rename responses cannot change a newly selected branch', async () => {
  const form = setupEditForm(async () => {
    form.context.getActiveBranch = () => 'other';
    return { className: '9VT6', classes: ['9VT6'] };
  });
  await form.submit();
  assert.equal(form.context.state.students[0].className, '9VT3');
  assert.equal(form.select.value, '9VT3');
});

function setupForm(api) {
  const fields = {
    newClassCode: { value: ' 9vt6 ', focus() {}, disabled: false },
    createClassBtn: { disabled: false }, createClassError: { style: {} },
    searchClassInput: { value: '9VT3' }
  };
  const context = {
    window: {}, document: { getElementById: id => fields[id] }, state: { classes: ['9VT3'] },
    getActiveBranch: () => 'main', api, renderFilters() {}, renderClassDropdown() {}, renderManageClassList() {}, toast() {}
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'window.createClass =', 'window.openManageClassesModal ='), context);
  return { context, fields, submit: () => context.window.createClass({ preventDefault() {} }) };
}

test('the form submits once while saving and refreshes classes on success', async () => {
  let complete;
  let requests = 0;
  const form = setupForm(async (url, options) => {
    requests += 1;
    assert.equal(url, '/api/classes');
    assert.equal(JSON.parse(options.body).className, '9VT6');
    return new Promise(resolve => { complete = resolve; });
  });
  const first = form.submit();
  assert.equal(form.fields.createClassBtn.disabled, true);
  await form.submit();
  assert.equal(requests, 1);
  complete({ className: '9VT6', classes: ['9VT3', '9VT6'] });
  await first;
  assert.deepEqual(form.context.state.classes, ['9VT3', '9VT6']);
  assert.equal(form.fields.newClassCode.value, '');
  assert.equal(form.fields.searchClassInput.value, '');
  assert.equal(form.fields.createClassBtn.disabled, false);
});

test('a failed save keeps the code and shows an error without adding a class', async () => {
  const form = setupForm(async () => { throw new Error('Mã lớp đã tồn tại.'); });
  await form.submit();
  assert.equal(form.fields.newClassCode.value, ' 9vt6 ');
  assert.equal(form.fields.createClassError.textContent, 'Mã lớp đã tồn tại.');
  assert.equal(form.fields.createClassError.style.display, 'block');
  assert.deepEqual(form.context.state.classes, ['9VT3']);
  assert.equal(form.fields.createClassBtn.disabled, false);
});

test('a response from a previous branch does not change the current class list', async () => {
  const form = setupForm(async () => {
    form.context.getActiveBranch = () => 'other';
    return { className: '9VT6', classes: ['9VT3', '9VT6'] };
  });
  await form.submit();
  assert.deepEqual(form.context.state.classes, ['9VT3']);
});

test('attendance choices include a registered class with zero students', () => {
  const fields = { classDropdown: { value: 'ALL' }, classCount: {}, classDropdownMeta: {} };
  const context = {
    state: { classes: ['9VT6'], absences: [] }, $: selector => fields[selector.slice(1)],
    selectedDate: () => '2026-10-08', selectedDay: () => 'ALL', selectedClass: () => 'ALL', selectedSession: () => 'ALL',
    attendanceRosterStudents: () => [], groupByClass: () => ({}), getClassGrade: () => '9',
    getClassScheduleInfo: () => ({ matchesDate: true, sessionName: 'Tối' }), escapeHtml: value => value
  };
  vm.createContext(context);
  vm.runInContext(slice(frontend, 'function renderClassDropdown(', 'function renderRoster('), context);
  context.renderClassDropdown();
  assert.match(fields.classDropdown.innerHTML, /9VT6 - 0 học sinh/);
  assert.equal(fields.classCount.textContent, '1 lớp');
});
