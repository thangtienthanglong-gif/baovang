const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('a multiline manual handoff stops the queue without marking the item failed', async () => {
  const listeners = [];
  const appEvents = [];
  const sentItems = [];
  let finish;
  const stopped = new Promise(resolve => { finish = resolve; });
  const chrome = {
    runtime: { onMessage: { addListener(listener) { listeners.push(listener); }, removeListener(listener) {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    } } },
    windows: { async update() {} },
    tabs: {
      async query() { return [{ id: 7, windowId: 1 }]; },
      async update() {},
      async reload() {},
      async get() { return { status: 'complete' }; },
      async sendMessage(tabId, message) {
        if (tabId === 3) {
          appEvents.push(message);
          if (message.type === 'BAOVANG_EXTENSION_STATUS' && message.status === 'stopped') finish();
          return;
        }
        if (message.type === 'BAOVANG_ZALO_ITEM') {
          sentItems.push(message.item.id);
          setTimeout(() => {
            for (const listener of [...listeners]) listener({
              type: 'BAOVANG_ZALO_ITEM_RESULT', itemId: message.item.id,
              ok: false, manual: true, error: 'Needs manual send'
            }, { tab: { id: 7 } });
          }, 0);
          return { accepted: true };
        }
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  vm.runInNewContext(source, { chrome, setTimeout, clearTimeout, Promise });
  listeners[0]({ type: 'BAOVANG_START_AUTO', items: [{ id: 'first' }, { id: 'second' }] }, { tab: { id: 3 } }, () => {});
  await stopped;

  assert.deepEqual(sentItems, ['first']);
  assert.equal(appEvents.find(event => event.type === 'BAOVANG_EXTENSION_RESULT').manual, true);
  const finalStatus = appEvents.find(event => event.type === 'BAOVANG_EXTENSION_STATUS' && event.status === 'stopped');
  assert.equal(finalStatus.manual, 1);
  assert.equal(finalStatus.failed, 0);
});
