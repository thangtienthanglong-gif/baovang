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
    'historyRows', 'callHistoryRows', 'noticeRows', 'noticePagination', 'quitRows', 'removedClassRows', 'historyExportMenu'
  ].map(id => [id, {
    value: '', listeners: {}, style: { display: 'block' },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
  const requests = [];
  const exports = [];
  const context = {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    },
    state: {}, $: selector => fields[selector.slice(1)], escapeHtml: value => String(value ?? ''),
    activeTabId: () => 'historyTab', getActiveBranch: () => 'main', renderFilters() {},
    api: async url => { requests.push(url); return []; },
    queryString: params => new URLSearchParams(params).toString(),
    loadAttendanceAbsences() {}, loadAbsences() {},
    downloadUrl: (path, params) => exports.push({ path, params })
  };
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
  load('function exportHistory(', 'async function clearQuitHistory(');
  load("  $('#historyExportMenu')", "  $('#historyKeyword').addEventListener");
  context.syncAutomaticDate();
  context.syncAutomaticHistoryDate();
  return {
    context, fields, requests, exports,
    exportType: type => fields.historyExportMenu.listeners.click({ target: {
      closest: () => ({ dataset: { historyExport: type } })
    } }),
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
  assert.equal(app.requests.length, 5);
  for (const route of ['/api/call-logs', '/api/notification-logs', '/api/removed-class-students']) {
    const request = app.requests.map(url => new URL(url, 'https://example.test')).find(url => url.pathname === route);
    assert.equal(request.searchParams.get('date'), '2026-10-09');
  }
  const tuitionRequest = app.requests.map(url => new URL(url, 'https://example.test'))
    .find(url => url.searchParams.get('absenceStatus') === 'Học phí');
  assert.equal(tuitionRequest.searchParams.get('date'), '2026-10-09');
  assert.equal(tuitionRequest.searchParams.get('dateBasis'), 'time');
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
  app.fields.historyKeyword.value = '  Ngọc  ';
  for (const type of ['absence', 'tuition', 'call-absence', 'call-tuition', 'quit', 'removed']) app.exportType(type);
  assert.equal(app.exports.length, 6);
  for (const result of app.exports) {
    assert.equal(result.params.q, 'Ngọc');
    // Withdrawal history intentionally shows every date, as its panel does.
    assert.equal(result.params.date, result.path === '/api/quit-students/export' ? undefined : '2027-01-01');
  }
  assert.equal(app.exports[0].params.excludeAbsenceStatus, 'Học phí');
  assert.equal(app.exports[1].params.absenceStatus, 'Học phí');
  assert.equal(app.exports[1].params.dateBasis, 'time');
  assert.equal(app.exports[2].path, '/api/call-logs/export');
  assert.equal(app.exports[2].params.excludeAbsenceStatus, 'Học phí');
  assert.equal(app.exports[3].params.absenceStatus, 'Học phí');
  assert.equal(app.exports[5].path, '/api/removed-class-students/export');
  assert.equal(app.fields.historyExportMenu.style.display, 'none');
  app.manualHistory('2026-09-28');
  app.exportType('call-absence');
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
  assert.equal(app.requests.length, 5);
});
