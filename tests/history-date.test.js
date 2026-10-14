const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function setup() {
  let now = new Date('2026-10-08T16:59:00Z');
  const fields = Object.fromEntries([
    'filterDate', 'filterDateAuto', 'historyDate', 'historyDateEnd', 'historyDateAuto', 'historyKeyword',
    'historyRows', 'callHistoryRows', 'noticeRows', 'noticePagination', 'quitRows', 'quitHistoryGrade', 'quitHistorySubject', 'removedClassRows', 'historyExportMenu'
  ].map(id => [id, {
    value: '', listeners: {}, style: { display: 'block' },
    setCustomValidity(message) { this.validationMessage = message; },
    reportValidity() { this.reported = true; },
    addEventListener(type, listener) { this.listeners[type] = listener; }
  }]));
  const requests = [];
  const exports = [];
  const context = {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    },
    state: {}, $: selector => fields[selector.slice(1)], escapeHtml: value => String(value ?? ''),
    getClassGrade: value => String(value || '').match(/^\d+/)?.[0] || '',
    activeTabId: () => 'historyTab', getActiveBranch: () => 'main', renderFilters() {},
    api: async url => { requests.push(url); return []; },
    queryString: params => new URLSearchParams(params).toString(),
    loadAttendanceAbsences() {}, loadAbsences() {}, toast() {},
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
  load('function quitHistoryParams(', 'async function markUnfriended(');
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
    manualHistory: (date, end = date) => {
      vm.runInContext('historyDateAuto = false;', context);
      fields.historyDate.value = date;
      fields.historyDateEnd.value = end;
      context.syncAutomaticHistoryDate();
    }
  };
}

test('history defaults to today and its live tab reloads at Vietnam midnight', async () => {
  const app = setup();
  assert.equal(app.fields.historyDate.value, '2026-10-08');
  assert.equal(app.fields.historyDateEnd.value, '2026-10-08');
  assert.equal(app.fields.historyDate.readOnly, true);
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.historyDate.value, '2026-10-09');
  assert.equal(app.requests.length, 5);
  for (const route of ['/api/call-logs', '/api/notification-logs', '/api/removed-class-students', '/api/quit-students']) {
    const request = app.requests.map(url => new URL(url, 'https://example.test')).find(url => url.pathname === route);
    assert.equal(request.searchParams.get('dateStart'), '2026-10-09');
    assert.equal(request.searchParams.get('dateEnd'), '2026-10-09');
  }
  const tuitionRequest = app.requests.map(url => new URL(url, 'https://example.test'))
    .find(url => url.searchParams.get('absenceStatus') === 'Học phí');
  assert.equal(tuitionRequest.searchParams.get('dateStart'), '2026-10-09');
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
  assert.equal(new URL(app.requests[0], 'https://example.test').searchParams.get('dateStart'), '2026-09-28');
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
    assert.equal(result.params.dateStart, '2027-01-01');
    assert.equal(result.params.dateEnd, '2027-01-01');
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
  assert.equal(app.exports.at(-1).params.dateStart, '2026-09-28');
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

test('every history and all six exports use the same manual date interval and keyword', async () => {
  const app = setup();
  app.manualHistory('2026-10-01', '2026-10-14');
  app.fields.historyKeyword.value = 'Ngọc';
  await app.context.reloadHistoryFromFilters();
  assert.equal(app.requests.length, 5);
  for (const request of app.requests) {
    const params = new URL(request, 'https://example.test').searchParams;
    assert.equal(params.get('dateStart'), '2026-10-01');
    assert.equal(params.get('dateEnd'), '2026-10-14');
    assert.equal(params.get('q'), 'Ngọc');
  }
  for (const type of ['absence', 'tuition', 'call-absence', 'call-tuition', 'quit', 'removed']) app.exportType(type);
  assert.equal(app.exports.length, 6);
  for (const result of app.exports) {
    assert.equal(result.params.dateStart, '2026-10-01');
    assert.equal(result.params.dateEnd, '2026-10-14');
  }
});

test('reversed dates block loading and exporting; clearing either endpoint permits an open interval', async () => {
  const app = setup();
  app.manualHistory('2026-10-14', '2026-10-01');
  await app.context.reloadHistoryFromFilters();
  assert.equal(app.requests.length, 0);
  assert.equal(app.fields.historyDateEnd.reported, true);
  assert.throws(() => app.context.exportHistory('absence'), /Từ ngày/);
  assert.equal(app.exports.length, 0);
  app.manualHistory('', '2026-10-14');
  assert.equal(app.context.historyDateParams().dateStart, '');
  assert.equal(app.context.historyDateParams().dateEnd, '2026-10-14');
  app.manualHistory('2026-10-01', '');
  assert.equal(app.context.historyDateParams().dateEnd, '');
  assert.equal(app.fields.historyDateEnd.validationMessage, '');
});

test('withdrawal grade and subject filters apply to the list and its Excel export only', async () => {
  const app = setup();
  app.manualHistory('2026-10-01', '2026-10-14');
  app.fields.quitHistoryGrade.value = '8';
  app.fields.quitHistorySubject.value = 'K';
  app.fields.historyKeyword.value = 'Nhân';
  await app.context.loadQuitStudents();
  const query = new URL(app.requests[0], 'https://example.test').searchParams;
  assert.equal(query.get('grade'), '8');
  assert.equal(query.get('subject'), 'K');
  assert.equal(query.get('q'), 'Nhân');
  app.exportType('quit');
  assert.equal(app.exports[0].params.grade, '8');
  assert.equal(app.exports[0].params.subject, 'K');
  assert.equal(app.exports[0].params.dateStart, '2026-10-01');
  app.exportType('absence');
  assert.equal(app.exports[1].params.grade, undefined);
  assert.equal(app.exports[1].params.subject, undefined);
});

test('a response for an earlier withdrawal filter cannot overwrite the newer selection', async () => {
  const app = setup();
  let first;
  app.context.api = async () => new Promise(resolve => { first = resolve; });
  const pending = app.context.loadQuitStudents();
  app.fields.quitHistoryGrade.value = '8';
  app.context.api = async () => [{ fullName: 'Khối 8', className: '8KS4M', quitDate: '2026-10-14' }];
  await app.context.loadQuitStudents();
  first([{ fullName: 'Khối 7', className: '7KS4M', quitDate: '2026-10-14' }]);
  await pending;
  assert.match(app.fields.quitRows.innerHTML, /Khối 8/);
  assert.doesNotMatch(app.fields.quitRows.innerHTML, /Khối 7/);
});

test('grouped withdrawal rows show both class chips and dates within one paginated row', async () => {
  const app = setup();
  app.context.api = async () => [{
    fullName: 'Thái Song Quang', phone1: '0908332401',
    classNames: ['8T3M+', '8NT7M'], quitDates: ['2026-10-13', '2026-10-10'], quitReason: 'Lý do 1\nLý do 2'
  }];
  await app.context.loadQuitStudents();
  const html = app.fields.quitRows.innerHTML;
  assert.equal((html.match(/<tr>/g) || []).length, 1);
  assert.equal((html.match(/class="mini-chip"/g) || []).length, 2);
  assert.match(html, /13\/10\/2026/);
  assert.match(html, /10\/10\/2026/);
  assert.match(html, /quit-history-reason/);
  assert.match(html, /0908332401/);
});
