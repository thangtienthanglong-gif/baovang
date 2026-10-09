const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function setup() {
  let now = new Date('2026-10-08T16:59:00Z');
  const fields = Object.fromEntries([
    'filterDate', 'filterDateAuto', 'historyDate', 'historyDateAuto', 'historyKeyword',
    'historyRows', 'noticeRows', 'quitRows', 'exportLateHistoryBtn',
    'exportExcusedHistoryBtn', 'exportFailedZaloHistoryBtn', 'exportCallListBtn', 'exportQuitListBtn'
  ].map(id => [id, {
    value: '', listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
  const requests = [];
  const exports = [];
  const context = {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    },
    state: {}, $: selector => fields[selector.slice(1)],
    activeTabId: () => 'historyTab', renderFilters() {},
    api: async url => { requests.push(url); return []; },
    queryString: params => new URLSearchParams(params).toString(),
    loadAttendanceAbsences() {}, loadAbsences() {}
  };
  for (const name of ['exportLateAbsences', 'exportExcusedAbsences', 'exportFailedZalo', 'exportCallList', 'exportQuitList']) {
    context[name] = params => exports.push({ name, params });
  }
  vm.createContext(context);
  function load(start, end) {
    const offset = source.indexOf(start);
    assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
    vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
  }
  vm.runInContext('let queueDateAuto = true; let historyDateAuto = true;', context);
  load('function clientTodayISO(', 'async function loadBootstrap(');
  load('async function loadHistory(', 'async function updateCallResult(');
  load('async function loadQuitStudents(', 'async function markUnfriended(');
  load("  $('#exportLateHistoryBtn')", "  $('#historyKeyword').addEventListener");
  context.syncAutomaticDate();
  context.syncAutomaticHistoryDate();
  return {
    context, fields, requests, exports,
    setTime: instant => { now = new Date(instant); },
    manualHistory: date => {
      vm.runInContext('historyDateAuto = false;', context);
      fields.historyDate.value = date;
      context.syncAutomaticHistoryDate();
    }
  };
}

test('history defaults to today and its live tab reloads at Vietnam midnight', async () => {
  const app = setup();
  assert.equal(app.fields.historyDate.value, '2026-10-08');
  assert.equal(app.fields.historyDate.readOnly, true);
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.historyDate.value, '2026-10-09');
  assert.equal(app.requests.length, 3);
  for (const route of ['/api/call-logs', '/api/notification-logs']) {
    const request = app.requests.map(url => new URL(url, 'https://example.test')).find(url => url.pathname === route);
    assert.equal(request.searchParams.get('date'), '2026-10-09');
  }
});

test('manual history dates and all-date searches survive automatic queue rollover', async () => {
  const app = setup();
  app.manualHistory('2026-09-28');
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-10-09');
  assert.equal(app.fields.historyDate.value, '2026-09-28');
  assert.equal(app.fields.historyDate.readOnly, false);
  assert.equal(app.requests.length, 0);
  await app.context.loadHistory();
  assert.equal(new URL(app.requests[0], 'https://example.test').searchParams.get('date'), '2026-09-28');
  app.fields.historyDate.value = '';
  assert.equal(app.context.selectedHistoryDate(), '');
});

test('history exports use the current automatic date even before the polling timer runs', () => {
  const app = setup();
  app.setTime('2026-12-31T17:01:00Z');
  for (const id of ['exportLateHistoryBtn', 'exportExcusedHistoryBtn', 'exportFailedZaloHistoryBtn', 'exportCallListBtn', 'exportQuitListBtn']) {
    app.fields[id].listeners.click();
  }
  assert.equal(app.exports.length, 5);
  for (const result of app.exports) assert.equal(result.params.date, '2027-01-01');
  app.manualHistory('2026-09-28');
  app.fields.exportCallListBtn.listeners.click();
  assert.equal(app.exports.at(-1).params.date, '2026-09-28');
});

test('automatic history and manual queue dates operate independently', async () => {
  const app = setup();
  vm.runInContext('queueDateAuto = false;', app.context);
  app.fields.filterDate.value = '2026-09-20';
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-09-20');
  assert.equal(app.fields.historyDate.value, '2026-10-09');
  assert.equal(app.requests.length, 3);
});
