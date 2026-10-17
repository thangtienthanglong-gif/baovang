let attendanceAlertRequest = 0;
let attendanceAlertOpenRequest = 0;
let attendanceAlertAction = null;
let attendanceExportBranch = null;
let attendanceExportClasses = [];

function updateAttendanceExportClasses() {
  const subject = $('#attendanceExportSubject').value;
  const select = $('#attendanceExportClass');
  const previous = select.value;
  const classes = attendanceExportClasses.filter(className => {
    const key = getClassSubjectKey(className);
    const group = ['TOAN', 'A', 'V', 'K'].includes(key) ? key : 'OTHER';
    return subject === 'ALL' || group === subject;
  });
  select.innerHTML = '<option value="ALL">Tất cả lớp</option>' + classes.map(className =>
    `<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`).join('');
  select.value = classes.includes(previous) ? previous : 'ALL';
}

async function openAttendanceExportDialog() {
  const button = $('#exportRepeatedAbsencesBtn');
  const dialog = $('#attendanceExportDialog');
  if (button.disabled || dialog.open) return;
  const branch = getActiveBranch();
  button.disabled = true;
  try {
    const endDate = clientTodayISO();
    const [bootstrap, result] = await Promise.all([
      api('/api/bootstrap'),
      api('/api/attendance-alerts?' + queryString({ period: 'month', endDate }))
    ]);
    if (branch !== getActiveBranch()) return;
    attendanceExportBranch = branch;
    attendanceExportClasses = [...new Set([
      ...(bootstrap.classes || []),
      ...result.alerts.flatMap(alert => [...alert.classes, alert.currentClass])
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));
    $('#attendanceExportSubject').value = 'ALL';
    $('#attendanceExportClass').value = 'ALL';
    $('#attendanceExportMinSessions').value = '2';
    updateAttendanceExportClasses();
    dialog.showModal();
  } catch (error) {
    if (branch === getActiveBranch()) toast(error.message, 'error');
  } finally { button.disabled = false; }
}

async function exportSelectedAttendance(event) {
  event.preventDefault();
  const dialog = $('#attendanceExportDialog');
  const button = $('#attendanceExportSubmit');
  if (button.disabled) return;
  if (attendanceExportBranch !== getActiveBranch()) {
    dialog.close();
    toast('Cơ sở đã thay đổi. Vui lòng mở lại hộp xuất danh sách.', 'error');
    return;
  }
  const rawMinSessions = $('#attendanceExportMinSessions').value;
  const minSessions = Number(rawMinSessions);
  if (!/^\d+$/.test(rawMinSessions) || !Number.isSafeInteger(minSessions) || minSessions < 2) {
    toast('Số buổi vắng tối thiểu phải là số nguyên từ 2 trở lên.', 'error');
    return;
  }
  button.disabled = true;
  try {
    await downloadUrl('/api/attendance-alerts/export', {
      period: 'month', endDate: clientTodayISO(),
      className: $('#attendanceExportClass').value,
      subject: $('#attendanceExportSubject').value,
      minSessions
    });
  } finally { button.disabled = false; }
}

function syncRosterAttendanceAlerts(result) {
  let changed = false;
  for (const student of state.students || []) {
    const flags = result.alerts.filter(alert => alert.studentIds.includes(student.id)).map(alert => ({
      id: alert.id, subjectKey: alert.subjectKey, subject: alert.subject,
      count: alert.count, level: alert.level, handled: alert.handled
    }));
    if (JSON.stringify(student.attendanceAlerts || []) !== JSON.stringify(flags)) changed = true;
    student.attendanceAlerts = flags;
  }
  if (changed) renderRoster();
}

async function refreshRosterAttendanceAlerts() {
  const branch = getActiveBranch();
  const request = ++attendanceAlertRequest;
  const result = await api('/api/attendance-alerts?' + queryString({ period: '30days', endDate: clientTodayISO() }));
  if (branch !== getActiveBranch() || request !== attendanceAlertRequest) return null;
  syncRosterAttendanceAlerts(result);
  return result;
}

function showRosterAttendanceAlert(alert, range, branch) {
  const dialog = $('#attendanceAlertDialog');
  if (dialog.open) return;
  attendanceAlertAction = { alert, range: { period: range.period, endDate: range.endDate }, branch };
  $('#attendanceAlertActionForm').reset();
  $('#attendanceAlertDialogTitle').textContent = 'Các buổi vắng không phép';
  $('#attendanceAlertDialogStudent').textContent = `${alert.studentName} · ${alert.subject} · ${alert.count} buổi trong 30 ngày gần nhất`;
  $('#attendanceAlertDates').innerHTML = `<ul>${alert.sessions.map(row =>
    `<li>${escapeHtml(row.date.split('-').reverse().join('/'))} · ${escapeHtml(row.session || 'Chưa rõ buổi')} · ${escapeHtml(row.className)}</li>`).join('')}</ul>`;
  const handledInfo = $('#attendanceAlertHandledInfo');
  handledInfo.hidden = !alert.handled;
  handledInfo.textContent = alert.handled
    ? `Đã xử lý bởi ${alert.handledBy} · ${formatDateTime(alert.handledAt, 'Asia/Ho_Chi_Minh')}` : '';
  $('#attendanceAlertNote').value = alert.handled ? alert.note || '' : '';
  $('#attendanceAlertNote').readOnly = alert.handled;
  $('#attendanceAlertSave').hidden = alert.handled;
  $('#attendanceAlertSave').disabled = false;
  $('#attendanceAlertActionError').hidden = true;
  dialog.showModal();
}

async function openRosterAttendanceAlert(button) {
  const dialog = $('#attendanceAlertDialog');
  if (button.disabled || dialog.open) return;
  const alertId = button.dataset.attendanceAlertId;
  const branch = getActiveBranch();
  const request = ++attendanceAlertOpenRequest;
  button.disabled = true;
  try {
    const result = await refreshRosterAttendanceAlerts();
    if (!result || branch !== getActiveBranch() || request !== attendanceAlertOpenRequest) return;
    const alert = result.alerts.find(row => row.id === alertId);
    if (!alert) {
      toast('Số buổi vắng đã thay đổi; học sinh hiện không còn cảnh báo này.');
      return;
    }
    showRosterAttendanceAlert(alert, result, branch);
  } catch (error) {
    if (branch === getActiveBranch() && request === attendanceAlertOpenRequest) toast(error.message, 'error');
  } finally { button.disabled = false; }
}

async function saveAttendanceAlertAction(event) {
  event.preventDefault();
  const selected = attendanceAlertAction;
  const button = $('#attendanceAlertSave');
  const dialog = $('#attendanceAlertDialog');
  if (!selected || selected.alert.handled || button.disabled) return;
  if (selected.branch !== getActiveBranch()) {
    dialog.close();
    toast('Cơ sở đã thay đổi. Vui lòng mở lại cảnh báo.', 'error');
    return;
  }
  button.disabled = true;
  $('#attendanceAlertCancel').disabled = true;
  dialog.dataset.saving = 'true';
  try {
    await api(`/api/attendance-alerts/${selected.alert.id}/handled`, {
      method: 'POST', body: JSON.stringify({
        ...selected.range, revision: selected.alert.revision, note: $('#attendanceAlertNote').value.trim()
      })
    });
    if (selected.branch !== getActiveBranch()) { dialog.close(); return; }
    dialog.close();
    toast('Đã xử lý cảnh báo vắng học.');
    try { await refreshRosterAttendanceAlerts(); }
    catch (error) { toast('Đã lưu, nhưng chưa tải lại được cảnh báo: ' + error.message, 'error'); }
  } catch (error) {
    if (selected.branch !== getActiveBranch()) { dialog.close(); return; }
    const errorField = $('#attendanceAlertActionError');
    errorField.textContent = error.message;
    errorField.hidden = false;
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    $('#attendanceAlertCancel').disabled = false;
    delete dialog.dataset.saving;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#exportRepeatedAbsencesBtn').addEventListener('click', openAttendanceExportDialog);
  $('#attendanceExportSubject').addEventListener('change', updateAttendanceExportClasses);
  $('#attendanceExportForm').addEventListener('submit', exportSelectedAttendance);
  $('#attendanceExportCancel').addEventListener('click', () => $('#attendanceExportDialog').close());
  $('#attendanceExportDialog').addEventListener('close', () => { attendanceExportBranch = null; });
  $('#studentRoster').addEventListener('click', event => {
    const button = event.target.closest('[data-attendance-alert-id]');
    if (button) openRosterAttendanceAlert(button);
  });
  $('#attendanceAlertActionForm').addEventListener('submit', saveAttendanceAlertAction);
  $('#attendanceAlertCancel').addEventListener('click', () => $('#attendanceAlertDialog').close());
  $('#attendanceAlertDialog').addEventListener('cancel', event => {
    if ($('#attendanceAlertDialog').dataset.saving) event.preventDefault();
  });
  $('#attendanceAlertDialog').addEventListener('close', () => { attendanceAlertAction = null; });
  setInterval(() => {
    if (!document.hidden && activeTabId() === 'absenceTab') {
      refreshRosterAttendanceAlerts().catch(error => console.error('Chưa tải lại được cảnh báo vắng học:', error));
    }
  }, 30000);
});
