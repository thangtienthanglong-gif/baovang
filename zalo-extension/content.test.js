const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, `globalThis.testApi = { findComposer, findSendButton, fillComposer, matchingMessageCount, sameMessageLines, hasFullMessage, sendOne };
globalThis.configureSend = hooks => {
  showZaloStatus = hooks.status;
  activateSearchBox = hooks.search;
  openConversation = hooks.open;
  findComposer = hooks.composer;
  matchingMessageCount = hooks.count;
  findSendButton = hooks.button;
};
})();`);

function element(left, top, width, height, attributes = {}) {
  return {
    offsetWidth: width,
    getBoundingClientRect: () => ({ left, right: left + width, top, height, width }),
    getAttribute: name => attributes[name] || '',
    matches: selector => selector.startsWith('input') && attributes.placeholder != null
  };
}

function findComposerAtWidth(innerWidth, withSearch = true) {
  const search = element(70, 30, 320, 36, { placeholder: 'Tìm kiếm' });
  const sidebarEditor = element(80, 700, 260, 48);
  const composer = element(440, 700, 500, 48);
  const document = {
    querySelectorAll(selector) {
      if (selector === 'input[placeholder*="Tìm kiếm"]') return withSearch ? [search] : [];
      if (selector === '[contenteditable="true"]') return [sidebarEditor, composer];
      return [];
    }
  };
  const context = {
    location: { hostname: 'chat.zalo.me' },
    window: { innerWidth, innerHeight: 900 },
    document,
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  return { selected: context.testApi.findComposer(), composer };
}

test('finds the chat composer on narrow and wide Zalo windows', () => {
  for (const width of [1366, 1920, 2560]) {
    const { selected, composer } = findComposerAtWidth(width);
    assert.equal(selected, composer, `viewport width ${width}`);
  }
});

test('finds the composer when the search field is hidden', () => {
  const { selected, composer } = findComposerAtWidth(1920, false);
  assert.equal(selected, composer);
});

test('pastes multiline messages through the clipboard and inserts single-line text', async () => {
  const commands = [];
  const clipboard = [];
  const document = {
    createRange: () => ({ selectNodeContents() {} }),
    execCommand(command, _showUi, value) {
      commands.push({ command, value });
      return true;
    }
  };
  const context = {
    location: { hostname: 'chat.zalo.me' },
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    document,
    navigator: { clipboard: { async writeText(value) { clipboard.push(value); } } },
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  const composer = { isContentEditable: true, focus() {} };
  await context.testApi.fillComposer(composer, 'Dòng một\nDòng hai');
  assert.deepEqual(clipboard, ['Dòng một\nDòng hai']);
  assert.deepEqual(commands.map(entry => entry.command), ['paste']);
  commands.length = 0;
  await context.testApi.fillComposer(composer, 'Dòng & một');

  assert.deepEqual(commands.map(entry => entry.command), ['delete', 'insertText']);
  assert.equal(commands[1].value, 'Dòng & một');
  assert.equal(context.testApi.sameMessageLines('Dòng một\nDòng hai', 'Dòng một\nDòng hai'), true);
  assert.equal(context.testApi.sameMessageLines('Dòng một Dòng hai', 'Dòng một\nDòng hai'), false);
});

function draftElement(tag, children = [], attributes = {}) {
  return {
    nodeType: 1, tagName: tag, childNodes: children,
    getAttribute: name => attributes[name] || null,
    isContentEditable: true
  };
}

const draftText = value => ({ nodeType: 3, nodeValue: value });

test('reads complete draft paragraphs despite a noneditable contact preview and editor whitespace', () => {
  const context = { location: { hostname: 'chat.zalo.me' }, window: {},
    chrome: { runtime: { onMessage: { addListener() {} } } } };
  vm.runInNewContext(source, context);
  const message = 'Kính gửi Quý phụ huynh.\nHọc sinh: Vắng không phép.\nLiên hệ 0703426786.';
  const preview = draftElement('DIV', [draftText('Trường Thăng Tiến Thăng Long\n0703426786')], { contenteditable: 'false' });
  const paragraphs = [
    draftElement('DIV', [draftText('Kính gửi\u00a0 Quý phụ huynh.')]),
    draftElement('DIV', [draftText('Học sinh: Vắng không phép.\u200b')]),
    draftElement('DIV', [draftText('Liên hệ '), draftElement('A', [draftText('0703426786')]), draftText('.')])
  ];
  const draft = draftElement('DIV', [preview, ...paragraphs]);
  draft.innerText = 'Trường Thăng Tiến Thăng Long\n0703426786\n' + message;
  assert.equal(context.testApi.hasFullMessage(draft, message), true);
  draft.childNodes.pop();
  draft.innerText = 'Kính gửi Quý phụ huynh.\nHọc sinh: Vắng không phép.';
  assert.equal(context.testApi.hasFullMessage(draft, message), false);
  draft.childNodes = [draftText(message.replace(/\n/g, ' '))];
  draft.innerText = message.replace(/\n/g, ' ');
  assert.equal(context.testApi.hasFullMessage(draft, message), false);
  draft.childNodes = [...paragraphs, draftElement('DIV', [draftText('Nội dung khác.')])];
  draft.innerText = message + '\nNội dung khác.';
  assert.equal(context.testApi.hasFullMessage(draft, message), false);
});

test('sends automatically after paste replaces the editor node', async () => {
  const message = 'Dòng một\nDòng hai\nDòng ba';
  const oldDraft = { isContentEditable: true, innerText: '', focus() {} };
  const newDraft = { isContentEditable: true, innerText: message };
  let current = oldDraft;
  let sendClicks = 0;
  const button = { focus() {}, dispatchEvent() {}, click() { sendClicks += 1; } };
  const context = {
    location: { hostname: 'chat.zalo.me' },
    window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
    navigator: { clipboard: { async writeText() {} } },
    document: { createRange: () => ({ selectNodeContents() {} }), execCommand(command) {
      if (command === 'paste') current = newDraft;
      return true;
    } },
    setTimeout(callback) { callback(); },
    MouseEvent: function () {},
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  context.configureSend({ status() {}, search: () => ({}), open: () => oldDraft,
    composer: () => current, count: () => sendClicks, button: () => button });
  const result = await context.testApi.sendOne({ phone: '0900000000', message });
  assert.equal(result.ok, true);
  assert.equal(sendClicks, 1);
  assert.equal(current, newDraft);
});

test('finds only an enabled send control next to the composer', () => {
  const button = {
    offsetWidth: 32,
    disabled: false,
    className: 'send-button',
    getAttribute: () => '',
    getBoundingClientRect: () => ({ left: 900, top: 700 })
  };
  const root = { querySelectorAll: () => [button] };
  const document = { querySelectorAll: () => [button] };
  const context = {
    location: { hostname: 'chat.zalo.me' },
    window: {},
    document,
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  const composer = {
    closest: () => root,
    getBoundingClientRect: () => ({ left: 440, top: 700 })
  };
  assert.equal(context.testApi.findSendButton(composer), button);
  button.disabled = true;
  assert.equal(context.testApi.findSendButton(composer), null);
  button.disabled = false;
  button.className = 'send-file';
  assert.equal(context.testApi.findSendButton(composer), null);
  button.className = 'zavi-send';
  assert.equal(context.testApi.findSendButton(composer), button);
  button.className = '';
  button.id = 'sendBtn';
  assert.equal(context.testApi.findSendButton(composer), button);
});

test('detects a sent message even when Zalo removes its line breaks', () => {
  const bubble = { offsetWidth: 300, textContent: 'First line Second line', innerText: 'First line Second line' };
  const document = {
    querySelectorAll(selector) {
      return selector === 'div, span, p, li' ? [bubble] : [];
    }
  };
  const context = {
    location: { hostname: 'chat.zalo.me' },
    window: {},
    document,
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  assert.equal(context.testApi.matchingMessageCount('First line\nSecond line'), 0);
  assert.equal(context.testApi.matchingMessageCount('First line\nSecond line', false), 1);
  bubble.innerText = 'First line\nSecond line';
  assert.equal(context.testApi.matchingMessageCount('First line\nSecond line'), 1);
});
