const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { registerStudentNotificationRoutes, NOTICE_TYPES } = require('../lib/student-notifications');
const { buildAttendanceAlerts } = require('../lib/attendance-alerts');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function slice(start, end) {
  const from = server.indexOf(start), to = server.indexOf(end, from);
  assert.ok(from >= 0 && to > from);
  return server.slice(from, to);
}
function assertFirebaseValues(value, field = 'branches.main') {
  if (value === undefined) throw new Error(`Firebase cannot save undefined at ${field}`);
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertFirebaseValues(child, `${field}.${key}`);
  }
}
function setup() {
  const db = {
    settings: { schoolName: 'Trường học', zaloMode: 'personal-real',
      examNoticeTemplate: 'Kiểm tra ngày 20/10 cho {studentName}, lớp {className}.',
      enrollmentNoticeTemplate: 'Mời {studentName}, lớp {className} đăng ký khóa mới trước 25/10.',
      messageTemplate: 'Thông báo vắng' },
    students: [{ id: 's1', fullName: 'Trương Bảo (C) Ngọc', className: '8T3M+', phone1: '0977686959', status: 'Đang học' }],
    absences: ['2026-10-10', '2026-10-14'].map((date, i) => ({ id: `a${i}`, studentId: 's1', date, attendanceClass: '8T3M+', session: 'Tối', absenceStatus: 'Vắng', noticeStatus: 'Lỗi gửi' })),
    notificationLogs: [], callLogs: []
  };
  const branches = { main: db, other: { students: [], absences: [], notificationLogs: [], settings: {} } };
  const routes = new Map();
  let saves = 0, counter = 0;
  const context = {
    app: Object.fromEntries(['get', 'post'].map(method => [method, (route, handler) => routes.set(`${method} ${route}`, handler)])),
    getBranchDb: async req => branches[req.branch], saveBranchDb: async (req, branchDb) => {
      assertFirebaseValues(branchDb);
      saves++;
    },
    cleanText: value => String(value ?? '').trim(), normalizePhone: value => value,
    normalizeInitialReason: value => value, absenceStatusForMessage: value => value,
    studentByIdMap: students => Object.fromEntries(students.map(row => [row.id, row])),
    resolveAbsenceMessageTemplate: value => value || 'Thông báo vắng',
    defaultSettings: () => db.settings,
    getZaloRuntimeConfig: () => ({ mode: 'personal-real' }),
    isWithdrawnAbsence: (row, student) => student.status === 'Nghỉ học' || student.removedFromClass,
    nowISO: () => '2026-10-14T09:00:00Z', id: prefix => `${prefix}-${++counter}`
  };
  Object.assign(context, require('../lib/history-date-range'));
  Object.assign(context, require('../lib/tuition-reminders'));
  vm.createContext(context);
  vm.runInContext(server.match(/^const ABSENCE_STATUSES = .*;$/m)[0], context);
  for (const [start, end] of [
    ['function normalizeAbsenceStatus(', 'function normalizeInitialReason('],
    ['function enrichAbsence(', 'function getSummary('],
    ['function getSummary(', 'function filterCallLogs('],
    ['function notificationLogDate(', 'function sendWorkbook('],
    ['function buildMessage(', 'function normalizeCozeBaseUrl('],
    ['async function sendZaloNotice(', 'let noticeSchedulerRunning'],
    ['function selectBulkZaloCandidates(', "app.post('/api/absences/zalo/bulk'"],
    ["app.post('/api/absences/zalo/bulk'", "app.post('/api/absences/:id/zalo/manual-sent'"],
    ["app.post('/api/absences/:id/zalo/manual-sent'", "app.post('/api/absences/:id/zalo'"]
  ]) vm.runInContext(slice(start, end), context);
  registerStudentNotificationRoutes(context.app, context);
  async function call(method, route, { body = {}, query = {}, branch = 'main', id = 's1' } = {}) {
    let data;
    await routes.get(`${method} ${route}`)({ params: { id }, body, query, branch }, { json: value => { data = value; } }, error => { throw error; });
    return data;
  }
  const input = type => ({ type, date: '2026-10-14', session: 'Tối' });
  const preview = type => call('get', '/api/students/:id/notifications/preview', { query: input(type) });
  async function create(type, sendNow = false, extra = {}) {
    const reviewed = await preview(type);
    return call('post', '/api/students/:id/notifications', { body: { ...input(type), message: reviewed.message, sendNow, ...extra } });
  }
  return { db, branches, context, call, preview, create, input, saves: () => saves };
}

