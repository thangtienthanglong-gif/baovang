const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, `globalThis.testApi = { openConversation, findSearchResult, nameSearchCandidates, phoneSearchUnavailable };
globalThis.configureSearch = hooks => {
  findSearchBox = hooks.search;
  findComposer = hooks.composer;
  searchResultCandidates = hooks.results;
  showZaloStatus = hooks.status || (() => {});
};
})();`);

function candidate(text, attributes = {}) {
  return {
    innerText: text, textContent: text,
    matches: selector => selector === '[role="option"]',
    contains: () => false, focus() {}, dispatchEvent() {}, offsetWidth: 1, offsetHeight: 1,
    getBoundingClientRect: () => ({ left: 100, right: 420, top: 280, bottom: 340, width: 320, height: 60 }),
    getClientRects: () => [{}], getAttribute: key => attributes[key] || null,
    click() { this.clicked = true; }
  };
}

function searchHarness({ editable = false, remount = false, pasteAllowed = true,
  pastedPhone, resetAllowed = true, clipboardAllowed = true,
  phoneUnavailable = false, phoneResults, nameResults = [], pastedName, namePasteAllowed = true,
  staleHeader = false, openedHeader, sections = [], searchBounds = false,
  genericHeader = false, headerAvatar = true, headerLeft = 500 } = {}) {
  const commands = [];
  const clipboardWrites = [];
  const queries = [];
  const result = candidate('Tên phụ huynh');
  const unavailable = candidate('Số điện thoại chưa đăng ký tài khoản hoặc không cho phép tìm kiếm.');
  const composer = { getBoundingClientRect: () => ({ left: 480 }) };
  let activeName = 'Cuộc trò chuyện cũ';
  for (const contact of nameResults) {
    const click = contact.click.bind(contact);
    contact.click = () => { click(); if (!staleHeader) activeName = openedHeader ?? contact.innerText.split(/\r?\n/)[0]; };
  }
  const header = candidate('');
  Object.defineProperty(header, 'innerText', { get: () => activeName });
  header.getBoundingClientRect = () => ({ left: headerLeft, right: headerLeft + 300, top: 60, bottom: 92, width: 300, height: 32 });
  if (genericHeader) {
    header.parentElement = {
      getBoundingClientRect: () => ({ left: 440, right: 820, top: 45, bottom: 112, width: 380, height: 67 }),
      querySelector: () => headerAvatar ? {} : null,
      parentElement: null
    };
  }
  let results = [];
  let clipboard;
  let current;
  let clock = 0;
  const document = {
    querySelectorAll: selector => {
      if (/header|Header|title-container|conversation-title|conversation-name|chat-info/.test(selector)) return genericHeader ? [] : [header];
      if (selector === 'div, span, h1, h2, h3, strong, [title]') return genericHeader ? [header] : [];
      const unavailableRows = phoneUnavailable && /^\d+$/.test(current.draft) ? [unavailable] : [];
      return [...unavailableRows, ...sections];
    },
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command) {
      commands.push(command);
      if (command === 'delete' && resetAllowed) {
        current.draft = '';
        queries.push('');
        results = [];
        if (remount) current = field('');
      }
      if (command === 'paste') {
        const byPhone = /^\d+$/.test(clipboard);
        if (!pasteAllowed || (!byPhone && !namePasteAllowed)) return false;
        current.draft = (byPhone ? pastedPhone : pastedName) ?? clipboard;
        queries.push(current.draft);
        results = byPhone ? (phoneResults ?? (phoneUnavailable ? [unavailable] : [result])) : nameResults;
      }
      return true;
    }
  };
  function field(draft) {
    return {
      draft, isContentEditable: editable,
      get value() { return this.draft; },
      set value(_value) { throw new Error('Must use native editing, not a DOM setter'); },
      get innerText() { return this.draft; },
      get textContent() { return this.draft; },
      focus() { document.activeElement = this; },
      select() {},
      getAttribute: () => editable ? 'true' : null,
      ...(searchBounds ? { getBoundingClientRect: () => ({ left: 70, right: 390, top: 30, bottom: 66, width: 320, height: 36 }) } : {})
    };
  }
  current = field('0906905915');
  const original = current;
  const context = {
    location: { hostname: 'chat.zalo.me' }, document,
    window: { innerHeight: 900, getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    navigator: { clipboard: { async writeText(value) {
      if (!clipboardAllowed) throw new Error('Clipboard denied');
      clipboard = value;
      clipboardWrites.push(value);
    } } },
    setTimeout(callback) { callback(); }, MouseEvent: function () {},
    Date: class extends Date { static now() { clock += 150; return clock; } },
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  context.configureSearch({ search: () => current, composer: () => composer, results: () => results });
  return { api: context.testApi, original, current: () => current,
    commands, clipboardWrites, queries, result, composer, unavailable,
    setResults(value) { results = value; } };
}

test('opens a conversation through native paste even when retrying the same phone', async () => {
  const app = searchHarness();
  const composer = await app.api.openConversation({ phone: '+84 906 905 915' }, app.original);
  assert.equal(composer, app.composer);
  assert.deepEqual(app.clipboardWrites, ['0906905915']);
  assert.deepEqual(app.queries, ['', '0906905915']);
  assert.deepEqual(app.commands, ['delete', 'paste']);
  assert.equal(app.result.clicked, true);
});

test('pastes into the current search field after clearing remounts it', async () => {
  const app = searchHarness({ remount: true });
  await app.api.openConversation({ phone: '0906905915' }, app.original);
  assert.notEqual(app.current(), app.original);
  assert.equal(app.original.value, '');
  assert.equal(app.current().value, '0906905915');
  assert.equal(app.result.clicked, true);
});

test('uses native selection and paste for an editable search field', async () => {
  const app = searchHarness({ editable: true });
  await app.api.openConversation({ phone: '0906905915' }, app.original);
  assert.deepEqual(app.queries, ['', '0906905915']);
  assert.equal(app.result.clicked, true);
});

test('does not open a result when paste is blocked or the clipboard cannot be written', async () => {
  for (const options of [{ pasteAllowed: false }, { clipboardAllowed: false }]) {
    const app = searchHarness(options);
    await assert.rejects(app.api.openConversation({ phone: '0906905915' }, app.original), /dán|clipboard/i);
    assert.equal(app.result.clicked, undefined);
  }
});

test('does not paste over a query that could not be cleared', async () => {
  const app = searchHarness({ resetAllowed: false });
  await assert.rejects(app.api.openConversation({ phone: '0906905915' }, app.original), /xóa/);
  assert.equal(app.commands.includes('paste'), false);
  assert.equal(app.result.clicked, undefined);
});

test('requires the entire phone to match even if the last eight digits are correct', async () => {
  const app = searchHarness({ pastedPhone: '0806905915' });
  await assert.rejects(app.api.openConversation({ phone: '0906905915' }, app.original), /số điện thoại/);
  assert.equal(app.result.clicked, undefined);
});

test('never selects the unregistered or search-disabled notice as a contact', () => {
  const app = searchHarness();
  for (const text of [
    'Số điện thoại chưa đăng ký tài khoản hoặc không cho phép tìm kiếm.',
    '0906905915: Số điện thoại chưa đăng ký tài khoản hoặc không cho phép tìm kiếm.',
    'Không tìm thấy kết quả',
    'Không có kết quả'
  ]) {
    app.setResults([candidate(text)]);
    assert.equal(app.api.findSearchResult('0906905915', new Map()), null);
  }
  app.setResults([app.result]);
  assert.equal(app.api.findSearchResult('0906905915', new Map()), app.result);
  assert.equal(app.api.findSearchResult('0906905915', new Map([[app.result, app.result.innerText]])), null);
});

test('an unavailable phone triggers native full-name search for the same student', async () => {
  const contact = candidate('Trương Bảo (C) Ngọc');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo (C) Ngọc', className: '9T2D+' }, app.original);
  assert.deepEqual(app.clipboardWrites, ['0977686959', 'Trương Bảo (C) Ngọc']);
  assert.deepEqual(app.queries, ['', '0977686959', '', 'Trương Bảo (C) Ngọc']);
  assert.deepEqual(app.commands, ['delete', 'paste', 'delete', 'paste']);
  assert.equal(contact.clicked, true);
  assert.equal(app.unavailable.clicked, undefined);
});

test('name search preserves parenthesized markers and normalizes whitespace only', async () => {
  const contact = candidate('Nguyễn Đặng Thiên (A) Kim');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0909630582', studentName: '  Nguyễn Đặng  Thiên (A) Kim  '.normalize('NFD') }, app.original);
  assert.deepEqual(app.clipboardWrites, ['0909630582', 'Nguyễn Đặng Thiên (A) Kim']);
  assert.equal(contact.clicked, true);
});

test('class-prefixed saved contacts with a school suffix open the matching conversation', async () => {
  const contact = candidate('9T46A Trần Ngọc Uyên Thy, VVT');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original);
  assert.equal(contact.clicked, true);
});

