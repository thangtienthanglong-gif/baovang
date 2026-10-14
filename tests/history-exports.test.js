const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const XLSX = require('xlsx-js-style');

const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function slice(start, end) {
  const offset = source.indexOf(start);
  const finish = source.indexOf(end, offset);
  assert.ok(offset >= 0 && finish > offset);
  return source.slice(offset, finish);
}

function setup(db) {
  const routes = new Map();
  const context = {
    XLSX,
    app: { get: (url, handler) => routes.set(url, handler) },
    getBranchDb: async req => req.headers['x-branch-id'] === 'other' ? {} : db,
    cleanText: value => String(value ?? '').replace(/\s+/g, ' ').trim()
  };
  Object.assign(context, require('../lib/history-date-range'));
  context.subjectForClass = require('../lib/attendance-alerts').subjectForClass;
  context.groupQuitStudents = require('../lib/quit-history').groupQuitStudents;
  vm.createContext(context);
  vm.runInContext(source.match(/^const ABSENCE_STATUSES = .*;$/m)[0], context);
  for (const [start, end] of [
    ['function normalizeAbsenceStatus(', 'function normalizeInitialReason('],
    ['function normalizeSearchText(', 'function countByLabel('],
    ['function quitStudentDetails(', 'function markStudentWithdrawn('],
    ['function filterCallLogs(', 'function buildMessage('],
    ['function filterRemovedClassStudents(', "app.post('/api/students/:id/remove-from-class'"],
    ['function filterQuitStudents(', "app.delete('/api/quit-students/clear'"],
    ["app.get('/api/call-logs/export'", "app.delete('/api/call-logs'"],
    ["app.get('/api/notification-logs/export'", "app.get('/api/notification-logs'"]
  ]) vm.runInContext(slice(start, end), context);
  return async (route, query = {}, branch = 'main') => {
    const headers = {};
    let buffer;
    await routes.get(route)(
      { query, headers: { 'x-branch-id': branch } },
      { setHeader: (key, value) => { headers[key] = value; }, send: value => { buffer = value; } },
      error => { throw error; }
    );
    assert.ok(Buffer.isBuffer(buffer));
    assert.equal(headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    return {
      filename: headers['Content-Disposition'],
      sheet: workbook.SheetNames[0],
      rows: XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]])
    };
  };
}

function notice(overrides = {}) {
  return {
    id: 'n1', date: '2026-10-12', time: '2026-10-12T13:00:00Z',
    studentName: 'Nguyễn An', className: '8T3M+', phone1: '0901234567',
    absenceStatus: 'Vắng không phép', status: 'Đã gửi', ...overrides
  };
}

test('general notification export keeps its send-day range and excludes attendance and tuition notices', async () => {
  const exportFile = setup({ absences: [], notificationLogs: [
    notice({ id: 'exam', absenceStatus: 'Kiểm tra định kì', date: '2026-10-01' }),
    notice({ id: 'registration', absenceStatus: 'Đăng ký mới', date: '2026-10-01' }),
    notice({ id: 'yesterday', absenceStatus: 'Kiểm tra định kì', time: '2026-10-11T13:00:00Z' }),
    notice({ id: 'attendance' }), notice({ id: 'tuition', absenceStatus: 'Học phí' })
  ] });
  const general = await exportFile('/api/notification-logs/export', { notificationType: 'general', dateBasis: 'time', date: '2026-10-12' });
  assert.equal(general.rows.length, 2);
  assert.equal(general.sheet, 'Thong Bao');
  assert.match(general.filename, /lich-su-thong-bao-2026-10-12/);
  const attendance = await exportFile('/api/notification-logs/export', { excludeAbsenceStatus: 'Học phí', excludeGeneralNotifications: true });
  assert.equal(attendance.rows.length, 1);
  assert.equal(attendance.rows[0]['Loại thông báo'], 'Vắng không phép');
});

