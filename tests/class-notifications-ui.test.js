const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/class-notifications.js'), 'utf8');

function setup() {
  const fields = {}, requests = [], messages = [], extensionItems = [], refreshes = [];
  let initialize, boxes = [], branch = 'main', handler;
  const preview = { className: '8T3M+', type: 'Kiểm tra định kì', date: '2026-10-15', session: 'Tối', recipients: [
    { studentId: 's1', studentName: 'Nguyễn An <img>', phone: '0901234567', message: 'Lịch kiểm tra cho An <img>', selectable: true, reason: '' },
    { studentId: 's2', studentName: 'Trần Bình', phone: '0912345678', message: 'Lịch kiểm tra cho Bình', selectable: true, reason: '' },
    { studentId: 's3', studentName: 'Chưa có SĐT', phone: '', message: 'Lịch kiểm tra', selectable: false, reason: 'Chưa có SĐT' }
  ] };
  for (const id of ['openClassNotificationBtn', 'classNotificationForm', 'classNotificationClass', 'classNotificationType',
    'classNotificationDate', 'classNotificationReload', 'classNotificationPreviewStudent', 'classNotificationRecipients',
    'classNotificationSelectAll', 'classNotificationCancel', 'classNotificationDialog', 'classNotificationTemplates',
    'classNotificationFields', 'classNotificationCount', 'classNotificationSend', 'classNotificationError', 'classNotificationMessage']) {
    let html = '';
    fields[id] = { value: '', disabled: false, checked: false, textContent: '', hidden: false, listeners: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
      get innerHTML() { return html; }, set innerHTML(value) {
        html = value;
        if (id === 'classNotificationRecipients') boxes = [...value.matchAll(/<input\b[^>]+>/g)].map(match => ({
          dataset: { studentId: match[0].match(/data-student-id="([^"]*)"/)[1] },
          checked: /\schecked\b/.test(match[0]), disabled: /\sdisabled\b/.test(match[0])
        }));
      } };
  }
  const context = {
    state: { students: [{ id: 's1', fullName: 'An', className: '8T3M+', status: 'Đang học' },
      { id: 's2', fullName: 'Bình', className: '9VT4', status: 'Đang học' },
      { id: 'inactive', className: '7T3', status: 'Nghỉ học' }], settings: { zaloMode: 'dry-run' } },
    document: { addEventListener(type, callback) { if (type === 'DOMContentLoaded') initialize = callback; },
      querySelectorAll: selector => selector.endsWith(':checked') ? boxes.filter(box => box.checked) : boxes },
    $: selector => fields[selector.slice(1)],
    isActiveStudent: row => row.status !== 'Nghỉ học' && !row.removedFromClass,
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    queryString: params => new URLSearchParams(params).toString(),
    getActiveBranch: () => branch, selectedClass: () => '8T3M+', selectedDate: () => '2026-10-15',
    getClassScheduleInfo: () => ({ sessionName: 'Tối' }),
    api: async (url, options) => {
      requests.push({ url, options });
      if (handler) return handler(url, options);
      if (url.startsWith('/api/class-notifications/preview?')) return structuredClone(preview);
      return { total: 1, processed: 1, logs: [], summary: { dryRun: 1 } };
    },
    toast: (...args) => messages.push(args), bulkZaloMessage: result => `Processed ${result.processed}`,
    renderManualSendPanel() {}, loadBootstrap: async () => refreshes.push('bootstrap'),
    loadGeneralNotificationHistory: async () => refreshes.push('history'),
    activateTab: async tab => refreshes.push(tab),
    startZaloExtensionAuto: async items => { extensionItems.push(...items); return true; }
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  initialize();
  async function open() {
    context.openClassNotifications();
    fields.classNotificationType.value = preview.type;
    await context.loadClassNotificationPreview();
  }
  const submit = () => context.sendClassNotifications({ preventDefault() {} });
  return { context, fields, requests, messages, preview, extensionItems, refreshes, open, submit,
    boxes: () => boxes, branch: value => { branch = value; }, handler: value => { handler = value; } };
}

test('class dialog prefills the selected class, loads only after type selection and displays safe personalized previews', async () => {
  const app = setup();
  app.context.openClassNotifications();
  assert.equal(app.fields.classNotificationClass.value, '8T3M+');
  assert.equal(app.fields.classNotificationDate.value, '2026-10-15');
  assert.equal(app.requests.length, 0);
  assert.doesNotMatch(app.fields.classNotificationClass.innerHTML, /7T3/);
  app.fields.classNotificationType.value = app.preview.type;
  await app.context.loadClassNotificationPreview();
  assert.equal(app.boxes().length, 3);
  assert.equal(app.boxes()[2].disabled, true);
  assert.equal(app.fields.classNotificationSend.textContent, 'Gửi hàng loạt (2)');
  assert.doesNotMatch(app.fields.classNotificationRecipients.innerHTML, /<img>/);
  assert.equal(app.fields.classNotificationMessage.textContent, 'Lịch kiểm tra cho An <img>');
  app.fields.classNotificationPreviewStudent.value = 's2';
  app.context.renderClassNotificationMessage();
  assert.equal(app.fields.classNotificationMessage.textContent, 'Lịch kiểm tra cho Bình');
});

test('select all and individual choices count only eligible students', async () => {
  const app = setup();
  await app.open();
  app.boxes()[1].checked = false;
  app.context.updateClassNotificationCount();
  assert.equal(app.fields.classNotificationSelectAll.indeterminate, true);
  app.fields.classNotificationSelectAll.listeners.change({ target: { checked: false } });
  assert.equal(app.fields.classNotificationSend.disabled, true);
  app.fields.classNotificationSelectAll.listeners.change({ target: { checked: true } });
  assert.equal(app.boxes()[2].checked, false);
  assert.equal(app.fields.classNotificationSend.textContent, 'Gửi hàng loạt (2)');
});

test('preview follows a remaining selected recipient when the previous one is unchecked', async () => {
  const app = setup();
  await app.open();
  app.boxes()[0].checked = false;
  app.fields.classNotificationRecipients.listeners.change();
  assert.equal(app.fields.classNotificationPreviewStudent.value, 's2');
  assert.equal(app.fields.classNotificationMessage.textContent, 'Lịch kiểm tra cho Bình');
});

test('class send posts only checked IDs with their reviewed messages and phones and never updates attendance', async () => {
  const app = setup();
  await app.open();
  app.boxes()[0].checked = false;
  await app.submit();
  const post = app.requests.find(row => row.options?.method === 'POST');
  assert.equal(post.url, '/api/class-notifications');
  const body = JSON.parse(post.options.body);
  assert.deepEqual(body.recipients, [{ studentId: 's2', message: 'Lịch kiểm tra cho Bình', phone: '0912345678' }]);
  assert.equal(body.className, '8T3M+');
  assert.equal(body.type, 'Kiểm tra định kì');
  assert.equal(app.fields.classNotificationDialog.open, false);
  assert.deepEqual(app.refreshes, ['bootstrap', 'history']);
  assert.equal(app.requests.filter(row => row.options?.method === 'POST').length, 1);
});

test('pending personal Zalo notices use exact notification log IDs in the existing bulk extension flow', async () => {
  const app = setup();
  await app.open();
  app.context.state.settings.zaloMode = 'personal-real';
  const log = { id: 'log-1', absenceId: 'notice-1', studentName: 'An', className: '8T3M+', message: 'Nội dung', status: 'Chờ gửi thủ công', responsePayload: { phone: '0901234567' } };
  app.handler(async url => url.startsWith('/api/notification-logs?') ? [{ ...log, status: 'Đã gửi' }]
    : { total: 1, processed: 1, logs: [log], summary: { manual: 1 } });
  await app.submit();
  assert.equal(app.extensionItems[0].id, 'log-1');
  assert.equal(app.extensionItems[0].absenceId, 'notice-1');
  assert.equal(app.extensionItems[0].phone, '0901234567');
  assert.ok(app.requests.some(row => row.url.includes('notificationType=general')));
});

test('repeat submit is ignored while sending and Escape cannot close an active send', async () => {
  const app = setup();
  await app.open();
  let finish;
  app.handler(() => new Promise(resolve => { finish = resolve; }));
  const first = app.submit();
  await app.submit();
  let prevented = false;
  app.fields.classNotificationDialog.listeners.cancel({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(app.requests.filter(row => row.options?.method === 'POST').length, 1);
  assert.equal(app.fields.classNotificationFields.disabled, true);
  finish({ total: 1, processed: 1, logs: [], summary: {} });
  await first;
  assert.equal(app.fields.classNotificationFields.disabled, false);
});

test('closing or changing branch ignores a late preview and never sends anything', async () => {
  for (const action of ['close', 'branch']) {
    const app = setup();
    app.context.openClassNotifications();
    app.fields.classNotificationType.value = app.preview.type;
    let finish;
    app.handler(() => new Promise(resolve => { finish = resolve; }));
    const loading = app.context.loadClassNotificationPreview();
    if (action === 'close') app.fields.classNotificationDialog.close();
    else app.branch('other');
    finish(app.preview);
    await loading;
    assert.equal(app.fields.classNotificationRecipients.innerHTML, '');
    assert.equal(app.fields.classNotificationSend.disabled, true);
    assert.equal(app.requests.filter(row => row.options?.method === 'POST').length, 0);
  }
});

test('template errors keep sending disabled and show a recoverable inline message', async () => {
  const app = setup();
  app.handler(async () => { throw new Error('Vui lòng điền lịch kiểm tra trong mẫu Zalo.'); });
  await app.open();
  assert.match(app.fields.classNotificationError.textContent, /mẫu Zalo/);
  assert.equal(app.fields.classNotificationSend.disabled, true);
  assert.equal(app.fields.classNotificationDialog.open, true);
});
