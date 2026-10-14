const REMINDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TUITION_TEMPLATE = 'Kính gửi Quý phụ huynh, {schoolName} kính nhờ Quý phụ huynh kiểm tra và hoàn thành học phí cho em {studentName}.\nNếu đã hoàn thành, xin vui lòng bỏ qua thông báo này. Trân trọng!';
const OLD_TUITION_TEMPLATE = 'Kính gửi Quý phụ huynh, {schoolName} thông báo học phí/tiền nợ của em {studentName}, lớp {className} hiện tại là: {tuitionDebt}.\nVui lòng hoàn thành sớm. Trân trọng!';
const text = value => String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
const isTuition = value => ['học phí', 'trễ học phí'].includes(text(value).toLocaleLowerCase('vi'));

function resolveTuitionTemplate(value) {
  const template = String(value || '').trim();
  return !template || template === OLD_TUITION_TEMPLATE ? DEFAULT_TUITION_TEMPLATE : template;
}

function studentKeys(student) {
  const name = text(student.fullName || student.studentName).toLocaleLowerCase('vi');
  let phone = text(student.phone1 || student.phone2 || student.phoneCalled || student.responsePayload?.phone).replace(/\D/g, '');
  if (/^84\d{9}$/.test(phone)) phone = `0${phone.slice(2)}`;
  if (/^\d{9}$/.test(phone)) phone = `0${phone}`;
  const person = text(student.personId);
  const code = text(student.code || student.studentCode).toUpperCase();
  return [
    person ? JSON.stringify(['person', person]) : '',
    name && /^\d{10,15}$/.test(phone) ? JSON.stringify(['contact', name, phone]) : '',
    name && code && !/^AUTO-/i.test(code) ? JSON.stringify(['code', name, code]) : ''
  ].filter(Boolean);
}

