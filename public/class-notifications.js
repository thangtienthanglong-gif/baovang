let classNotificationPreview = null;
let classNotificationRequest = 0;
let classNotificationSending = false;

function classNotificationError(message = '') {
  const field = $('#classNotificationError');
  field.textContent = message;
  field.hidden = !message;
}

function classNotificationChecked() {
  return [...document.querySelectorAll('#classNotificationRecipients .class-notice-recipient:checked')]
    .filter(box => !box.disabled).map(box => box.dataset.studentId);
}

function updateClassNotificationCount() {
  const boxes = [...document.querySelectorAll('#classNotificationRecipients .class-notice-recipient')].filter(box => !box.disabled);
  const selected = classNotificationChecked().length;
  const all = $('#classNotificationSelectAll');
  all.checked = boxes.length > 0 && selected === boxes.length;
  all.indeterminate = selected > 0 && selected < boxes.length;
  all.disabled = classNotificationSending || !boxes.length;
  $('#classNotificationCount').textContent = `Đã chọn ${selected} / ${boxes.length} học sinh có thể gửi`;
  $('#classNotificationSend').textContent = classNotificationSending ? 'Đang gửi…' : `Gửi hàng loạt (${selected})`;
  $('#classNotificationSend').disabled = classNotificationSending || !classNotificationPreview || !selected;
}

function renderClassNotificationMessage() {
  const row = classNotificationPreview?.recipients.find(row => row.studentId === $('#classNotificationPreviewStudent').value);
  $('#classNotificationMessage').textContent = row?.message || 'Chọn lớp và loại thông báo để xem nội dung.';
}

function updateClassNotificationSelection() {
  updateClassNotificationCount();
  const selected = classNotificationChecked();
  if (selected.length && !selected.includes($('#classNotificationPreviewStudent').value)) {
    $('#classNotificationPreviewStudent').value = selected[0];
  }
  renderClassNotificationMessage();
}

async function loadClassNotificationPreview() {
  if (classNotificationSending) return;
  const request = ++classNotificationRequest;
  const dialog = $('#classNotificationDialog');
  const branch = getActiveBranch();
  classNotificationPreview = null;
  classNotificationError();
  $('#classNotificationRecipients').innerHTML = '';
  $('#classNotificationPreviewStudent').innerHTML = '';
  updateClassNotificationCount();
  renderClassNotificationMessage();
  const className = $('#classNotificationClass').value;
  const type = $('#classNotificationType').value;
  const date = $('#classNotificationDate').value;
  if (!className || !type || !date) return;
  $('#classNotificationRecipients').textContent = 'Đang tải người nhận…';
  try {
    const session = getClassScheduleInfo(className, date).sessionName;
    const result = await api('/api/class-notifications/preview?' + queryString({ className, type, date, session }));
    if (request !== classNotificationRequest || branch !== getActiveBranch() || !dialog.open) return;
    classNotificationPreview = { ...result, branch };
    $('#classNotificationRecipients').innerHTML = result.recipients.map(row => `
      <label class="class-notice-person${row.selectable ? '' : ' unavailable'}">
        <input type="checkbox" class="class-notice-recipient" data-student-id="${escapeHtml(row.studentId)}" ${row.selectable ? 'checked' : 'disabled'}>
        <span><strong>${escapeHtml(row.studentName)}</strong><span class="muted">${escapeHtml(row.phone || 'Chưa có SĐT')}</span></span>
        ${row.reason ? `<span class="class-notice-reason">${escapeHtml(row.reason)}</span>` : ''}
      </label>`).join('');
    $('#classNotificationPreviewStudent').innerHTML = result.recipients.map(row =>
      `<option value="${escapeHtml(row.studentId)}">${escapeHtml(row.studentName)}</option>`).join('');
    $('#classNotificationPreviewStudent').value = (result.recipients.find(row => row.selectable) || result.recipients[0])?.studentId || '';
    renderClassNotificationMessage();
    updateClassNotificationCount();
  } catch (error) {
    if (request !== classNotificationRequest || branch !== getActiveBranch() || !dialog.open) return;
    $('#classNotificationRecipients').textContent = 'Chưa tải được danh sách người nhận.';
    classNotificationError(error.message);
  }
}

