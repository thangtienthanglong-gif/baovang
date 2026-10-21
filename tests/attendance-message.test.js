const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const AttendanceMessage = require('../public/attendance-message');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function slice(source, start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
function messageContext() {
  const context = { AttendanceMessage, ...require('../lib/tuition-reminders') };
  vm.createContext(context);
  vm.runInContext(server.match(/^const ABSENCE_STATUSES = .*;$/m)[0], context);
  vm.runInContext(server.match(/^const DEFAULT_ABSENCE_MESSAGE_TEMPLATE = .*;$/m)[0], context);
  vm.runInContext(server.match(/^const OLD_ABSENCE_MESSAGE_TEMPLATE = .*;$/m)[0], context);
  vm.runInContext(server.match(/^const DEFAULT_EARLY_LEAVE_TEMPLATE = .*;$/m)[0], context);
  vm.runInContext(slice(server, 'function cleanText(', 'function normalizePhone('), context);
  vm.runInContext(slice(server, 'function buildMessage(', 'function normalizeCozeBaseUrl('), context);
  return context;
}

test('each weekday starts on the send date and ends on the same Sunday; Sunday omits makeup', () => {
  for (let day = 19; day <= 25; day++) {
    const result = AttendanceMessage.makeupNotice('Vắng', new Date(`2026-10-${day}T08:00:00Z`));
    assert.equal(result, day === 25 ? ''
      : `Học sinh có thể đi bù từ thứ ${day - 17} ngày ${day}/10/2026 đến Chủ nhật ngày 25/10/2026.`);
  }
});

test('morning and afternoon absences start in the following session; evening starts the next day', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const notice = session => AttendanceMessage.makeupNotice('Vắng', now, undefined, { attendanceDate: '2026-10-19', session });
  assert.equal(notice('Sáng'), 'Học sinh có thể đi bù từ chiều thứ 2 ngày 19/10/2026 đến Chủ nhật ngày 25/10/2026.');
  assert.equal(notice('Chiều'), 'Học sinh có thể đi bù từ tối thứ 2 ngày 19/10/2026 đến Chủ nhật ngày 25/10/2026.');
  assert.equal(notice('Tối'), 'Học sinh có thể đi bù từ thứ 3 ngày 20/10/2026 đến Chủ nhật ngày 25/10/2026.');
  assert.equal(notice('Buổi tối'), notice('Tối'));
  assert.equal(notice('Cả ngày'), notice('Tối'));
});

test('evening absences retain the original week across Saturday, month and year boundaries', () => {
  const notice = (date, now = `${date}T08:00:00Z`) => AttendanceMessage.makeupNotice('Có phép', new Date(now), undefined,
    { attendanceDate: date, session: 'Tối' });
  assert.equal(notice('2026-10-24'), 'Học sinh có thể đi bù từ Chủ nhật ngày 25/10/2026 đến Chủ nhật ngày 25/10/2026.');
  assert.equal(notice('2026-10-25'), '');
  assert.match(notice('2026-10-31'), /Chủ nhật ngày 01\/11\/2026 đến Chủ nhật ngày 01\/11\/2026/);
  assert.match(notice('2026-12-31'), /thứ 6 ngày 01\/01\/2027.*03\/01\/2027/);
});

test('late sends use the absence week, never offer past dates, and omit an expired week', () => {
  const attendance = { attendanceDate: '2026-10-19', session: 'Tối' };
  const notice = now => AttendanceMessage.makeupNotice('Vắng', new Date(now), undefined, attendance);
  assert.match(notice('2026-10-19T08:00:00Z'), /20\/10\/2026.*25\/10\/2026/);
  assert.match(notice('2026-10-20T08:00:00Z'), /20\/10\/2026.*25\/10\/2026/);
  assert.match(notice('2026-10-21T08:00:00Z'), /21\/10\/2026.*25\/10\/2026/);
  assert.equal(notice('2026-10-25T08:00:00Z'), '');
  assert.equal(notice('2026-10-26T08:00:00Z'), '');
});

test('session-based schedules honor Vietnam midnight and do not alter editable wording or placement', () => {
  const data = { absenceStatus: 'Vắng', attendanceDate: '2026-10-19', session: 'Tối' };
  const template = 'Mở đầu\n{makeupNotice}\nKết thúc';
  const custom = 'Đăng ký bù: {makeupStartDay} ({makeupStartDate}) – {makeupEndDay} ({makeupEndDate}).';
  assert.equal(AttendanceMessage.renderTemplate(template, data, new Date('2026-10-19T17:01:00Z'), custom),
    'Mở đầu\nĐăng ký bù: thứ 3 (20/10/2026) – Chủ nhật (25/10/2026).\nKết thúc');
  assert.equal(AttendanceMessage.renderTemplate(template, data, new Date('2026-10-24T17:00:00Z'), custom), 'Mở đầu\n\nKết thúc');
});

