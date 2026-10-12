const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, `globalThis.testApi = { openConversation, findSearchResult };
globalThis.configureSearch = hooks => {
  findSearchBox = hooks.search;
  findComposer = hooks.composer;
  searchResultCandidates = hooks.results;
};
})();`);

function candidate(text) {
  return {
    innerText: text, textContent: text,
    matches: selector => selector === '[role="option"]',
    contains: () => false, focus() {}, dispatchEvent() {},
    click() { this.clicked = true; }
  };
}

function searchHarness({ editable = false, remount = false, pasteAllowed = true,
  pastedPhone, resetAllowed = true, clipboardAllowed = true } = {}) {
  const commands = [];
  const clipboardWrites = [];
  const queries = [];
  const result = candidate('Tên phụ huynh');
  const composer = {};
  let results = [];
  let clipboard;
  let current;
  const document = {
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
        if (!pasteAllowed) return false;
        current.draft = pastedPhone ?? clipboard;
        queries.push(current.draft);
        results = [result];
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
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    navigator: { clipboard: { async writeText(value) {
      if (!clipboardAllowed) throw new Error('Clipboard denied');
      clipboard = value;
      clipboardWrites.push(value);
    } } },
    setTimeout(callback) { callback(); }, MouseEvent: function () {},
    chrome: { runtime: { id: 'test-extension', onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  context.configureSearch({ search: () => current, composer: () => composer, results: () => results });
  return { api: context.testApi, original, current: () => current,
    commands, clipboardWrites, queries, result, composer,
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
