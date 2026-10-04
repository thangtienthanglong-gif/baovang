(() => {
const isBaoVang = location.hostname === 'baovang.vercel.app';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = el => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const textOf = el => String(el?.innerText || el?.textContent || '').trim();

function allVisible(selectors) {
  return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))).filter(visible);
}

async function waitFor(getter, timeout = 8000, interval = 150) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = getter();
    if (result) return result;
    await wait(interval);
  }
  return null;
}

function emitInput(el, value) {
  const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true';
  el.focus();

  if (isEditable) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand('delete', false);
    document.execCommand('insertText', false, value);
    if (textOf(el) !== value) {
      el.textContent = value;
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: value
    }));
  } else {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (descriptor?.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function keyEnter(el) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    el.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true
    }));
  }
}

function clickLike(el) {
  el.focus?.();
  for (const type of ['mousedown', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  el.click();
}

function findSearchBox() {
  return allVisible([
    'input[placeholder*="Tìm kiếm"]',
    'input[placeholder*="tìm kiếm"]',
    'input[placeholder*="Tìm bạn"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="Tìm"]',
    'input[aria-label*="Search"]'
  ]).find(el => el.type !== 'hidden') || null;
}

function findComposer() {
  const candidates = allVisible([
    '[contenteditable="true"]',
    'div[role="textbox"]',
    'textarea[placeholder*="Nhập"]',
    'textarea[placeholder*="Tin nhắn"]',
    'textarea[aria-label*="tin nhắn"]'
  ]);
  if (!candidates.length) return null;

  // Zalo có thể có nhiều contenteditable; ô chat thường nằm thấp nhất trong cửa sổ.
  return candidates
    .filter(el => !/tìm kiếm|search/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''))
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.top + br.height) - (ar.top + ar.height);
    })[0] || null;
}

function findSendButton(composer) {
  const root = composer?.closest('form, [class*="footer"], [class*="composer"], [class*="input"]') || document;
  const candidates = Array.from(root.querySelectorAll('button, [role="button"], [aria-label], [title]')).filter(visible);
  const matching = candidates.filter(el => {
    const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${textOf(el)}`;
    return /(^|\s)(gửi|send)(\s|$)/i.test(label) || /send|gửi/i.test(el.className || '');
  });
  return matching[matching.length - 1] || null;
}

function findSearchResult(phone) {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  const candidates = allVisible([
    '[role="option"]',
    'li',
    '[class*="search"] [class*="item"]',
    '[class*="friend"]',
    '[class*="contact"]',
    '[class*="user-item"]'
  ]);
  return candidates.filter(el => {
    const digits = textOf(el).replace(/\D/g, '');
    return normalizedPhone && digits.includes(normalizedPhone.slice(-8));
  }).sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
}

function skippedError(message) {
  const error = new Error(message);
  error.skipped = true;
  return error;
}

async function openConversation(item, search) {
  emitInput(search, item.phone);
  const result = await waitFor(() => findSearchResult(item.phone), 6000);
  if (!result) throw skippedError(`Không tìm thấy kết quả Zalo khớp số ${item.phone}; chưa gửi tin.`);
  clickLike(result);
  // The previous chat's composer may still be mounted while Zalo switches chats.
  await wait(1200);
  const composer = await waitFor(findComposer, 4500);
  if (!composer) throw skippedError(`Không mở được cuộc trò chuyện của số ${item.phone}.`);
  return composer;
}

async function sendOne(item) {
  if (!String(item?.phone || '').replace(/\D/g, '')) throw skippedError('Thiếu số điện thoại Zalo; đã bỏ qua tin này.');
  if (!String(item?.message || '').trim()) throw skippedError('Tin nhắn trống; đã bỏ qua tin này.');
  const search = await waitFor(findSearchBox, 8000);
  if (!search) throw new Error('Không tìm thấy ô tìm kiếm Zalo Web.');

  const composer = await openConversation(item, search);
  if (!composer) throw skippedError(`Không mở được cuộc trò chuyện của số ${item.phone}.`);

  emitInput(composer, item.message);
  const filled = await waitFor(() => {
    const value = composer.isContentEditable ? textOf(composer) : composer.value;
    return value.includes(String(item.message).slice(0, 20)) ? composer : null;
  }, 2500);
  if (!filled) throw new Error('Zalo Web không nhận được nội dung tin nhắn.');

  await wait(500);
  const sendButton = findSendButton(composer);
  if (sendButton) {
    clickLike(sendButton);
  } else {
    // Một số phiên bản Zalo ẩn nút Gửi; Enter là phương án dự phòng.
    keyEnter(composer);
  }

  const sent = await waitFor(() => {
    const value = composer.isContentEditable ? textOf(composer) : composer.value;
    return !value || value.trim() === '' ? true : null;
  }, 6000);
  if (!sent) throw new Error('Đã điền tin nhưng Zalo Web chưa xác nhận gửi.');
  await wait(900);
  return { ok: true };
}

if (isBaoVang) {
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'BAOVANG_EXTENSION_RESULT' || message?.type === 'BAOVANG_EXTENSION_STATUS') {
      window.postMessage({ source: 'baovang-zalo-extension', ...message }, '*');
    }
  });
  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.source !== 'baovang-app') return;
    if (event.data.type === 'START_AUTO') {
      chrome.runtime.sendMessage({ type: 'BAOVANG_START_AUTO', items: event.data.items })
        .then(response => {
          if (response?.ok) return;
          window.postMessage({ source: 'baovang-zalo-extension', type: 'BAOVANG_EXTENSION_STATUS', status: 'error', error: response?.error || 'Extension không khởi động được.' }, location.origin);
        })
        .catch(error => window.postMessage({ source: 'baovang-zalo-extension', type: 'BAOVANG_EXTENSION_STATUS', status: 'error', error: error.message }, location.origin));
    }
    if (event.data.type === 'STOP_AUTO') chrome.runtime.sendMessage({ type: 'BAOVANG_STOP_AUTO' });
  });
} else {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'BAOVANG_ZALO_ITEM') return;
    // Acknowledge receipt now; the completed send is reported separately below.
    // Returning true without ever calling sendResponse leaves tabs.sendMessage pending.
    sendResponse({ accepted: true });
    sendOne(message.item)
      .then(result => chrome.runtime.sendMessage({ type: 'BAOVANG_ZALO_ITEM_RESULT', itemId: message.item.id, ...result }))
      .catch(error => chrome.runtime.sendMessage({
        type: 'BAOVANG_ZALO_ITEM_RESULT',
        itemId: message.item.id,
        ok: false,
        skipped: Boolean(error.skipped),
        error: error.message
      }));
  });
}

})();
