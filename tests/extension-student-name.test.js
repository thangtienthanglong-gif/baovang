const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function load(context, start, end) {
  const offset = source.indexOf(start);
  vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
}

test('bulk extension items carry each returned log ID, phone, student name and class', async () => {
  const batches = [];
  const logs = [
    { id: 'log-ngoc', absenceId: 'a1', status: 'Chờ gửi thủ công', phone1: '0977686959', studentName: 'Trương Bảo (C) Ngọc', className: '9T2D+', message: 'Tin Ngọc' },
    { id: 'log-kim', absenceId: 'a2', status: 'Chờ gửi thủ công', phone1: '0909630582', studentName: 'Nguyễn Đặng Thiên (A) Kim', className: '9T2D+', message: 'Tin Kim' }
  ];
  const context = {
    state: { settings: { zaloMode: 'personal-real' } },
    document: { querySelectorAll: () => logs.map(log => ({ checked: true, dataset: { id: log.absenceId } })) },
    getFilters: () => ({}), selectedDate: () => '2026-10-12', queryString: () => '',
    api: async (url, options) => options ? { logs } : logs,
    startZaloExtensionAuto: async items => { batches.push(structuredClone(Array.from(items))); },
    renderManualSendPanel() {}, loadAbsences() {}, toast() {}, bulkZaloMessage() {}
  };
  vm.createContext(context);
  load(context, 'async function sendBulkZalo(', 'function startZaloExtensionAuto(');
  const button = { disabled: false };
  await context.sendBulkZalo(button);
  assert.deepEqual(batches[0].map(item => [item.id, item.phone, item.studentName, item.className]), logs.map(log => [log.id, log.phone1, log.studentName, log.className]));
  assert.equal(button.disabled, false);
});

test('a single send preserves the same student identity and real log ID', async () => {
  const batches = [];
  const context = { toast() {}, startZaloExtensionAuto: async items => { batches.push(structuredClone(Array.from(items))); } };
  vm.createContext(context);
  load(context, 'async function sendSingleViaZaloExtension(', 'async function copyMessageAndOpenZalo(');
  const item = { id: 'log-123', absenceId: 'a1', phone: '0977686959', studentName: 'Trương Bảo (C) Ngọc', className: '9T2D+', message: 'Thông báo' };
  await context.sendSingleViaZaloExtension(item);
  assert.deepEqual(batches[0][0], item);
  await context.sendSingleViaZaloExtension({ ...item, phone: '' });
  assert.equal(batches.length, 1);
});
