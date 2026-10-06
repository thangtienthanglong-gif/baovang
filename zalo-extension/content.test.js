const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, 'globalThis.testApi = { findComposer, findSendButton, fillComposer, matchingMessageCount, sameMessageLines };\n})();');

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

test('fills single-line messages and blocks automatic multiline insertion', () => {
  const commands = [];
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
    chrome: { runtime: { onMessage: { addListener() {} } } }
  };
  vm.runInNewContext(source, context);
  const composer = { isContentEditable: true, focus() {} };
  assert.throws(() => context.testApi.fillComposer(composer, 'Dòng một\nDòng hai'), /gửi thủ công/);
  assert.equal(commands.length, 0);
  context.testApi.fillComposer(composer, 'Dòng & một');

  assert.deepEqual(commands.map(entry => entry.command), ['delete', 'insertText']);
  assert.equal(commands[1].value, 'Dòng & một');
  assert.equal(context.testApi.sameMessageLines('Dòng một\nDòng hai', 'Dòng một\nDòng hai'), true);
  assert.equal(context.testApi.sameMessageLines('Dòng một Dòng hai', 'Dòng một\nDòng hai'), false);
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