for (const type of NOTICE_TYPES) {
  test(`${type}: preview and queue preserve attendance and warnings, and use the correct template`, async () => {
    const app = setup(), before = structuredClone(app.db.absences);
    const warnings = buildAttendanceAlerts(app.db, { endDate: '2026-10-14' });
    const preview = await app.preview(type);
    assert.match(preview.message, type === NOTICE_TYPES[0] ? /Kiểm tra ngày 20\/10/ : /đăng ký khóa mới/);
    assert.match(preview.message, /Trương Bảo \(C\) Ngọc/);
    assert.equal(app.db.contactRequests, undefined);
    assert.equal(app.saves(), 0);
    const response = await app.create(type);
    assert.equal(response.request.notificationOnly, true);
    assert.equal(response.request.noticeStatus, 'Chưa gửi');
    assert.equal(response.request.noticeSentAt, '');
    assert.equal(response.noticeLog, null);
    assert.deepEqual(app.db.absences, before);
    assert.deepEqual(buildAttendanceAlerts(app.db, { endDate: '2026-10-14' }), warnings);
    assert.equal(app.context.filterAbsences(app.db, { date: '2026-10-14' }).length, 1);
    assert.equal(app.context.filterAbsences(app.db, { date: '2026-10-14', includeNotifications: 'true', absenceStatus: type }).length, 1);
    assert.equal(app.context.getSummary(app.context.filterAbsences(app.db, { date: '2026-10-14', includeNotifications: true })).total, 1);
  });

  test(`${type}: send, exact success acknowledgement, and retry use separate notification history`, async () => {
    const app = setup(), before = structuredClone(app.db.absences);
    const response = await app.create(type, true);
    assert.equal(response.noticeLog.status, 'Chờ gửi thủ công');
    assert.equal(response.noticeLog.absenceStatus, type);
    assert.equal(response.noticeLog.notificationOnly, true);
    assert.equal(response.noticeLog.message, response.request.message);
    await app.call('post', '/api/absences/:id/zalo/manual-sent', { id: response.request.id, body: { logId: response.noticeLog.id } });
    await app.call('post', '/api/absences/:id/zalo/manual-sent', { id: response.request.id, body: { logId: response.noticeLog.id } });
    assert.equal(app.db.notificationLogs.length, 1);
    assert.equal(app.db.contactRequests[0].noticeStatus, 'Đã gửi');
    assert.deepEqual(app.db.absences, before);
    const query = { notificationType: 'general', dateBasis: 'time', date: '2026-10-14' };
    assert.equal(app.context.filterNotificationLogs(app.db, query).length, 1);
    assert.equal(app.context.filterNotificationLogs(app.db, { excludeGeneralNotifications: true }).length, 0);
    assert.equal((await app.create(type, true)).noticeLog, null, 'an already sent notice is not sent again');
    app.db.settings[type === NOTICE_TYPES[0] ? 'examNoticeTemplate' : 'enrollmentNoticeTemplate'] = 'Nội dung thay đổi cho {studentName}';
    const next = await app.create(type, true);
    assert.notEqual(next.request.id, response.request.id);
    await app.call('post', '/api/absences/:id/zalo/manual-error', { id: next.request.id, body: { logId: next.noticeLog.id, error: 'Không tìm thấy Zalo' } });
    assert.equal(app.db.contactRequests.at(-1).noticeStatus, 'Lỗi gửi');
    assert.deepEqual(app.db.absences, before);
  });
}

test('repeated queue choices reuse a notice, while two types on the same day remain independent', async () => {
  const app = setup();
  const first = await app.create(NOTICE_TYPES[0]);
  const second = await app.create(NOTICE_TYPES[0]);
  const third = await app.create(NOTICE_TYPES[1]);
  assert.equal(first.request.id, second.request.id);
  assert.equal(second.reused, true);
  assert.notEqual(first.request.id, third.request.id);
  assert.equal(app.db.contactRequests.length, 2);
});

test('a changed template requires another review before creating or sending anything', async () => {
  const app = setup();
  const preview = await app.preview(NOTICE_TYPES[0]);
  app.db.settings.examNoticeTemplate = 'Mẫu mới';
  await assert.rejects(app.call('post', '/api/students/:id/notifications', { body: { ...app.input(NOTICE_TYPES[0]), message: preview.message, sendNow: true } }), error => error.status === 409);
  assert.equal(app.saves(), 0);
  assert.equal(app.db.contactRequests, undefined);
});