test('the two Lam Thanh Truc contacts select the requested class despite parentheses in the school name', async () => {
  const correct = candidate('9T26A Lâm Thanh Trúc, NTT(P)');
  const other = candidate('9T26D Lâm Thanh Trúc');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [correct, other] });
  await app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original);
  assert.equal(correct.clicked, true);
  assert.equal(other.clicked, undefined);
});

test('a Zalo chat title beside the avatar is verified even without header CSS classes', async () => {
  const correct = candidate('9T26A Lâm Thanh Trúc, NTT(P)');
  const other = candidate('9T26D Lâm Thanh Trúc');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [correct, other],
    genericHeader: true, openedHeader: '9T26A Lâm Thanh Trúc, NTT(PN)' });
  await app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original);
  assert.equal(correct.clicked, true);
  assert.equal(other.clicked, undefined);
});

test('generic chat-title fallback still rejects a different class, missing avatar or sidebar label', async () => {
  for (const options of [
    { openedHeader: '9T26D Lâm Thanh Trúc, NTT(PN)' },
    { openedHeader: '9T26A Lâm Thanh Trúc, NTT(PN)', headerAvatar: false },
    { openedHeader: '9T26A Lâm Thanh Trúc, NTT(PN)', headerLeft: 100 }
  ]) {
    const contact = candidate('9T26A Lâm Thanh Trúc, NTT(P)');
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], genericHeader: true, ...options });
    await assert.rejects(app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original), error => error.skipped);
    assert.equal(contact.clicked, true);
  }
});

