const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const page = fs.readFileSync(path.join(__dirname, '..', 'public/ketbu_eval.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const branch = 'branch_1791031403300';
const student = { id: 's1', fullName: 'HS 01', className: '9T246A', status: 'Đang học' };
const backend = {};
vm.runInNewContext(server.slice(server.indexOf('function getBranchId(req)'), server.indexOf('async function getBranchDb(')), backend);

function setup() {
  const storage = new Map([['token', 'session-token'], ['activeBranch', branch]]);
  const fields = Object.fromEntries(['className', 'gradeFilter', 'subjectFilter', 'dayFilter', 'sessionFilter', 'teacherName', 'shiftName', 'partName', 'startBtn', 'classLoadError', 'retryLoadClassesBtn'].map(id => [id, {
    value: ['gradeFilter', 'subjectFilter', 'dayFilter', 'sessionFilter'].includes(id) ? 'ALL' : '',
    innerHTML: '', textContent: '', hidden: true, disabled: false, listeners: [],
    addEventListener(type, fn) { this.listeners.push({ type, fn }); }
  }]));
  const requests = [];
  let failure = null;
  const context = {
    document: { getElementById: id => fields[id] }, window: {}, console: { error() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: async (url, options) => {
      const headers = new Headers(options.headers);
      requests.push({ url, headers });
      if (failure) return { ok: false, status: 403, json: async () => ({ error: failure }) };
      try {
        assert.equal(headers.get('authorization'), 'Bearer session-token');
        const selected = backend.resolveValidBranchId({ headers: Object.fromEntries(headers) }, { branches: { [branch]: {} } });
        assert.equal(selected, branch);
        return { ok: true, status: 200, json: async () => [student, { ...student, id: 'quit', className: '8T246B', status: 'Nghỉ học' }] };
      } catch (error) {
        return { ok: false, status: error.status || 400, json: async () => ({ error: error.message }) };
      }
    }
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['    function getBranchId()', '    function showCustomConfirm('],
    ['    function escapeClassText(', "    if (document.readyState === 'loading')"]
  ]) {
    const from = page.indexOf(start), to = page.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    vm.runInContext(page.slice(from, to), context);
  }
  context.setCurrentScheduleFilters = () => {};
  return { context, fields, requests, storage, fail: message => { failure = message; } };
}

test('teaching class loading sends a single valid branch header accepted by the backend', async () => {
  const app = setup();
  await app.context.loadClasses();
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/students');
  assert.equal(app.requests[0].headers.get('x-branch-id'), branch);
  assert.match(app.fields.className.innerHTML, /9T246A/);
  assert.doesNotMatch(app.fields.className.innerHTML, /8T246B/);
  assert.equal(app.fields.startBtn.disabled, false);
  assert.equal(app.fields.classLoadError.hidden, true);
  assert.equal(app.fields.retryLoadClassesBtn.hidden, true);
});

test('a class load error explains the problem and a retry restores the list without losing the login', async () => {
  const app = setup();
  app.fail('Bạn không có quyền truy cập cơ sở này.');
  await app.context.loadClasses();
  assert.match(app.fields.className.innerHTML, /Lỗi tải danh sách lớp/);
  assert.equal(app.fields.classLoadError.hidden, false);
  assert.match(app.fields.classLoadError.textContent, /không có quyền/);
  assert.equal(app.fields.retryLoadClassesBtn.hidden, false);
  assert.equal(app.fields.retryLoadClassesBtn.disabled, false);
  assert.equal(app.fields.startBtn.disabled, true);
  assert.equal(app.storage.get('token'), 'session-token');
  app.fail(null);
  await app.context.loadClasses();
  assert.match(app.fields.className.innerHTML, /9T246A/);
  assert.equal(app.fields.classLoadError.hidden, true);
  assert.equal(app.fields.classLoadError.textContent, '');
  assert.equal(app.fields.retryLoadClassesBtn.hidden, true);
  assert.equal(app.fields.startBtn.disabled, false);
});

test('reloading classes keeps one filter handler and disables starting when no class matches', async () => {
  const app = setup();
  await app.context.loadClasses();
  await app.context.loadClasses();
  assert.equal(app.fields.gradeFilter.listeners.length, 0);
  assert.equal(typeof app.fields.gradeFilter.onchange, 'function');
  app.fields.gradeFilter.value = '8';
  app.fields.gradeFilter.onchange();
  assert.match(app.fields.className.innerHTML, /Không có lớp phù hợp/);
  assert.equal(app.fields.startBtn.disabled, true);
});

test('switching branches during loading cannot show students from the previous branch', async () => {
  const app = setup();
  const fetch = app.context.fetch;
  app.context.fetch = async (...args) => {
    const response = await fetch(...args);
    app.storage.set('activeBranch', 'other');
    return response;
  };
  await app.context.loadClasses();
  assert.equal(app.context.window.allStudentsList.length, 0);
  assert.equal(app.fields.startBtn.disabled, true);
  assert.equal(app.fields.classLoadError.hidden, false);
  assert.match(app.fields.classLoadError.textContent, /Chi nhánh đã thay đổi/);
});

test('teaching actions share the fixed branch header and keep their JSON body', async () => {
  const app = setup();
  const body = { className: student.className, shift: 'Ca 1' };
  const fetch = app.context.fetch;
  let submitted;
  app.context.fetch = (url, options) => { submitted = options; return fetch(url, options); };
  await app.context.apiRequest('/api/teaching-sessions', 'POST', body);
  assert.equal(submitted.method, 'POST');
  assert.deepEqual(JSON.parse(submitted.body), body);
  assert.equal(app.requests[0].headers.get('x-branch-id'), branch);
});
