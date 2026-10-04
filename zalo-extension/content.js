(() => {
const isBaoVang = location.hostname === 'baovang.vercel.app';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = el => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const textOf = el => String(el?.innerText || el?.textContent || '').trim();
const phoneForSearch = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('84') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
};

function showZaloStatus(message, isError = false) {
  let banner = document.getElementById('baovang-zalo-status');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'baovang-zalo-status';
    Object.assign(banner.style, {
      position: 'fixed', right: '16px', top: '16px', zIndex: '2147483647',
      maxWidth: '420px', padding: '12px 16px', borderRadius: '10px',
      boxShadow: '0 6px 24px rgba(0,0,0,.2)', font: '600 14px/1.5 sans-serif'
    });
    document.body.appendChild(banner);
  }
  banner.textContent = message;
  banner.style.background = isError ? '#fff1f2' : '#eff6ff';
  banner.style.color = isError ? '#9f1239' : '#1e3a8a';
  banner.style.border = isError ? '1px solid #fda4af' : '1px solid #93c5fd';
}

function allVisible(selectors) {
  return selectors.flatMap(selector => Array.from(document.querySelectorAll(selector))).filter(visible);
}

async function waitFor(getter, timeout = 8000, interval = 150) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await getter();
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

function inSearchArea(el) {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    && rect.top < Math.min(260, window.innerHeight * 0.3)
    && rect.left < window.innerWidth * 0.45;
}

function isEditableField(el) {
  return Boolean(el?.matches?.('input:not([type="hidden"]), textarea, [contenteditable="true"]'));
}

function findSearchBox() {
  const named = allVisible([
    'input[placeholder*="Tìm kiếm"]',
    'input[placeholder*="tìm kiếm"]',
    'input[placeholder*="Tìm bạn"]',
    'input[placeholder*="Search"]',
    'input[aria-label*="Tìm"]',
    'input[aria-label*="Search"]',
    '[role="searchbox"]',
    '[contenteditable="true"][data-placeholder*="Tìm"]',
    '[contenteditable="true"][aria-label*="Tìm"]'
  ]).find(el => isEditableField(el) && inSearchArea(el));
  if (named) return named;
  return allVisible(['input[type="search"]', 'input[type="text"]', 'input:not([type])'])
    .filter(inSearchArea)
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
}

async function activateSearchBox() {
  const existing = findSearchBox();
  if (existing) {
    clickLike(existing);
    await wait(120);
    const focused = document.activeElement;
    if (isEditableField(focused) && visible(focused) && inSearchArea(focused)) return focused;
    return findSearchBox();
  }

  // Zalo may render the visible "Tìm kiếm" as a clickable wrapper first.
  const trigger = Array.from(document.querySelectorAll('span, div, button, [role="button"], [role="searchbox"]'))
    .filter(el => visible(el) && inSearchArea(el) && (el.getAttribute('role') === 'searchbox' || /^tìm kiếm$/i.test(textOf(el))))
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.width * ar.height - br.width * br.height;
    })[0];
  if (trigger) clickLike(trigger);
  return waitFor(() => {
    const focused = document.activeElement;
    if (isEditableField(focused) && visible(focused) && inSearchArea(focused)) return focused;
    return findSearchBox();
  }, 2500);
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
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.left > window.innerWidth * 0.28 && rect.top > window.innerHeight * 0.3;
    })
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

function searchResultCandidates() {
  return [...new Set(allVisible([
    '[role="option"]',
    '[role="listbox"] li',
    '[class*="search"] [class*="item"]',
    '[class*="search"] [role="button"]',
    '[class*="search"] li',
    '[class*="friend"]',
    '[class*="contact"]',
    '[class*="user-item"]'
  ]))].filter(el => textOf(el).length > 0);
}

function findSearchResult(phone, previousResults) {
  const normalizedPhone = phoneForSearch(phone);
  const candidates = searchResultCandidates();
  const exact = candidates.filter(el => {
    const digits = textOf(el).replace(/\D/g, '');
    return normalizedPhone && digits.includes(normalizedPhone.slice(-8));
  }).sort((a, b) => textOf(a).length - textOf(b).length)[0];
  if (exact) return exact;

  // Search results may show only the account name. Accept a single newly
  // rendered result, never an unchanged chat from the left-hand history.
  const fresh = candidates.filter(el => previousResults.get(el) !== textOf(el))
    .filter(el => el.matches?.('[role="option"]') || el.closest?.('[role="listbox"], [class*="search"], [class*="Search"]'))
    .filter(el => !/không tìm thấy|không có kết quả|no results|tìm tất cả/i.test(textOf(el)));
  const leaves = fresh.filter(el => !fresh.some(other => other !== el && el.contains(other)));
  return leaves.length === 1 ? leaves[0] : null;
}

function skippedError(message) {
  const error = new Error(message);
  error.skipped = true;
  return error;
}

async function openConversation(item, search) {
  const previousResults = new Map(searchResultCandidates().map(el => [el, textOf(el)]));
  const searchedPhone = phoneForSearch(item.phone);
  emitInput(search, searchedPhone);
  const enteredPhone = String(search.isContentEditable ? textOf(search) : search.value || '').replace(/\D/g, '');
  if (!enteredPhone.endsWith(searchedPhone.slice(-8))) {
    throw new Error('Zalo Web không nhận số điện thoại trong ô Tìm kiếm.');
  }
  await wait(800);
  const result = await waitFor(() => findSearchResult(item.phone, previousResults), 7000);
  if (!result) throw skippedError(`Không tìm thấy kết quả tìm kiếm rõ ràng cho số ${item.phone}; chưa gửi tin.`);
  clickLike(result);
  // The previous chat's composer may still be mounted while Zalo switches chats.
  await wait(1200);
  let composer = await waitFor(findComposer, 3500);
  if (!composer) {
    const chatButton = allVisible(['button', '[role="button"]'])
      .find(el => /^nhắn tin$/i.test(textOf(el)));
    if (chatButton) {
      clickLike(chatButton);
      composer = await waitFor(findComposer, 4000);
    }
  }
  if (!composer) throw skippedError(`Không mở được cuộc trò chuyện của số ${item.phone}.`);
  return composer;
}

async function sendOne(item) {
  if (!String(item?.phone || '').replace(/\D/g, '')) throw skippedError('Thiếu số điện thoại Zalo; đã bỏ qua tin này.');
  if (!String(item?.message || '').trim()) throw skippedError('Tin nhắn trống; đã bỏ qua tin này.');
  showZaloStatus(`BaoVang: đang tìm số ${String(item.phone).slice(-4)} trên Zalo...`);
  const search = await waitFor(activateSearchBox, 8000);
  if (!search) throw new Error('Không tìm thấy ô tìm kiếm Zalo Web.');

  const composer = await openConversation(item, search);
  if (!composer) throw skippedError(`Không mở được cuộc trò chuyện của số ${item.phone}.`);

  showZaloStatus('BaoVang: đã mở cuộc trò chuyện, đang điền tin nhắn...');
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
  showZaloStatus('BaoVang: đã gửi tin nhắn qua Zalo Web.');
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
      .catch(error => {
        showZaloStatus(`BaoVang: ${error.message}`, true);
        return chrome.runtime.sendMessage({
          type: 'BAOVANG_ZALO_ITEM_RESULT',
          itemId: message.item.id,
          ok: false,
          skipped: Boolean(error.skipped),
          error: error.message
        });
      });
  });
}

})();
