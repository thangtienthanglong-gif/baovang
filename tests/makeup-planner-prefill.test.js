const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const plannerSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'ketbu', 'app.js'), 'utf8');
const attendanceSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function load(context, source, start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
}

function select() {
  return {
    value: '', html: '', listeners: {},
    set innerHTML(html) {
      this.html = html;
      this.value = html.match(/value="([^"]*)"/)?.[1] || '';
    },
    get innerHTML() { return this.html; },
    addEventListener(type, callback) { this.listeners[type] = callback; }
  };
}

const sessions = [
  { id: '7C26C-T2', classCode: '7C26C', weekday: 2, shift: 'Chiều', lessonParts: 'H1-D2-H2' },
  { id: '7C26C-T6', classCode: '7C26C', weekday: 6, shift: 'Chiều', lessonParts: 'H3-D3-TH' }
];

function setup(search, classSessions = sessions) {
  const elements = {
    studentClassCode: select(), studentNameInput: select(), missedSessionSelect: select(),
    studentInfo: { classList: { add() {}, remove() {} }, innerHTML: '' }, missedInfo: {}
  };
  const initialData = { classes: [{ code: '7C26C' }], classSessions };
  const context = {
    URLSearchParams, elements, data: initialData,
    window: { location: { search } }, console,
    normalizeRoomId: value => value,
    normalizeClassCodeValue: value => value.replace(/\s+/g, '').toUpperCase(),
    classCodeDetails: code => ({ baseCode: code, subjectLabel: 'Toán', levelCode: 'C' }),
    weekdayLabel: day => day === 8 ? 'Chủ nhật' : `Thứ ${day}`,
    clearResults() {}, setNotice() {}, renderAutocomplete() {},
    appState: { activeBranchId: 'main', branches: [{ id: 'main', data: initialData }] },
    getActiveBranch() { return context.appState.branches.find(b => b.id === context.appState.activeBranchId); },
    persistAppState() {}, persistLocalAppState() {}, setCloudVersion() {},
    normalizeAppStatePayload: value => value,
    localStorage: { getItem: key => ({ token: 'test-token', activeBranch: 'branch-2' })[key] },
    fetch: async () => ({ ok: true, json: async () => [{ id: 'branch-2', name: 'Cơ sở 2' }] })
  };
  context.renderAll = () => { context.renderStudentInfo(); context.renderMissedSessions(); };
  vm.createContext(context);
  vm.runInContext('let pendingMissedSession = null;', context);
  for (const [start, end] of [
    ['function escapeHtml(', 'function shiftFromClassCode('],
    ['function getClass(', 'function classBaseCode('],
    ['function sessionSort(', 'function getSelectedMissedSession('],
    ['function getSelectedMissedSession(', 'function activeAssignments('],
    ['function getMainClassSessions(', 'function hasTimeConflict('],
    ['function sessionLabel(', 'function initials('],
    ['function renderStudentInfo(', 'function suitabilityForLevel('],
    ['async function syncBranches(', 'function renderStats('],
    ['function applyCloudState(', 'async function pullCloudState('],
    ['elements.missedSessionSelect.addEventListener("change"', 'elements.preferredWeekday.addEventListener(']
  ]) {
    load(context, plannerSource, start, end);
  }
  return { context, elements };
}

function openPlanner(search, classSessions) {
  const app = setup(search, classSessions);
  app.context.initializePlannerFromUrl();
  app.context.renderAll();
  return app;
}

test('absence link carries the row date and shift and safely encodes names', () => {
  const context = { URLSearchParams };
  vm.createContext(context);
  load(context, attendanceSource, 'function scheduleMakeupUrl(', 'function renderAbsences(');
  const name = "Nguyễn O'Neil & Vy";
  const url = new URL(context.scheduleMakeupUrl({ className: '7C26C', studentName: name, date: '2026-10-09', session: 'Chiều' }), 'https://example.test');
  assert.equal(url.pathname, '/ketbu/index.html');
  assert.equal(url.searchParams.get('student'), name);
  assert.equal(url.searchParams.get('date'), '2026-10-09');
  assert.equal(url.searchParams.get('session'), 'Chiều');
});

test('opening an absence fills the student and selects Friday immediately, rather than the first session', () => {
  const { elements } = openPlanner('?class=7c26c&student=Nguyễn+Đan+Vy&date=2026-10-09&session=Chiều');
  assert.equal(elements.studentClassCode.value, '7C26C');
  assert.match(elements.studentInfo.innerHTML, /Nguyễn Đan Vy/);
  assert.equal(elements.missedSessionSelect.value, '7C26C-T6');
  assert.match(elements.missedInfo.innerHTML, /Chiều Thứ 6/);
  assert.match(elements.missedInfo.innerHTML, /H3-D3-TH/);
});

test('links without a date still display available sessions immediately', () => {
  const { elements } = openPlanner('?class=7C26C&student=Vy');
  assert.equal(elements.missedSessionSelect.value, '7C26C-T2');
  assert.match(elements.missedInfo.innerHTML, /H1-D2-H2/);
});

test('branch synchronization refreshes sessions even when the cloud has no new version', async () => {
  const { context, elements } = openPlanner('?class=7C26C&date=2026-10-09&session=Chiều', []);
  context.appState.branches.push({ id: 'branch-2', data: { classes: [{ code: '7C26C' }], classSessions: sessions } });
  assert.equal(elements.missedSessionSelect.value, '');
  await context.syncBranches();
  assert.equal(elements.missedSessionSelect.value, '7C26C-T6');
  assert.match(elements.missedInfo.innerHTML, /H3-D3-TH/);
});

test('a pending absence is selected when its schedule arrives from cloud', () => {
  const { context, elements } = openPlanner('?class=7C26C&date=2026-10-09&session=Chiều', [sessions[0]]);
  assert.equal(elements.missedSessionSelect.value, '');
  assert.match(elements.missedInfo.innerHTML, /Chưa chọn buổi/);
  context.applyCloudState({ branches: [{ id: 'main', data: { classes: [], classSessions: sessions } }] }, 'v2');
  assert.equal(elements.missedSessionSelect.value, '7C26C-T6');
});

test('manual session selection is preserved during later cloud refreshes', () => {
  const { context, elements } = openPlanner('?class=7C26C&date=2026-10-09&session=Chiều', [sessions[0]]);
  elements.missedSessionSelect.value = '7C26C-T2';
  elements.missedSessionSelect.listeners.change();
  context.applyCloudState({ branches: [{ id: 'main', data: { classes: [], classSessions: sessions } }] }, 'v2');
  assert.equal(elements.missedSessionSelect.value, '7C26C-T2');
});

test('Sunday maps to weekday 8 and the absence shift distinguishes sessions on the same day', () => {
  const sundaySessions = [
    { ...sessions[0], id: 'sunday-morning', weekday: 8, shift: 'Sáng' },
    { ...sessions[1], id: 'sunday-afternoon', weekday: 8 }
  ];
  const { elements } = openPlanner('?class=7C26C&date=2026-10-11&session=Chiều', sundaySessions);
  assert.equal(elements.missedSessionSelect.value, 'sunday-afternoon');
  assert.match(elements.missedInfo.innerHTML, /Chiều Chủ nhật/);
});
