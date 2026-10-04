const isBaoVang = location.hostname === 'baovang.vercel.app';

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function first(selectors) { return selectors.map(s => document.querySelector(s)).find(Boolean) || null; }
function visible(el) { return el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length); }

if (isBaoVang) {
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'BAOVANG_EXTENSION_RESULT' || message?.type === 'BAOVANG_EXTENSION_STATUS') {
      window.postMessage({ source: 'baovang-zalo-extension', ...message }, '*');
    }
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'baovang-app') return;
    if (event.data.type === 'START_AUTO') chrome.runtime.sendMessage({ type: 'BAOVANG_START_AUTO', items: event.data.items });
    if (event.data.type === 'STOP_AUTO') chrome.runtime.sendMessage({ type: 'BAOVANG_STOP_AUTO' });
  });
} else {
  async function runItem(item) {
    const search = first([
      'input[placeholder*="Tìm kiếm"]', 'input[placeholder*="tìm kiếm"]',
      'input[placeholder*="Search"]', 'input[aria-label*="Tìm"]',
      'input[aria-label*="Search"]'
    ]);
    if (!visible(search)) throw new Error('Không tìm thấy ô tìm kiếm Zalo Web.');
    search.focus();
    search.select();
    document.execCommand('insertText', false, item.phone);
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await wait(1000);
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    search.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await wait(1800);

    const input = first([
      '[contenteditable="true"]',
      'div[role="textbox"]',
      'textarea[placeholder*="Nhập"]',
      'textarea[placeholder*="Tin nhắn"]'
    ]);
    if (!visible(input)) throw new Error('Không tìm thấy ô nhập tin nhắn.');
    input.focus();
    if (input.isContentEditable || input.getAttribute('contenteditable') === 'true') {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, item.message);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: item.message }));
    } else {
      input.value = item.message;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await wait(400);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
    await wait(700);
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'BAOVANG_ZALO_ITEM') return;
    runItem(message.item).then(result => chrome.runtime.sendMessage({ type: 'BAOVANG_ZALO_ITEM_RESULT', itemId: message.item.id, ...result }))
      .catch(error => chrome.runtime.sendMessage({ type: 'BAOVANG_ZALO_ITEM_RESULT', itemId: message.item.id, ok: false, error: error.message }));
    return true;
  });
}
