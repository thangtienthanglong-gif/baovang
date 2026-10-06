const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8')
  .replace(/\}\)\(\);\s*$/, `globalThis.testApi = { handleZaloItem, requireActiveExtension };
globalThis.configureReport = (send, status) => { sendOne = send; showZaloStatus = status; };
})();`);

function bridge(sendMessage, hostname = 'baovang.vercel.app') {
  const appListeners = new Set();
  const runtimeListeners = new Set();
  const events = [];
  const window = {
    addEventListener(type, listener) { if (type === 'message') appListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'message') appListeners.delete(listener); },
    postMessage(message) { events.push(message); }
  };
  const context = { location: { hostname, origin: `https://${hostname}` }, window,
    chrome: { runtime: { id: 'test-extension', sendMessage, onMessage: {
      addListener(listener) { runtimeListeners.add(listener); },
      removeListener(listener) { runtimeListeners.delete(listener); }
    } } } };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, window, appListeners, runtimeListeners, events };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('a synchronous invalidation error is caught and the stale app bridge is detached', async () => {
  let attempts = 0;
  const app = bridge(() => { attempts += 1; throw new Error('Extension context invalidated.'); });
  const listener = [...app.appListeners][0];
  assert.doesNotThrow(() => listener({ source: app.window, data: { source: 'baovang-app', type: 'START_AUTO', items: [] } }));
  await flush();
  assert.equal(attempts, 1);
  assert.equal(app.appListeners.size, 0);
  assert.equal(app.events.length, 1);
  assert.equal(app.events[0].status, 'error');
  assert.match(app.events[0].error, /tải lại tab BaoVang và Zalo/);
});

test('STOP_AUTO handles a rejected runtime message without an unhandled rejection', async () => {
  const app = bridge(() => Promise.reject(new Error('Could not establish connection.')));
  [...app.appListeners][0]({ source: app.window, data: { source: 'baovang-app', type: 'STOP_AUTO' } });
  await flush();
  assert.equal(app.events.length, 1);
  assert.match(app.events[0].error, /Could not establish connection/);
});

test('reinjection replaces the bridge instead of starting two sending queues', async () => {
  let attempts = 0;
  const app = bridge(async () => { attempts += 1; return { ok: true }; });
  vm.runInContext(source, app.context);
  assert.equal(app.appListeners.size, 1);
  assert.equal(app.runtimeListeners.size, 1);
  [...app.appListeners][0]({ source: app.window, data: { source: 'baovang-app', type: 'START_AUTO', items: [] } });
  await flush();
  assert.equal(attempts, 1);
});

test('reporting failure after a successful send never emits a failed-send result', async () => {
  const attempts = [];
  const statuses = [];
  const zalo = bridge(message => { attempts.push(message); throw new Error('Extension context invalidated.'); }, 'chat.zalo.me');
  zalo.context.configureReport(async () => ({ ok: true }), message => statuses.push(message));
  const result = await zalo.context.testApi.handleZaloItem({ id: 'notice-1' });
  assert.equal(result.ok, true);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].ok, true);
  assert.match(statuses.at(-1), /tin đã gửi, nhưng chưa báo kết quả/);
});

test('a missing runtime id produces a clear reconnect error', () => {
  const app = bridge(async () => ({ ok: true }));
  delete app.context.chrome.runtime.id;
  assert.throws(() => app.context.testApi.requireActiveExtension(), /tải lại tab BaoVang và Zalo/);
});
