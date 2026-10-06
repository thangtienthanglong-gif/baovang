const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const apiSource = source.slice(source.indexOf('async function api(path, options = {}) {'), source.indexOf('window.apiJson = api;'));
const editStart = source.indexOf("document.addEventListener('submit', async (e) => {");
const editEnd = source.indexOf("  if (e.target && e.target.id === 'transferClassForm')", editStart);
const editSource = source.slice(editStart, editEnd) + '\n});';

function setup(fetch) {
  const storage = new Map([['token', 'test-session-token'], ['user', 'test-user'], ['activeBranch', 'branch-two']]);
  const context = {
    Headers, fetch,
    localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
    window: { location: { href: '/', pathname: '/' } },
    getToken: () => storage.get('token'), getActiveBranch: () => storage.get('activeBranch')
  };
  vm.createContext(context);
  vm.runInContext(apiSource, context);
  return { context, storage };
}

const response = (status, data) => ({ status, ok: status >= 200 && status < 300, async json() { return data; } });

test('saving the edit student form keeps authentication and the selected branch', async () => {
  const saved = { id: 'student-1', fullName: 'Tên đã sửa', code: 'TEST-1', className: '6VT3', parentName: 'Trường chính', phone1: '0900000000' };
  const requests = [];
  const { context, storage } = setup(async (url, options) => {
    requests.push({ url, options });
    if (options.headers.get('authorization') !== 'Bearer test-session-token') return response(401, { error: 'Vui lòng đăng nhập' });
    if (options.headers.get('x-branch-id') !== 'branch-two') return response(403, { error: 'Bạn không có quyền truy cập cơ sở này.' });
    return response(200, saved);
  });
  const fields = {
    editStudentId: { value: saved.id }, editStudentCode: { value: saved.code },
    editStudentName: { value: saved.fullName }, editStudentClass: { value: saved.className },
    editStudentParent: { value: saved.parentName }, editStudentPhone: { value: saved.phone1 },
    editStudentModal: { style: { display: 'flex' } }
  };
  let submit;
  let prevented = false;
  context.document = { getElementById: id => fields[id], addEventListener(type, listener) { if (type === 'submit') submit = listener; } };
  context.state = { students: [{ id: saved.id, fullName: 'Tên cũ' }] };
  context.rebuildQuickSearchIndex = () => {};
  context.renderRoster = () => {};
  context.openStudentProfile = () => {};
  context.toast = () => {};
  context.console = console;
  vm.runInContext(editSource, context);
  await submit({ target: { id: 'editStudentForm' }, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/students/student-1');
  assert.equal(requests[0].options.method, 'PUT');
  assert.equal(requests[0].options.headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    code: saved.code, fullName: saved.fullName, className: saved.className,
    parentName: saved.parentName, phone1: saved.phone1
  });
  assert.equal(context.state.students[0].fullName, saved.fullName);
  assert.equal(fields.editStudentModal.style.display, 'none');
  assert.equal(storage.get('token'), 'test-session-token');
  assert.equal(context.window.location.href, '/');
});

test('custom headers merge with session headers for objects, Headers and tuples', async () => {
  const { context } = setup(async (_url, options) => {
    assert.equal(options.headers.get('authorization'), 'Bearer test-session-token');
    assert.equal(options.headers.get('x-branch-id'), 'branch-two');
    assert.equal(options.headers.get('content-type'), 'application/problem+json');
    return response(200, { ok: true });
  });
  for (const headers of [{ 'Content-Type': 'application/problem+json' },
    new Headers({ 'Content-Type': 'application/problem+json' }), [['Content-Type', 'application/problem+json']]]) {
    await context.api('/api/example', { headers });
  }
});

test('a permission denial shows an error without removing a valid login', async () => {
  const { context, storage } = setup(async () => response(403, { error: 'Bạn không có quyền truy cập cơ sở này.' }));
  await assert.rejects(context.api('/api/students'), error => error.status === 403);
  assert.equal(storage.get('token'), 'test-session-token');
  assert.equal(storage.get('activeBranch'), 'branch-two');
  assert.equal(context.window.location.href, '/');
});

for (const [status, error] of [[401, 'Vui lòng đăng nhập'], [403, 'Phiên đăng nhập hết hạn hoặc không hợp lệ']]) {
  test(`an invalid session (${status}) still requires login`, async () => {
    const { context, storage } = setup(async () => response(status, { error }));
    await assert.rejects(context.api('/api/students'), failure => failure.status === status);
    assert.equal(storage.has('token'), false);
    assert.equal(storage.has('user'), false);
    assert.equal(storage.has('activeBranch'), false);
    assert.equal(context.window.location.href, '/login.html');
  });
}