test('a shortened visible title uses the full title attribute before opening the matching chat', async () => {
  const fullName = '9T46A Chu Nguyễn Hoàng Phúc';
  const contact = candidate('9T46A Chu Nguyễn Hoàng Ph...', { title: fullName });
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], openedHeader: fullName });
  await app.api.openConversation({ phone: '0937236758', studentName: 'Chu Nguyễn Hoàng Phúc', className: '9T46A' }, app.original);
  assert.equal(contact.clicked, true);
});

test('a name query reads the whole result row when a nested name element holds only the class code', async () => {
  const contact = candidate('9T26A Lâm Thanh Trúc, NTT');
  contact.querySelector = selector => selector.includes('name') ? candidate('9T26A') : null;
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original);
  assert.equal(contact.clicked, true);
});

test('a class code joined to the highlighted name still identifies the requested class', async () => {
  const contact = candidate('9T26ALâm Thanh Trúc, NTT(P)');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original);
  assert.equal(contact.clicked, true);
});

test('a matching highlight or tooltip cannot replace a longer visible name or conflicting class', async () => {
  for (const text of ['9T26A Lâm Thanh Trúc Anh', '9T26D Lâm Thanh Tr...', '9T26A+ Lâm Thanh Tr...']) {
    const contact = candidate(text, { title: '9T26A Lâm Thanh Trúc' });
    contact.querySelector = selector => selector.includes('name') ? candidate('Lâm Thanh Trúc') : null;
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
    await assert.rejects(app.api.openConversation({ phone: '0942752299', studentName: 'Lâm Thanh Trúc', className: '9T26A' }, app.original), error => error.skipped);
    assert.equal(contact.clicked, undefined, text);
  }
});

test('a shortened contact with a conflicting full title is never selected', async () => {
  const contact = candidate('Chu Nguyễn Hoàng Ph...', { title: '9VT4 Chu Nguyễn Hoàng Phúc' });
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await assert.rejects(app.api.openConversation({ phone: '0937236758', studentName: 'Chu Nguyễn Hoàng Phúc', className: '9T46A' }, app.original), error => error.skipped);
  assert.equal(contact.clicked, undefined);
});

test('the visible contact section is selected while an identical message search hit is ignored', async () => {
  const contact = candidate('9T46A Trần Ngọc Uyên Thy, VVT');
  const message = candidate('9T46A Trần Ngọc Uyên Thy, VVT\nBạn: Nội dung thông báo cũ');
  message.getBoundingClientRect = () => ({ left: 100, top: 500, bottom: 580, right: 420, height: 80, width: 320 });
  const sections = [['Liên hệ (1)', 200], ['Tin nhắn (1)', 420]].map(([text, top]) => {
    const heading = candidate(text);
    heading.getBoundingClientRect = () => ({ left: 70, right: 220, top, bottom: top + 24, height: 24, width: 150 });
    return heading;
  });
  const app = searchHarness({ phoneUnavailable: true, nameResults: [message, contact], sections, searchBounds: true });
  await app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original);
  assert.equal(contact.clicked, true);
  assert.equal(message.clicked, undefined);
});