test('absence Excel exports all matching history beyond one page and excludes calls and tuition', async () => {
  const exportFile = setup({
    notificationLogs: [
      ...Array.from({ length: 32 }, (_, index) => notice({ id: `n${index}` })),
      notice({ absenceStatus: 'Học phí' }), notice({ callLogId: 'call1' }),
      notice({ studentName: 'Bình' }), notice({ date: '2026-10-11' }),
      notice({ status: 'Chưa kết bạn - Cần gọi' }),
      notice({ absenceId: 'called-absence' })
    ],
    absences: [{ id: 'called-absence', status: 'Đã gọi' }]
  });
  const query = { date: '2026-10-12', q: 'nguyễn an', excludeAbsenceStatus: 'Học phí' };
  const file = await exportFile('/api/notification-logs/export', query);
  assert.equal(file.rows.length, 32);
  assert.equal(file.sheet, 'Lich Su Vang');
  assert.match(file.filename, /lich-su-vang-2026-10-12\.xlsx/);
  assert.equal(file.rows[31].STT, 32);
  assert.equal(file.rows[0]['SĐT'], '0901234567');
  assert.equal(file.rows[0]['Thời gian'], new Date('2026-10-12T13:00:00Z').toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const empty = await exportFile('/api/notification-logs/export', query, 'other');
  assert.equal(empty.rows.length, 0);
});

test('tuition Excel uses the Vietnam send day and recovers types from old messages', async () => {
  const exportFile = setup({ notificationLogs: [
    notice({ date: '2026-10-01', time: '2026-10-11T18:00:00Z', absenceStatus: '', message: 'Học sinh: Học phí - thông báo' }),
    notice({ absenceStatus: 'Học phí', time: '2026-10-12T18:00:00Z' }),
    notice(), notice({ absenceStatus: 'Học phí', callLogId: 'called' })
  ] });
  const file = await exportFile('/api/notification-logs/export', { date: '2026-10-12', absenceStatus: 'Học phí', dateBasis: 'time' });
  assert.equal(file.rows.length, 1);
  assert.equal(file.sheet, 'Lich Su Hoc Phi');
  assert.equal(file.rows[0]['Ngày lịch sử'], '2026-10-12');
  assert.equal(file.rows[0]['Loại thông báo'], 'Học phí');
});

test('call exports separate absence and tuition using original history day and retain every outcome', async () => {
  const exportFile = setup({
    notificationLogs: [notice({ id: 'absence' }), notice({ id: 'tuition', absenceStatus: 'Học phí', date: '2026-10-01' })],
    callLogs: [
      ...['Đã gọi', 'Không bắt máy', 'Không liên lạc được'].map((result, index) => ({
        id: `c${index}`, notificationLogId: 'absence', date: '2026-10-13',
        time: '2026-10-13T03:00:00Z', studentName: 'Nguyễn An', phoneCalled: '0901234567',
        callStatus: index ? 'Lỗi gọi' : 'Đã gọi', callResult: result
      })),
      { id: 'tuition-call', notificationLogId: 'tuition', date: '2026-10-13', time: '2026-10-13T04:00:00Z', studentName: 'Nguyễn An', callStatus: 'Đã gọi' }
    ]
  });
  const absence = await exportFile('/api/call-logs/export', { date: '2026-10-12', q: 'nguyễn', excludeAbsenceStatus: 'Học phí' });
  assert.equal(absence.sheet, 'Goi Vang');
  assert.equal(absence.rows.length, 3);
  assert.deepEqual(absence.rows.map(row => row['Trạng thái cuộc gọi']), ['Đã gọi', 'Không nghe máy', 'Không liên lạc được']);
  assert.equal(absence.rows[0]['Ngày lịch sử'], '2026-10-12');
  const tuition = await exportFile('/api/call-logs/export', { date: '2026-10-12', absenceStatus: 'Học phí' });
  assert.equal(tuition.sheet, 'Goi Hoc Phi');
  assert.equal(tuition.rows.length, 1);
  assert.match(tuition.filename, /lich-su-goi-hoc-phi-2026-10-12\.xlsx/);
});

test('removal Excel matches date and accent-insensitive search and retains original class snapshots', async () => {
  const exportFile = setup({ classRemovalHistory: [
    { fullName: 'Nguyễn An', className: '8OLD', removedDate: '2026-10-12', removedAt: '2026-10-12T13:00:00Z', phone1: '0901234567' },
    { fullName: 'Nguyễn An', className: '8OLD', removedDate: '2026-10-11', removedAt: '2026-10-11T13:00:00Z' },
    { fullName: 'Bình', className: '8OLD', removedDate: '2026-10-12', removedAt: '2026-10-12T14:00:00Z' }
  ] });
  const file = await exportFile('/api/removed-class-students/export', { date: '2026-10-12', q: 'nguyen an' });
  assert.equal(file.rows.length, 1);
  assert.equal(file.sheet, 'Da Xoa Khoi Lop');
  assert.equal(file.rows[0]['Lớp'], '8OLD');
  assert.equal(file.rows[0]['SĐT'], '0901234567');
});

test('withdrawal Excel keeps all dates shown in its panel and exports the saved reason', async () => {
  const exportFile = setup({ students: [
    { id: 's1', status: 'Nghỉ học', fullName: 'Nguyễn An', quitDate: '2026-09-30', quitReason: 'Chuyển trường', phone1: '0901234567' },
    { id: 's2', status: 'Đang học', fullName: 'Nguyễn An' },
    { id: 's3', status: 'Nghỉ học', fullName: 'Bình', quitDate: '2026-10-12' }
  ] });
  const file = await exportFile('/api/quit-students/export', { q: 'nguyen an' });
  assert.equal(file.rows.length, 1);
  assert.equal(file.rows[0]['Ngày nghỉ'], '30/09/2026');
  assert.equal(file.rows[0]['Lý do'], 'Chuyển trường');
  assert.equal(file.rows[0]['SĐT'], '0901234567');
});

test('all history Excel exports include both interval boundaries and exclude outside records', async () => {
  const dates = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'];
  const exportFile = setup({
    notificationLogs: dates.flatMap((date, i) => [
      notice({ id: `absence${i}`, date, time: `${date}T10:00:00Z` }),
      notice({ id: `tuition${i}`, date: '2026-09-01', time: `${date}T10:00:00Z`, absenceStatus: 'Học phí' })
    ]),
    callLogs: dates.flatMap((date, i) => [
      { id: `call${i}`, date, time: `${date}T10:00:00Z`, studentName: 'An', absenceStatus: 'Vắng' },
      { id: `fee-call${i}`, date, time: `${date}T10:00:00Z`, studentName: 'An', absenceStatus: 'Học phí' }
    ]),
    students: dates.map((date, i) => ({ id: `s${i}`, status: 'Nghỉ học', fullName: 'An', quitDate: date, quitReason: 'Chuyển trường' })),
    classRemovalHistory: dates.map((date, i) => ({ id: `removed${i}`, fullName: 'An', removedDate: date, removedAt: `${date}T10:00:00Z` }))
  });
  const range = { dateStart: '2026-10-10', dateEnd: '2026-10-12' };
  for (const [route, type] of [
    ['/api/notification-logs/export', { excludeAbsenceStatus: 'Học phí' }],
    ['/api/notification-logs/export', { absenceStatus: 'Học phí', dateBasis: 'time' }],
    ['/api/call-logs/export', { excludeAbsenceStatus: 'Học phí' }],
    ['/api/call-logs/export', { absenceStatus: 'Học phí' }],
    ['/api/quit-students/export', {}], ['/api/removed-class-students/export', {}]
  ]) {
    const file = await exportFile(route, { ...range, ...type });
    assert.equal(file.rows.length, 3, route);
    assert.match(file.filename, /2026-10-10_den_2026-10-12\.xlsx/);
  }
});

test('withdrawal Excel combines grade, subject, date and keyword and preserves reasons and phones', async () => {
  const exportFile = setup({ students: [
    { id: 'target', status: 'Nghỉ học', fullName: 'An', className: '8KS4M', quitDate: '2026-10-14', quitReason: 'Học mệt', phone1: '0901234567' },
    { id: 'other-grade', status: 'Nghỉ học', fullName: 'An', className: '7KS4M', quitDate: '2026-10-14' },
    { id: 'other-subject', status: 'Nghỉ học', fullName: 'An', className: '8VT2', quitDate: '2026-10-14' },
    { id: 'old', status: 'Nghỉ học', fullName: 'An', className: '8KS4M', quitDate: '2026-09-14' },
    { id: 'other-name', status: 'Nghỉ học', fullName: 'Bình', className: '8KS4M', quitDate: '2026-10-14' }
  ] });
  const file = await exportFile('/api/quit-students/export', { grade: '8', subject: 'K', q: 'an', dateStart: '2026-10-01', dateEnd: '2026-10-14' });
  assert.equal(file.rows.length, 1);
  assert.equal(file.rows[0]['Lớp'], '8KS4M');
  assert.equal(file.rows[0]['Lý do'], 'Học mệt');
  assert.equal(file.rows[0]['SĐT'], '0901234567');
});

test('withdrawal Excel exports one grouped math student with every selected class, date and reason', async () => {
  const db = { students: [
    { id: 's1', status: 'Nghỉ học', code: 'AUTO-1', fullName: 'Thái Song Quang', className: '8T3M+', phone1: '0908332401', quitDate: '2026-10-13', quitReason: 'Bận lịch' },
    { id: 's2', status: 'Nghỉ học', code: 'AUTO-2', fullName: 'Thái Song Quang', className: '8NT7M', phone1: '0908332401', quitDate: '2026-10-10', quitReason: 'Chuyển trường' }
  ] };
  const file = await setup(db)('/api/quit-students/export', { grade: '8', subject: 'TOAN', dateStart: '2026-10-10', dateEnd: '2026-10-13' });
  assert.equal(file.rows.length, 1);
  assert.equal(file.rows[0]['Ngày nghỉ'], '13/10/2026\n10/10/2026');
  assert.equal(file.rows[0]['Lớp'], '8T3M+, 8NT7M');
  assert.match(file.rows[0]['Lý do'], /Bận lịch/);
  assert.match(file.rows[0]['Lý do'], /Chuyển trường/);
  const singleDate = await setup(db)('/api/quit-students/export', { date: '2026-10-13' });
  assert.equal(singleDate.rows[0]['Lớp'], '8T3M+');
});
