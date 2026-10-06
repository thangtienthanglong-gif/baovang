const state = {
  running: false,
  stopped: false,
  appTabId: null,
  zaloTabId: null,
  items: [],
  index: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  manual: 0,
  stopReason: ''
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendToApp(message) {
  if (state.appTabId == null) return;
  try { await chrome.tabs.sendMessage(state.appTabId, message); } catch (_) {}
}

async function refreshAppTabsAfterUpdate() {
  // Reloading the extension invalidates content scripts in existing pages.
  // Reload BaoVang itself so the old, possibly unguarded message bridge is
  // removed; injecting a new listener does not remove the old page listener.
  const tabs = await chrome.tabs.query({ url: 'https://baovang.vercel.app/*' });
  const appTabs = tabs.filter(tab => tab.id != null && /^https:\/\/baovang\.vercel\.app(?:\/|$)/i.test(tab.url || ''));
  const results = await Promise.allSettled(appTabs.map(tab => chrome.tabs.reload(tab.id)));
  for (const result of results) {
    if (result.status === 'rejected') console.warn('Không tải lại được tab BaoVang sau khi cập nhật tiện ích:', result.reason?.message || result.reason);
  }
}

chrome.runtime.onInstalled.addListener(details => {
  if (!['install', 'update'].includes(details.reason)) return;
  return refreshAppTabsAfterUpdate().catch(error => console.warn('Không kết nối lại được tab BaoVang:', error.message));
});

async function waitForTabComplete(tabId, timeoutMs = 20000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === 'complete') return;
  await new Promise(resolve => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);
  });
}

async function findOrOpenZaloTab() {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: 'https://chat.zalo.me/*' });
  const tabs = activeTabs.length ? activeTabs : await chrome.tabs.query({ url: 'https://chat.zalo.me/*' });
  if (tabs[0]?.id != null) {
    state.zaloTabId = tabs[0].id;
    await chrome.tabs.update(state.zaloTabId, { active: true });
    if (tabs[0].windowId != null) await chrome.windows.update(tabs[0].windowId, { focused: true });
    // Reload so an extension update cannot leave an old content script in the tab.
    await chrome.tabs.reload(state.zaloTabId);
    await waitForTabComplete(state.zaloTabId);
    return state.zaloTabId;
  }
  const tab = await chrome.tabs.create({ url: 'https://chat.zalo.me/', active: true });
  state.zaloTabId = tab.id;
  await waitForTabComplete(state.zaloTabId);
  return state.zaloTabId;
}

async function sendItemToZalo(tabId, item) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'BAOVANG_ZALO_ITEM', item });
    if (!response?.accepted) throw new Error('Zalo Web không xác nhận đã nhận tin nhắn.');
    return response;
  } catch (firstError) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(firstError.message || '')) throw firstError;
    // Tab Zalo có thể đã mở trước khi extension được tải. Khi đó content.js
    // chưa tồn tại trong tab; tiêm lại rồi gửi lần nữa.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await sleep(500);
      const response = await chrome.tabs.sendMessage(tabId, { type: 'BAOVANG_ZALO_ITEM', item });
      if (!response?.accepted) throw new Error('Zalo Web không xác nhận đã nhận tin nhắn.');
      return response;
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
        const timeout = setTimeout(() => {
          chrome.runtime.onMessage.removeListener(listener);
          resolve({ ok: false, error: 'Không xác nhận được tin đã gửi trên Zalo sau 2 phút.' });
        }, 150000);
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
    await sendToApp({ type: 'BAOVANG_EXTENSION_RESULT', itemId: item.id, absenceId: item.absenceId, ok: Boolean(response.ok), skipped: Boolean(response.skipped), manual: Boolean(response.manual), error: response.error || '', formattingWarning: response.formattingWarning || '' });
    if (response.manual) {
      state.manual += 1;
      state.stopReason = response.error || 'Tin nhiều dòng cần gửi thủ công.';
      state.stopped = true;
      break;
    } else if (response.ok) {
      state.sent += 1;
      if (response.formattingWarning) {
        state.stopReason = response.formattingWarning;
        state.stopped = true;
        break;
      }
    } else {
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
    completed: state.sent + state.skipped + state.failed + state.manual,
    sent: state.sent,
    skipped: state.skipped,
    failed: state.failed,
    manual: state.manual,
    error: state.stopReason,
    total: state.items.length
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BAOVANG_START_AUTO') {
    if (state.running) { sendResponse({ ok: false, error: 'Auto đang chạy.' }); return; }
    if (!Array.isArray(message.items) || !message.items.length) {
      sendResponse({ ok: false, error: 'Không có tin nhắn nào để gửi.' });
      return;
    }
    state.appTabId = sender.tab?.id ?? message.appTabId ?? null;
    state.items = message.items;
    state.index = 0;
    state.sent = 0;
    state.skipped = 0;
    state.failed = 0;
    state.manual = 0;
    state.stopReason = '';
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
    return;
  }
});
