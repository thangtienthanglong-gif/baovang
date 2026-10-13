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
    getClientRects: () => [{}], getAttribute: key => attributes[key] || null,
    click() { this.clicked = true; }
  };
}

function searchHarness({ editable = false, remount = false, pasteAllowed = true,
  pastedPhone, resetAllowed = true, clipboardAllowed = true,
  phoneUnavailable = false, phoneResults, nameResults = [], pastedName, namePasteAllowed = true,
  staleHeader = false, openedHeader } = {}) {
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
  header.getBoundingClientRect = () => ({ left: 500, top: 60 });
  let results = [];
  let clipboard;
  let current;
  let clock = 0;
  const document = {
    querySelectorAll: selector => /header|Header|title-container|conversation-title|chat-info/.test(selector)
      ? [header] : phoneUnavailable && /^\d+$/.test(current.draft) ? [unavailable] : [],
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
      getAttribute: () => editable ? 'true' : null
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
