const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function select() {
  return {
    value: '', html: '',
    set innerHTML(html) {
      this.html = html;
      this.value = html.match(/value="([^"]*)"/)?.[1] || '';
    },
    get innerHTML() { return this.html; },
    values() { return [...this.html.matchAll(/value="([^"]*)"/g)].map(match => match[1]); }
  };
}

function setup(students) {
  const fields = Object.fromEntries([
    'makeupModalStudentId', 'makeupModalOriginalClass', 'makeupModalStudentName',
    'makeupModalStuckDay', 'makeupModalTargetClass', 'makeupModalTargetDay'
  ].map(id => [id, select()]));
  fields.makeupModal = { style: {} };
  const context = {
    state: { today: '2026-10-07', students },
    document: { getElementById: id => fields[id] },
    escapeHtml: value => value,
    reloadMakeupList: async () => {}
  };
  vm.createContext(context);
  for (const [start, end] of [
    ['function isActiveStudent(', 'function normalizeAbsenceStatus('],
    ['function getClassScheduleInfo(', 'function renderFilters('],
    ['function getClassGrade(', 'function normalizeComparableText('],
    ['async function openMakeupModal(', 'async function reloadMakeupList('],
    ['function getTransferSubjectKey(', 'function openTransferClassModal(']
  ]) vm.runInContext(slice(start, end), context);
  return { context, fields };
}

const student = (className, status = 'Đang học') => ({ id: className, className, status });

test('math makeup choices include N-prefixed classes in the same grade and their actual days', async () => {
  const { context, fields } = setup([
    ...['8S46A', '8NSCC', '8NC7A', '8NT7B', '8T24B', '8AT3', '8VS7', '8KS4B', '7NSCC', '9NC7A'].map(code => student(code)),
    student('8NSCC'), student('8NSCD', 'Nghỉ học')
  ]);
  await context.openMakeupModal('8S46A', 'Học sinh kiểm tra', '8S46A');
  assert.deepEqual(fields.makeupModalTargetClass.values(), ['8NC7A', '8NSCC', '8NT7B', '8T24B']);
  assert.deepEqual(fields.makeupModalStuckDay.values(), ['4', '6']);
  fields.makeupModalTargetClass.value = '8NSCC';
  fields.makeupModalTargetClass.onchange();
  assert.deepEqual(fields.makeupModalTargetDay.values(), ['8']);
  fields.makeupModalTargetClass.value = '8NC7A';
  fields.makeupModalTargetClass.onchange();
  assert.deepEqual(fields.makeupModalTargetDay.values(), ['7']);
  assert.equal(fields.makeupModal.style.display, 'flex');
});

test('N-prefixed math students can also choose regular math classes', async () => {
  const { context, fields } = setup(['8NSCC', '8NC7A', '8S46A', '8AT3', '9S46A'].map(code => student(code)));
  await context.openMakeupModal('8NSCC', 'Học sinh kiểm tra', '8NSCC');
  assert.deepEqual(fields.makeupModalTargetClass.values(), ['8NC7A', '8S46A']);
  assert.deepEqual(fields.makeupModalStuckDay.values(), ['8']);
});

test('other subjects still restrict makeup choices to the same subject and grade', async () => {
  const { context, fields } = setup(['8AT3', '8ASC', '8NSCC', '8S46A', '8VS7', '8KS4B', '9AT3'].map(code => student(code)));
  await context.openMakeupModal('8AT3', 'Học sinh kiểm tra', '8AT3');
  assert.deepEqual(fields.makeupModalTargetClass.values(), ['8ASC']);
  assert.deepEqual(fields.makeupModalTargetDay.values(), ['8']);
});

test('transfer subject filters classify advanced math consistently with makeup choices', () => {
  const { context } = setup([]);
  for (const code of ['8NSCC', '8NC7A', '8NT7B', ' 8nscc ', '8S46A', '6CT1(3-5)', '6T2M+']) {
    assert.equal(context.getTransferSubjectKey(code), 'TOAN', code);
  }
  for (const [code, expected] of [['8AT3', 'A'], ['8VS7', 'V'], ['8KS4B', 'K'], ['8XYZ', 'OTHER']]) {
    assert.equal(context.getTransferSubjectKey(code), expected);
  }
});
