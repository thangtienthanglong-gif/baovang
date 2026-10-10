const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function slice(start, end) {
  const offset = frontend.indexOf(start);
  const finish = frontend.indexOf(end, offset);
  assert.ok(offset >= 0 && finish > offset);
  return frontend.slice(offset, finish);
}

function rosterContext({ madeUp = false, stuck = false } = {}) {
  const context = {
    state: { scheduleExceptions: stuck ? [{}] : [] },
    absenceForStudent: () => madeUp ? { id: 'a1', absenceStatus: 'Đã bù' } : null,
    normalizeAbsenceStatus: value => value, absenceStatusLabel: value => value,
    scheduleExceptionMatchesStudent: () => true, scheduleExceptionAppliesToDate: () => true,
    scheduleDayLabel: () => '', selectedDate: () => '2026-10-10', selectedDay: () => 'ALL', escapeHtml: value => value
  };
  vm.createContext(context);
  vm.runInContext(slice('function renderRosterStudent(', 'function noticeTimeLine('), context);
  return context;
}
const student = { id: 's1', className: '8AT3', fullName: 'Học sinh đã bù' };

test('regular attendance offers made-up status and retains it after a reload without showing an absence highlight', () => {
  const context = rosterContext({ madeUp: true });
  const html = context.renderRosterStudent(student);
  assert.match(html, /value="Đã bù"\s+selected/);
  assert.doesNotMatch(html, /student-card is-absent/);
  assert.doesNotMatch(rosterContext().renderRosterStudent({ ...student, isMakeupAttendance: true }), /value="Đã bù"/);
});

test('a student with a schedule conflict can be marked made up while other attendance options stay locked', () => {
  const html = rosterContext({ stuck: true }).renderRosterStudent(student);
  const select = html.match(/<select[^>]+>/)[0];
  assert.doesNotMatch(select, /disabled/);
  assert.doesNotMatch(html.match(/<option value="Đã bù"[^>]*>/)[0], /disabled/);
  assert.match(html.match(/<option value="Vắng"[^>]*>/)[0], /disabled/);
});

for (const absenceId of ['', 'existing']) {
  test(`saving made-up status uses the chosen attendance date and explicitly disables sending (${absenceId || 'new'})`, async () => {
    const requests = [];
    const context = {
      state: { students: [student] }, normalizeAbsenceStatus: value => value,
      selectedDate: () => '2026-10-10', selectedDay: () => 'ALL',
      getClassScheduleInfo: () => ({ sessionName: 'Tối' }),
      api: async (url, options) => { requests.push({ url, options }); return {}; },
      toast() {}, loadBootstrap: async () => {}
    };
    vm.createContext(context);
    vm.runInContext(slice('async function updateRosterStatus(', 'function bulkZaloMessage('), context);
    await context.updateRosterStatus({ value: 'Đã bù', dataset: { studentId: 's1', attendanceClass: '8AT3', absenceId } });
    assert.equal(requests.length, 1);
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.absenceStatus, 'Đã bù');
    assert.equal(body.sendZalo, false);
    if (!absenceId) assert.equal(body.date, '2026-10-10');
  });
}

test('made-up attendance stays out of the queue even if a stale record is still marked pending', () => {
  const container = {};
  const context = {
    state: { absences: [{ absenceStatus: 'Đã bù', noticeStatus: 'Chờ gửi', studentName: 'Đã học bù' }] },
    $: () => container, normalizeAbsenceStatus: value => value
  };
  vm.runInNewContext(slice('function renderAbsences(', 'function getWeekRange('), context);
  context.renderAbsences();
  assert.match(container.innerHTML, /Hàng xử lý trống/);
});