test('Vietnam midnight changes the send date, even on a UTC server', () => {
  assert.match(AttendanceMessage.makeupNotice('Có phép', new Date('2026-10-24T16:59:59Z')), /24\/10\/2026/);
  assert.equal(AttendanceMessage.makeupNotice('Có phép', new Date('2026-10-24T17:00:00Z')), '');
  assert.match(AttendanceMessage.makeupNotice('Có phép', new Date('2026-10-25T17:00:00Z')), /26\/10\/2026.*01\/11\/2026/);
  assert.match(AttendanceMessage.makeupNotice('Vắng', new Date('2026-12-31T08:00:00Z')), /31\/12\/2026.*03\/01\/2027/);
});

test('editable makeup wording retains automatic dates and still disappears on Sunday', () => {
  const template = 'Em được học bù trong tuần: {makeupStartDay} ({makeupStartDate}) – {makeupEndDay} ({makeupEndDate}).';
  assert.equal(AttendanceMessage.makeupNotice('Vắng', new Date('2026-10-19T08:00:00Z'), template),
    'Em được học bù trong tuần: thứ 2 (19/10/2026) – Chủ nhật (25/10/2026).');
  for (const status of ['Vắng', 'Có phép', 'Về sớm', 'Đi trễ', 'Học phí']) {
    assert.equal(AttendanceMessage.makeupNotice(status, new Date('2026-10-25T08:00:00Z'), template), '');
  }
  for (const template of ['', '   ', undefined]) {
    assert.equal(AttendanceMessage.makeupNotice('Vắng', new Date('2026-10-19T08:00:00Z'), template),
      'Học sinh có thể đi bù từ thứ 2 ngày 19/10/2026 đến Chủ nhật ngày 25/10/2026.');
  }
});

test('all absence aliases get makeup; unrelated notifications and early departure never do', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  for (const status of ['Vắng', 'Có phép', 'Vắng có phép', 'Vắng không phép', 'Không phép', 'Cả ngày']) {
    assert.ok(AttendanceMessage.makeupNotice(status, now), status);
  }
  for (const status of ['Về sớm', 'Đi trễ', 'Đã bù', 'Học phí', 'Nghỉ học', 'Kiểm tra định kì', 'Đăng ký mới', 'Thông báo chung']) {
    assert.equal(AttendanceMessage.makeupNotice(status, now), '', status);
  }
});

test('custom absence templates gain the notice automatically or insert it once at the chosen position', () => {
  const data = { studentName: 'An', absenceStatus: 'Vắng không phép' };
  const now = new Date('2026-10-19T08:00:00Z');
  const oldCustom = AttendanceMessage.renderTemplate('Em {studentName} vắng.', data, now);
  assert.match(oldCustom, /^Em An vắng\.\nHọc sinh có thể đi bù/);
  const explicit = AttendanceMessage.renderTemplate('Em {studentName} vắng.\n{makeupNotice}\nTrân trọng.', data, now);
  assert.equal((explicit.match(/có thể đi bù/g) || []).length, 1);
  assert.match(explicit, /25\/10\/2026\.\nTrân trọng\.$/);
  const sunday = AttendanceMessage.renderTemplate('Em {studentName} vắng.\n{makeupNotice}', data, new Date('2026-10-25T08:00:00Z'));
  assert.equal(sunday, 'Em An vắng.');
});

const student = { id: 's1', fullName: 'Nguyễn An', className: '6T2', phone1: '0900000000' };
test('server uses attendance date and session, with an independent early-leave template', () => {
  const context = messageContext();
  const record = { date: '2026-10-19', session: 'Tối', absenceStatus: 'Vắng', initialReason: 'Vắng' };
  const settings = { messageTemplate: '{studentName}: {absenceStatus}, {date}.', earlyLeaveTemplate: 'TIN VỀ SỚM: {studentName}, {reason}, {date}.' };
  assert.match(context.buildMessage(settings, record, student, new Date('2026-10-19T08:00:00Z')), /19\/10\/2026.*\n.*20\/10\/2026.*25\/10\/2026/);
  assert.doesNotMatch(context.buildMessage(settings, { ...record, date: '2026-09-01' }, student, new Date('2026-10-19T08:00:00Z')), /đi bù/);
  assert.doesNotMatch(context.buildMessage(settings, record, student, new Date('2026-10-25T08:00:00Z')), /đi bù/);
  const customized = { ...settings, makeupNoticeTemplate: 'Lịch bù: {makeupStartDate} đến {makeupEndDate}.' };
  assert.match(context.buildMessage(customized, record, student, new Date('2026-10-19T08:00:00Z')), /\nLịch bù: 20\/10\/2026 đến 25\/10\/2026\.$/);
  assert.doesNotMatch(context.buildMessage(customized, record, student, new Date('2026-10-25T08:00:00Z')), /Lịch bù/);
  const early = { ...record, absenceStatus: 'Về sớm', initialReason: 'Về sớm lúc 17:15' };
  const message = context.buildMessage(settings, early, student, new Date('2026-10-19T08:00:00Z'));
  assert.equal(message, 'TIN VỀ SỚM: Nguyễn An, Về sớm lúc 17:15, 19/10/2026.');
  assert.match(context.buildMessage({}, early, student), /Về sớm lúc 17:15/);
  assert.doesNotMatch(context.buildMessage({}, early, student), /đi bù|Vắng học/);
});