test('invalid types, dates, wrong branches, inactive students and unfinished templates make no mutations', async () => {
  for (const variant of ['type', 'date', 'branch', 'withdrawn', 'removed', 'template']) {
    const app = setup();
    const query = app.input(NOTICE_TYPES[0]);
    if (variant === 'type') query.type = 'Vắng';
    if (variant === 'date') query.date = '2026-02-30';
    if (variant === 'withdrawn') app.db.students[0].status = 'Nghỉ học';
    if (variant === 'removed') app.db.students[0].removedFromClass = true;
    if (variant === 'template') app.db.settings.examNoticeTemplate = 'Ngày kiểm tra: [Nhập ngày, giờ]';
    const before = structuredClone(app.db);
    await assert.rejects(app.call('get', '/api/students/:id/notifications/preview', { query, branch: variant === 'branch' ? 'other' : 'main' }), error => [400, 404].includes(error.status));
    assert.deepEqual(app.db, before);
    assert.equal(app.saves(), 0);
  }
});

test('a queued notification sends its reviewed snapshot even if settings change before the bulk send', async () => {
  const app = setup();
  const { request } = await app.create(NOTICE_TYPES[0]);
  const reviewed = request.message;
  app.db.settings.examNoticeTemplate = 'Khác hoàn toàn';
  const log = await app.context.sendZaloNotice(app.db, request.id, 'bulk_send');
  assert.equal(log.message, reviewed);
  assert.equal(log.status, 'Chờ gửi thủ công');
});

test('bulk sending only selected notification IDs leaves attendance and other notification types untouched', async () => {
  const app = setup();
  const exam = await app.create(NOTICE_TYPES[0]);
  const enrollment = await app.create(NOTICE_TYPES[1]);
  const before = structuredClone(app.db.absences);
  const result = await app.context.runBulkZaloAction(app.db, { date: '2026-10-14', includeNotifications: true }, 'bulk_send', [exam.request.id]);
  assert.equal(result.processed, 1);
  assert.equal(result.logs[0].absenceId, exam.request.id);
  assert.equal(app.db.contactRequests.find(row => row.id === enrollment.request.id).noticeStatus, 'Chưa gửi');
  assert.deepEqual(app.db.absences, before);
});

test('bulk API saves pending exam and enrollment notices without undefined values rejected by Firebase', async () => {
  const app = setup();
  const exam = await app.create(NOTICE_TYPES[0]);
  const enrollment = await app.create(NOTICE_TYPES[1]);
  const before = structuredClone(app.db.absences);
  // Requests created before the fix do not have this field yet.
  for (const request of app.db.contactRequests) delete request.noticeSentAt;
  const result = await app.call('post', '/api/absences/zalo/bulk', { body: {
    filters: { date: '2026-10-14', includeNotifications: true },
    ids: [exam.request.id, enrollment.request.id]
  } });
  assert.equal(result.processed, 2);
  assert.equal(result.summary.manual, 2);
  assert.equal(app.saves(), 3);
  assert.ok(app.db.contactRequests.every(row => row.noticeStatus === 'Chờ gửi thủ công' && row.noticeSentAt === ''));
  assertFirebaseValues(app.db);
  assert.deepEqual(app.db.absences, before);
});

test('failed and blocked notices are Firebase-safe and retries preserve an existing send time', async () => {
  for (const scenario of ['missing-user', 'missing-token', 'existing-time']) {
    const app = setup();
    const { request } = await app.create(NOTICE_TYPES[0]);
    delete request.noticeSentAt;
    if (scenario === 'existing-time') request.noticeSentAt = '2026-10-13T09:00:00Z';
    if (scenario === 'missing-token') app.db.students[0].zaloUserId = 'uid-1';
    if (scenario !== 'existing-time') app.context.getZaloRuntimeConfig = () => ({ mode: 'oa', enabled: true });
    const result = await app.call('post', '/api/absences/zalo/bulk', { body: {
      filters: { date: '2026-10-14', includeNotifications: true }, ids: [request.id]
    } });
    assert.equal(result.logs[0].status, scenario === 'missing-user' ? 'Không gửi' : scenario === 'missing-token' ? 'Lỗi gửi' : 'Chờ gửi thủ công');
    assert.equal(app.db.contactRequests[0].noticeSentAt, scenario === 'existing-time' ? '2026-10-13T09:00:00Z' : '');
    assertFirebaseValues(app.db);
  }
});
