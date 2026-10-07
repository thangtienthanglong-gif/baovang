const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function setup(selectedClass = '8S46A') {
  const fields = { studentRoster: {}, rosterTitle: {}, rosterMeta: {}, quickStudentSearchMain: { value: '' } };
  const context = {
    state: {
      today: '2026-10-07',
      students: [
        { id: 'regular-z', fullName: 'Học sinh Z', className: '8S46A' },
        { id: 'regular-b', fullName: 'Học sinh B', className: '8S46A' },
        { id: 'makeup-a', fullName: 'Học sinh A', className: '8S35B' },
        { id: 'makeup-c', fullName: 'Học sinh C', className: '8S35B' },
        { id: 'withdrawn', fullName: 'Học sinh nghỉ', className: '8S35B', status: 'Nghỉ học' }
      ],
      scheduleExceptions: [
        { studentId: 'makeup-a', originalClass: '8S35B', stuckDay: '3', makeupDay: '4', makeupClass: '8S46A' },
        { studentId: 'makeup-a', originalClass: '8S35B', stuckDay: '5', makeupDay: '4', makeupClass: '8S46A' },
        { studentId: 'makeup-c', originalClass: '8S35B', stuckDay: '3', makeupDay: '4', makeupClass: '8S46A' },
        { studentId: 'withdrawn', originalClass: '8S35B', stuckDay: '3', makeupDay: '4', makeupClass: '8S46A' }
      ]
    },
    $: selector => fields[selector.slice(1)],
    selectedClass: () => selectedClass,
    selectedDate: () => '2026-10-07', selectedSession: () => 'ALL',
    selectedDay: () => 'ALL', selectedGrade: () => 'ALL',
    absenceForStudent: () => null,
    escapeHtml: value => value,
    renderRosterStudent: student => `<article data-id="${student.id}" data-class="${student.className}" data-makeup="${!!student.isMakeupAttendance}">${student.fullName}</article>`,
    QUICK_SEARCH_ROSTER_LIMIT: 100,
    normalizeQuickSearch: value => value.toLowerCase()
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function isActiveStudent(', 'function normalizeAbsenceStatus('],
    ['function getClassScheduleInfo(', 'function renderFilters('],
    ['function groupByClass(', 'function matchesRosterKeyword('],
    ['function getClassGrade(', 'function renderClassDropdown('],
    ['function renderRoster(', 'function openAddStudentModal(']
  ]) vm.runInContext(slice(start, end), context);
  return { context, fields };
}

function assertMakeupAtEnd(html) {
  const section = html.indexOf('<section class="makeup-roster-section"');
  assert.ok(section > html.indexOf('data-id="regular-b"'));
  assert.ok(section > html.indexOf('data-id="regular-z"'));
  assert.ok(html.indexOf('data-id="regular-b"') < html.indexOf('data-id="regular-z"'));
  const makeupSection = html.slice(section, html.indexOf('</section>', section));
  assert.match(makeupSection, /Học sinh học bù/);
  assert.match(makeupSection, /2 học sinh/);
  assert.ok(makeupSection.indexOf('data-id="makeup-a"') < makeupSection.indexOf('data-id="makeup-c"'));
  assert.doesNotMatch(makeupSection, /data-makeup="false"|withdrawn/);
  assert.equal((makeupSection.match(/data-id="makeup-a"/g) || []).length, 1);
  assert.doesNotMatch(html.slice(0, section), /data-makeup="true"/);
}

test('the selected receiving class shows sorted regular students followed by a separate makeup group', () => {
  const { context, fields } = setup();
  context.renderRoster();
  assertMakeupAtEnd(fields.studentRoster.innerHTML);
});

test('all-class attendance also keeps makeup students at the end of their receiving class', () => {
  const { context, fields } = setup('ALL');
  context.renderRoster();
  assertMakeupAtEnd(fields.studentRoster.innerHTML);
  assert.doesNotMatch(fields.studentRoster.innerHTML, /data-class="8S35B"/);
});

test('search results keep the same regular and makeup separation', () => {
  const { context, fields } = setup();
  fields.quickStudentSearchMain.value = '8S46A';
  context.renderRoster([]);
  assertMakeupAtEnd(fields.studentRoster.innerHTML);
});

test('a class without incoming makeup students has no extra group', () => {
  const { context, fields } = setup();
  context.state.scheduleExceptions = [];
  context.renderRoster();
  assert.doesNotMatch(fields.studentRoster.innerHTML, /makeup-roster-section|Học sinh học bù/);
  assert.match(fields.studentRoster.innerHTML, /regular-b/);
});

test('makeup attendance stays assigned to the receiving class and only appears on the makeup day', () => {
  const { context } = setup();
  const incoming = context.attendanceRosterStudents('2026-10-07').filter(student => student.isMakeupAttendance);
  assert.equal(incoming.length, 2);
  for (const student of incoming) {
    assert.equal(student.className, '8S46A');
    assert.equal(student.makeupOriginalClass, '8S35B');
  }
  assert.equal(context.attendanceRosterStudents('2026-10-08').filter(student => student.isMakeupAttendance).length, 0);
  assert.equal(context.state.students.find(student => student.id === 'makeup-a').className, '8S35B');
});
