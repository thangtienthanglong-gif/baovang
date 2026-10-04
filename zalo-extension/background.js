const state = {
  running: false,
  stopped: false,
  appTabId: null,
  zaloTabId: null,
  items: [],
  index: 0,
  skipped: 0,
  failed: 0
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendToApp(message) {
  if (state.appTabId == null) return;
  try { await chrome.tabs.sendMessage(state.appTabId, message); } catch (_) {}
}

async function findOrOpenZaloTab() {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: ['https://chat.zalo.me/*', 'https://zalo.me/*'] });
  const tabs = activeTabs.length ? activeTabs : await chrome.tabs.query({ url: ['https://chat.zalo.me/*', 'https://zalo.me/*'] });
  if (tabs[0]?.id != null) {
    state.zaloTabId = tabs[0].id;
    await chrome.tabs.update(state.zaloTabId, { active: true });
    return state.zaloTabId;
  }
  const tab = await chrome.tabs.create({ url: 'https://chat.zalo.me/', active: true });
  state.zaloTabId = tab.id;
  await new Promise(resolve => {
    const listener = (tabId, info) => {
      if (tabId === state.zaloTabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 20000);
  });
  return state.zaloTabId;
}

async function sendItemToZalo(tabId, item) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'BAOVANG_ZALO_ITEM', item });
  } catch (firstError) {
    // Tab Zalo có thể đã mở trước khi extension được tải. Khi đó content.js
    // chưa tồn tại trong tab; tiêm lại rồi gửi lần nữa.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(500);
      return await chrome.tabs.sendMessage(tabId, { type: 'BAOVANG_ZALO_ITEM', item });
    } catch (secondError) {
      throw new Error(`Không kết nối được với Zalo Web: ${secondError.message || firstError.message}`);
    }
  }
}

async function processQueue() {
  const zaloTabId = await findOrOpenZaloTab();
  await sendToApp({ type: 'BAOVANG_EXTENSION_STATUS', status: 'started', total: state.items.length });
  for (; state.index < state.items.length; state.index += 1) {
    if (state.stopped) break;
    const item = state.items[state.index];
    await chrome.tabs.update(zaloTabId, { active: true });
    let response;
    try {
      response = await new Promise(async resolve => {
        const timeout = setTimeout(() => resolve({ ok: false, error: 'Zalo Web không phản hồi trong 30 giây.' }), 30000);
        const listener = (message, sender) => {
          if (sender.tab?.id !== zaloTabId || message?.type !== 'BAOVANG_ZALO_ITEM_RESULT' || message.itemId !== item.id) return;
          clearTimeout(timeout);
          chrome.runtime.onMessage.removeListener(listener);
          resolve(message);
        };
        chrome.runtime.onMessage.addListener(listener);
        try { await sendItemToZalo(zaloTabId, item); }
        catch (error) { clearTimeout(timeout); chrome.runtime.onMessage.removeListener(listener); resolve({ ok: false, error: error.message }); }
      });
    } catch (error) {
      response = { ok: false, error: error.message };
    }
    await sendToApp({ type: 'BAOVANG_EXTENSION_RESULT', itemId: item.id, absenceId: item.absenceId, ok: Boolean(response.ok), skipped: Boolean(response.skipped), error: response.error || '' });
    if (!response.ok) {
      if (response.skipped) state.skipped += 1;
      else state.failed += 1;
      // Số không có trên Zalo/người lạ chỉ là một mục bị bỏ qua,
      // không được làm dừng cả hàng đợi.
      if (!response.skipped) {
        state.stopped = true;
        break;
      }
    }
    await sleep(response.ok ? 3000 : 1200);
  }
  state.running = false;
  await sendToApp({
    type: 'BAOVANG_EXTENSION_STATUS',
    status: state.stopped ? 'stopped' : 'completed',
    completed: Math.min(state.index + (state.stopped ? 0 : 1), state.items.length),
    skipped: state.skipped,
    failed: state.failed,
    total: state.items.length
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BAOVANG_START_AUTO') {
    if (state.running) { sendResponse({ ok: false, error: 'Auto đang chạy.' }); return; }
    state.appTabId = sender.tab?.id ?? message.appTabId ?? null;
    state.items = Array.isArray(message.items) ? message.items : [];
    state.index = 0;
    state.skipped = 0;
    state.failed = 0;
    state.stopped = false;
    state.running = true;
    processQueue().catch(error => { state.running = false; sendToApp({ type: 'BAOVANG_EXTENSION_STATUS', status: 'error', error: error.message }); });
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'BAOVANG_STOP_AUTO') {
    state.stopped = true;
    sendResponse({ ok: true });
    return;
  }
  if (message?.type === 'BAOVANG_GET_STATUS') {
    sendResponse({ ok: true, running: state.running, index: state.index, total: state.items.length });
  }
  return true;
});