test('message and file results never substitute for a contact, including phone search hits', async () => {
  for (const type of ['message', 'file']) {
    const hit = candidate('9T46A Trần Ngọc Uyên Thy, VVT\n0901234567', { 'data-type': type });
    const app = searchHarness({ phoneUnavailable: true, nameResults: [hit] });
    await assert.rejects(app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original), error => error.skipped);
    app.setResults([hit]);
    assert.equal(app.api.findSearchResult('0901234567', new Map()), null);
    assert.equal(hit.clicked, undefined);
  }
});

test('search tabs without section counts do not masquerade as result headings', async () => {
  const contact = candidate('9T46A Trần Ngọc Uyên Thy, VVT');
  const tabs = ['Liên hệ', 'Tin nhắn', 'File'].map(text => {
    const tab = candidate(text);
    tab.getBoundingClientRect = () => ({ left: 70, right: 220, top: 100, bottom: 124, height: 24, width: 150 });
    return tab;
  });
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], sections: tabs, searchBounds: true });
  await app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original);
  assert.equal(contact.clicked, true);
});

test('class prefix and school suffix support preserves full-name, class, phone and marker checks', async () => {
  for (const text of [
    '9VT4 Trần Ngọc Uyên Thy, VVT',
    '9T46A Trần Ngọc Uyên Thy Anh, VVT',
    '9T46A Trần Ngọc Uyên Thy (A), VVT',
    '9T46A Trần Ngọc Uyên Thy, (C), VVT',
    '9T46A Trần Ngọc Uyên Thy, 0900000000',
    '9T46A Trần Ngọc Uyên Thy, VVT\n5 thành viên'
  ]) {
    const contact = candidate(text);
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
    await assert.rejects(app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original), error => error.skipped, text);
    assert.equal(contact.clicked, undefined, text);
  }
});

test('class prefixes and suffixes disambiguate a matching contact without accepting another class', async () => {
  const correct = candidate('9T46A Trần Ngọc Uyên Thy, VVT');
  const other = candidate('9VT4 Trần Ngọc Uyên Thy, VVT');
  const unknown = candidate('Trần Ngọc Uyên Thy, VVT');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [other, unknown, correct] });
  await app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original);
  assert.equal(correct.clicked, true);
  assert.equal(unknown.clicked, undefined);
  assert.equal(other.clicked, undefined);
});

test('two saved contacts with the same class and full name remain ambiguous', async () => {
  const contacts = [candidate('9T46A Trần Ngọc Uyên Thy, VVT'), candidate('9T46A Trần Ngọc Uyên Thy, ABC')];
  const app = searchHarness({ phoneUnavailable: true, nameResults: contacts });
  await assert.rejects(app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original), error => error.skipped);
  assert.ok(contacts.every(contact => !contact.clicked));
});

test('a class suffix plus sign stays significant and an incompatible class in the opened header blocks pasting', async () => {
  for (const openedHeader of ['9T46A+ Trần Ngọc Uyên Thy, VVT', '9VT4 Trần Ngọc Uyên Thy, VVT']) {
    const contact = candidate('9T46A Trần Ngọc Uyên Thy, VVT');
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], openedHeader });
    await assert.rejects(app.api.openConversation({ phone: '0901234567', studentName: 'Trần Ngọc Uyên Thy', className: '9T46A' }, app.original), error => error.skipped && /cuộc trò chuyện khớp tên/.test(error.message));
    assert.equal(contact.clicked, true);
  }
});

test('a name with a missing or different marker never qualifies as the same student', async () => {
  for (const name of ['Trương Bảo Ngọc', 'Trương Bảo (A) Ngọc']) {
    const contact = candidate(name);
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
    await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo (C) Ngọc' }, app.original), error => error.skipped);
    assert.equal(contact.clicked, undefined);
  }
});

test('conversation verification retains the marker from the searched student name', async () => {
  for (const openedHeader of ['Trương Bảo Ngọc', 'Trương Bảo (A) Ngọc']) {
    const contact = candidate('Trương Bảo (C) Ngọc');
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], openedHeader });
    await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo (C) Ngọc' }, app.original), error => error.skipped && /cuộc trò chuyện khớp tên/.test(error.message));
    assert.equal(contact.clicked, true);
  }
});

test('normal phone search remains the first and only search when it succeeds', async () => {
  const app = searchHarness();
  await app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original);
  assert.deepEqual(app.clipboardWrites, ['0977686959']);
});

