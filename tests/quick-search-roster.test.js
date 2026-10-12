const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function setup() {
  const fields = {
    quickStudentSearchMain: { value: '' },
    studentRoster: {}, rosterTitle: {}, rosterMeta: {}
  };
  const context = {
    state: {
      students: [
        { id: 'tuan', code: 'AUTO-1E977793', fullName: 'Nguyễn Bá Minh Tuấn', className: '8T35A' },
        { id: 'vs2', fullName: 'Học sinh lớp văn', className: '8VS2' },
        { id: 'other-tuan', fullName: 'Nguyễn Minh Tuấn', className: '9S2' },
        { id: 'removed', fullName: 'Nguyễn Bá Minh Tuấn', className: '8VS2', removedFromClass: true }
      ],
      scheduleExceptions: []
    },
    $: selector => fields[selector.slice(1)],
    selectedClass: () => '8VS2', selectedDate: () => '2026-10-12',
    selectedSession: () => 'Sáng', selectedDay: () => '2', selectedGrade: () => '8',
    absenceForStudent: () => null,
    escapeHtml: value => value,
    renderRosterStudent: student => `<article data-id="${student.id}" data-class="${student.className}">${student.fullName}</article>`,
    QUICK_SEARCH_ROSTER_LIMIT: 80
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['let quickSearchIndex =', 'const $ ='],
    ['function isActiveStudent(', 'function normalizeAbsenceStatus('],
    ['function getClassScheduleInfo(', 'function renderFilters('],
    ['function groupByClass(', 'function matchesRosterKeyword('],
    ['function getClassGrade(', 'function renderClassDropdown('],
    ['function renderRoster(', 'function openAddStudentModal(']
  ]) {
    const offset = source.indexOf(start);
    const finish = source.indexOf(end, offset);
    assert.ok(offset >= 0 && finish > offset);
    vm.runInContext(source.slice(offset, finish), context);
  }
  context.rebuildQuickSearchIndex();
  return { context, fields };
}

test('global name search shows the actual class instead of the selected 8VS2 heading', () => {
  const { context, fields } = setup();
  fields.quickStudentSearchMain.value = 'Nguyễn bá Minh';
  context.renderRoster();
  assert.equal(fields.rosterTitle.textContent, 'Kết quả tra cứu học sinh');
  assert.equal(fields.rosterMeta.textContent, '1 học sinh · Tất cả lớp · 0 đang báo vắng');
  assert.match(fields.studentRoster.innerHTML, /class-group-title[^]*8T35A \(Buổi Tối\)/);
  assert.match(fields.studentRoster.innerHTML, /data-id="tuan" data-class="8T35A"/);
  assert.doesNotMatch(fields.studentRoster.innerHTML, /8VS2|data-id="removed"/);
});

test('search results from several classes each show their class regardless of attendance filters', () => {
  const { context, fields } = setup();
  fields.quickStudentSearchMain.value = 'Minh Tuấn';
  context.renderRoster(context.findQuickSearchStudents(fields.quickStudentSearchMain.value));
  assert.equal((fields.studentRoster.innerHTML.match(/class-group-title/g) || []).length, 2);
  assert.match(fields.studentRoster.innerHTML, /8T35A \(Buổi Tối\)/);
  assert.match(fields.studentRoster.innerHTML, /9S2 \(Buổi Sáng\)/);
  assert.match(fields.rosterMeta.textContent, /^2 học sinh · Tất cả lớp/);
});

test('clearing search restores the selected class and its own roster', () => {
  const { context, fields } = setup();
  fields.quickStudentSearchMain.value = 'Nguyễn bá Minh';
  context.renderRoster();
  fields.quickStudentSearchMain.value = '';
  context.renderRoster();
  assert.equal(fields.rosterTitle.textContent, 'Lớp 8VS2');
  assert.equal(fields.rosterMeta.textContent, '1 học sinh · 0 đang báo vắng');
  assert.match(fields.studentRoster.innerHTML, /data-id="vs2"/);
  assert.doesNotMatch(fields.studentRoster.innerHTML, /data-id="tuan"|class-group-title/);
});

test('an empty global search reports no match without labeling the selected class empty', () => {
  const { context, fields } = setup();
  fields.quickStudentSearchMain.value = 'Không có tên này';
  context.renderRoster();
  assert.equal(fields.rosterTitle.textContent, 'Kết quả tra cứu học sinh');
  assert.match(fields.studentRoster.innerHTML, /Không tìm thấy học sinh khớp nội dung tra cứu/);
});