function openClassNotifications() {
  const dialog = $('#classNotificationDialog');
  if (dialog.open || classNotificationSending) return;
  const classes = [...new Set((state.students || []).filter(student => isActiveStudent(student) && !student.isMakeupAttendance)
    .map(student => student.className).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
  if (!classes.length) { toast('Chưa có lớp có học sinh đang học. Hãy tải lại danh sách học sinh.', 'warning'); return; }
  $('#classNotificationClass').innerHTML = '<option value="">Chọn lớp nhận thông báo</option>' + classes.map(className =>
    `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
  const currentClass = selectedClass();
  $('#classNotificationClass').value = classes.includes(currentClass) ? currentClass : '';
  $('#classNotificationType').value = '';
  $('#classNotificationDate').value = selectedDate();
  dialog.showModal();
  loadClassNotificationPreview();
  ($('#classNotificationClass').value ? $('#classNotificationType') : $('#classNotificationClass')).focus();
}

function setClassNotificationSending(sending) {
  classNotificationSending = sending;
  $('#classNotificationFields').disabled = sending;
  $('#classNotificationCancel').disabled = sending;
  $('#openClassNotificationBtn').disabled = sending;
  updateClassNotificationCount();
}

async function sendClassNotifications(event) {
  event.preventDefault();
  if (classNotificationSending) return;
  const preview = classNotificationPreview;
  const ids = new Set(classNotificationChecked());
  if (!preview || !ids.size) { classNotificationError('Vui lòng chọn loại thông báo và tích người nhận.'); return; }
  if (preview.branch !== getActiveBranch()) { classNotificationError('Chi nhánh đã thay đổi. Vui lòng mở lại danh sách.'); return; }
  const recipients = preview.recipients.filter(row => row.selectable && ids.has(row.studentId))
    .map(row => ({ studentId: row.studentId, message: row.message, phone: row.phone }));
  setClassNotificationSending(true);
  classNotificationError();
  try {
    const result = await api('/api/class-notifications', { method: 'POST', body: JSON.stringify({
      className: preview.className, type: preview.type, date: preview.date, session: preview.session, recipients
    }) });
    if (preview.branch !== getActiveBranch()) return;
    $('#classNotificationDialog').close();
    const pending = (result.logs || []).filter(log => log.status === 'Chờ gửi thủ công');
    if (state.settings?.zaloMode === 'personal-real' && pending.length) {
      await startZaloExtensionAuto(pending.map(log => ({ id: log.id, absenceId: log.absenceId,
        phone: log.responsePayload?.phone || log.phone1 || '', studentName: log.studentName || '',
        className: log.className || '', message: log.responsePayload?.message || log.message || '' })));
      if (preview.branch !== getActiveBranch()) return;
      const latest = await api('/api/notification-logs?' + queryString({ date: preview.date,
        absenceStatus: preview.type, notificationType: 'general' }));
      const byId = new Map(latest.map(log => [log.id, log]));
      result.logs = result.logs.map(log => byId.get(log.id) || log);
      result.summary = { sent: result.logs.filter(log => log.status === 'Đã gửi').length,
        dryRun: result.logs.filter(log => log.status === 'Chạy thử').length,
        manual: result.logs.filter(log => log.status === 'Chờ gửi thủ công').length,
        failed: result.logs.filter(log => log.status === 'Lỗi gửi').length,
        notSent: result.logs.filter(log => log.status === 'Không gửi').length };
    }
    if (preview.branch !== getActiveBranch()) return;
    toast(bulkZaloMessage(result));
    renderManualSendPanel(result.logs || []);
    await loadBootstrap();
    await loadGeneralNotificationHistory();
    if ((result.logs || []).some(log => log.status === 'Chờ gửi thủ công')) await activateTab('queueTab');
  } catch (error) {
    if (preview.branch !== getActiveBranch()) return;
    if ($('#classNotificationDialog').open) classNotificationError(error.message);
    else toast(error.message + ' Kiểm tra kết quả tại Lịch sử liên hệ → Thông báo.', 'error');
  } finally { setClassNotificationSending(false); }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#openClassNotificationBtn').addEventListener('click', openClassNotifications);
  $('#classNotificationForm').addEventListener('submit', sendClassNotifications);
  for (const id of ['classNotificationClass', 'classNotificationType', 'classNotificationDate']) {
    $('#' + id).addEventListener('change', loadClassNotificationPreview);
  }
  $('#classNotificationReload').addEventListener('click', loadClassNotificationPreview);
  $('#classNotificationPreviewStudent').addEventListener('change', renderClassNotificationMessage);
  $('#classNotificationRecipients').addEventListener('change', updateClassNotificationSelection);
  $('#classNotificationSelectAll').addEventListener('change', event => {
    document.querySelectorAll('#classNotificationRecipients .class-notice-recipient').forEach(box => {
      if (!box.disabled) box.checked = event.target.checked;
    });
    updateClassNotificationSelection();
  });
  $('#classNotificationCancel').addEventListener('click', () => $('#classNotificationDialog').close());
  $('#classNotificationDialog').addEventListener('cancel', event => { if (classNotificationSending) event.preventDefault(); });
  $('#classNotificationDialog').addEventListener('close', () => { classNotificationRequest++; classNotificationPreview = null; });
  $('#classNotificationTemplates').addEventListener('click', () => {
    $('#classNotificationDialog').close();
    activateTab('zaloTab');
  });
});