test('settings preview matches the server and never adds makeup to non-absence templates', () => {
  const now = new Date('2026-10-19T08:00:00Z');
  const shared = { renderTemplate: (template, data, _now, makeupTemplate) => AttendanceMessage.renderTemplate(template, data, now, makeupTemplate) };
  const fields = Object.fromEntries(Object.entries({ previewTypeSelect: 'absence', previewAbsenceStatusSelect: 'Vắng có phép',
    messageTemplate: '{studentName}: {absenceStatus}, {date}.', earlyLeaveTemplate: '{studentName}: {reason}, {date}.',
    tuitionTemplate: 'Nhắc học phí: {studentName}', periodicTemplate: 'Thông báo: {studentName}', schoolName: 'Trường học'
  }).map(([key, value]) => [key, { value }]));
  fields.messagePreview = {};
  fields.previewSessionSelect = { value: 'Sáng' };
  const context = { AttendanceMessage: shared, $: selector => fields[selector.slice(1)],
    selectedDate: () => '2026-10-19', selectedDay: () => 'ALL', getClassScheduleInfo: () => ({ sessionName: 'Tối' }) };
  vm.runInNewContext(slice(frontend, 'function renderMessagePreview(', 'function renderZaloModeFields('), context);
  context.renderMessagePreview();
  assert.match(fields.messagePreview.textContent, /Vắng có phép, 19\/10\/2026.*\n.*chiều thứ 2 ngày 19\/10\/2026.*25\/10\/2026/);
  fields.previewSessionSelect.value = 'Chiều';
  context.renderMessagePreview();
  assert.match(fields.messagePreview.textContent, /tối thứ 2 ngày 19\/10\/2026/);
  fields.previewSessionSelect.value = 'Tối';
  context.renderMessagePreview();
  assert.match(fields.messagePreview.textContent, /thứ 3 ngày 20\/10\/2026/);
  fields.makeupNoticeTemplate = { value: 'Lịch bù: {makeupStartDate} đến {makeupEndDate}.' };
  context.renderMessagePreview();
  assert.match(fields.messagePreview.textContent, /\nLịch bù: 20\/10\/2026 đến 25\/10\/2026\.$/);
  fields.previewTypeSelect.value = 'early-leave';
  context.renderMessagePreview();
  assert.match(fields.messagePreview.textContent, /Về sớm lúc 17:00/);
  assert.doesNotMatch(fields.messagePreview.textContent, /đi bù/);
  assert.equal(fields.previewAbsenceStatusSelect.hidden, true);
  assert.equal(fields.previewSessionSelect.hidden, true);
  for (const type of ['tuition', 'periodic']) {
    fields.previewTypeSelect.value = type;
    context.renderMessagePreview();
    assert.doesNotMatch(fields.messagePreview.textContent, /đi bù/);
  }
});

test('early-leave attendance saves the chosen time; cancel or changed context sends no request', async () => {
  for (const variant of ['new', 'existing', 'cancel', 'branch', 'date']) {
    const calls = [];
    let changed = false;
    const context = {
      state: { students: [student] }, normalizeAbsenceStatus: value => value,
      absenceForStudent: () => variant === 'existing' ? { absenceStatus: 'Vắng' } : null,
      getActiveBranch: () => changed && variant === 'branch' ? 'other' : 'main',
      selectedDate: () => changed && variant === 'date' ? '2026-10-20' : '2026-10-19', selectedDay: () => '2',
      requestEarlyLeaveTime: async () => { changed = true; return variant === 'cancel' ? null : '17:15'; },
      getClassScheduleInfo: () => ({ sessionName: 'Tối' }),
      api: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return {}; },
      toast() {}, queuedMessage: () => '', loadBootstrap: async () => {}, loadAttendanceAbsences: async () => {}
    };
    vm.runInNewContext(slice(frontend, 'async function updateRosterStatus(', 'function bulkZaloMessage('), context);
    const select = { value: 'Về sớm', dataset: { studentId: student.id, attendanceClass: student.className,
      absenceId: variant === 'existing' ? 'a1' : '' } };
    if (['branch', 'date'].includes(variant)) {
      await assert.rejects(context.updateRosterStatus(select), /đã thay đổi/);
    } else await context.updateRosterStatus(select);
    if (['new', 'existing'].includes(variant)) {
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.initialReason, 'Về sớm lúc 17:15');
      assert.equal(calls[0].body.absenceStatus, 'Về sớm');
    } else assert.equal(calls.length, 0);
  }
});
