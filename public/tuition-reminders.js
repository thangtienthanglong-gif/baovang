let tuitionReminderRequest = 0;
let tuitionHistoryRequest = 0;

function recentTuitionReminder(studentId) {
  const reminder = state.tuitionReminders?.[studentId];
  return reminder && Date.parse(reminder.expiresAt) > Date.now() + (state.tuitionClockOffset || 0) ? reminder : null;
}

async function loadTuitionReminders() {
  const branch = getActiveBranch();
  const request = ++tuitionReminderRequest;
  try {
    const result = await api('/api/tuition-reminders');
    if (branch !== getActiveBranch() || request !== tuitionReminderRequest) return;
    state.tuitionReminders = result.reminders;
    state.tuitionIdentities = result.identities;
    state.tuitionClockOffset = Date.parse(result.serverTime) - Date.now();
    state.tuitionRemindersLoaded = true;
  } catch (error) {
    if (branch !== getActiveBranch() || request !== tuitionReminderRequest) return;
    if (state.tuitionRemindersLoaded !== false) toast('Chưa kiểm tra được lịch sử nhắc học phí. Các mục học phí tạm bỏ tích để tránh gửi trùng.', 'error');
    state.tuitionRemindersLoaded = false;
  }
}

function renderTuitionReminderBadge(studentId) {
  const reminder = recentTuitionReminder(studentId);
  if (!reminder) return '';
  const detail = `${formatDateTime(reminder.lastContactAt, 'Asia/Ho_Chi_Minh')} · ${reminder.className || 'Chưa rõ lớp'}`;
  return `<div class="tuition-reminder-line"><button type="button" class="tuition-reminder-badge" data-tuition-student-id="${escapeHtml(studentId)}" data-tuition-expires-at="${escapeHtml(reminder.expiresAt)}" aria-haspopup="dialog" title="${escapeHtml(detail + '. Bấm xem lịch sử nhắc chung các môn.')}">Đã nhắc học phí</button><span class="muted">${escapeHtml(detail)}</span></div>`;
}

function tuitionQueueChecked(row) {
  if (!['Học phí', 'Trễ học phí'].includes(row.absenceStatus)) return true;
  const reminderId = recentTuitionReminder(row.studentId)?.eventId || '';
  const choice = state.tuitionQueueChoices?.[row.id];
  if (choice && choice.reminderId === reminderId) return choice.checked;
  return state.tuitionRemindersLoaded === true && !reminderId;
}

function rememberTuitionQueueChoice(box) {
  const row = state.absences.find(row => row.id === box.dataset.id);
  if (!row || !['Học phí', 'Trễ học phí'].includes(row.absenceStatus)) return;
  state.tuitionQueueChoices ||= {};
  state.tuitionQueueChoices[row.id] = { checked: box.checked,
    reminderId: recentTuitionReminder(row.studentId)?.eventId || '' };
}

async function openTuitionReminderHistory(button) {
  const dialog = $('#tuitionReminderDialog');
  if (button.disabled || dialog.open) return;
  const branch = getActiveBranch();
  const request = ++tuitionHistoryRequest;
  const studentId = button.dataset.tuitionStudentId;
  button.disabled = true;
  try {
    const rows = await api(`/api/tuition-reminders/${encodeURIComponent(studentId)}/history`);
    if (branch !== getActiveBranch() || request !== tuitionHistoryRequest) return;
    const student = state.students.find(row => row.id === studentId);
    $('#tuitionReminderStudent').textContent = student?.fullName || 'Học sinh';
    setHistoryRows('tuitionReminderRows', 'tuitionReminderPagination', rows, row =>
      `<tr><td>${escapeHtml(formatDateTime(row.time, 'Asia/Ho_Chi_Minh'))}</td><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.channel)}</td><td><span class="badge ${statusClass(row.status === 'Đã báo' ? 'Đã gọi' : row.status === 'Không bắt máy' ? 'Không nghe máy' : row.status)}">${escapeHtml(row.status)}</span>${row.caller ? `<div class="muted">${escapeHtml(row.caller)}</div>` : ''}</td></tr>`,
      'Chưa có lịch sử nhắc học phí.', 4);
    dialog.showModal();
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-tuition-student-id]');
    if (button) openTuitionReminderHistory(button);
  });
  $('#tuitionReminderClose').addEventListener('click', () => $('#tuitionReminderDialog').close());
  $('#tuitionReminderDialog').addEventListener('click', handleHistoryPageClick);
  setInterval(async () => {
    if (document.hidden || activeTabId() !== 'absenceTab') return;
    const before = (state.students || []).map(row => recentTuitionReminder(row.id)?.eventId || '').join('|');
    await loadTuitionReminders();
    const after = (state.students || []).map(row => recentTuitionReminder(row.id)?.eventId || '').join('|');
    // Compare the actual rendered badges too, so expiration hides an existing badge.
    const expired = [...document.querySelectorAll('#studentRoster [data-tuition-expires-at]')]
      .some(button => Date.parse(button.dataset.tuitionExpiresAt) <= Date.now() + (state.tuitionClockOffset || 0));
    if (before !== after || expired) renderRoster();
  }, 30000);
});
