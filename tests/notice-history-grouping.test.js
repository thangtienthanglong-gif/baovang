const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const offset = source.indexOf('function groupFailedNoticeRows(');
const finish = source.indexOf('async function markUnfriended(', offset);
assert.ok(offset >= 0 && finish > offset);

function failure(overrides = {}) {
  return {
    id: 'latest', time: '2026-10-10T01:37:00Z', date: '2026-10-10', studentId: 's1',
    studentName: 'Nguyễn Thái Dương', studentCode: 'AUTO-58371C93', className: '8S37MB',
    phone1: '0975078436', absenceId: 'a1', absenceStatus: 'Vắng', channel: 'Zalo cá nhân',
    status: 'Lỗi gửi', result: 'Không gửi được tin nhắn', ...overrides
  };
}

function setup(rows) {
  const container = { innerHTML: '' };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
  const context = {
    api: async () => rows,
    $: selector => selector === '#noticeRows' ? container : { value: '' },
    selectedHistoryDate: () => '2026-10-10', queryString: () => '',
    escapeHtml, formatDateTime: value => value, absenceStatusLabel: value => value,
    statusClass: () => 'wrong'
  };
  vm.createContext(context);
  vm.runInContext(source.slice(offset, finish), context);
  return { context, container };
}

test('two failures for the same enrollment and session become one row using the latest log without mutating history', () => {
  const rows = [failure({ id: 'older', time: '2026-10-10T01:35:00Z' }), failure()];
  const original = structuredClone(rows);
  const { context } = setup(rows);
  const grouped = context.groupFailedNoticeRows(rows);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, 'latest');
  assert.equal(grouped[0].time, '2026-10-10T01:37:00Z');
  assert.deepEqual(Array.from(grouped[0].failedAttempts, row => row.id), ['latest', 'older']);
  assert.deepEqual(rows, original);
});

test('names alone never merge distinct students, sessions, dates, classes or recipients', () => {
  for (const overrides of [
    { studentId: 's2' }, { absenceId: 'other-session' }, { date: '2026-10-09' },
    { className: '8OTHER' }, { phone1: '0900000000' }, { channel: 'Zalo OA' }, { absenceStatus: 'Học phí' },
    { studentId: '', studentCode: '' }, { absenceId: '' }
  ]) {
    const rows = [failure(), failure({ id: 'other', ...overrides })];
    assert.equal(setup(rows).context.groupFailedNoticeRows(rows).length, 2);
  }
});

test('legacy failures can use the student code while sent and pending logs remain separate', () => {
  const rows = [
    failure({ studentId: '' }), failure({ studentId: '', id: 'older', time: '2026-10-10T01:35:00Z' }),
    failure({ id: 'sent', status: 'Đã gửi' }), failure({ id: 'pending', status: 'Chờ gửi thủ công' })
  ];
  const grouped = setup(rows).context.groupFailedNoticeRows(rows);
  assert.equal(grouped.length, 3);
  assert.equal(grouped.find(row => row.status === 'Lỗi gửi').failedAttempts.length, 2);
  assert.equal(grouped.filter(row => row.status !== 'Lỗi gửi').length, 2);
});

test('the grouped badge shows x2 with both attempt details and one set of actions targeting the latest log', async () => {
  const { context, container } = setup([
    failure(), failure({ id: 'older', time: '2026-10-10T01:35:00Z', result: '<script>unsafe</script>' })
  ]);
  await context.loadNotices();
  assert.equal((container.innerHTML.match(/<tr>/g) || []).length, 1);
  assert.match(container.innerHTML, /Lỗi gửi x2/);
  assert.match(container.innerHTML, /<details>/);
  assert.match(container.innerHTML, /01:37:00Z/);
  assert.match(container.innerHTML, /01:35:00Z/);
  assert.match(container.innerHTML, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(container.innerHTML, /<script>/);
  assert.equal((container.innerHTML.match(/retry-zalo-btn/g) || []).length, 1);
  assert.match(container.innerHTML, /data-logid="latest"/);
  assert.doesNotMatch(container.innerHTML, /data-logid="older"/);
});

test('a third failure increments the badge and a single failure retains its normal label', async () => {
  const single = setup([failure()]);
  await single.context.loadNotices();
  assert.doesNotMatch(single.container.innerHTML, /Lỗi gửi x1|<details>/);
  const triple = setup([
    failure(), failure({ id: 'older1', time: '2026-10-10T01:35:00Z' }), failure({ id: 'older2', time: '2026-10-10T01:33:00Z' })
  ]);
  await triple.context.loadNotices();
  assert.match(triple.container.innerHTML, /Lỗi gửi x3/);
});

test('an uncertain partial send in any failed attempt retains the existing warning and suppresses retry', async () => {
  const { context, container } = setup([
    failure(), failure({ id: 'older', time: '2026-10-10T01:35:00Z', result: 'Đã bấm Gửi, chưa xác nhận được nội dung' })
  ]);
  await context.loadNotices();
  assert.match(container.innerHTML, /Lỗi gửi x2/);
  assert.match(container.innerHTML, /Kiểm tra tin trong Zalo trước khi thao tác tiếp/);
  assert.doesNotMatch(container.innerHTML, /retry-zalo-btn/);
});
