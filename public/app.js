const state = {
  today: '',
  settings: {},
  classes: [],
  statuses: [],
  noticeStatuses: [],
  absenceStatuses: [],
  results: [],
  students: [],
  absences: [],
  summary: {},
  aiConversationId: ''
};

let absencePieChart = null;
let classBarChart = null;

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

const COZE_BOT_PROMPT = `Bạn là Trợ lý Báo Vắng Học Sinh cho giáo viên và văn phòng nhà trường.

Nhiệm vụ:
- Trả lời bằng tiếng Việt, ngắn gọn, rõ ràng, đúng trọng tâm câu hỏi cuối cùng.
- Hỗ trợ xem thống kê học sinh vắng, đi trễ, về sớm, nghỉ học.
- Hỗ trợ tìm học sinh theo tên, lớp, mã học sinh, số điện thoại phụ huynh.
- Giải thích tình trạng gửi Zalo: chưa gửi, chờ gửi, đã gửi, lỗi gửi, chạy thử.
- Hướng dẫn giáo viên thao tác trong app: nạp Excel, điểm danh vắng, gửi Zalo hàng loạt, xem lịch sử.
- Ưu tiên dùng dữ liệu trong phần ngữ cảnh hệ thống do app gửi lên.
- Nếu không có dữ liệu trong ngữ cảnh, hãy nói rõ là chưa có dữ liệu hoặc cần kiểm tra thêm trong app.
- Không tự bịa tên học sinh, số điện thoại, lớp, trạng thái hoặc kết quả gửi Zalo.
- Không yêu cầu người dùng cung cấp access token, mật khẩu hoặc thông tin nhạy cảm trong chat.
- Với dữ liệu học sinh/phụ huynh, trả lời vừa đủ, tránh lộ thông tin không cần thiết.

Luật trả lời đúng trọng tâm:
- Câu đầu tiên phải trả lời trực tiếp điều thầy/cô hỏi.
- Nếu hỏi số lượng/thống kê, nêu ngay con số và phạm vi ngày/lớp/bộ lọc đang dùng.
- Nếu hỏi học sinh, chỉ liệt kê học sinh khớp câu hỏi; không chuyển sang hướng dẫn thao tác nếu không được hỏi.
- Nếu hỏi Zalo, chỉ nói trạng thái gửi, chế độ gửi và thao tác cần làm tiếp nếu có.
- Nếu hỏi cách thao tác, trả lời bằng 2-4 bước ngắn trong app.
- Không mở rộng sang các chủ đề khác chỉ vì chúng xuất hiện trong ngữ cảnh.
- Nếu câu hỏi mơ hồ, hỏi lại đúng một câu ngắn để làm rõ.

Phong cách:
- Lịch sự, thân thiện, giống một trợ lý văn phòng nhà trường.
- Gọi người dùng là "thầy/cô" khi phù hợp.
- Khi có danh sách, trình bày bằng gạch đầu dòng.
- Không mở đầu bằng phần tự giới thiệu hoặc liệt kê khả năng của trợ lý.`;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDelay(minutes) {
  const value = Number(minutes || 0);
  return value <= 0 ? 'gửi ngay' : `sau ${value} phút`;
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'HS';
  return parts.slice(-2).map(part => part[0]).join('').toUpperCase();
}

function isActiveStudent(student) {
  return student && student.status !== 'Nghỉ học';
}

function activeStudents() {
  return state.students.filter(isActiveStudent);
}

function normalizeAbsenceStatus(value) {
  const status = String(value || '').trim();
  const aliases = {
    'Vắng chưa rõ lý do': 'Vắng',
    'Vắng không phép': 'Vắng',
    'Vắng có phép': 'Có phép',
    'Nghỉ bệnh': 'Nghỉ học',
    'Trễ học phí': 'Học phí'
  };
  return aliases[status] || status;
}


function getToken() {
  const t = localStorage.getItem('token');
  if (!t && window.location.pathname !== '/login.html') {
    window.location.href = '/login.html';
  }
  return t;
}

function getActiveBranch() {
  return localStorage.getItem('activeBranch') || 'main';
}