function buildTuitionReminders(db, { now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Ngày tính lịch sử học phí không hợp lệ.');
  const students = new Map((db.students || []).map(student => [student.id, student]));
  const identities = {}, aliases = new Map();
  const explicitPeople = new Map();
  for (const student of students.values()) {
    if (!text(student.personId)) continue;
    const keys = studentKeys(student);
    for (const key of keys.slice(1)) {
      if (!explicitPeople.has(key)) explicitPeople.set(key, new Set());
      explicitPeople.get(key).add(keys[0]);
    }
  }
  for (const student of students.values()) {
    const keys = studentKeys(student);
    const people = explicitPeople.get(keys[0]);
    const identity = !text(student.personId) && people?.size === 1
      ? [...people][0] : keys[0] || JSON.stringify(['enrollment', student.id]);
    identities[student.id] = identity;
    for (const key of keys) {
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key).add(identity);
    }
  }
  const absences = new Map([...(db.absences || []), ...(db.contactRequests || [])].map(row => [row.id, row]));
  const notices = new Map((db.notificationLogs || []).map(row => [row.id, row]));
  function identityFor(row, source = {}) {
    const studentId = row.studentId || source.studentId;
    if (studentId && students.has(studentId)) return identities[studentId];
    const contact = {
      ...source, ...row,
      fullName: row.studentName || source.studentName || '',
      phone1: row.phoneCalled || row.phone1 || source.phone1 || source.phone2 || source.responsePayload?.phone || ''
    };
    for (const key of studentKeys(contact)) {
      const matches = aliases.get(key);
      if (matches?.size === 1) return [...matches][0];
      if (matches?.size > 1) return '';
    }
    return '';
  }
  function tuitionType(row, source = {}) {
    if (text(row.absenceStatus)) return isTuition(row.absenceStatus);
    if (text(source.absenceStatus)) return isTuition(source.absenceStatus);
    const message = String(row.message || row.responsePayload?.message || '').normalize('NFC');
    if (/thông báo\s+học phí\s*\/\s*tiền nợ\s+của em\b/iu.test(message)) return true;
    return isTuition(absences.get(row.absenceId || source.absenceId)?.absenceStatus);
  }
  function successfulCall(row) {
    return row.callResult ? ['Đã báo', 'Đã gọi'].includes(text(row.callResult)) : text(row.callStatus || row.status) === 'Đã gọi';
  }
  const contacts = [];
  for (const log of db.notificationLogs || []) {
    if (!tuitionType(log)) continue;
    // A converted failed notice is represented by its actual call below.
    if (log.callLogId) continue;
    const identity = identityFor(log, absences.get(log.absenceId));
    const timestamp = Date.parse(log.time);
    if (!identity || !Number.isFinite(timestamp) || timestamp > nowMs) continue;
    contacts.push({
      identity, eventId: `notice:${log.id}`, time: log.time, timestamp,
      className: log.className || '', channel: log.channel || 'Zalo',
      status: log.status || '', caller: log.sentBy || log.confirmedBy || '', result: log.result || '',
      successful: log.status === 'Đã gửi' || (log.status === 'Đã gọi' && successfulCall(log))
    });
  }
  for (const call of db.callLogs || []) {
    const source = notices.get(call.notificationLogId) || absences.get(call.absenceId) || {};
    if (!tuitionType(call, source)) continue;
    const identity = identityFor(call, source);
    const timestamp = Date.parse(call.time || call.lastCallAt);
    if (!identity || !Number.isFinite(timestamp) || timestamp > nowMs) continue;
    contacts.push({ identity, eventId: `call:${call.id}`, time: call.time || call.lastCallAt, timestamp,
      className: call.className || source.className || '', channel: 'Gọi điện',
      status: call.callResult || call.callStatus || '', caller: call.caller || '',
      result: call.note || source.result || '', successful: successfulCall(call) });
  }
  contacts.sort((a, b) => b.timestamp - a.timestamp || a.eventId.localeCompare(b.eventId));
  const latest = new Map();
  for (const contact of contacts) {
    if (contact.successful && contact.timestamp + REMINDER_WINDOW_MS > nowMs && !latest.has(contact.identity)) {
      latest.set(contact.identity, contact);
    }
  }
  const reminders = {};
  for (const [studentId, identity] of Object.entries(identities)) {
    const contact = latest.get(identity);
    if (contact) reminders[studentId] = { eventId: contact.eventId, lastContactAt: contact.time,
      expiresAt: new Date(contact.timestamp + REMINDER_WINDOW_MS).toISOString(),
      className: contact.className, channel: contact.channel, caller: contact.caller };
  }
  return { reminders, identities, contacts, serverTime: new Date(nowMs).toISOString() };
}

function selectTuitionContacts(db, rows, { allowRecent = false, now = new Date() } = {}) {
  const { reminders, identities } = buildTuitionReminders(db, { now });
  const selected = [], seen = new Set();
  let reminded = 0, duplicates = 0;
  for (const row of rows) {
    if (!isTuition(row.absenceStatus)) { selected.push(row); continue; }
    if (!allowRecent && reminders[row.studentId]) { reminded++; continue; }
    const identity = identities[row.studentId] || JSON.stringify(['row', row.id]);
    if (seen.has(identity)) { duplicates++; continue; }
    seen.add(identity);
    selected.push(row);
  }
  return { candidates: selected, reminded, duplicates };
}

function registerTuitionReminderRoutes(app, { getBranchDb }) {
  app.get('/api/tuition-reminders', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const { reminders, identities, serverTime } = buildTuitionReminders(db);
      res.json({ reminders, identities, serverTime });
    } catch (error) { next(error); }
  });
  app.get('/api/tuition-reminders/:id/history', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const student = (db.students || []).find(row => row.id === req.params.id);
      if (!student) return res.status(404).json({ error: 'Không tìm thấy học sinh trong chi nhánh này.' });
      const { identities, contacts } = buildTuitionReminders(db);
      res.json(contacts.filter(row => row.identity === identities[student.id]).map(({ identity, timestamp, ...row }) => row));
    } catch (error) { next(error); }
  });
}

module.exports = { REMINDER_WINDOW_MS, DEFAULT_TUITION_TEMPLATE, resolveTuitionTemplate,
  buildTuitionReminders, selectTuitionContacts, registerTuitionReminderRoutes };
