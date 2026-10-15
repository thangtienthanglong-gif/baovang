const NOTICE_TYPES = ['Kiểm tra định kì', 'Đăng ký mới'];
const COMPLETED_NOTICE_STATUSES = new Set(['Đã gửi', 'Chạy thử', 'Đã gọi', 'Không nghe máy', 'Không liên lạc được']);

function registerStudentNotificationRoutes(app, deps) {
  const { getBranchDb, saveBranchDb, buildMessage, sendZaloNotice, runBulkZaloAction, id, nowISO } = deps;
  function prepare(db, req, input) {
    const student = (db.students || []).find(row => row.id === req.params.id);
    if (!student || student.removedFromClass || student.status === 'Nghỉ học') {
      const error = new Error('Không tìm thấy học sinh đang học trong chi nhánh này.');
      error.status = 404;
      throw error;
    }
    const type = String(input.type || '').trim();
    const date = String(input.date || '').trim();
    if (!NOTICE_TYPES.includes(type) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
      const error = new Error('Loại thông báo hoặc ngày thông báo không hợp lệ.');
      error.status = 400;
      throw error;
    }
    const record = {
      studentId: student.id, date, session: String(input.session || '').trim(),
      attendanceClass: student.className, absenceStatus: type, initialReason: type,
      notificationOnly: true
    };
    const message = buildMessage(db.settings || {}, record, student);
    if (!message.trim()) {
      const error = new Error('Vui lòng lưu nội dung mẫu thông báo trong mục Zalo trước khi gửi.');
      error.status = 400;
      throw error;
    }
    if (/\[Nhập[^\]]*\]/i.test(message)) {
      const error = new Error('Vui lòng điền lịch kiểm tra hoặc thông tin đăng ký trong mẫu ở mục Zalo, rồi lưu cấu hình.');
      error.status = 400;
      throw error;
    }
    return { student, record, message };
  }

  function findRequest(db, record, message) {
    return (db.contactRequests || []).findLast(row => row.studentId === record.studentId
      && row.date === record.date && row.absenceStatus === record.absenceStatus
      && row.attendanceClass === record.attendanceClass && row.message === message);
  }

  function createRequest(db, record, message) {
    const existing = findRequest(db, record, message);
    if (existing) return existing;
    const time = nowISO();
    const request = { ...record, id: id('notice'), message, status: 'Chưa gọi',
      noticeStatus: 'Chưa gửi', noticeSentAt: '', autoNotice: false, noticeDueAt: '', createdAt: time, updatedAt: time };
    db.contactRequests ||= [];
    db.contactRequests.push(request);
    return request;
  }

  function prepareClass(db, input) {
    const className = String(input.className || '').trim();
    if (!className || className === 'ALL') {
      const error = new Error('Vui lòng chọn một lớp cụ thể để gửi thông báo.');
      error.status = 400;
      throw error;
    }
    const students = (db.students || []).filter(student => student.className === className
      && !student.removedFromClass && student.status !== 'Nghỉ học');
    if (!students.length) {
      const error = new Error('Lớp này chưa có học sinh đang học trong chi nhánh đang chọn.');
      error.status = 404;
      throw error;
    }
    return students.map(student => prepare(db, { params: { id: student.id } }, input));
  }

  app.get('/api/class-notifications/preview', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const prepared = prepareClass(db, req.query);
      const recipients = prepared.map(({ student, record, message }) => {
        const previous = findRequest(db, record, message);
        const completed = COMPLETED_NOTICE_STATUSES.has(previous?.noticeStatus);
        const phone = String(student.phone1 || student.phone2 || '').trim();
        return { studentId: student.id, studentName: student.fullName || '', phone, message,
          selectable: Boolean(phone) && !completed,
          reason: completed ? previous.noticeStatus : phone ? '' : 'Chưa có SĐT' };
      });
      const { record } = prepared[0];
      res.json({ className: record.attendanceClass, type: record.absenceStatus, date: record.date,
        session: record.session, recipients });
    } catch (error) { next(error); }
  });

  app.post('/api/class-notifications', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const input = req.body || {};
      const prepared = prepareClass(db, input);
      if (!Array.isArray(input.recipients) || !input.recipients.length) {
        const error = new Error('Vui lòng tích ít nhất một học sinh nhận thông báo.');
        error.status = 400;
        throw error;
      }
      const byId = new Map(prepared.map(row => [row.student.id, row]));
      const selected = new Map();
      // Validate every recipient and reviewed message before creating or sending anything.
      for (const item of input.recipients) {
        const row = byId.get(item?.studentId);
        if (!row || !String(row.student.phone1 || row.student.phone2 || '').trim()) {
          const error = new Error('Danh sách nhận có học sinh ngoài lớp, đã nghỉ học hoặc chưa có số điện thoại. Vui lòng tải lại danh sách.');
          error.status = 409;
          throw error;
        }
        if (item.message !== row.message) {
          const error = new Error('Mẫu thông báo đã thay đổi. Vui lòng xem lại nội dung trước khi gửi.');
          error.status = 409;
          throw error;
        }
        if (item.phone !== String(row.student.phone1 || row.student.phone2 || '').trim()) {
          const error = new Error('Số điện thoại người nhận đã thay đổi. Vui lòng tải lại danh sách trước khi gửi.');
          error.status = 409;
          throw error;
        }
        selected.set(row.student.id, row);
      }
      const requests = [...selected.values()].map(row => createRequest(db, row.record, row.message));
      const pending = new Map();
      for (const request of requests) {
        const log = (db.notificationLogs || []).findLast(row => row.absenceId === request.id);
        if (request.noticeStatus === 'Chờ gửi thủ công' && log?.status === 'Chờ gửi thủ công') pending.set(request.id, log);
      }
      const completed = requests.filter(row => COMPLETED_NOTICE_STATUSES.has(row.noticeStatus));
      const ids = requests.filter(row => !pending.has(row.id) && !COMPLETED_NOTICE_STATUSES.has(row.noticeStatus)).map(row => row.id);
      const { record } = prepared[0];
      const result = await runBulkZaloAction(db, { date: record.date, className: record.attendanceClass,
        absenceStatus: record.absenceStatus, includeNotifications: true }, 'class_notification', ids);
      result.total += pending.size + completed.length;
      result.processed += pending.size;
      result.skipped += completed.length;
      result.alreadySent += completed.length;
      result.summary.manual += pending.size;
      result.logs.push(...pending.values());
      const order = new Map(requests.map((row, index) => [row.id, index]));
      result.logs.sort((a, b) => order.get(a.absenceId) - order.get(b.absenceId));
      // Persist separate notices and their results; attendance records are untouched.
      await saveBranchDb(req, db);
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get('/api/students/:id/notifications/preview', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const { student, record, message } = prepare(db, req, req.query);
      res.json({ type: record.absenceStatus, date: record.date, studentName: student.fullName,
        className: student.className, phone: student.phone1 || student.phone2 || '', message });
    } catch (error) { next(error); }
  });

  app.post('/api/students/:id/notifications', async (req, res, next) => {
    try {
      const db = await getBranchDb(req);
      const { student, record, message } = prepare(db, req, req.body || {});
      // Preview is reviewable before sending. A changed template needs review again.
      if (req.body?.message !== message) {
        const error = new Error('Mẫu thông báo đã thay đổi. Vui lòng mở lại bản xem trước.');
        error.status = 409;
        throw error;
      }
      const reused = Boolean(findRequest(db, record, message));
      const request = createRequest(db, record, message);
      let noticeLog = null;
      if (req.body.sendNow === true && !['Đã gửi', 'Chạy thử'].includes(request.noticeStatus)) {
        noticeLog = (db.notificationLogs || []).findLast(log => log.absenceId === request.id
          && log.status === 'Chờ gửi thủ công');
        if (!noticeLog) noticeLog = await sendZaloNotice(db, request.id, 'student_notification');
      }
      await saveBranchDb(req, db);
      const saved = db.contactRequests.find(row => row.id === request.id);
      res.json({ request: saved, noticeLog, reused });
    } catch (error) { next(error); }
  });
}

module.exports = { NOTICE_TYPES, registerStudentNotificationRoutes };
