const NOTICE_TYPES = ['Kiểm tra định kì', 'Đăng ký mới'];

function registerStudentNotificationRoutes(app, deps) {
  const { getBranchDb, saveBranchDb, buildMessage, sendZaloNotice, id, nowISO } = deps;
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
      db.contactRequests ||= [];
      let request = db.contactRequests.findLast(row => row.studentId === student.id
        && row.date === record.date && row.absenceStatus === record.absenceStatus
        && row.attendanceClass === record.attendanceClass && row.message === message);
      const reused = Boolean(request);
      if (!request) {
        const time = nowISO();
        request = { ...record, id: id('notice'), message, status: 'Chưa gọi',
          noticeStatus: 'Chưa gửi', autoNotice: false, noticeDueAt: '', createdAt: time, updatedAt: time };
        db.contactRequests.push(request);
      }
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
