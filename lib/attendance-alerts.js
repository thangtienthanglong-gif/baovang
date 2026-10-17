const crypto = require('node:crypto');

const SUBJECT_LABELS = { TOAN: 'Toán', A: 'Anh', V: 'Văn', K: 'KHTN' };
const text = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const searchText = value => text(value).toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const hash = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

function subjectForClass(className) {
  const normalized = text(className).toUpperCase();
  const key = /^\d+N?[SCT]/.test(normalized) ? 'TOAN' : normalized.match(/^\d+([A-Z])/)?.[1];
  return SUBJECT_LABELS[key]
    ? { key, label: SUBJECT_LABELS[key] }
    : { key: `OTHER:${normalized}`, label: `Môn khác (${text(className) || 'Chưa có lớp'})` };
}

function vietnamDate(now = new Date()) {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function alertRange(query = {}, now = new Date()) {
  const period = query.period || '30days';
  const endDate = query.endDate || vietnamDate(now);
  if (!['30days', 'month', 'all'].includes(period) || !validDate(endDate)) {
    const error = new Error('Khoảng thời gian cảnh báo không hợp lệ.');
    error.status = 400;
    throw error;
  }
  const startDate = period === 'all' ? '' : period === 'month' ? `${endDate.slice(0, 7)}-01`
    : new Date(Date.parse(`${endDate}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  return { period, startDate, endDate };
}

function identity(student) {
  // Transfers preserve the enrollment ID. A real shared code/person ID can
  // join enrollments; generated AUTO codes and parent phone numbers cannot.
  if (text(student.personId)) return `person:${text(student.personId)}`;
  const code = text(student.code);
  if (code && !/^AUTO-/i.test(code)) return `code:${code.toUpperCase()}:${searchText(student.fullName)}`;
  return `id:${student.id}`;
}

function historicalClass(db, absence, student) {
  if (text(absence.attendanceClass || absence.className)) return text(absence.attendanceClass || absence.className);
  let className = student.className;
  const transfers = (db.transferHistory || []).filter(row => row.studentId === student.id)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || Number(b.timestamp || 0) - Number(a.timestamp || 0));
  for (const transfer of transfers) {
    if (absence.date < transfer.date || (absence.date === transfer.date && absence.createdAt
      && Date.parse(absence.createdAt) < Number(transfer.timestamp))) className = transfer.fromClass;
    else break;
  }
  return text(className);
}

function normalizedSession(session) {
  const value = searchText(session).replace(/^buoi\s+/, '');
  return ({ sang: 'Sáng', chieu: 'Chiều', toi: 'Tối' })[value] || text(session);
}

function buildAttendanceAlerts(db, query = {}, now = new Date()) {
  const range = alertRange(query, now);
  const students = new Map((db.students || []).map(student => [student.id, student]));
  const studentsByIdentity = new Map();
  for (const student of students.values()) {
    const key = identity(student);
    if (!studentsByIdentity.has(key)) studentsByIdentity.set(key, []);
    studentsByIdentity.get(key).push(student);
  }
  const activeIdentities = new Set((db.students || [])
    .filter(student => !student.removedFromClass && student.status !== 'Nghỉ học').map(identity));
  const groups = new Map();
  // Resolve repeated saves before checking status: the newest correction to
  // an excused/present/made-up session must remove that session from the count.
  const sessions = new Map();
  for (const absence of db.absences || []) {
    const student = students.get(absence.studentId);
    if (!student || !activeIdentities.has(identity(student)) || !validDate(absence.date)
      || absence.date > range.endDate || (range.startDate && absence.date < range.startDate)) continue;
    const className = historicalClass(db, absence, student);
    const subject = subjectForClass(className);
    const studentKey = identity(student);
    const session = normalizedSession(absence.session);
    const key = JSON.stringify([studentKey, subject.key, absence.date, session]);
    const previous = sessions.get(key);
    const time = row => Date.parse(row.updatedAt || row.createdAt || '') || 0;
    if (!previous || time(absence) >= time(previous.absence)) {
      sessions.set(key, { key, absence, student, studentKey, className, subject, session });
    }
  }
  for (const record of sessions.values()) {
    if (!['Vắng', 'Không phép', 'Vắng không phép'].includes(text(record.absence.absenceStatus))) continue;
    const { studentKey, subject, student, absence, className, session, key } = record;
    const alertId = hash(JSON.stringify([studentKey, subject.key]));
    if (!groups.has(alertId)) {
      const enrollments = studentsByIdentity.get(studentKey);
      const current = enrollments.findLast(row => !row.removedFromClass && row.status !== 'Nghỉ học') || student;
      groups.set(alertId, {
        id: alertId, subjectKey: subject.key, subject: subject.label, studentName: current.fullName || '',
        studentIds: enrollments.map(row => row.id), classes: [], currentClass: current.className || '',
        phone: current.phone1 || current.phone2 || '', sessions: []
      });
    }
    const group = groups.get(alertId);
    if (!group.classes.includes(className)) group.classes.push(className);
    group.sessions.push({ key, absenceId: absence.id, studentId: student.id, date: absence.date, session, className });
  }
  const actionRows = Array.isArray(db.attendanceAlertActions)
    ? db.attendanceAlertActions : Object.values(db.attendanceAlertActions || {});
  const actions = new Map(actionRows.filter(Boolean).map(action => [action.alertId, action]));
  let alerts = [...groups.values()].filter(group => group.sessions.length >= 2).map(group => {
    group.sessions.sort((a, b) => b.date.localeCompare(a.date) || b.session.localeCompare(a.session));
    const sessionKeys = group.sessions.map(row => row.key).sort();
    const handled = actions.get(group.id);
    const isHandled = Boolean(handled && sessionKeys.every(key => (handled.sessionKeys || []).includes(key)));
    return {
      ...group, count: group.sessions.length, level: group.sessions.length >= 3 ? 'danger' : 'warning',
      latestDate: group.sessions[0].date, revision: hash(JSON.stringify(sessionKeys)),
      handled: isHandled, handledAt: isHandled ? handled.time : '', handledBy: isHandled ? handled.username : '',
      note: handled?.note || ''
    };
  });
  const summary = { total: alerts.length, pending: alerts.filter(row => !row.handled).length };
  const keyword = searchText(query.q || '');
  alerts = alerts.filter(row => (!query.subject || query.subject === 'ALL' || row.subjectKey === query.subject
      || (query.subject === 'OTHER' && row.subjectKey.startsWith('OTHER:')))
    && (!query.className || query.className === 'ALL' || row.classes.includes(query.className) || row.currentClass === query.className)
    && (!keyword || searchText(`${row.studentName} ${row.phone} ${row.subject} ${row.classes.join(' ')} ${row.currentClass}`).includes(keyword))
    && (!query.status || query.status === 'ALL' || (query.status === 'handled' ? row.handled : !row.handled)));
  alerts.sort((a, b) => Number(a.handled) - Number(b.handled) || b.count - a.count || b.latestDate.localeCompare(a.latestDate));
  return { ...range, summary, alerts };
}

function currentAlert(db, alertId, body) {
  const result = buildAttendanceAlerts(db, { period: body.period, endDate: body.endDate });
  const alert = result.alerts.find(row => row.id === alertId);
  if (!alert || body.revision !== alert.revision) {
    const error = new Error('Dữ liệu vắng đã thay đổi. Vui lòng tải lại cảnh báo trước khi xử lý.');
    error.status = 409;
    throw error;
  }
  return { ...result, alert };
}

function registerAttendanceAlertRoutes(app, deps) {
  const { getBranchDb, saveHandledAlert, sendWorkbook, id, nowISO } = deps;
  app.get('/api/attendance-alerts', async (req, res, next) => {
    try { res.json(buildAttendanceAlerts(await getBranchDb(req), req.query)); }
    catch (error) { next(error); }
  });
  app.get('/api/attendance-alerts/export', async (req, res, next) => {
    try {
      const rawMinSessions = req.query.minSessions ?? '2';
      const minSessions = Number(rawMinSessions);
      if (typeof rawMinSessions !== 'string' || !/^\d+$/.test(rawMinSessions)
        || !Number.isSafeInteger(minSessions) || minSessions < 2) {
        const error = new Error('Số buổi vắng tối thiểu phải là số nguyên từ 2 trở lên.');
        error.status = 400;
        throw error;
      }
      const result = buildAttendanceAlerts(await getBranchDb(req), { period: 'month', ...req.query });
      const headers = ['STT', 'Họ tên học sinh', 'Lớp hiện tại', 'Môn', 'Lớp có buổi vắng', 'SĐT phụ huynh',
        'Số buổi vắng không phép', 'Vắng gần nhất', 'Chi tiết các buổi vắng', 'Trạng thái xử lý', 'Ghi chú xử lý', 'Từ ngày', 'Đến ngày'];
      const rows = result.alerts.filter(alert => alert.count >= minSessions).map((alert, index) => ({
        'STT': index + 1,
        'Họ tên học sinh': alert.studentName,
        'Lớp hiện tại': alert.currentClass,
        'Môn': alert.subject,
        'Lớp có buổi vắng': alert.classes.join(', '),
        'SĐT phụ huynh': alert.phone,
        'Số buổi vắng không phép': alert.count,
        'Vắng gần nhất': alert.latestDate,
        'Chi tiết các buổi vắng': alert.sessions.map(row => `${row.date} · ${row.session || 'Chưa rõ buổi'} · ${row.className}`).join('\n'),
        'Trạng thái xử lý': alert.handled ? 'Đã xử lý' : 'Cần xử lý',
        'Ghi chú xử lý': alert.note,
        'Từ ngày': result.startDate,
        'Đến ngày': result.endDate
      }));
      sendWorkbook(res, `hoc-sinh-vang-tu-${minSessions}-buoi-${result.startDate || 'tat-ca'}_den_${result.endDate}.xlsx`, [
        { name: `Vang tu ${minSessions} buoi`, headers, rows }
      ]);
    } catch (error) { next(error); }
  });
  app.post('/api/attendance-alerts/:id/handled', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const { alert } = currentAlert(db, req.params.id, req.body || {});
      if (!alert.handled) {
        const action = {
          id: id('alert_action'), alertId: alert.id, time: nowISO(), username: req.user.username,
          sessionKeys: alert.sessions.map(row => row.key), note: text(req.body.note).slice(0, 1000)
        };
        await saveHandledAlert(req, action);
      }
      res.json({ success: true });
    } catch (error) { next(error); }
  });

}

module.exports = { buildAttendanceAlerts, alertRange, subjectForClass, registerAttendanceAlertRoutes };
