const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const tables = [
  ['loadGeneralNotificationHistory', 'generalHistoryRows', 'generalHistoryPagination', '/api/notification-logs'],
  ['loadTuitionHistory', 'historyRows', 'tuitionHistoryPagination', '/api/notification-logs'],
  ['loadCallHistory', 'callHistoryRows', 'callHistoryPagination', '/api/call-logs'],
  ['loadQuitStudents', 'quitRows', 'quitHistoryPagination', '/api/quit-students'],
  ['loadRemovedClassStudents', 'removedClassRows', 'removedClassHistoryPagination', '/api/removed-class-students']
];

function rows(count) {
  return Array.from({ length: count }, (_, i) => ({
    id: `log-${i}`, studentId: `s-${i}`, absenceId: `a-${i}`,
    studentName: `HS-${String(i + 1).padStart(3, '0')}`, fullName: `HS-${String(i + 1).padStart(3, '0')}`,
    time: new Date(Date.UTC(2026, 9, 12, 16, 30) - i * 60000).toISOString(),
    removedAt: '2026-10-12T13:30:00Z', date: '2026-10-12', quitDate: '2026-10-12',
    studentCode: 'AUTO-HIDDEN', className: '9T2D+', phone1: '0906905915',
    absenceStatus: 'Học phí', channel: 'Zalo cá nhân', status: 'Đã gửi', result: 'Đã gửi thủ công.'
  }));
}

function setup() {
  const fields = { historyKeyword: { value: '' }, noticeRows: { innerHTML: '' }, noticePagination: { innerHTML: '' } };
  for (const [, tbody, pager] of tables) {
    fields[tbody] = { innerHTML: '' };
    fields[pager] = { innerHTML: '' };
  }
  const data = new Map(tables.map(([, , , route]) => [route, rows(47)]));
  const requests = [];
  const context = {
    $: selector => fields[selector.slice(1)], getActiveBranch: () => 'main',
    selectedHistoryDate: () => '2026-10-12', historyDateParams: () => ({ date: (() => '2026-10-12')() }), queryString: params => new URLSearchParams(params).toString(),
    api: async url => { requests.push(url); return data.get(new URL(url, 'http://localhost').pathname); },
    escapeHtml: value => String(value ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    formatDateTime: value => value, statusClass: () => 'sent', absenceStatusLabel: value => value
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['async function loadHistory(', 'async function updateCallResult('],
    ['function quitHistoryParams(', 'async function markUnfriended(']
  ]) {
    const offset = source.indexOf(start);
    vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
  }
  const click = (pagerId, page, disabled = false) => context.handleHistoryPageClick({
    target: { closest: () => ({ disabled, dataset: { page: String(page) }, closest: () => ({ id: pagerId }) }) }
  });
  return { context, fields, data, requests, click };
}

function names(html) {
  return [...html.matchAll(/class="person-main">HS-(\d+)/g)].map(match => Number(match[1]));
}

for (const [loader, tbodyId, pagerId, route] of tables) {
  test(`${loader}: 47 records show 15 rows per page and filtering resets to page one`, async () => {
    const app = setup();
    await app.context[loader]();
    for (const [page, first, last] of [[1, 1, 15], [2, 16, 30], [3, 31, 45], [4, 46, 47]]) {
      app.click(pagerId, page);
      assert.deepEqual(names(app.fields[tbodyId].innerHTML), Array.from({ length: last - first + 1 }, (_, i) => first + i));
      assert.ok(app.fields[pagerId].innerHTML.includes(`Hiển thị ${first}–${last} / tổng 47`));
    }
    assert.equal(app.requests.length, 1);
    assert.match(app.fields[pagerId].innerHTML, /data-page="5" disabled/);
    app.fields.historyKeyword.value = 'HS';
    app.data.set(route, rows(16));
    await app.context[loader]();
    assert.equal(names(app.fields[tbodyId].innerHTML)[0], 1);
    assert.ok(app.fields[pagerId].innerHTML.includes('Hiển thị 1–15 / tổng 16'));
    app.click(pagerId, 99);
    assert.deepEqual(names(app.fields[tbodyId].innerHTML), [16]);
    app.data.set(route, []);
    await app.context[loader]();
    assert.equal(app.fields[pagerId].innerHTML, '');
    assert.match(app.fields[tbodyId].innerHTML, /class="empty"/);
  });
}

test('each history has independent pages and ignores disabled or invalid controls', async () => {
  const app = setup();
  await Promise.all(tables.map(([loader]) => app.context[loader]()));
  app.click('tuitionHistoryPagination', 2);
  app.click('callHistoryPagination', 3);
  assert.equal(names(app.fields.historyRows.innerHTML)[0], 16);
  assert.equal(names(app.fields.callHistoryRows.innerHTML)[0], 31);
  assert.equal(names(app.fields.quitRows.innerHTML)[0], 1);
  assert.equal(names(app.fields.removedClassRows.innerHTML)[0], 1);
  for (const [page, disabled] of [[1, true], ['bad', false], [0, false]]) {
    app.click('tuitionHistoryPagination', page, disabled);
  }
  app.context.handleHistoryPageClick({ target: { closest: () => null } });
  app.click('noticePagination', 2);
  assert.equal(names(app.fields.historyRows.innerHTML)[0], 16);
});

test('tuition rows combine name, class and phone without AUTO codes and preserve send details', async () => {
  const app = setup();
  await app.context.loadTuitionHistory();
  const html = app.fields.historyRows.innerHTML;
  assert.match(html, /class="notice-history-student"/);
  assert.match(html, /class="mini-chip">9T2D\+/);
  assert.match(html, /class="student-phone">0906905915/);
  assert.doesNotMatch(html, /AUTO-HIDDEN/);
  assert.match(html, /title="Zalo cá nhân — Đã gửi thủ công\."/);
  assert.equal((html.match(/<td(?:\s[^>]*)?>/g) || []).length, 45);
});
