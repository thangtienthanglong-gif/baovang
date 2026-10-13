const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function makeRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `log-${index + 1}`, studentId: `student-${index + 1}`, absenceId: `absence-${index + 1}`,
    studentName: `Học sinh ${index + 1}`, className: '9VT2', phone1: '0906905915',
    time: new Date(Date.UTC(2026, 9, 12, 16, 30) - index * 60000).toISOString(),
    absenceStatus: 'Vắng không phép', channel: 'Zalo cá nhân',
    status: 'Chờ gửi thủ công', message: 'Thông báo <học sinh>'
  }));
}

function setup(initialRows) {
  let rows = initialRows;
  const fields = {
    noticeRows: { innerHTML: '' },
    noticePagination: {
      innerHTML: '',
      addEventListener(type, listener) { this[type] = listener; }
    },
    historyKeyword: { value: '' },
    historyDate: { value: '2026-10-12' }
  };
  const requests = [];
  const context = {
    $: selector => fields[selector.slice(1)],
    api: async url => { requests.push(url); return rows; },
    queryString: params => new URLSearchParams(params).toString(),
    selectedHistoryDate: () => fields.historyDate.value,
    escapeHtml: value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]),
    formatDateTime: value => value, absenceStatusLabel: value => value, statusClass: () => 'waiting'
  };
  vm.createContext(context);
  const start = source.indexOf('function groupFailedNoticeRows(');
  vm.runInContext(source.slice(start, source.indexOf('async function markUnfriended(', start)), context);
  const eventStart = source.indexOf("  $('#noticePagination')?.addEventListener");
  assert.ok(eventStart >= 0);
  vm.runInContext(source.slice(eventStart, source.indexOf("  $('#noticeRows')?.addEventListener", eventStart)), context);
  return {
    context, fields, requests,
    setRows: next => { rows = next; },
    go: page => vm.runInContext(`noticePage = ${page}; renderNoticePage();`, context),
    click: (page, disabled = false) => fields.noticePagination.click({
      target: { closest: () => ({ dataset: { page: String(page) }, disabled }) }
    })
  };
}

function visibleLogIds(app) {
  return [...app.fields.noticeRows.innerHTML.matchAll(/data-logid="([^"]+)"/g)].map(match => match[1]);
}

test('32 records paginate into 15, 15 and 2 rows while retaining message actions', async () => {
  const app = setup(makeRows(32));
  await app.context.loadNotices();
  for (const [page, first, last] of [[1, 1, 15], [2, 16, 30], [3, 31, 32]]) {
    app.click(page);
    assert.deepEqual(visibleLogIds(app), Array.from({ length: last - first + 1 }, (_, i) => `log-${first + i}`));
    assert.ok(app.fields.noticePagination.innerHTML.includes(`Hiển thị ${first}–${last} / tổng 32`));
    assert.match(app.fields.noticeRows.innerHTML, /copy-log-msg-btn/);
    assert.match(app.fields.noticeRows.innerHTML, /Thông báo &lt;học sinh&gt;/);
    assert.match(app.fields.noticeRows.innerHTML, /notice-history-student/);
  }
  assert.equal(app.requests.length, 1, 'page changes use the loaded records');
});

test('filtering or reloading resets the page and uses the current date and keyword', async () => {
  const app = setup(makeRows(32));
  await app.context.loadNotices();
  app.click(3);
  app.fields.historyDate.value = '2026-10-11';
  app.fields.historyKeyword.value = '  Ngân  ';
  app.setRows(makeRows(20));
  await app.context.loadNotices();
  assert.equal(visibleLogIds(app)[0], 'log-1');
  assert.ok(app.fields.noticePagination.innerHTML.includes('Hiển thị 1–15 / tổng 20'));
  const request = new URL(app.requests.at(-1), 'http://localhost');
  assert.equal(request.searchParams.get('date'), '2026-10-11');
  assert.equal(request.searchParams.get('q'), 'Ngân');
  app.click(2);
  await app.context.loadNotices();
  assert.equal(visibleLogIds(app)[0], 'log-1');
});

test('empty results remove the pager and a page past the end is clamped', async () => {
  const app = setup(makeRows(32));
  await app.context.loadNotices();
  app.go(99);
  assert.deepEqual(visibleLogIds(app), ['log-31', 'log-32']);
  app.setRows([]);
  await app.context.loadNotices();
  assert.match(app.fields.noticeRows.innerHTML, /colspan="3".*Chưa có lịch sử vắng\./);
  assert.equal(app.fields.noticePagination.innerHTML, '');
  app.setRows(makeRows(1));
  await app.context.loadNotices();
  assert.deepEqual(visibleLogIds(app), ['log-1']);
  assert.match(app.fields.noticePagination.innerHTML, /data-page="0" disabled/);
  assert.match(app.fields.noticePagination.innerHTML, /data-page="2" disabled/);
});

test('page windows contain at most five numbers and mark the active page', async () => {
  const app = setup(makeRows(150));
  await app.context.loadNotices();
  for (const [page, expected] of [[1, [1, 2, 3, 4, 5]], [6, [4, 5, 6, 7, 8]], [10, [6, 7, 8, 9, 10]]]) {
    app.click(page);
    const html = app.fields.noticePagination.innerHTML;
    const numbers = [...html.matchAll(/data-page="(\d+)"(?: aria-current="page")?>(\d+)<\/button>/g)].map(match => Number(match[2]));
    assert.deepEqual(numbers, expected);
    assert.ok(html.includes(`active" type="button" data-page="${page}" aria-current="page"`));
  }
  assert.match(app.fields.noticePagination.innerHTML, /data-page="11" disabled/);
});

test('delegated clicks ignore disabled controls, invalid pages and unrelated elements', async () => {
  const app = setup(makeRows(32));
  await app.context.loadNotices();
  const initial = app.fields.noticeRows.innerHTML;
  app.click(2, true);
  app.click('invalid');
  app.click(0);
  app.fields.noticePagination.click({ target: { closest: () => null } });
  assert.equal(app.fields.noticeRows.innerHTML, initial);
  app.click(2);
  assert.equal(visibleLogIds(app)[0], 'log-16');
});

test('pagination counts grouped failures after excluding call-only logs', async () => {
  const records = makeRows(16);
  records[0].status = 'Lỗi gửi';
  records.push({ ...records[0], id: 'older-failure', time: '2026-10-12T01:00:00Z' });
  records.push({ ...makeRows(1)[0], status: 'Chưa kết bạn - Cần gọi' });
  const app = setup(records);
  await app.context.loadNotices();
  assert.ok(app.fields.noticePagination.innerHTML.includes('Hiển thị 1–15 / tổng 16'));
  assert.match(app.fields.noticeRows.innerHTML, /Lỗi gửi x2/);
  app.click(2);
  assert.deepEqual(visibleLogIds(app), ['log-16']);
});
