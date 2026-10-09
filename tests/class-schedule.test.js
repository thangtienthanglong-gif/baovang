const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function load(context, start, end) {
  const offset = source.indexOf(start);
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  vm.runInContext(source.slice(offset, source.indexOf(end, offset)), context);
}

function setup() {
  const fields = {
    classDropdown: { value: 'ALL' }, classDropdownMeta: {}, classCount: {},
    gradeDropdown: { value: '8' }, studentRoster: {}, rosterTitle: {}, rosterMeta: {}
  };
  const students = [
    { id: 'ct1', fullName: 'Học sinh CT1', className: '8CT1' },
    { id: 'ct2', fullName: 'Học sinh CT2', className: '8CT2' },
    { id: 'normal', fullName: 'Học sinh T35', className: '8T35A' }
  ];
  const context = {
    state: { students, classes: students.map(row => row.className), absences: [], scheduleExceptions: [] },
    $: selector => fields[selector.slice(1)],
    selectedDate: () => '2026-10-08', selectedDay: () => 'ALL',
    selectedSession: () => 'Tối', selectedGrade: () => fields.gradeDropdown.value,
    selectedClass: () => fields.classDropdown.value,
    activeStudents: () => students, escapeHtml: value => value,
    absenceForStudent: () => null,
    renderRosterStudent: row => `<article data-id="${row.id}">${row.fullName}</article>`
  };
  vm.createContext(context);
  load(context, 'function getClassScheduleInfo(', 'function renderFilters(');
  load(context, 'function groupByClass(', 'function matchesRosterKeyword(');
  load(context, 'function getClassGrade(', 'function openAddStudentModal(');
  return { context, fields };
}

test('CT schedule groups across grades use weekdays rather than the group number', () => {
  const { context } = setup();
  for (const prefix of ['', '6', '7', '8', '9', '10']) {
    for (const [group, days] of [['1', '357'], ['2', '246']]) {
      const className = `${prefix}CT${group}`;
      for (const day of '2345678') {
        const info = context.getClassScheduleInfo(className, '2026-10-08', day);
        assert.equal(info.sessionName, 'Tối', className);
        assert.equal(info.matchesDate, days.includes(day), `${className}: day ${day}`);
      }
    }
  }
  assert.equal(context.getClassScheduleInfo(' 8ct1 ', '2026-10-08').matchesDate, true);
});

test('explicit CT weekdays override group defaults, including grade 9', () => {
  const { context } = setup();
  for (const className of ['6CT1(3-5)', '7CT1(3-5)', '8CT1(3-5)', '9CT1(3-5)']) {
    assert.equal(context.getClassScheduleInfo(className, '2026-10-08').matchesDate, true, className);
    assert.equal(context.getClassScheduleInfo(className, '2026-10-10').matchesDate, false, className);
  }
  for (const [className, days] of [['7CT2(2-4)', '24'], ['8CT2(4-6)', '46'], ['9CT2(2-4)', '24']]) {
    for (const day of '2345678') {
      assert.equal(context.getClassScheduleInfo(className, '2026-10-08', day).matchesDate, days.includes(day), `${className}: day ${day}`);
    }
  }
});

test('Thursday evening dropdown and roster show 8CT1 with its students', () => {
  const { context, fields } = setup();
  context.renderClassDropdown();
  context.renderRoster();
  assert.match(fields.classDropdown.innerHTML, /8CT1 - 1 học sinh/);
  assert.match(fields.classDropdown.innerHTML, /8T35A - 1 học sinh/);
  assert.doesNotMatch(fields.classDropdown.innerHTML, /value="8CT2"/);
  assert.equal(fields.classCount.textContent, '2 lớp');
  assert.match(fields.classDropdown.innerHTML, /Tất cả lớp \(2 học sinh\)/);
  assert.match(fields.studentRoster.innerHTML, /data-id="ct1"/);
  assert.match(fields.studentRoster.innerHTML, /data-id="normal"/);
  assert.doesNotMatch(fields.studentRoster.innerHTML, /data-id="ct2"/);
});

test('choosing Thursday explicitly also includes 8CT1 when the date is Friday', () => {
  const { context, fields } = setup();
  context.selectedDate = () => '2026-10-09';
  context.selectedDay = () => '5';
  context.renderClassDropdown();
  assert.match(fields.classDropdown.innerHTML, /8CT1 - 1 học sinh/);
  fields.classDropdown.value = '8CT1';
  context.renderRoster();
  assert.match(fields.studentRoster.innerHTML, /data-id="ct1"/);
  assert.doesNotMatch(fields.studentRoster.innerHTML, /data-id="normal"|data-id="ct2"/);
});
