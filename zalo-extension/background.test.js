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
    runtime: { onInstalled: { addListener() {} }, onMessage: { addListener(listener) { listeners.push(listener); }, removeListener(listener) {
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

function updateWorker(tabs, reload) {
  let onInstalled;
  const warnings = [];
  const chrome = {
    runtime: { onMessage: { addListener() {} }, onInstalled: { addListener(listener) { onInstalled = listener; } } },
    tabs: { async query(filter) {
      assert.equal(filter.url, 'https://baovang.vercel.app/*');
      return typeof tabs === 'function' ? tabs() : tabs;
    }, reload }
  };
  const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  vm.runInNewContext(source, { chrome, setTimeout, clearTimeout, Promise, console: { warn(...args) { warnings.push(args); } } });
  return { onInstalled, warnings };
}

test('extension install and reload refresh BaoVang pages without resending or touching other sites', async () => {
  const reloaded = [];
  const worker = updateWorker([
    { id: 3, url: 'https://baovang.vercel.app/' },
    { id: 4, url: 'https://baovang.vercel.app/ketbu/index.html' },
    { id: 5, url: 'https://chat.zalo.me/' },
    { id: 6, url: 'https://baovang.vercel.app.example.com/' },
    { url: 'https://baovang.vercel.app/' }
  ], async id => { reloaded.push(id); });
  await worker.onInstalled({ reason: 'update' });
  assert.deepEqual(reloaded, [3, 4]);
  await worker.onInstalled({ reason: 'install' });
  assert.deepEqual(reloaded, [3, 4, 3, 4]);
  await worker.onInstalled({ reason: 'chrome_update' });
  assert.deepEqual(reloaded, [3, 4, 3, 4]);
  assert.equal(worker.warnings.length, 0);
});

test('a closed tab does not stop reconnecting the other BaoVang tab', async () => {
  const reloaded = [];
  const worker = updateWorker([
    { id: 3, url: 'https://baovang.vercel.app/' },
    { id: 4, url: 'https://baovang.vercel.app/' }
  ], async id => {
    reloaded.push(id);
    if (id === 3) throw new Error('No tab with id: 3.');
  });
  await worker.onInstalled({ reason: 'update' });
  assert.deepEqual(reloaded, [3, 4]);
  assert.equal(worker.warnings.length, 1);
});

test('an update query failure is handled without an uncaught extension error', async () => {
  const worker = updateWorker(() => { throw new Error('Query failed.'); }, async () => {});
  await worker.onInstalled({ reason: 'update' });
  assert.equal(worker.warnings.length, 1);
});
