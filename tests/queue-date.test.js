const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function setup(instant = '2026-10-08T16:59:00Z') {
  let now = new Date(instant);
  let tab = 'queueTab';
  const fields = {
    filterDate: { value: '2026-10-07' }, filterDateAuto: { checked: true },
    filterClass: { value: 'ALL' }
  };
  const requests = [];
  let filterRenders = 0;
  let attendanceLoads = 0;
  const context = {
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    },
    state: { today: '2026-10-07' },
    $: selector => fields[selector.slice(1)],
    activeTabId: () => tab,
    api: async url => { requests.push(url); return { absences: [], summary: {} }; },
    queryString: params => new URLSearchParams(params).toString(),
    renderFilters: () => { filterRenders++; }, renderSummary() {}, renderAbsences() {},
    renderClassDropdown() {}, renderRoster() {},
    loadAttendanceAbsences: async () => { attendanceLoads++; }
  };
  vm.createContext(context);
  const load = (start, end) => {
    const offset = source.indexOf(start);
    assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
    vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
  };
  vm.runInContext("let queueDateAuto = true; let historyDateAuto = true; let queueSessionAuto = true; let renderedQueueSession = '';", context);
  load('function clientTodayISO(', 'async function loadBootstrap(');
  load('async function loadAbsences(', 'async function loadAttendanceAbsences(');
  return {
    context, fields, requests,
    setTime: value => { now = new Date(value); },
    setTab: value => { tab = value; },
    setAuto: value => { vm.runInContext(`queueDateAuto = ${value};`, context); context.syncAutomaticDate(); },
    filterRenders: () => filterRenders,
    attendanceLoads: () => attendanceLoads
  };
}

test('automatic date uses Vietnam midnight even when the UTC date is still yesterday', () => {
  const app = setup('2026-10-08T17:01:00Z');
  app.context.syncAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-10-09');
  assert.equal(app.context.selectedDate(), '2026-10-09');
  assert.equal(app.context.state.today, '2026-10-09');
  assert.equal(app.fields.filterDate.readOnly, true);
});

test('an open queue advances to the new day and requests that day on refresh', async () => {
  const app = setup();
  app.context.syncAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-10-08');
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-10-09');
  assert.equal(new URL(app.requests[0], 'https://example.test').searchParams.get('date'), '2026-10-09');
  assert.ok(app.filterRenders() > 0);
});

test('a manually selected historical date is preserved until automatic mode is enabled', async () => {
  const app = setup();
  app.setAuto(false);
  app.fields.filterDate.value = '2026-09-28';
  app.setTime('2026-10-08T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.filterDate.readOnly, false);
  assert.equal(app.fields.filterDateAuto.checked, false);
  assert.equal(app.fields.filterDate.value, '2026-09-28');
  assert.equal(new URL(app.requests[0], 'https://example.test').searchParams.get('date'), '2026-09-28');
  app.setAuto(true);
  assert.equal(app.fields.filterDate.value, '2026-10-09');
  assert.equal(app.fields.filterDateAuto.checked, true);
});

test('attendance reloads on a new day, while a history view keeps its own date', async () => {
  const app = setup('2026-10-31T16:59:00Z');
  app.context.syncAutomaticDate();
  app.setTab('absenceTab');
  app.setTime('2026-10-31T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.fields.filterDate.value, '2026-11-01');
  assert.equal(app.attendanceLoads(), 1);
  assert.equal(app.requests.length, 0);
  app.setTab('historyTab');
  app.setTime('2026-11-01T17:01:00Z');
  await app.context.refreshAutomaticDate();
  assert.equal(app.attendanceLoads(), 1);
  assert.equal(app.requests.length, 0);
});

test('entering the queue after midnight refreshes a stale date before loading rows', async () => {
  const app = setup('2026-12-31T17:01:00Z');
  await app.context.loadAbsences();
  assert.equal(app.fields.filterDate.value, '2027-01-01');
  assert.equal(new URL(app.requests[0], 'https://example.test').searchParams.get('date'), '2027-01-01');
});