test('a generic empty phone result does not trigger the restricted-phone fallback', async () => {
  const contact = candidate('Trương Bảo Ngọc');
  const app = searchHarness({ phoneResults: [], nameResults: [contact] });
  await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original), error => error.skipped);
  assert.deepEqual(app.clipboardWrites, ['0977686959']);
  assert.equal(contact.clicked, undefined);
});

test('a restricted phone without a student name is skipped before a second search', async () => {
  const app = searchHarness({ phoneUnavailable: true });
  await assert.rejects(app.api.openConversation({ phone: '0977686959' }, app.original), /thiếu tên học sinh/);
  assert.deepEqual(app.clipboardWrites, ['0977686959']);
});

test('ambiguous full names and partial name matches never select a recipient', async () => {
  for (const matches of [[candidate('Trương Bảo Ngọc'), candidate('Trương Bảo Ngọc')], [candidate('Trương Bảo Ngọc Anh')]]) {
    const app = searchHarness({ phoneUnavailable: true, nameResults: matches });
    await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original), error => error.skipped);
    assert.ok(matches.every(contact => !contact.clicked));
  }
});

test('a matching visible phone disambiguates otherwise equal student names', async () => {
  const exact = candidate('Trương Bảo Ngọc\n0977686959');
  const unknown = candidate('Trương Bảo Ngọc');
  const mismatch = candidate('Trương Bảo Ngọc\n0900000000');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [unknown, mismatch, exact] });
  await app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original);
  assert.equal(exact.clicked, true);
  assert.equal(unknown.clicked, undefined);
  assert.equal(mismatch.clicked, undefined);
});

test('the class of the current student can disambiguate identical full names', async () => {
  const exact = candidate('Trương Bảo Ngọc 9T2D+');
  const other = candidate('Trương Bảo Ngọc 9VT2');
  const unknown = candidate('Trương Bảo Ngọc');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [other, unknown, exact] });
  await app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc', className: '9T2D+' }, app.original);
  assert.equal(exact.clicked, true);
  assert.equal(other.clicked, undefined);
  assert.equal(unknown.clicked, undefined);
});

test('the same name with a conflicting phone or a group indicator is skipped', async () => {
  for (const contact of [
    candidate('Trương Bảo Ngọc\n0900000000'),
    candidate('Trương Bảo Ngọc', { 'data-type': 'group' }),
    candidate('Trương Bảo Ngọc\n5 thành viên')
  ]) {
    const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
    await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original), error => error.skipped);
    assert.equal(contact.clicked, undefined);
  }
});

test('an explicitly different class never qualifies for name fallback', async () => {
  const contact = candidate('Trương Bảo Ngọc\nLớp: 9VT2');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc', className: '9T2D+' }, app.original), error => error.skipped);
  assert.equal(contact.clicked, undefined);
});

test('unchanged results and chat history outside search results are excluded', () => {
  const app = searchHarness();
  const unchanged = candidate('Trương Bảo Ngọc');
  const history = candidate('Trương Bảo Ngọc'); history.matches = () => false;
  app.setResults([unchanged, history]);
  assert.equal(app.api.nameSearchCandidates({ studentName: 'Trương Bảo Ngọc' }, new Map([[unchanged, unchanged.innerText]])).length, 0);
});

test('a blocked or incomplete name paste never opens a contact', async () => {
  for (const options of [{ namePasteAllowed: false }, { pastedName: 'Trương Bảo' }]) {
    const contact = candidate('Trương Bảo Ngọc');
    const app = searchHarness({ ...options, phoneUnavailable: true, nameResults: [contact] });
    await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original), /dán|đủ tên/);
    assert.equal(contact.clicked, undefined);
  }
});

test('name matching tolerates Vietnamese accent composition and display-name casing', async () => {
  const contact = candidate('TRUONG BAO NGOC');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact] });
  await app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc'.normalize('NFD') }, app.original);
  assert.equal(contact.clicked, true);
});

test('a name result cannot reuse the previous chat composer before the header switches', async () => {
  const contact = candidate('Trương Bảo Ngọc');
  const app = searchHarness({ phoneUnavailable: true, nameResults: [contact], staleHeader: true });
  await assert.rejects(app.api.openConversation({ phone: '0977686959', studentName: 'Trương Bảo Ngọc' }, app.original), error => error.skipped && /cuộc trò chuyện khớp tên/.test(error.message));
  assert.equal(contact.clicked, true);
});