function toast(message, type = 'success') {
  const container = $('#toastContainer');
  if (!container) return;
  const item = document.createElement('div');
  item.className = `toast-item ${type}`;
  item.innerHTML = `
    <i class="fa-solid ${type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check'}"></i>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(item);
  
  requestAnimationFrame(() => {
    item.classList.add('show');
  });

  setTimeout(() => {
    item.classList.remove('show');
    setTimeout(() => item.remove(), 300);
  }, 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', 'X-Branch-Id': getActiveBranch(), 'Authorization': 'Bearer ' + getToken() },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
  }
  
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem('token');
    window.location.href = '/login.html';
  }
  if (!response.ok) throw new Error(data.error || 'Có lỗi xảy ra.');
  return data;
}

async function apiForm(path, formData) {
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'X-Branch-Id': getActiveBranch(),
      'Authorization': 'Bearer ' + getToken()
    },
    body: formData
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Có lỗi xảy ra.');
  return data;
}

function queryString(params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, value);
  });
  return search.toString();
}

function downloadUrl(path, params = {}) {
  const query = queryString(params);
  window.location.href = query ? `${path}?${query}` : path;
}

function clientTodayISO() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function selectedDate() {
  return $('#filterDate')?.value || state.today || clientTodayISO();
}

function selectedClass() {
  return $('#filterClass')?.value || 'ALL';
}

function getFilters() {
  return {
    date: selectedDate(),
    className: $('#filterClass')?.value || 'ALL',
    absenceStatus: $('#filterAbsenceStatus')?.value || 'ALL',
    status: $('#filterStatus')?.value || 'ALL',
    noticeStatus: $('#filterNoticeStatus')?.value || 'ALL',
    q: $('#filterKeyword')?.value.trim() || ''
  };
}

function getAttendanceFilters() {
  return {
    date: selectedDate(),
    className: $('#filterClass')?.value || 'ALL'
  };
}

async function loadBootstrap() {
  const filters = activeTabId() === 'queueTab' ? getFilters() : getAttendanceFilters();
  const data = await api('/api/bootstrap?' + queryString(filters));
  Object.assign(state, data);
  if ($('#filterDate') && !$('#filterDate').value) $('#filterDate').value = state.today;
  renderFilters();
  renderSettings();
  await loadStudents();
  updateChatboxStatus();
  renderSummary();
  renderAbsences();
}

async function refreshCurrentView(button) {
  button.disabled = true;
  try {
    await loadBootstrap();
    const tab = activeTabId();
    if (tab === 'queueTab') await loadAbsences();
    if (tab === 'historyTab') {
      await Promise.all([loadHistory(), loadNotices(), loadQuitStudents()]);
    }
    if (tab === 'absenceTab' || tab === 'overviewTab') await loadAttendanceAbsences();
    toast('Đã tải lại dữ liệu.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

async function loadAbsences() {
  const data = await api('/api/absences?' + queryString(getFilters()));
  state.absences = data.absences;
  state.summary = data.summary;
  renderSummary();
  renderAbsences();
  renderClassDropdown();
  renderRoster();
  updateChatboxStatus();
}

async function loadAttendanceAbsences() {
  const data = await api('/api/absences?' + queryString(getAttendanceFilters()));
  state.absences = data.absences;
  state.summary = data.summary;
  renderSummary();
  renderClassDropdown();
  renderRoster();
  updateChatboxStatus();
}

async function loadStudents(q = '') {
  const rows = await api('/api/students?' + queryString({ q }));
  state.students = rows;
  renderStudentSelect();
  renderClassDropdown();
  renderRoster();
  renderFilters(); // Added this!
}

function getClassScheduleInfo(className, dateString, forcedDay = 'ALL') {
  let sessionName = 'Khác';
  let daysStr = '';
  
  const str = String(className || '').toUpperCase();
  
  const ctMatch = str.match(/\d+CT.*?\(([\d-]+)\)/);
  if (ctMatch) {
    sessionName = 'Tối';
    daysStr = ctMatch[1].replace(/-/g, '');
  } else {
    const stdMatch = str.match(/^\d+([SCT])(\d+)/);
    if (stdMatch) {
      const sessionCode = stdMatch[1];
      sessionName = sessionCode === 'S' ? 'Sáng' : sessionCode === 'C' ? 'Chiều' : 'Tối';
      daysStr = stdMatch[2];
    }
  }

  if (sessionName === 'Khác') {
    return { sessionName, matchesDate: true };
  }
  
  let dayNumberStr;
  if (forcedDay && forcedDay !== 'ALL') {
    dayNumberStr = forcedDay;
  } else {
    const date = new Date(dateString);
    const day = date.getDay();
    dayNumberStr = day === 0 ? '8' : String(day + 1);
  }

  const matchesDate = daysStr.includes(dayNumberStr);
  return { sessionName, matchesDate };
}

function renderFilters() {
  const dateStr = selectedDate();
  const sessionGroups = { 'Sáng': [], 'Chiều': [], 'Tối': [], 'Khác': [] };
  state.classes.forEach(className => {
    const info = getClassScheduleInfo(className, dateStr);
    if (info.matchesDate) sessionGroups[info.sessionName].push(className);
  });
  const validClasses = Object.values(sessionGroups).flat();

  const currentClass = $('#filterClass')?.value || 'ALL';
  if ($('#filterClass')) {
    const optionsHtml = ['<option value="ALL">Tất cả lớp</option>'];
    ['Sáng', 'Chiều', 'Tối', 'Khác'].forEach(session => {
      if (sessionGroups[session].length > 0) {
        optionsHtml.push(`<optgroup label="Buổi ${session}">`);
        sessionGroups[session].forEach(className => {
          optionsHtml.push(`<option value="${escapeHtml(className)}">${escapeHtml(className)}</option>`);
        });
        optionsHtml.push(`</optgroup>`);
      }
    });
    $('#filterClass').innerHTML = optionsHtml.join('');
    $('#filterClass').value = validClasses.includes(currentClass) ? currentClass : 'ALL';
  }

  const currentAbsenceStatus = normalizeAbsenceStatus($('#filterAbsenceStatus')?.value || 'ALL');
  if ($('#filterAbsenceStatus')) {
    $('#filterAbsenceStatus').innerHTML = [
      '<option value="ALL">Tất cả trạng thái vắng</option>',
      ...state.absenceStatuses.map(status => `<option value="${escapeHtml(status)}">${escapeHtml(status)}</option>`)
    ].join('');
    $('#filterAbsenceStatus').value = state.absenceStatuses.includes(currentAbsenceStatus) ? currentAbsenceStatus : 'ALL';
  }

  const currentStatus = $('#filterStatus')?.value || 'ALL';
  if ($('#filterStatus')) {
    $('#filterStatus').innerHTML = state.statuses.map(status => {
      const label = status === 'ALL' ? 'Tất cả trạng thái' : status;
      return `<option value="${escapeHtml(status)}">${escapeHtml(label)}</option>`;
    }).join('');
    $('#filterStatus').value = state.statuses.includes(currentStatus) ? currentStatus : 'ALL';
  }

  const currentNotice = $('#filterNoticeStatus')?.value || 'ALL';
  $('#filterNoticeStatus').innerHTML = state.noticeStatuses.map(status => {
    const label = status === 'ALL' ? 'Tất cả Zalo' : status;
    return `<option value="${escapeHtml(status)}">${escapeHtml(label)}</option>`;
  }).join('');
  $('#filterNoticeStatus').value = state.noticeStatuses.includes(currentNotice) ? currentNotice : 'ALL';

  if ($('#absenceStatus')) {
    $('#absenceStatus').innerHTML = state.absenceStatuses.map(status => `<option>${escapeHtml(status)}</option>`).join('');
  }
}

function renderSettings() {
  const settings = state.settings || {};
  $('#schoolName').value = settings.schoolName || '';
  $('#zaloMode').value = settings.zaloMode || 'dry-run';
  $('#zaloEnabled').checked = Boolean(settings.zaloEnabled);
  $('#zaloDelayMinutes').value = Number(settings.zaloDelayMinutes ?? 10);
  $('#zaloEndpoint').value = settings.zaloEndpoint || 'https://openapi.zalo.me/v3.0/oa/message/cs';
  $('#zaloAccessToken').placeholder = settings.hasZaloAccessToken ? 'Đã có token, nhập token mới nếu muốn thay' : 'Chưa có token';
  $('#personalZaloName').value = settings.personalZaloName || '';
  $('#personalZaloPhone').value = settings.personalZaloPhone || '';

  $('#zaloCycleSize').value = Number(settings.zaloCycleSize ?? 20);
  $('#zaloCycleDelayMinutes').value = Number(settings.zaloCycleDelayMinutes ?? 1);
  if ($('#aiProvider')) $('#aiProvider').value = settings.aiProvider || 'gemini';
  if ($('#openaiModel')) $('#openaiModel').value = settings.openaiModel || 'gpt-5.5';
  if ($('#openaiApiKey')) $('#openaiApiKey').placeholder = settings.hasOpenAiApiKey ? 'Đã có key, nhập key mới nếu muốn thay' : 'Chưa có key';
  if ($('#geminiModel')) $('#geminiModel').value = settings.geminiModel || 'gemini-3.5-flash';
  if ($('#geminiApiKey')) $('#geminiApiKey').placeholder = settings.hasGeminiApiKey ? 'Đã có key, nhập key mới nếu muốn thay' : 'Chưa có key';
  if ($('#cozeBaseUrl')) $('#cozeBaseUrl').value = settings.cozeBaseUrl || 'https://api.coze.com';
  if ($('#cozeBotId')) $('#cozeBotId').value = settings.cozeBotId || '';
  if ($('#cozeUserId')) $('#cozeUserId').value = settings.cozeUserId || 'bao-vang-teacher';
  if ($('#cozeAccessToken')) $('#cozeAccessToken').placeholder = settings.hasCozeAccessToken ? 'Đã có token, nhập token mới nếu muốn thay' : 'Chưa có token';
  $('#messageTemplate').value = settings.messageTemplate || '';
  if ($('#tuitionTemplate')) $('#tuitionTemplate').value = settings.tuitionTemplate || '';
  if ($('#periodicTemplate')) $('#periodicTemplate').value = settings.periodicTemplate || '';
  if ($('#periodicImageBase64')) {
    $('#periodicImageBase64').value = settings.periodicImageBase64 || '';
    if (settings.periodicImageBase64) {
      $('#periodicImagePreview').src = settings.periodicImageBase64;
      $('#periodicImagePreview').style.display = 'block';
      $('#clearPeriodicImageBtn').style.display = 'inline-block';
      $('#periodicPasteArea').querySelector('.muted').style.display = 'none';
    } else {
      $('#periodicImagePreview').style.display = 'none';
      $('#clearPeriodicImageBtn').style.display = 'none';
      $('#periodicPasteArea').querySelector('.muted').style.display = 'inline-block';
    }
  }
  renderZaloModeFields();
  renderAiStatus();
  renderAutomationBadge();
  renderMessagePreview();
}

function renderMessagePreview() {
  const previewType = $('#previewTypeSelect')?.value || 'absence';
  let templateId = 'messageTemplate';
  if (previewType === 'tuition') templateId = 'tuitionTemplate';
  if (previewType === 'periodic') templateId = 'periodicTemplate';

  const template = $('#' + templateId)?.value || '';
  const previewBox = $('#messagePreview');
  if (!previewBox) return;

  if (!template.trim()) {
    previewBox.innerHTML = '<span class="muted">Chưa có nội dung...</span>';
    return;
  }

  const dummyClass = '6CT1(3-5)';
  const dummySession = getClassScheduleInfo(dummyClass, selectedDate(), selectedDay()).sessionName;

  const dummyData = {
    schoolName: $('#schoolName')?.value || 'Trường Thăng Long',
    date: selectedDate(),
    studentCode: 'HS001',
    studentName: 'Vũ Phương Hướng Nam',
    className: dummyClass,
    session: dummySession !== 'Khác' ? dummySession : 'Sáng',
    absenceStatus: 'Vắng không phép',
    reason: 'Không có lý do',
    parentName: 'Phụ huynh HS',
    phone: '0901234567',
    tuitionDebt: '1.500.000 VNĐ',
    birthday: '15/05/2012'
  };

  let previewText = template;
  for (const [key, value] of Object.entries(dummyData)) {
    previewText = previewText.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }

  previewBox.textContent = previewText;
}

function renderZaloModeFields() {
  const mode = $('#zaloMode')?.value || 'dry-run';
  const isPersonal = ['personal-test', 'personal-real'].includes(mode);
  const isOa = mode === 'oa';
  const note = $('#zaloModeNote');

  $$('.personal-setting').forEach(field => {
    field.hidden = !isPersonal;
  });

  $$('.oa-setting').forEach(field => {
    field.hidden = !isOa;
  });

  if ($('#zaloEnabled')) {
    $('#zaloEnabled').disabled = !isOa;
    if (!isOa) $('#zaloEnabled').checked = false;
  }

  if (note) {
    const notes = {
      'personal-real': 'Zalo cá nhân gửi thật theo cách thủ công: hệ thống tạo tối đa 3-5 tin, giáo viên bấm Nhắn tin, kiểm tra nội dung trong Zalo rồi bấm gửi.',
      'personal-test': 'Zalo cá nhân chạy thử: hệ thống chỉ tạo log và nội dung mẫu cho tối đa 3-5 học sinh, chưa gửi thật.',
      oa: 'Zalo OA gửi thật bằng endpoint và access token OA. Chỉ bật chế độ này khi token đã sẵn sàng.',
      'dry-run': 'Chạy thử chỉ ghi log nội dung tin nhắn, không gửi Zalo thật.'
    };
    note.textContent = notes[mode] || notes['dry-run'];
  }
}

function aiProviderLabel(provider) {
  const labels = {
    internal: 'Nội bộ',
    openai: 'ChatGPT',
    gemini: 'Gemini',
    coze: 'Coze AI'
  };
  return labels[provider] || labels.internal;
}

function selectedAiProvider() {
  return 'gemini';
}

function renderAiStatus() {
  const note = $('#aiModeNote');
  if (!note) return;
  const settings = state.settings || {};
  const provider = selectedAiProvider();
  $$('.ai-provider').forEach(field => {
    field.hidden = !field.classList.contains(`ai-provider-${provider}`);
  });
  if ($('#copyCozePromptBtn')) $('#copyCozePromptBtn').hidden = provider !== 'coze';

  if (provider === 'internal') {
    note.textContent = 'Chatbox đang dùng trợ lý nội bộ, không cần API key ngoài.';
    return;
  }

  if (provider === 'openai') {
    const hasKey = Boolean(settings.hasOpenAiApiKey) || Boolean($('#openaiApiKey')?.value.trim());
    note.textContent = hasKey
      ? 'ChatGPT đã sẵn sàng. API key được gọi qua server, không lộ trên trình duyệt.'
      : 'Cần OpenAI API key để chatbox gọi ChatGPT.';
    return;
  }

  if (provider === 'gemini') {
    const hasKey = Boolean(settings.hasGeminiApiKey) || Boolean($('#geminiApiKey')?.value.trim());
    note.textContent = hasKey
      ? 'Gemini đã sẵn sàng. API key được gọi qua server, không lộ trên trình duyệt.'
      : 'Cần Gemini API key để chatbox gọi Gemini.';
    return;
  }

  const botId = $('#cozeBotId')?.value.trim() || settings.cozeBotId || '';
  const hasToken = Boolean(settings.hasCozeAccessToken) || Boolean($('#cozeAccessToken')?.value.trim());

  if (!botId || !hasToken) {
    note.textContent = 'Cần Bot ID và access token Coze để chatbox gọi AI.';
    return;
  }

  note.textContent = 'Coze AI đã sẵn sàng. Token được gọi qua server, không lộ trên trình duyệt.';
}

function renderAutomationBadge() {
  const badge = $('#automationBadge');
  if (!badge) return;
  const settings = state.settings || {};
  const sendMode = settings.zaloMode === 'personal-test'
    ? `Zalo cá nhân, chạy thử`
    : (settings.zaloMode === 'personal-real'
      ? `Zalo cá nhân, gửi thật`
      : (settings.zaloEnabled && settings.zaloMode === 'oa' ? 'Gửi thật' : 'Chạy thử'));
  badge.textContent = `${sendMode}, ${formatDelay(settings.zaloDelayMinutes)}`;
}

function renderStudentSelect() {
  if (!$('#absenceStudent')) return;
  const rows = activeStudents();
  $('#absenceStudent').innerHTML = rows.length
    ? rows.map(student => `<option value="${student.id}">${escapeHtml(student.code)} - ${escapeHtml(student.fullName)} - ${escapeHtml(student.className)} - ${escapeHtml(student.phone1)}</option>`).join('')
    : '<option value="">Chưa có học sinh</option>';
}

function renderSummary() {
  const items = [
    ['total', 'Tổng vắng', 'HS', 'total'],
    ['pending', 'Chưa gọi', 'CG', 'pending'],
    ['called', 'Đã gọi', 'ĐG', 'sent'],
    ['noticeWaiting', 'Chờ Zalo', 'ZA', 'waiting'],
    ['noticeSent', 'Zalo đã gửi', 'OK', 'sent'],
    ['noticeFailed', 'Zalo lỗi', '!', 'failed']
  ];
  $('#summaryGrid').innerHTML = items.map(([key, label, icon, tone]) => `
    <div class="summary-card ${tone}">
      <span class="summary-icon">${escapeHtml(icon)}</span>
      <div>
        <strong>${state.summary[key] ?? 0}</strong>
        <span>${label}</span>
      </div>
    </div>
  `).join('');
  
  if (activeTabId() === 'overviewTab') {
    renderCharts();
  }
}

function renderCharts() {
  if (!window.Chart) return;
  
  // 1. Prepare data for Pie Chart (Tỉ lệ vắng)
  const statusCounts = {};
  state.absences.forEach(a => {
    const status = state.absenceStatuses.find(s => s.id === a.absence_status_id);
    const label = status ? status.name : 'Khác';
    statusCounts[label] = (statusCounts[label] || 0) + 1;
  });
  
  const pieCtx = document.getElementById('absencePieChart');
  if (pieCtx) {
    if (absencePieChart) absencePieChart.destroy();
    absencePieChart = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusCounts),
        datasets: [{
          data: Object.values(statusCounts),
          backgroundColor: ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' }
        }
      }
    });
  }

  // 2. Prepare data for Bar Chart (Thống kê theo lớp)
  const classCounts = {};
  state.absences.forEach(a => {
    const className = a.student_class || 'Khác';
    classCounts[className] = (classCounts[className] || 0) + 1;
  });
  
  // Sort classes by absence count descending, take top 10
  const sortedClasses = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
    
  const barCtx = document.getElementById('classBarChart');
  if (barCtx) {
    if (classBarChart) classBarChart.destroy();
    classBarChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: sortedClasses.map(c => c[0]),
        datasets: [{
          label: 'Số học sinh vắng',
          data: sortedClasses.map(c => c[1]),
          backgroundColor: '#3b82f6',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { beginAtZero: true, ticks: { stepSize: 1 } }
        }
      }
    });
  }
}

function statusClass(status) {
  return {
    'Chưa gọi': 'pending',
    'Đã gọi': 'called',
    'Không nghe máy': 'no-answer',
    'Hẹn gọi lại': 'callback',
    'Sai số': 'wrong',
    'Chờ gửi': 'waiting',
    'Chờ gửi thủ công': 'waiting',
    'Chưa gửi': 'pending',
    'Chạy thử': 'callback',
    'Đã gửi': 'called',
    'Lỗi gửi': 'wrong',
    'Không gửi': 'no-answer'
  }[status] || 'pending';
}

function options(values, selected) {
  return values.map(value => {
    const label = value || '-- Chọn --';
    return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

function groupByClass(students) {
  return students.reduce((groups, student) => {
    const className = student.className || 'Chưa có lớp';
    if (!groups[className]) groups[className] = [];
    groups[className].push(student);
    return groups;
  }, {});
}

function matchesRosterKeyword(student, keyword) {
  if (!keyword) return true;
  const text = `${student.code} ${student.fullName} ${student.className} ${student.parentName} ${student.phone1} ${student.phone2} ${student.zaloUserId}`.toLowerCase();
  return text.includes(keyword);
}

function absenceForStudent(studentId) {
  return state.absences.find(row => row.studentId === studentId && row.date === selectedDate());
}

function selectedSession() {
  return $('#sessionDropdown')?.value || 'ALL';
}

function selectedDay() {
  return $('#dayDropdown')?.value || 'ALL';
}

function renderClassDropdown() {
  const dropdown = $('#classDropdown');
  const meta = $('#classDropdownMeta');
  const rows = activeStudents();
  const groups = groupByClass(rows);
  const classNames = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'vi'));
  const activeClass = selectedClass();
  const dateStr = selectedDate();
  const activeSession = selectedSession();
  const activeDay = selectedDay();
  
  const sessionGroups = { 'Sáng': [], 'Chiều': [], 'Tối': [], 'Khác': [] };
  classNames.forEach(className => {
    const info = getClassScheduleInfo(className, dateStr, activeDay);
    if (info.matchesDate && (activeSession === 'ALL' || info.sessionName === activeSession)) {
      sessionGroups[info.sessionName].push(className);
    }
  });
  
  const validClasses = Object.values(sessionGroups).flat();
  
  $('#classCount').textContent = `${validClasses.length} lớp`;
  if (!dropdown) return;

  const validStudents = rows.filter(s => validClasses.includes(s.className || 'Chưa có lớp'));
  const validAbsences = state.absences.filter(a => validClasses.includes(a.className));

  const optionsHtml = [`<option value="ALL">Tất cả lớp (${validStudents.length} học sinh)</option>`];
  
  ['Sáng', 'Chiều', 'Tối', 'Khác'].forEach(session => {
    if (sessionGroups[session].length > 0) {
      optionsHtml.push(`<optgroup label="Buổi ${session}">`);
      sessionGroups[session].forEach(className => {
        const students = groups[className];
        const absenceCount = state.absences.filter(row => row.className === className).length;
        optionsHtml.push(`<option value="${escapeHtml(className)}">${escapeHtml(className)} - ${students.length} học sinh, ${absenceCount} vắng</option>`);
      });
      optionsHtml.push(`</optgroup>`);
    }
  });

  dropdown.innerHTML = optionsHtml.join('');
  dropdown.value = validClasses.includes(activeClass) ? activeClass : 'ALL';

  const selectedStudents = dropdown.value === 'ALL' ? validStudents : (groups[dropdown.value] || []);
  const selectedAbsences = dropdown.value === 'ALL'
    ? validAbsences.length
    : state.absences.filter(row => row.className === dropdown.value).length;
  const phoneCount = selectedStudents.filter(student => student.phone1 || student.phone2).length;

  if (meta) {
    meta.innerHTML = `
      <div><strong>${selectedStudents.length}</strong><span>học sinh đang học</span></div>
      <div><strong>${selectedAbsences}</strong><span>đang báo vắng</span></div>
      <div><strong>${phoneCount}</strong><span>có SĐT phụ huynh</span></div>
    `;
  }
}

function renderRoster() {
  const roster = $('#studentRoster');
  const className = selectedClass();
  const dateStr = selectedDate();
  const activeSession = selectedSession();
  const activeDay = selectedDay();
  
  const filtered = activeStudents().filter(student => {
    const studentClass = student.className || 'Chưa có lớp';
    const info = getClassScheduleInfo(studentClass, dateStr, activeDay);
    
    const matchesSession = activeSession === 'ALL' || info.sessionName === activeSession;
    if (!matchesSession) return false;
    
    if (className === 'ALL') {
      return info.matchesDate;
    }
    return studentClass === className;
  });

  const absentCount = filtered.filter(student => absenceForStudent(student.id)).length;

  $('#rosterTitle').textContent = className === 'ALL' ? 'Danh sách học sinh' : `Lớp ${className}`;
  $('#rosterMeta').textContent = `${filtered.length} học sinh · ${absentCount} đang báo vắng`;

  if (!filtered.length) {
    roster.innerHTML = '<div class="empty">Chưa có học sinh trong phạm vi đang chọn.</div>';
    return;
  }

  const groups = groupByClass(filtered);
  
  const sortedGroups = Object.keys(groups).sort((a, b) => {
    const infoA = getClassScheduleInfo(a, dateStr, activeDay);
    const infoB = getClassScheduleInfo(b, dateStr, activeDay);
    const sessionOrder = { 'Sáng': 1, 'Chiều': 2, 'Tối': 3, 'Khác': 4 };
    if (sessionOrder[infoA.sessionName] !== sessionOrder[infoB.sessionName]) {
      return sessionOrder[infoA.sessionName] - sessionOrder[infoB.sessionName];
    }
    return a.localeCompare(b, 'vi');
  });

  roster.innerHTML = sortedGroups.map(groupName => {
    const info = getClassScheduleInfo(groupName, dateStr, activeDay);
    const sessionLabel = info.sessionName !== 'Khác' ? ` (Buổi ${info.sessionName})` : '';
    const title = className === 'ALL'
      ? `<div class="class-group-title"><span>${escapeHtml(groupName)}${sessionLabel}</span><span>${groups[groupName].length} học sinh</span></div>`
      : '';
    const rows = groups[groupName].map(renderRosterStudent).join('');
    return title + rows;
  }).join('');
}

function renderRosterStudent(student) {
  const absence = absenceForStudent(student.id);
  const currentStatus = absence ? normalizeAbsenceStatus(absence.absenceStatus) : 'Đang học';
  const phone = student.phone1 || student.phone2 || 'Chưa có SĐT';
  const statusOptions = [
    ['Đang học', 'Đang học'],
    ['Vắng', 'Vắng'],
    ['Có phép', 'Có phép'],
    ['Đi trễ', 'Đi trễ'],
    ['Về sớm', 'Về sớm'],
    ['Cả ngày', 'Cả ngày'],
    ['Nghỉ học', 'Nghỉ học'],
    ['Học phí', 'Trễ học phí']
  ];
  if (!statusOptions.some(([value]) => value === currentStatus)) {
    statusOptions.push([currentStatus, currentStatus]);
  }

  return `
    <article class="student-card ${absence ? 'is-absent' : ''}">
      <div class="student-main">
        <div>
          <div class="person-main">
            ${escapeHtml(student.fullName)}
            ${student.recentAbsenceCount >= 3 ? `<span title="Vắng ${student.recentAbsenceCount} buổi trong 30 ngày qua" style="color: #ef4444; font-size: 14px; margin-left: 4px;">⚠️ (${student.recentAbsenceCount})</span>` : ''}
          </div>
          <div class="student-phone">${escapeHtml(phone)}</div>
        </div>
      </div>
      <div class="student-status-control">
        <label for="status-${escapeHtml(student.id)}">Trạng thái</label>
        <select id="status-${escapeHtml(student.id)}" class="roster-status-select" data-student-id="${escapeHtml(student.id)}" data-absence-id="${escapeHtml(absence?.id || '')}">
          ${statusOptions.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === currentStatus ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
    </article>
  `;
}

function noticeTimeLine(row) {
  if (row.noticeStatus === 'Chờ gửi' && row.noticeDueAt) {
    return escapeHtml(formatDateTime(row.noticeDueAt));
  }
  if (row.noticeSentAt) {
    return escapeHtml(formatDateTime(row.noticeSentAt));
  }
  return 'Chưa xử lý';
}

function renderAbsences() {
  const container = $('#absenceRows');
  
  // Filter out processed items if the user is viewing "ALL"
  const currentNoticeFilter = $('#filterNoticeStatus')?.value || 'ALL';
  const displayAbsences = state.absences.filter(row => {
    if (currentNoticeFilter !== 'ALL') return true; // Show whatever they filtered for
    // In ALL mode, hide processed items
    if (['Đã gửi', 'Chưa kết bạn - Cần gọi', 'Không gửi', 'Lỗi gửi', 'Chờ gửi thủ công'].includes(row.noticeStatus)) {
      return false;
    }
    return true;
  });

  if (!displayAbsences.length) {
    container.innerHTML = '<div class="empty">Hàng xử lý trống. Mọi học sinh đã được xử lý xong.</div>';
    return;
  }

  container.innerHTML = displayAbsences.map(row => {
    const phone = row.phone1 || row.phone2 || 'Chưa có SĐT';
    return `
    <article class="absence-item" data-id="${row.id}">
      <div class="absence-student">
        <div class="person-main">${escapeHtml(row.studentName)}</div>
        <div class="student-phone">${escapeHtml(phone)}</div>
      </div>

      <div class="absence-controls">
        <label>Trạng thái vắng</label>
        <span class="absence-status-pill">${escapeHtml(normalizeAbsenceStatus(row.absenceStatus))}</span>
        ${row.initialReason && row.initialReason !== row.absenceStatus ? `<span class="muted">${escapeHtml(row.initialReason)}</span>` : ''}
      </div>

      <div class="stack notice-cell">
        <label>Zalo</label>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge ${statusClass(row.noticeStatus)}">${escapeHtml(row.noticeStatus || 'Chưa gửi')}</span>
          ${['Lỗi gửi', 'Chưa gửi'].includes(row.noticeStatus || 'Chưa gửi') ? `<button class="btn ghost btn-sm retry-zalo-btn" type="button" data-id="${row.id}" style="padding: 2px 8px; font-size: 12px;">Gửi thủ công</button>` : ''}
        </div>
      </div>

      <div class="stack notice-time-cell">
        <label>Thời gian xử lý</label>
        <span class="notice-time">${noticeTimeLine(row)}</span>
      </div>
    </article>
  `;
  }).join('');
}

async function loadHistory() {
  const rows = await api('/api/call-logs?' + queryString({
    date: $('#historyDate').value,
    q: $('#historyKeyword').value.trim()
  }));

  const tbody = $('#historyRows');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Chưa có lịch sử cuộc gọi.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.time))}</td>
      <td>${escapeHtml(row.date)}</td>
      <td>
        <div class="person-main">${escapeHtml(row.studentName)}</div>
        <div class="muted">${escapeHtml(row.studentCode)}</div>
      </td>
      <td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.phoneCalled)}</td>
      <td><span class="badge ${statusClass(row.callStatus)}">${escapeHtml(row.callStatus)}</span></td>
      <td>
        <select class="form-control" onchange="updateCallResult('${row.id}', this.value)" style="width: 150px;">
          <option value="" ${!row.callResult ? 'selected' : ''}>-- Chọn --</option>
          <option value="Đã gọi" ${row.callResult === 'Đã gọi' ? 'selected' : ''}>Đã gọi</option>
          <option value="Không bắt máy" ${row.callResult === 'Không bắt máy' ? 'selected' : ''}>Không bắt máy</option>
          <option value="Không liên lạc được" ${row.callResult === 'Không liên lạc được' ? 'selected' : ''}>Không liên lạc được</option>
        </select>
      </td>
      <td>${escapeHtml(row.caller)}</td>
      <td>${escapeHtml(row.note)}</td>
    </tr>
  `).join('');
}

