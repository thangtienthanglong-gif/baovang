const assert = require('node:assert/strict');
const test = require('node:test');
const { groupQuitStudents } = require('../lib/quit-history');

function rows() {
  return [
    { id: 'regular', code: 'AUTO-1', fullName: 'Thái Song Quang', className: '8T3M+', phone1: '0908332401', quitDate: '2026-10-13', quitReason: '' },
    { id: 'advanced', code: 'AUTO-2', fullName: 'Thái Song Quang', className: '8NT7M', phone1: '0908332401', quitDate: '2026-10-10', quitReason: '' }
  ];
}

test('the reported two math enrollments become one person with both classes and withdrawal dates', () => {
  const source = rows();
  const before = structuredClone(source);
  const grouped = groupQuitStudents(source);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].fullName, 'Thái Song Quang');
  assert.equal(grouped[0].subject, 'Toán');
  assert.deepEqual(grouped[0].classNames, ['8T3M+', '8NT7M']);
  assert.deepEqual(grouped[0].quitDates, ['2026-10-13', '2026-10-10']);
  assert.deepEqual(grouped[0].studentIds, ['regular', 'advanced']);
  assert.equal(grouped[0].phone1, '0908332401');
  assert.equal(grouped[0].withdrawals.length, 2);
  assert.deepEqual(source, before);
});

test('Vietnam phone formatting, name casing, whitespace and composed accents identify the same contact', () => {
  const source = rows();
  source[1].phone1 = '+84 908 332 401';
  source[1].fullName = '  THÁI   SONG QUANG '.normalize('NFD');
  assert.equal(groupQuitStudents(source).length, 1);
});

test('different names, conflicting phones and other subjects remain separate', () => {
  const source = rows();
  source.push({ ...source[0], id: 'sibling', fullName: 'Thái Song Minh' });
  source.push({ ...source[0], id: 'same-name', phone1: '0909999999' });
  source.push({ ...source[0], id: 'english', className: '8AT2' });
  assert.equal(groupQuitStudents(source).length, 4);
});

test('a name alone cannot merge enrollments without a reliable phone or shared identifier', () => {
  const source = rows().map(row => ({ ...row, phone1: '' }));
  assert.equal(groupQuitStudents(source).length, 2);
  source.forEach(row => { row.code = 'HS001'; });
  assert.equal(groupQuitStudents(source).length, 1);
});

test('distinct reasons retain their dates and classes while repeated reasons display once', () => {
  const source = rows();
  source[0].quitReason = 'Bận lịch';
  source[1].quitReason = 'Chuyển trường';
  const grouped = groupQuitStudents(source)[0];
  assert.match(grouped.quitReason, /13\/10\/2026 · 8T3M\+: Bận lịch/);
  assert.match(grouped.quitReason, /10\/10\/2026 · 8NT7M: Chuyển trường/);
  source[1].quitReason = 'Bận lịch';
  assert.equal(groupQuitStudents(source)[0].quitReason, 'Bận lịch');
});

test('equal withdrawal dates display once, with both classes preserved', () => {
  const source = rows();
  source[1].quitDate = source[0].quitDate;
  assert.deepEqual(groupQuitStudents(source)[0].quitDates, ['2026-10-13']);
  assert.equal(groupQuitStudents(source)[0].classNames.length, 2);
});