async function updateCallResult(id, result) {
  try {
    await api(`/api/call-logs/${id}/result`, {
      method: 'POST',
      body: JSON.stringify({ result })
    });
    await loadHistory();
  } catch (error) {
    console.error('Failed to update call result:', error);
  }
}

async function loadQuitStudents() {
  const rows = await api('/api/quit-students?' + queryString({
    q: $('#historyKeyword').value.trim()
  }));

  const tbody = $('#quitRows');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">Không có học sinh nào nghỉ học.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(row.quitDate || '')}</td>
      <td>
        <div class="person-main">${escapeHtml(row.fullName)}</div>
        <div class="muted">${escapeHtml(row.code)}</div>
      </td>
      <td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.parentName)}</td>
      <td>
        <div>${escapeHtml(row.phone1 || '')}</div>
      </td>
      <td>${escapeHtml(row.quitReason || '')}</td>
    </tr>
  `).join('');
}

async function loadNotices() {
  let rows = await api('/api/notification-logs?' + queryString({
    date: $('#historyDate').value,
    q: $('#historyKeyword').value.trim()
  }));
  
  rows = rows.filter(row => row.status !== 'Chưa kết bạn - Cần gọi');

  const tbody = $('#noticeRows');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty">Chưa có lịch sử gửi Zalo.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(row => `
    <tr>
      <td>${escapeHtml(formatDateTime(row.time))}</td>
      <td>${escapeHtml(row.date)}</td>
      <td>
        <div class="person-main">${escapeHtml(row.studentName)}</div>
        <div class="muted">${escapeHtml(row.studentCode)}</div>
      </td>
      <td>${escapeHtml(row.className)}</td>
      <td>${escapeHtml(row.parentName)}</td>
      <td>
        <div>${escapeHtml(row.zaloUserId || 'Chưa có UID')}</div>
        <div class="muted">${escapeHtml(row.phone1 || '')}</div>
      </td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="badge ${statusClass(row.status)}">${escapeHtml(row.status)}</span>
          ${row.status === 'Chờ gửi thủ công' && row.message ? `
            <button class="btn ghost btn-sm copy-log-msg-btn" type="button" style="font-size: 11px; padding: 2px 4px; white-space: nowrap;" data-msg="${escapeHtml(row.message)}">
              Copy tin nhắn
            </button>
          ` : ''}
          ${row.status === 'Lỗi gửi' && row.absenceId ? `
            <button class="btn ghost btn-sm retry-zalo-btn" type="button" data-id="${row.absenceId}" data-logid="${row.id}" data-msg="${escapeHtml(row.message || '')}" data-link="${escapeHtml(row.responsePayload?.link || '')}" style="font-size: 11px; padding: 2px 4px; white-space: nowrap;">
              Gửi lại
            </button>
          ` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

async function markUnfriended(id) {
  if (!confirm('Bạn có chắc chắn muốn báo "Người lạ (Chưa kết bạn Zalo)" cho lượt gửi này và đưa vào danh sách Cần gọi điện không?')) return;
  await api(`/api/notification-logs/${id}/mark-unfriended`, { method: 'POST' });
  await Promise.all([loadNotices(), loadCallHistory()]);
}

async function activateTab(tabId, activeShortcut = null) {
  $$('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  $$('.side-link[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabId));
  let shortcutMarked = false;
  $$('.shortcut-tab').forEach(btn => {
    const isActive = activeShortcut
      ? btn === activeShortcut
      : btn.dataset.tab === tabId && !shortcutMarked;
    btn.classList.toggle('active', isActive);
    if (isActive) shortcutMarked = true;
  });
  $$('.tab-panel').forEach(panel => panel.classList.remove('active'));
  $('#' + tabId).classList.add('active');
  if (tabId === 'overviewTab' || tabId === 'absenceTab') await loadAttendanceAbsences();
  if (tabId === 'historyTab') {
    await Promise.all([loadHistory(), loadNotices(), loadQuitStudents()]);
  }
  if (tabId === 'queueTab') await loadAbsences();
}

function activeTabId() {
  return document.querySelector('.tab-panel.active')?.id || '';
}

function queuedMessage(result) {
  if (result.noticeLog) return ` Zalo: ${result.noticeLog.status}.`;
  if (result.absence?.noticeStatus === 'Chờ gửi') {
    return ` Zalo chờ gửi lúc ${formatDateTime(result.absence.noticeDueAt)}.`;
  }
  return '';
}

async function updateRosterStatus(select) {
  const studentId = select.dataset.studentId;
  const absenceId = select.dataset.absenceId;
  const status = normalizeAbsenceStatus(select.value);

  if (status === 'Đang học') {
    if (absenceId) {
      await api(`/api/absences/${absenceId}`, { method: 'DELETE' });
      toast('Đã chuyển học sinh về trạng thái đang học.');
      await loadBootstrap();
    }
    return;
  }

  if (absenceId) {
    const result = await api(`/api/absences/${absenceId}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        absenceStatus: status,
        initialReason: status,
        sendZalo: true
      })
    });
    toast('Đã cập nhật trạng thái.' + queuedMessage(result));
    await loadBootstrap();
    return;
  }

  const student = state.students.find(s => s.id === studentId);
  const className = student?.className || '';
  const sessionInfo = getClassScheduleInfo(className, selectedDate(), selectedDay());

  const result = await api('/api/absences', {
    method: 'POST',
    body: JSON.stringify({
      date: selectedDate(),
      studentId,
      session: sessionInfo.sessionName,
      absenceStatus: status,
      initialReason: status,
      sendZalo: true
    })
  });
  toast('Đã cập nhật trạng thái.' + queuedMessage(result));
  await loadBootstrap();
}

function bulkZaloMessage(result) {
  const summary = result.summary || {};
  const parts = [
    `${result.processed || 0}/${result.total || 0} học sinh`,
    summary.sent ? `${summary.sent} đã gửi` : '',
    summary.dryRun ? `${summary.dryRun} chạy thử` : '',
    summary.manual ? `${summary.manual} chờ gửi thủ công` : '',
    summary.failed ? `${summary.failed} lỗi` : '',
    summary.notSent ? `${summary.notSent} chưa gửi được` : '',
    result.skipped ? `${result.skipped} đã gửi trước đó` : '',
    result.limited ? `${result.limited} ngoài giới hạn chạy thử` : ''
  ].filter(Boolean);
  return `Đã xử lý Zalo hàng loạt: ${parts.join(', ')}.`;
}

function manualPayload(log) {
  return log?.responsePayload || {};
}

async function copyMessageAndOpenZalo(message, link = '') {
  let popup = null;
  if (link) {
    popup = window.open('about:blank', '_blank');
    if (popup) popup.opener = null;
  }

  try {
    await navigator.clipboard.writeText(message || '');
    toast('Đã copy nội dung tin nhắn. Dùng khi nút Nhắn tin không tự điền được nội dung.');
  } catch (error) {
    toast('Không copy tự động được. Hãy dùng nút Copy tin dự phòng.');
  }

  if (popup && link) {
    popup.location.href = link;
  } else if (link) {
    window.open(link, '_blank', 'noopener');
  }
}

async function openZaloAndPasteMessage(message, link = '') {
  if (!link || link.trim() === '') {
    toast('Học sinh này chưa có số điện thoại, không thể mở Zalo.', 'error');
    return false;
  }
  
  try {
    let success = false;
    
    let fetchError1 = '';
    let fetchError2 = '';

    const handleResponse = async (res) => {
      if (res.ok) {
        success = true;
        return true;
      }
      const text = await res.text();
      if (text.includes('OCR_STRANGER_DETECTED')) {
        throw new Error('OCR_STRANGER_DETECTED');
      }
      return false;
    };

    // Attempt 1: Try to call the local helper on 127.0.0.1:3000
    try {
      const localResponse = await fetch('http://127.0.0.1:3000/api/local-zalo/open-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, link })
      });
      await handleResponse(localResponse);
    } catch (e) {
      if (e.message === 'OCR_STRANGER_DETECTED') throw e;
      fetchError1 = e.message;
    }

    // Attempt 1.5: Try localhost
    if (!success) {
      try {
        const localResponse = await fetch('http://localhost:3000/api/local-zalo/open-paste', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, link })
        });
        await handleResponse(localResponse);
      } catch (e) {
        if (e.message === 'OCR_STRANGER_DETECTED') throw e;
        fetchError2 = e.message;
      }
    }

    // Attempt 2: Try the same-origin server (works if running locally)
    if (!success) {
      const response = await fetch('/api/local-zalo/open-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, link })
      });
      await handleResponse(response);
    }

    if (success) {
      toast('Đã tự động mở Zalo và dán tin nhắn.');
      return true;
    }
    
    // Fallback if local server is unreachable
    toast(`Không kết nối ZaloHelper: ${fetchError1 || fetchError2 || 'Unknown'}. Đang mở thủ công...`);
    await copyMessageAndOpenZalo(message, link);
    return false;
  } catch (error) {
    if (error.message === 'OCR_STRANGER_DETECTED') {
      toast('Phát hiện Zalo báo Người lạ! Đã ngừng dán tin nhắn để bảo đảm an toàn.', 'error');
      return 'STRANGER';
    }
    toast(`${error.message} Nội dung đã được copy sẵn; dùng Copy tin nếu cần.`);
    await copyMessageAndOpenZalo(message, link);
    return false;
  }
}

function renderManualSendPanel(logs = []) {
  const panel = $('#manualSendPanel');
  if (!panel) return;
  const rows = logs.filter(log => log.status === 'Chờ gửi thủ công');
  panel.hidden = rows.length === 0;
  if (!rows.length) {
    panel.innerHTML = '';
    return;
  }

  panel.innerHTML = `
    <div class="manual-send-heading">
      <div>
        <h3>Tin nhắn Zalo cá nhân cần gửi</h3>
        <p>Bấm Nhắn tin để mở Zalo và đưa nội dung vào khung chat, sau đó kiểm tra và bấm gửi trong Zalo.</p>
      </div>
      <span>${rows.length} học sinh</span>
    </div>
    <div class="manual-send-list">
      ${rows.map(log => {
        const payload = manualPayload(log);
        return `
          <article class="manual-send-card" data-absence-id="${escapeHtml(log.absenceId)}">
            <div>
              <strong>${escapeHtml(log.studentName)}</strong>
              <span>${escapeHtml(payload.phone || log.phone1 || 'Chưa có SĐT')}</span>
            </div>
            <textarea readonly>${escapeHtml(payload.message || log.message || '')}</textarea>
            <div class="manual-send-actions">
              ${payload.link ? `<a class="btn small blue open-manual-zalo" href="${escapeHtml(payload.link)}" target="_blank" rel="noopener">Nhắn tin</a>` : ''}
              <button class="btn small ghost copy-manual-message" type="button">Copy tin</button>
              <button class="btn small success mark-manual-sent" type="button">Đã gửi</button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderManualSendChatCards(logs = []) {
  const rows = logs.filter(log => log.status === 'Chờ gửi thủ công');
  if (!rows.length) return;

  const bubble = addChatMessage('bot', `Mình đã tạo ${rows.length} tin Zalo cá nhân. Bấm Nhắn tin để app mở Zalo và đưa nội dung vào khung chat; thầy/cô chỉ kiểm tra rồi bấm gửi.`);
  const host = bubble?.parentElement;
  if (!host) return;

  const list = document.createElement('div');
  list.className = 'chat-manual-list';

  rows.forEach(log => {
    const payload = manualPayload(log);
    const card = document.createElement('article');
    card.className = 'chat-manual-card';
    card.dataset.absenceId = log.absenceId || '';

    const title = document.createElement('strong');
    title.textContent = log.studentName || 'Học sinh';

    const phone = document.createElement('span');
    phone.textContent = payload.phone || log.phone1 || 'Chưa có SĐT';

    const textarea = document.createElement('textarea');
    textarea.readOnly = true;
    textarea.value = payload.message || log.message || '';

    const actions = document.createElement('div');
    actions.className = 'chat-action-buttons';

    if (payload.link) {
      const openBtn = document.createElement('button');
      openBtn.className = 'btn small blue';
      openBtn.type = 'button';
      openBtn.textContent = 'Nhắn tin';
      openBtn.addEventListener('click', () => openZaloAndPasteMessage(textarea.value || '', payload.link));
      actions.appendChild(openBtn);
    }

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small ghost';
    copyBtn.type = 'button';
    copyBtn.textContent = 'Copy tin';
    copyBtn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value || '');
      toast('Đã copy nội dung tin nhắn.');
    });

    const markBtn = document.createElement('button');
    markBtn.className = 'btn small success';
    markBtn.type = 'button';
    markBtn.textContent = 'Đã gửi';
    markBtn.addEventListener('click', async () => {
      markBtn.disabled = true;
      try {
        await api(`/api/absences/${card.dataset.absenceId}/zalo/manual-sent`, { method: 'POST', body: '{}' });
        card.dataset.done = 'true';
        markBtn.textContent = 'Đã cập nhật';
        toast('Đã đánh dấu gửi qua Zalo cá nhân.');
        await loadAbsences();
      } catch (error) {
        markBtn.disabled = false;
        toast(error.message, 'error');
      }
    });

    actions.append(copyBtn, markBtn);
    card.append(title, phone, textarea, actions);
    list.appendChild(card);
  });

  host.appendChild(list);
  $('#chatboxMessages').scrollTop = $('#chatboxMessages').scrollHeight;
}

async function sendBulkZalo(button) {
  button.disabled = true;
  try {
    const result = await api('/api/absences/zalo/bulk', {
      method: 'POST',
      body: JSON.stringify({ filters: getFilters() })
    });
    toast(bulkZaloMessage(result));
    renderManualSendPanel(result.logs || []);
    await loadAbsences();
  } finally {
    button.disabled = false;
  }
}

function exportLateAbsences(params = {}) {
  downloadUrl('/api/absences/export-late', params);
}

function exportFailedZalo(params = {}) {
  downloadUrl('/api/absences/export-failed-zalo', params);
}

function exportCallList(params = {}) {
  downloadUrl('/api/call-logs/export', params);
}

async function clearCallHistory() {
  const params = {
    date: $('#historyDate')?.value || '',
    q: $('#historyKeyword')?.value.trim() || ''
  };
  const scope = params.date || params.q ? 'lịch sử cuộc gọi đang lọc' : 'toàn bộ lịch sử cuộc gọi';
  if (!confirm(`Xóa ${scope}?`)) return;
  const result = await api('/api/call-logs?' + queryString(params), { method: 'DELETE' });
  toast(`Đã xóa ${result.deleted || 0} dòng lịch sử cuộc gọi.`);
  await loadHistory();
}

async function clearNoticeHistory() {
  const params = {
    date: $('#historyDate')?.value || '',
    q: $('#historyKeyword')?.value.trim() || ''
  };
  const scope = params.date || params.q ? 'lịch sử Zalo đang lọc' : 'toàn bộ lịch sử Zalo';
  if (!confirm(`Xóa ${scope}?`)) return;
  const result = await api('/api/notification-logs?' + queryString(params), { method: 'DELETE' });
  toast(`Đã xóa ${result.deleted || 0} dòng lịch sử Zalo.`);
  await loadNotices();
}

function normalizeChatText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[.,:;!?()[\]{}"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chatHasAny(text, words) {
  return words.some(word => text.includes(word));
}

function chatStatusCounts(rows, field, fallback = '') {
  return rows.reduce((counts, row) => {
    const key = field === 'absenceStatus'
      ? normalizeAbsenceStatus(row[field] || fallback)
      : (row[field] || fallback);
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function formatChatCounts(counts) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))
    .map(([label, count]) => `${label}: ${count}`)
    .join(', ');
}

function updateChatboxStatus() {
  const status = $('#chatboxStatus');
  if (!status) return;
  const totalStudents = activeStudents().length;
  const totalAbsences = state.summary?.total ?? state.absences.length;
  const settings = state.settings || {};
  const aiStatus = settings.aiConfigured ? aiProviderLabel(settings.aiProvider) : 'Nội bộ';
  status.textContent = `${aiStatus} · ${totalStudents} học sinh · ${totalAbsences} báo vắng`;
}

function addChatMessage(role, text) {
  const messages = $('#chatboxMessages');
  if (!messages) return;

  const item = document.createElement('article');
  item.className = `chat-message ${role}`;

  const label = document.createElement('span');
  label.textContent = role === 'user' ? 'Bạn' : 'Trợ lý';

  const bubble = document.createElement('p');
  bubble.textContent = text;

  item.append(label, bubble);
  messages.appendChild(item);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function addChatActionCard(bubble, action) {
  if (!bubble || !action) return;
  const card = document.createElement('div');
  card.className = 'chat-action-card';

  const title = document.createElement('strong');
  title.textContent = action.label || 'Hành động chờ xác nhận';

  const meta = document.createElement('span');
  const mode = action.mode ? ` · chế độ ${action.mode}` : '';
  meta.textContent = `${action.candidateCount || 0} bản ghi cần gửi${mode}`;

  const actions = document.createElement('div');
  actions.className = 'chat-action-buttons';

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'btn small success';
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Xác nhận gửi';
  confirmBtn.addEventListener('click', () => confirmAiAction(confirmBtn, action.id, card));

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn small ghost';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Hủy';
  cancelBtn.addEventListener('click', () => {
    card.dataset.done = 'true';
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    meta.textContent = 'Đã hủy lệnh gửi.';
  });

  actions.append(confirmBtn, cancelBtn);
  card.append(title, meta, actions);
  bubble.parentElement?.appendChild(card);
  $('#chatboxMessages').scrollTop = $('#chatboxMessages').scrollHeight;
}

function detectClassFromChat(message) {
  const query = normalizeChatText(message);
  if (!query) return '';

  return (state.classes || [])
    .filter(className => {
      const classText = normalizeChatText(className);
      const parts = classText.split(/[^a-z0-9]+/).filter(part => part.length >= 2);
      return query.includes(classText) || parts.some(part => query.includes(part));
    })
    .sort((a, b) => normalizeChatText(b).length - normalizeChatText(a).length)[0] || '';
}

function buildClassReply(className) {
  const students = activeStudents().filter(student => student.className === className);
  const absences = state.absences.filter(row => row.className === className);
  const withPhone = students.filter(student => student.phone1 || student.phone2).length;
  const lines = [
    `Lớp ${className}: ${students.length} học sinh đang học, ${absences.length} báo vắng ngày ${selectedDate()}.`,
    `${withPhone}/${students.length || 0} học sinh có số điện thoại phụ huynh.`
  ];

  const statusCounts = chatStatusCounts(absences, 'absenceStatus', 'Vắng');
  if (Object.keys(statusCounts).length) {
    lines.push(`Trạng thái: ${formatChatCounts(statusCounts)}.`);
  }

  return lines.join('\n');
}

function buildSummaryReply() {
  const absences = state.absences || [];
  const summary = state.summary || {};
  const total = summary.total ?? absences.length;
  const lines = [
    `Ngày ${selectedDate()} đang có ${total} học sinh trong hàng báo vắng.`,
    `Chưa gọi: ${summary.pending ?? 0}, đã gọi: ${summary.called ?? 0}, chờ Zalo: ${summary.noticeWaiting ?? 0}, Zalo đã gửi: ${summary.noticeSent ?? 0}, Zalo lỗi: ${summary.noticeFailed ?? 0}.`
  ];

  const statusCounts = chatStatusCounts(absences, 'absenceStatus', 'Vắng');
  if (Object.keys(statusCounts).length) {
    lines.push(`Theo trạng thái: ${formatChatCounts(statusCounts)}.`);
  }

  const classCounts = absences.reduce((counts, row) => {
    const key = row.className || 'Chưa có lớp';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const topClasses = Object.entries(classCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'vi'))
    .slice(0, 5)
    .map(([className, count]) => `${className}: ${count}`);
  if (topClasses.length) {
    lines.push(`Lớp có báo vắng: ${topClasses.join(', ')}.`);
  }

  return lines.join('\n');
}

function buildTodayAbsentStudentsReply() {
  const rows = state.absences || [];
  if (!rows.length) {
    return `Ngày ${selectedDate()} chưa có học sinh trong danh sách báo vắng.`;
  }

  const lines = rows.slice(0, 20).map((row, index) => {
    const status = normalizeAbsenceStatus(row.absenceStatus);
    const session = row.session ? ` · ${row.session}` : '';
    return `${index + 1}. ${row.studentName} · ${row.className} · ${status}${session}`;
  });
  const suffix = rows.length > 20 ? `\nMình đang hiển thị 20/${rows.length} học sinh đầu tiên.` : '';
  return `Ngày ${selectedDate()} có ${rows.length} học sinh trong danh sách báo vắng:\n${lines.join('\n')}${suffix}`;
}

function buildZaloReply() {
  const settings = state.settings || {};
  const absences = state.absences || [];
  const modes = {
    'dry-run': 'chạy thử',
    'personal-test': 'Zalo cá nhân chạy thử',
    'personal-real': 'Zalo cá nhân gửi thủ công',
    oa: 'Zalo OA'
  };
  const noticeCounts = chatStatusCounts(absences, 'noticeStatus', 'Chưa gửi');
  const enabled = settings.zaloMode === 'oa' && settings.zaloEnabled ? 'đã bật gửi thật' : 'chưa bật gửi thật';

  return [
    `Zalo đang ở chế độ ${modes[settings.zaloMode] || settings.zaloMode || 'chạy thử'}, ${enabled}, ${formatDelay(settings.zaloDelayMinutes)}.`,
    `Hàng đang lọc: ${formatChatCounts(noticeCounts) || 'chưa có bản ghi Zalo'}.`,
    'Để gửi hàng loạt, mở tab Hàng xử lý và bấm Gửi Zalo hàng loạt.'
  ].join('\n');
}

function buildImportReply() {
  return [
    'Mở tab Nạp Excel, chọn file .xlsx hoặc .xls có lớp, họ tên học sinh và số điện thoại phụ huynh.',
    'Sau khi bấm Nạp và tách lớp, danh sách sẽ cập nhật ở tab Điểm danh vắng.'
  ].join('\n');
}

function buildHistoryReply() {
  return 'Lịch sử Zalo nằm ở tab Lịch sử Zalo, lịch sử cuộc gọi nằm ở tab Lịch sử gọi. Có thể lọc theo ngày hoặc từ khóa rồi xuất danh sách học sinh đi trễ nếu cần.';
}

function searchableStudentText(student) {
  return normalizeChatText([
    student.code,
    student.fullName,
    student.className,
    student.parentName,
    student.phone1,
    student.phone2,
    student.zaloUserId
  ].filter(Boolean).join(' '));
}

const STUDENT_QUERY_STOP_WORDS = new Set([
  'toi', 'muon', 'minh', 'giup', 'hay', 'cho', 'hoi', 'xem', 'tim', 'kiem',
  'hoc', 'sinh', 'lop', 'em', 'ban', 'bao', 'nhieu', 'thong', 'ke', 'hom',
  'nay', 'vang', 'zalo', 'sdt', 'so', 'dien', 'thoai', 'phu', 'huynh',
  'co', 'khong', 'trong', 'danh', 'sach', 'ten', 'ma', 'thong', 'tin',
  'la', 'ai', 'o', 'dang', 'can', 'biet', 'tra', 'kiemtra', 'thu',
  'xemgiup', 'chohoi', 'vui', 'long', 'neu', 'voi', 'cua'
]);

function studentQueryTokens(message) {
  return normalizeChatText(message)
    .split(/\s+/)
    .filter(token => token.length >= 2 && !STUDENT_QUERY_STOP_WORDS.has(token))
    .slice(0, 8);
}

function scoreStudentSearchMatch(student, tokens) {
  if (!tokens.length) return 0;

  const text = searchableStudentText(student);
  const nameText = normalizeChatText(student.fullName || '');
  const codeText = normalizeChatText(student.code || '');
  const phoneText = normalizeChatText(`${student.phone1 || ''} ${student.phone2 || ''}`);
  const compactText = text.replace(/\s+/g, '');
  const compactQuery = tokens.join('');
  const phrase = tokens.join(' ');
  let score = 0;
  let matched = 0;

  tokens.forEach(token => {
    if (!text.includes(token)) return;
    matched += 1;
    score += token.length >= 4 ? 5 : 3;
    if (nameText.includes(token)) score += 4;
    if (codeText.includes(token)) score += 3;
    if (phoneText.includes(token)) score += 3;
  });

  if (phrase.length >= 3 && nameText.includes(phrase)) score += 20;
  if (compactQuery.length >= 4 && compactText.includes(compactQuery)) score += 12;

  const requiredMatches = tokens.length <= 2 ? tokens.length : Math.max(2, Math.ceil(tokens.length * 0.6));
  if (matched < requiredMatches && !(phrase.length >= 3 && nameText.includes(phrase))) return 0;
  return score + matched;
}

function buildStudentSearchReply(message) {
  const tokens = studentQueryTokens(message);
  if (!tokens.length) {
    return 'Nhập thêm tên, mã học sinh, lớp hoặc số điện thoại để mình tìm chính xác hơn.';
  }

  const rows = (state.students || [])
    .map(student => ({ student, score: scoreStudentSearchMatch(student, tokens) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || `${a.student.className || ''} ${a.student.fullName || ''}`.localeCompare(`${b.student.className || ''} ${b.student.fullName || ''}`, 'vi'))
    .slice(0, 5)
    .map(row => row.student);

  if (!rows.length) {
    return `Chưa tìm thấy học sinh khớp với "${message.trim()}". Thử nhập tên ngắn hơn, mã học sinh hoặc số điện thoại phụ huynh.`;
  }

  const lines = rows.map(student => {
    const absence = absenceForStudent(student.id);
    const status = absence ? normalizeAbsenceStatus(absence.absenceStatus) : (student.status || 'Đang học');
    const phone = student.phone1 || student.phone2 || 'chưa có SĐT';
    return `- ${student.fullName} · ${student.className} · ${phone} · ${status}`;
  });

  const suffix = rows.length === 5 ? '\nMình đang hiển thị 5 kết quả đầu tiên.' : '';
  return `Tìm thấy ${rows.length} học sinh:\n${lines.join('\n')}${suffix}`;
}

function buildChatReply(message) {
  const text = normalizeChatText(message);
  const className = detectClassFromChat(message);
  const wantsStudent = chatHasAny(text, ['tim', 'kiem', 'hoc sinh', 'hs ', 'sdt', 'so dien thoai', 'phu huynh']);
  const wantsTodayAbsentList = text.includes('hoc sinh') && text.includes('vang') && (text.includes('hom nay') || text.includes('danh sach') || text.includes('nhung'));

  if (className && chatHasAny(text, ['lop', 'vang', 'hoc sinh', 'thong ke', 'bao nhieu'])) {
    return buildClassReply(className);
  }

  if (wantsTodayAbsentList) return buildTodayAbsentStudentsReply();
  if (chatHasAny(text, ['zalo', 'tin nhan', 'gui'])) return buildZaloReply();
  if (chatHasAny(text, ['excel', 'import', 'nap', 'tai file', 'danh ba'])) return buildImportReply();
  if (chatHasAny(text, ['lich su', 'log', 'cuoc goi', 'da gui'])) return buildHistoryReply();
  if (chatHasAny(text, ['thong ke', 'bao nhieu', 'hom nay', 'vang', 'di tre', 'tong'])) return buildSummaryReply();
  if (wantsStudent || text.length >= 3) return buildStudentSearchReply(message);

  return 'Mình có thể xem nhanh thống kê vắng, tình trạng Zalo, tìm học sinh/lớp, nạp Excel và lịch sử. Ví dụ: "hôm nay vắng bao nhiêu" hoặc "tìm 0901111222".';
}

function chatShouldUseAi() {
  const settings = state.settings || {};
  return Boolean(settings.aiConfigured && settings.aiProvider && settings.aiProvider !== 'internal');
}

function buildChatRequestContext() {
  return {
    date: selectedDate(),
    className: selectedClass(),
    absenceStatus: $('#filterAbsenceStatus')?.value || 'ALL',
    status: $('#filterStatus')?.value || 'ALL',
    noticeStatus: $('#filterNoticeStatus')?.value || 'ALL',
    q: $('#filterKeyword')?.value.trim() || '',
    activeTab: activeTabId()
  };
}

function normalizeAccessTokenInput(value) {
  return String(value || '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^["']|["']$/g, '')
    .replace(/\s+/g, '');
}

function buildSettingsPayload() {
  const mode = $('#zaloMode').value;
  return {
    schoolName: $('#schoolName').value,
    zaloMode: mode,
    zaloEnabled: mode === 'oa' && $('#zaloEnabled').checked,
    zaloDelayMinutes: $('#zaloDelayMinutes').value,
    zaloEndpoint: $('#zaloEndpoint').value,
    zaloAccessToken: $('#zaloAccessToken').value,
    personalZaloName: $('#personalZaloName').value,
    personalZaloPhone: $('#personalZaloPhone').value,

    zaloCycleSize: $('#zaloCycleSize').value,
    zaloCycleDelayMinutes: $('#zaloCycleDelayMinutes').value,
    aiProvider: selectedAiProvider(),
    openaiModel: $('#openaiModel') ? $('#openaiModel').value : '',
    openaiApiKey: $('#openaiApiKey') ? normalizeAccessTokenInput($('#openaiApiKey').value) : '',
    geminiModel: $('#geminiModel') ? $('#geminiModel').value : '',
    geminiApiKey: $('#geminiApiKey') ? normalizeAccessTokenInput($('#geminiApiKey').value) : '',
    cozeEnabled: selectedAiProvider() === 'coze',
    cozeBaseUrl: $('#cozeBaseUrl') ? $('#cozeBaseUrl').value : '',
    cozeBotId: $('#cozeBotId') ? $('#cozeBotId').value : '',
    cozeAccessToken: $('#cozeAccessToken') ? normalizeAccessTokenInput($('#cozeAccessToken').value) : '',
    cozeUserId: $('#cozeUserId') ? $('#cozeUserId').value : '',
    messageTemplate: $('#messageTemplate').value,
    tuitionTemplate: $('#tuitionTemplate')?.value || '',
    periodicTemplate: $('#periodicTemplate')?.value || '',
    periodicImageBase64: $('#periodicImageBase64')?.value || ''
  };
}

async function saveSettingsFromUi() {
  const settings = await api('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(buildSettingsPayload())
  });
  state.settings = settings;
  if ($('#zaloAccessToken')) $('#zaloAccessToken').value = '';
  if ($('#openaiApiKey')) $('#openaiApiKey').value = '';
  if ($('#geminiApiKey')) $('#geminiApiKey').value = '';
  if ($('#cozeAccessToken')) $('#cozeAccessToken').value = '';
  renderSettings();
  toast('Đã lưu cấu hình.');
  return settings;
}

async function askAiChat(prompt) {
  const result = await api('/api/ai-chat', {
    method: 'POST',
    body: JSON.stringify({
      message: prompt,
      conversationId: state.aiConversationId,
      filters: buildChatRequestContext()
    })
  });

  if (result.conversationId) state.aiConversationId = result.conversationId;
  return result.answer || 'AI chưa trả nội dung.';
}

async function previewAiAction(prompt) {
  return api('/api/ai-actions/preview', {
    method: 'POST',
    body: JSON.stringify({
      message: prompt,
      filters: buildChatRequestContext()
    })
  });
}

async function confirmAiAction(button, actionId, card) {
  const buttons = Array.from(card?.querySelectorAll('button') || []);
  buttons.forEach(item => {
    item.disabled = true;
  });
  const originalText = button.textContent;
  button.textContent = 'Đang gửi...';

  try {
    const response = await api('/api/ai-actions/confirm', {
      method: 'POST',
      body: JSON.stringify({ actionId })
    });
    const result = response.result || {};
    card.dataset.done = 'true';
    const meta = card.querySelector('span');
    if (meta) meta.textContent = 'Đã xác nhận và app đã xử lý lệnh gửi.';
    
    const manualLogs = (result.logs || []).filter(log => log.status === 'Chờ gửi thủ công');
    if (manualLogs.length > 0) {
      addChatMessage('bot', `Hệ thống đang tự động gửi ${manualLogs.length} tin qua ZaloHelper. Vui lòng không chạm chuột/bàn phím...`);
      for (const log of manualLogs) {
        const payload = log.responsePayload || {};
        if (payload.link) {
          const ok = await openZaloAndPasteMessage(payload.message || log.message, payload.link);
          if (ok === 'STRANGER') {
            try {
              await api(`/api/notification-logs/${log.id}/mark-unfriended`, { method: 'POST' });
              log.status = 'Chưa kết bạn - Cần gọi';
              await Promise.all([loadNotices(), loadCallHistory()]);
            } catch (err) {
              console.error('Failed to mark unfriended:', err);
            }
          } else if (ok && log.absenceId) {
            try {
              await api(`/api/absences/${log.absenceId}/zalo/manual-sent`, { method: 'POST', body: '{}' });
              log.status = 'Đã gửi';
            } catch (err) {
              console.error('Failed to update status:', err);
            }
          } else if (!ok && log.absenceId) {
            try {
              await api(`/api/absences/${log.absenceId}/zalo/manual-error`, { method: 'POST', body: '{}' });
              log.status = 'Lỗi gửi';
            } catch (err) {
              console.error('Failed to update error status:', err);
            }
          }
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      addChatMessage('bot', 'Đã hoàn tất gửi tự động qua ZaloHelper.');
    }

    addChatMessage('bot', `Đã thực hiện lệnh gửi Zalo.\n${bulkZaloMessage(result)}`);
    renderManualSendPanel(result.logs || []);
    renderManualSendChatCards(result.logs || []);
    await loadAbsences();
  } catch (error) {
    buttons.forEach(item => {
      item.disabled = false;
    });
    button.textContent = originalText;
    addChatMessage('bot', `Chưa gửi được theo lệnh AI: ${error.message}`);
  }
}

async function testAiAssistant(button) {
  const note = $('#aiModeNote');
  const provider = selectedAiProvider();
  const label = aiProviderLabel(provider);
  if (provider === 'internal') {
    const message = 'Trợ lý nội bộ đang hoạt động. Không cần kiểm tra API key ngoài.';
    if (note) note.textContent = message;
    toast(message);
    return;
  }
  const token = normalizeAccessTokenInput($('#cozeAccessToken').value);
  if (provider === 'coze' && token && !token.startsWith('pat_')) {
    const message = 'Token Coze phải là Personal Access Token bắt đầu bằng pat_. Không dùng App ID, Client Secret hoặc chữ Bearer.';
    if (note) note.textContent = message;
    toast(message);
    return;
  }

  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = 'Đang kiểm tra...';
  if (note) note.textContent = `Đang gửi thử một câu hỏi tới ${label}...`;

  try {
    const result = await api('/api/ai-chat/test', {
      method: 'POST',
      body: JSON.stringify({
        message: `Hãy trả lời ngắn gọn: ${label} đã kết nối thành công với app báo vắng.`,
        aiProvider: provider,
        openaiModel: $('#openaiModel') ? $('#openaiModel').value : '',
        openaiApiKey: $('#openaiApiKey') ? normalizeAccessTokenInput($('#openaiApiKey').value) : '',
        geminiModel: $('#geminiModel') ? $('#geminiModel').value : '',
        geminiApiKey: $('#geminiApiKey') ? normalizeAccessTokenInput($('#geminiApiKey').value) : '',
        cozeBaseUrl: $('#cozeBaseUrl') ? $('#cozeBaseUrl').value : '',
        cozeBotId: $('#cozeBotId') ? $('#cozeBotId').value : '',
        cozeAccessToken: token,
        cozeUserId: $('#cozeUserId') ? $('#cozeUserId').value : ''
      })
    });
    if (note) note.textContent = `Kết nối ${label} thành công: ${result.answer || 'AI đã phản hồi.'}`;
    toast(`${label} đã kết nối thành công.`);
  } catch (error) {
    if (note) note.textContent = error.message;
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function sendChatPrompt(message) {
  const prompt = String(message || '').trim();
  if (!prompt) return;
  addChatMessage('user', prompt);

  try {
    const preview = await previewAiAction(prompt);
    if (preview.pendingAction || preview.answer) {
      const actionBubble = addChatMessage('bot', preview.answer || 'Mình đã chuẩn bị một hành động chờ xác nhận.');
      if (preview.pendingAction) addChatActionCard(actionBubble, preview.pendingAction);
      return;
    }
  } catch (error) {
    console.warn('Không kiểm tra được AI action:', error);
  }

  const bubble = addChatMessage('bot', chatShouldUseAi() ? `Đang hỏi ${aiProviderLabel(state.settings.aiProvider)}...` : buildChatReply(prompt));

  if (!chatShouldUseAi()) return;

  try {
    bubble.textContent = await askAiChat(prompt);
  } catch (error) {
    bubble.textContent = `${error.message}\nMình tạm trả lời bằng trợ lý nội bộ:\n${buildChatReply(prompt)}`;
  }
}

function setChatboxOpen(isOpen) {
  const chatbox = $('#chatbox');
  const toggle = $('#chatboxToggle');
  const input = $('#chatboxInput');
  if (!chatbox || !toggle) return;

  chatbox.dataset.open = String(isOpen);
  toggle.setAttribute('aria-expanded', String(isOpen));
  toggle.setAttribute('aria-label', isOpen ? 'Đóng trợ lý chat' : 'Mở trợ lý chat');
  if (isOpen) setTimeout(() => input?.focus(), 60);
}

function initChatbox() {
  const chatbox = $('#chatbox');
  const form = $('#chatboxForm');
  const input = $('#chatboxInput');
  if (!chatbox || !form || !input) return;

  $('#chatboxToggle')?.addEventListener('click', () => {
    setChatboxOpen(chatbox.dataset.open !== 'true');
  });
  $('#chatboxClose')?.addEventListener('click', () => setChatboxOpen(false));

  $$('.chatbox-suggestions button').forEach(button => {
    button.addEventListener('click', () => {
      setChatboxOpen(true);
      sendChatPrompt(button.dataset.chatPrompt || button.textContent);
    });
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const prompt = input.value;
    input.value = '';
    sendChatPrompt(prompt);
  });

  addChatMessage('bot', 'Chào thầy/cô, mình đã sẵn sàng. Có thể hỏi nhanh về báo vắng, Zalo, học sinh hoặc lớp.');
  updateChatboxStatus();
}

function initEvents() {
  $$('.tab').forEach(button => {
    button.addEventListener('click', async () => activateTab(button.dataset.tab));
  });

  $$('.shortcut-tab').forEach(button => {
    button.addEventListener('click', async () => activateTab(button.dataset.tab, button));
  });

  $$('.side-link[data-tab]').forEach(button => {
    button.addEventListener('click', async () => activateTab(button.dataset.tab));
  });

  $('#refreshBtn').addEventListener('click', event => refreshCurrentView(event.currentTarget));
  $('#applyFilterBtn').addEventListener('click', loadAbsences);
  $('#bulkSendTuitionBtn')?.addEventListener('click', () => {
    setChatboxOpen(true);
    sendChatPrompt('Gửi nhắc trễ học phí');
  });
  $('#bulkSendZaloBtn')?.addEventListener('click', async event => {
    try {
      await sendBulkZalo(event.currentTarget);
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#manualSendPanel')?.addEventListener('click', async event => {
    const card = event.target.closest('.manual-send-card');
    if (!card) return;

    if (event.target.classList.contains('open-manual-zalo')) {
      event.preventDefault();
      const text = card.querySelector('textarea')?.value || '';
      const link = event.target.getAttribute('href') || '';
      await openZaloAndPasteMessage(text, link);
    }

    if (event.target.classList.contains('copy-manual-message')) {
      const text = card.querySelector('textarea')?.value || '';
      await navigator.clipboard.writeText(text);
      toast('Đã copy nội dung tin nhắn.');
    }

    if (event.target.classList.contains('mark-manual-sent')) {
      await api(`/api/absences/${card.dataset.absenceId}/zalo/manual-sent`, { method: 'POST', body: '{}' });
      toast('Đã đánh dấu gửi qua Zalo cá nhân.');
      card.remove();
      if (!$('#manualSendPanel .manual-send-card')) $('#manualSendPanel').hidden = true;
      await loadAbsences();
    }
  });

  $('#absenceRows')?.addEventListener('click', async event => {
    const btn = event.target.closest('.retry-zalo-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';
    try {
      await api(`/api/absences/${id}/zalo`, { method: 'POST', body: '{}' });
      toast('Đã đưa vào tiến trình gửi Zalo.');
    } catch (err) {
      console.error(err);
      toast('Lỗi khi gửi lại Zalo: ' + err.message);
    }
    await loadAbsences();
  });

  $('#noticeRows')?.addEventListener('click', async event => {
    const copyBtn = event.target.closest('.copy-log-msg-btn');
    if (copyBtn) {
      const msg = copyBtn.dataset.msg;
      if (msg) {
        try {
          await navigator.clipboard.writeText(msg);
          toast('Đã copy nội dung tin nhắn.');
        } catch (err) {
          console.error(err);
          toast('Lỗi khi copy: ' + err.message);
        }
      }
      return;
    }

    const retryBtn = event.target.closest('.retry-zalo-btn');
    if (retryBtn) {
      const id = retryBtn.dataset.id;
      const logId = retryBtn.dataset.logid;
      const msg = retryBtn.dataset.msg;
      const link = retryBtn.dataset.link;

      retryBtn.disabled = true;
      retryBtn.textContent = '...';

      if (msg) {
        try {
          const ok = await openZaloAndPasteMessage(msg, link);
          if (ok === 'STRANGER') {
            await api(`/api/notification-logs/${logId}/mark-unfriended`, { method: 'POST' });
            toast('Đã đánh dấu: Chưa kết bạn.');
          } else if (ok) {
            await api(`/api/absences/${id}/zalo/manual-sent`, { method: 'POST', body: '{}' });
            toast('Đã đánh dấu gửi thành công qua Zalo cá nhân.');
          }
        } catch (err) {
          console.error(err);
          toast('Lỗi khi thao tác Zalo: ' + err.message);
        }
        await loadNotices();
        await loadAbsences();
      } else {
        try {
          await api(`/api/absences/${id}/zalo`, { method: 'POST', body: '{}' });
          toast('Đã đưa vào tiến trình gửi Zalo.');
        } catch (err) {
          console.error(err);
          toast('Lỗi khi gửi lại Zalo: ' + err.message);
        }
        await loadNotices();
        await loadAbsences();
      }
      return;
    }
  });
  $('#filterClass').addEventListener('change', loadAbsences);
  $('#filterAbsenceStatus')?.addEventListener('change', loadAbsences);
  $('#filterStatus')?.addEventListener('change', loadAbsences);
  $('#filterNoticeStatus')?.addEventListener('change', loadAbsences);
  $('#filterDate').addEventListener('change', async () => {
    await loadAbsences();
  });
  $('#filterKeyword').addEventListener('keydown', event => {
    if (event.key === 'Enter') loadAbsences();
  });

  $('#messageTemplate')?.addEventListener('input', renderMessagePreview);
  $('#tuitionTemplate')?.addEventListener('input', renderMessagePreview);
  $('#periodicTemplate')?.addEventListener('input', renderMessagePreview);
  $('#previewTypeSelect')?.addEventListener('change', renderMessagePreview);
  $('#schoolName')?.addEventListener('input', renderMessagePreview);

  $('#sessionDropdown')?.addEventListener('change', () => {
    renderClassDropdown();
    renderRoster();
  });

  $('#dayDropdown')?.addEventListener('change', () => {
    renderClassDropdown();
    renderRoster();
  });

  $('#classDropdown')?.addEventListener('change', async event => {
    $('#filterClass').value = event.target.value;
    await loadAttendanceAbsences();
  });

  $('#studentRoster').addEventListener('change', async event => {
    const select = event.target.closest('.roster-status-select');
    if (!select) return;
    select.disabled = true;
    try {
      await updateRosterStatus(select);
    } catch (error) {
      toast(error.message, 'error');
      await loadBootstrap();
    }
  });

  $('#importForm').addEventListener('submit', async event => {
    event.preventDefault();
    const files = $('#contactsFile').files;
    if (!files || files.length === 0) return toast('Chưa chọn file', 'error');
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('contacts', files[i]);
    }
    $('#importResult').textContent = 'Đang nạp danh bạ...';
    const result = await apiForm('/api/import/students', formData);
    $('#importResult').textContent = JSON.stringify({
      fileName: result.fileName,
      parsed: result.parsed,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
      samples: result.samples.map(item => ({
        action: item.action,
        code: item.student.code,
        name: item.student.fullName,
        className: item.student.className,
        phone1: item.student.phone1
      }))
    }, null, 2);
    toast(`Đã nạp danh bạ: thêm ${result.created}, cập nhật ${result.updated}.`);
    await loadBootstrap();
    document.querySelector('[data-tab="absenceTab"]').click();
  });

  $('#clearContactsBtn')?.addEventListener('click', () => {
    if ($('#contactsFile')) $('#contactsFile').value = '';
    if ($('#importResult')) $('#importResult').textContent = '';
  });

  $('#settingsForm').addEventListener('submit', async event => {
    event.preventDefault();
    await saveSettingsFromUi();
  });

  $('#cozeSettingsForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    await saveSettingsFromUi();
  });

  $('#zaloMode')?.addEventListener('change', renderZaloModeFields);
  $('#copyCozePromptBtn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(COZE_BOT_PROMPT);
      toast('Đã copy prompt bot Coze.');
    } catch (error) {
      toast('Không copy được tự động. Hãy mở README để lấy prompt Coze.');
    }
  });
  $('#testAiBtn')?.addEventListener('click', async event => {
    await testAiAssistant(event.currentTarget);
  });
  [
    '#aiProvider',
    '#openaiModel',
    '#openaiApiKey',
    '#geminiModel',
    '#geminiApiKey',
    '#cozeBaseUrl',
    '#cozeBotId',
    '#cozeAccessToken',
    '#cozeUserId'
  ].forEach(selector => {
    $(selector)?.addEventListener('input', renderAiStatus);
    $(selector)?.addEventListener('change', renderAiStatus);
  });

  $('#historyFilterBtn').addEventListener('click', async () => {
    await Promise.all([loadHistory(), loadNotices(), loadQuitStudents()]);
  });
  $('#clearCallHistoryBtn')?.addEventListener('click', async () => {
    try {
      await clearCallHistory();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
  $('#exportLateHistoryBtn')?.addEventListener('click', () => {
    exportLateAbsences({
      date: $('#historyDate')?.value || '',
      q: $('#historyKeyword')?.value.trim() || ''
    });
  });
  $('#exportFailedZaloHistoryBtn')?.addEventListener('click', () => {
    exportFailedZalo({
      date: $('#historyDate')?.value || '',
      q: $('#historyKeyword')?.value.trim() || ''
    });
  });
  $('#exportCallListBtn')?.addEventListener('click', () => {
    exportCallList({
      date: $('#historyDate')?.value || '',
      q: $('#historyKeyword')?.value.trim() || ''
    });
  });
  $('#historyKeyword').addEventListener('keydown', async event => {
    if (event.key === 'Enter') {
      await Promise.all([loadHistory(), loadNotices()]);
    }
  });

  $('#clearNoticeHistoryBtn')?.addEventListener('click', async () => {
    try {
      await clearNoticeHistory();
    } catch (error) {
      toast(error.message, 'error');
    }
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  initEvents();
  initChatbox();
  try {
    await loadBootstrap();
    setInterval(() => {
      if (activeTabId() === 'queueTab') {
        loadAbsences().catch(error => toast(error.message, 'error'));
      }
    }, 30000);
  } catch (error) {
    toast(error.message, 'error');
  }
});

window.addEventListener('unhandledrejection', event => {
  toast(event.reason?.message || 'Có lỗi xảy ra.');
});



async function loadBranches() {
  try {
    const branches = await api('/api/branches');
    const branchSelector = document.getElementById('branchSelector');
    if (!branchSelector) return;
    
    branchSelector.innerHTML = branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
    
    const active = getActiveBranch();
    if (branches.find(b => b.id === active)) {
      branchSelector.value = active;
    } else {
      branchSelector.value = 'main';
      localStorage.setItem('activeBranch', 'main');
    }
    
    const delBtn = document.getElementById('delBranchBtn');
    if (delBtn) {
      delBtn.disabled = branchSelector.value === 'main';
      delBtn.style.opacity = branchSelector.value === 'main' ? '0.5' : '1';
      delBtn.style.cursor = branchSelector.value === 'main' ? 'not-allowed' : 'pointer';
    }
  } catch (err) {
    console.error('Không tải được danh sách chi nhánh', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadBranches();
  
  const branchSelector = document.getElementById('branchSelector');
  if (branchSelector) {
    branchSelector.addEventListener('change', (e) => {
      localStorage.setItem('activeBranch', e.target.value);
      location.reload(); // Reload the page to fetch new branch data
    });
  }
  
  const newBranchBtn = document.getElementById('newBranchBtn');
  if (newBranchBtn) {
    newBranchBtn.addEventListener('click', async () => {
      const branchName = prompt('Nhập tên chi nhánh mới (có thể viết tiếng Việt có dấu):');
      if (!branchName) return;
      try {
        const res = await api('/api/branches', { method: 'POST', body: JSON.stringify({ name: branchName }) });
        showToast('Đã tạo chi nhánh mới thành công!');
        localStorage.setItem('activeBranch', res.branchId);
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }
  
  const delBranchBtn = document.getElementById('delBranchBtn');
  if (delBranchBtn) {
    delBranchBtn.addEventListener('click', async () => {
      const branchId = getActiveBranch();
      if (branchId === 'main') return;
      if (!confirm('Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu của chi nhánh này không? Hành động này không thể hoàn tác!')) return;
      try {
        await api('/api/branches/' + branchId, { method: 'DELETE' });
        showToast('Đã xóa chi nhánh thành công!');
        localStorage.setItem('activeBranch', 'main');
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const renameBranchBtn = document.getElementById('renameBranchBtn');
  if (renameBranchBtn) {
    renameBranchBtn.addEventListener('click', async () => {
      const branchId = getActiveBranch();
      const currentName = branchSelector.options[branchSelector.selectedIndex]?.text || '';
      const newName = prompt('Nhập tên mới cho chi nhánh này:', currentName);
      if (!newName || newName === currentName) return;
      try {
        await api('/api/branches/' + branchId, { method: 'PUT', body: JSON.stringify({ name: newName }) });
        showToast('Đã đổi tên chi nhánh thành công!');
        location.reload();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

});



// ==================== REAL-TIME & AUTH UI ====================
document.addEventListener('DOMContentLoaded', () => {
  const userStr = localStorage.getItem('user');
  if (userStr) {
    const user = JSON.parse(userStr);
    const headerDiv = document.querySelector('header .header-controls');
    if (headerDiv) {
      headerDiv.innerHTML += `<div style="margin-left: 15px; display: inline-block;">
        <span style="font-weight: bold; margin-right: 10px;">👤 ${user.username}</span>
        <button id="logoutBtn" class="btn" style="padding: 6px 12px; background: #e2e8f0; color: #475569; border:none;"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>`;
      
      document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
      });
      
      // If not admin, hide branch controls
      if (user.role !== 'admin') {
        const newB = document.getElementById('newBranchBtn');
        const delB = document.getElementById('delBranchBtn');
        const renB = document.getElementById('renameBranchBtn');
        if (newB) newB.style.display = 'none';
        if (delB) delB.style.display = 'none';
        if (renB) renB.style.display = 'none';
        const branchSel = document.getElementById('branchSelector');
        if (branchSel && user.branchId !== 'all') {
          branchSel.disabled = true;
        }
      }
    }
  }

  // Socket.io integration
  if (typeof io !== 'undefined') {
        socket.on('data_updated', (data) => {
      const active = getActiveBranch();
      if (data.branchId === active || data.branchId === 'all') {
        showToast('🔄 Dữ liệu vừa được làm mới...', 'success');
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) refreshBtn.click();
      }
    });
  }

  // Inner Tabs Logic for History Tab
  document.addEventListener('click', (e) => {
    if (e.target.matches('.inner-tab')) {
      const parent = e.target.closest('.inner-tabs');
      if (!parent) return;
      
      // Update active tab button
      parent.querySelectorAll('.inner-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      
      // Show corresponding panel
      const targetPanelId = e.target.dataset.subtab;
      const tabContainer = e.target.closest('.tab-panel');
      tabContainer.querySelectorAll('.sub-panel').forEach(panel => {
        panel.style.display = panel.id === targetPanelId ? 'block' : 'none';
      });
    }
  });
});

// ==================== STAFF MANAGEMENT ====================
document.addEventListener("DOMContentLoaded", () => {
  const userStr = localStorage.getItem("user");
  if (!userStr) return;
  const user = JSON.parse(userStr);
  
  if (user.role === "admin") {
    // Show admin-only elements
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "");
    
    const staffTabBtn = document.querySelector('[data-tab="staffTab"]');
    const createStaffForm = document.getElementById("createStaffForm");
    const staffList = document.getElementById("staffList");
    const staffBranch = document.getElementById("staffBranch");
    
    if (staffTabBtn) {
      staffTabBtn.addEventListener("click", async () => {
        loadStaffList();
        const branches = await api("/api/branches");
        let options = "<option value='all'>Tất cả chi nhánh (Quản trị viên)</option>";
        branches.forEach(b => {
          if (b.id !== 'main') {
            options += `<option value="${b.id}">${b.name}</option>`;
          } else {
             options += `<option value="main">Cơ sở chính (Main)</option>`;
          }
        });
        staffBranch.innerHTML = options;
      });
    }
    
    if (createStaffForm) {
      createStaffForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const username = document.getElementById("staffUsername").value;
        const password = document.getElementById("staffPassword").value;
        const branchId = document.getElementById("staffBranch").value;
        const role = branchId === "all" ? "admin" : "staff";
        
        try {
          await api("/api/users", {
            method: "POST",
            body: JSON.stringify({ username, password, role, branchId })
          });
          toast("Tạo tài khoản thành công!");
          createStaffForm.reset();
          loadStaffList();
        } catch (err) {
          toast(err.message, "error");
        }
      });
    }
    
    async function loadStaffList() {
      if (!staffList) return;
      try {
        const users = await api("/api/users");
        const branches = await api("/api/branches");
        const branchMap = { "all": "Tất cả chi nhánh", "main": "Cơ sở chính" };
        branches.forEach(b => branchMap[b.id] = b.name);
        
        staffList.innerHTML = users.map(u => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border: 1px solid #e2e8f0; background: #fff; margin-bottom: 8px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
            <div style="display: flex; flex-direction: column;">
              <strong style="font-size: 1.1em; color: #1e293b;">👤 ${u.username} ${u.plainPassword ? `<span style=\"font-size: 0.85em; font-weight: normal; color: #64748b; margin-left: 8px;\">🔑 Mật khẩu: <b>${u.plainPassword}</b></span>` : ''}</strong>
              <span style="font-size: 0.9em; color: #64748b; margin-top: 4px;">
                ${u.role === 'admin' ? '<span style="background:#fee2e2;color:#b91c1c;padding:2px 6px;border-radius:4px;font-size:0.8em;font-weight:bold;">Admin</span>' : '<span style="background:#dbeafe;color:#1d4ed8;padding:2px 6px;border-radius:4px;font-size:0.8em;font-weight:bold;">Nhân viên</span>'}
                &nbsp;•&nbsp; Phụ trách: ${branchMap[u.branchId] || u.branchId}
              </span>
            </div>
            ${u.username !== 'admin' ? `<button class="btn danger" onclick="deleteStaff('${u.username}')" style="padding: 6px 10px;"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        `).join("");
      } catch (err) {
        console.error(err);
      }
    }
    
    window.deleteStaff = async function(username) {
      if (!confirm("Bạn có chắc chắn muốn xóa tài khoản " + username + " không?")) return;
      try {
        await api("/api/users/" + username, { method: "DELETE" });
        toast("Đã xóa tài khoản");
        loadStaffList();
      } catch (err) {
        toast(err.message, "error");
      }
    }
  } else {
    document.querySelectorAll(".admin-only").forEach(el => el.style.display = "none");
  }
});