(() => {
const isBaoVang = location.hostname === 'baovang.vercel.app';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const visible = el => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
const textOf = el => String(el?.innerText || el?.textContent || '').trim();
const phoneForSearch = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('84') && digits.length >= 11 ? `0${digits.slice(2)}` : digits;
};

function contextInvalidatedError() {
  const error = new Error('Tiện ích BaoVang đã được tải lại. Hãy tải lại tab BaoVang và Zalo để kết nối phiên bản mới.');
  error.contextInvalidated = true;
  return error;
}

function requireActiveExtension() {
  try {
    if (chrome.runtime.id) return;
  } catch (_) {}
  throw contextInvalidatedError();
}

async function sendRuntimeMessage(message) {
  try {
    requireActiveExtension();
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    if (error.contextInvalidated || /Extension context invalidated/i.test(error.message || '')) {
      throw contextInvalidatedError();
    }
    throw error;
  }
}

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

function clickLike(el) {
  el.focus?.();
  for (const type of ['mousedown', 'mouseup']) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  el.click();
}

function messageLines(value) {
  return String(value || '').replace(/\r\n?/g, '\n').split('\n');
}

function sameMessageLines(actual, expected) {
  const normalize = value => messageLines(value)
    .map(line => line.normalize('NFC').replace(/[\u200b\ufeff]/g, '').replace(/[^\S\n]+/g, ' ').trim())
    .filter(Boolean);
  const actualLines = normalize(actual);
  const expectedLines = normalize(expected);
  return actualLines.length === expectedLines.length
    && actualLines.every((line, index) => line === expectedLines[index]);
}

function editableText(node) {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';
  const tag = node.tagName?.toUpperCase() || '';
  const block = /^(DIV|P|LI|SECTION|ARTICLE|ASIDE|BLOCKQUOTE)$/.test(tag);
  // Zalo can mount a contact/link preview alongside the draft. Read text
  // paragraphs and inline links, excluding controls and noneditable cards.
  if (/^(BUTTON|SCRIPT|STYLE|SVG|IMG)$/.test(tag)
      || node.hidden || node.getAttribute?.('aria-hidden') === 'true'
      || node.getAttribute?.('role') === 'button'
      || (block && node.getAttribute?.('contenteditable') === 'false')) return '';
  if (tag === 'BR') return '\n';
  const text = Array.from(node.childNodes || []).map(editableText).join('');
  return block ? `\n${text}\n` : text;
}

function hasFullMessage(composer, message) {
  if (!composer) return false;
  if (!composer.isContentEditable && typeof composer.value === 'string') {
    return sameMessageLines(composer.value, message);
  }
  return [composer.innerText, editableText(composer)]
    .some(value => typeof value === 'string' && sameMessageLines(value, message));
}

async function fillComposer(composer, message) {
  if (!composer.isContentEditable) {
    emitInput(composer, message);
    return;
  }

  const isMultiline = messageLines(message).length > 1;
  if (isMultiline) await navigator.clipboard.writeText(message);

  composer.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);

  if (isMultiline) {
    if (!document.execCommand('paste', false)) {
      throw new Error('Chrome không cho phép dán tin nhiều dòng vào Zalo; chưa bấm Gửi.');
    }
    return;
  }

  document.execCommand('delete', false);
  if (message && !document.execCommand('insertText', false, message)) {
    throw new Error('Zalo Web không nhận đủ nội dung tin nhắn; chưa bấm Gửi.');
  }
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

  // The chat panel starts after the search box in Zalo's left sidebar. A
  // viewport percentage can move past the composer on wider screens.
  const searchBox = findSearchBox();
  const chatLeft = searchBox
    ? searchBox.getBoundingClientRect().right
    : Math.min(320, window.innerWidth * 0.28);

  // Zalo có thể có nhiều contenteditable; ô chat thường nằm thấp nhất trong cửa sổ.
  return candidates
    .filter(el => !/tìm kiếm|search/i.test(el.getAttribute('placeholder') || el.getAttribute('aria-label') || ''))
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.left > chatLeft && rect.top > window.innerHeight * 0.3;
    })
    .sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return (br.top + br.height) - (ar.top + ar.height);
    })[0] || null;
}

function findSendButton(composer) {
  const root = composer?.closest('form, [class*="footer"], [class*="composer"], [class*="input"]');
  const composerRect = composer?.getBoundingClientRect();
  for (const scope of [root, document]) {
    if (!scope) continue;
    const matching = Array.from(scope.querySelectorAll('button, [role="button"], [aria-label], [title], [class*="send"], [class*="Send"], [id*="send"], [id*="Send"]'))
      .filter(visible)
      .filter(el => {
        const labels = [el.getAttribute('aria-label'), el.getAttribute('title'), textOf(el)].filter(Boolean);
        const isSend = labels.some(label => /^(gửi( tin nhắn)?|send( message)?)(\s*\(.*\))?$/i.test(label.trim()))
          || /^send[-_]?(btn|button|message)$/i.test(el.id || '')
          || /(?:^|[\s_-])(send|gửi)(?:$|[\s_-](?:btn|button|message|msg))(?![a-z])/i.test(el.className || '');
        const rect = el.getBoundingClientRect();
        return isSend
          && !el.disabled
          && !el.closest?.('button:disabled, [aria-disabled="true"]')
          && (!composerRect || (rect.left >= composerRect.left && rect.top >= composerRect.top - 80));
      });
    if (matching.length) return matching[matching.length - 1];
  }
  return null;
}

function matchingMessageCount(message, requireLines = true) {
  const compact = value => String(value || '').replace(/[\s\u00a0\u200b]+/g, '');
  const expected = compact(message);
  if (!expected) return 0;
  const composer = findComposer();
  const matches = Array.from(document.querySelectorAll('div, span, p, li'))
    .filter(el => {
      return compact(el.textContent) === expected
        && visible(el)
        && !(composer && (composer.contains(el) || el.contains(composer)));
    })
    .filter(el => compact(textOf(el)) === expected && (!requireLines || sameMessageLines(textOf(el), message)));
  // A message can have several nested wrappers with the same text.
  return matches.filter(el => !matches.some(child => child !== el && el.contains(child))).length;
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
  requireActiveExtension();
  if (!String(item?.phone || '').replace(/\D/g, '')) throw skippedError('Thiếu số điện thoại Zalo; đã bỏ qua tin này.');
  if (!String(item?.message || '').trim()) throw skippedError('Tin nhắn trống; đã bỏ qua tin này.');
  showZaloStatus(`BaoVang: đang tìm số ${String(item.phone).slice(-4)} trên Zalo...`);
  const search = await waitFor(activateSearchBox, 8000);
  if (!search) throw new Error('Không tìm thấy ô tìm kiếm Zalo Web.');

  let composer = await openConversation(item, search);
  if (!composer) throw skippedError(`Không mở được cuộc trò chuyện của số ${item.phone}.`);

  const previousMessages = matchingMessageCount(item.message);
  const previousTextMatches = matchingMessageCount(item.message, false);
  const lines = messageLines(item.message).filter(line => line.trim());
  const previousLineCounts = lines.map(line => matchingMessageCount(line, false));
  const deliveryState = () => {
    if (matchingMessageCount(item.message) > previousMessages) return 'formatted';
    if (matchingMessageCount(item.message, false) > previousTextMatches) return 'flat';
    return null;
  };
  const finishSent = async state => {
    if (state === 'flat') {
      const warning = 'Tin đã gửi nhưng Zalo làm mất dấu xuống dòng; đã dừng hàng đợi. Không gửi lại tin này.';
      showZaloStatus(`BaoVang: ${warning}`, true);
      return { ok: true, formattingWarning: warning };
    }
    await wait(900);
    showZaloStatus('BaoVang: đã gửi tin nhắn qua Zalo Web.');
    return { ok: true };
  };

  showZaloStatus('BaoVang: đã mở cuộc trò chuyện, đang dán tin nhắn...');
  requireActiveExtension();
  await fillComposer(composer, item.message);
  await wait(500);
  const sentDuringInput = deliveryState();
  if (sentDuringInput) return finishSent(sentDuringInput);
  if (lines.some((line, index) => matchingMessageCount(line, false) > previousLineCounts[index])) {
    throw new Error('Zalo có thể đã gửi một phần tin khi điền nội dung; hãy kiểm tra cuộc trò chuyện trước khi gửi lại.');
  }
  const filled = await waitFor(() => {
    // Pasting can replace the editor node. Validate the current draft rather
    // than the detached node used to initiate the paste.
    const current = findComposer();
    if (!hasFullMessage(current, item.message)) return null;
    composer = current;
    return current;
  }, 2500);
  if (!filled) throw new Error('Zalo Web chưa nhận đủ nội dung tin nhắn; chưa bấm Gửi.');

  if (!hasFullMessage(composer, item.message)) {
    throw new Error('Nội dung trong ô chat đã thay đổi; chưa bấm Gửi.');
  }
  const sendButton = await waitFor(() => findSendButton(composer), 2000);
  if (!sendButton) throw new Error('Zalo chưa hiện nút Gửi; tin vẫn ở trong ô soạn. Hãy kiểm tra và gửi thủ công.');
  requireActiveExtension();
  clickLike(sendButton);

  const sent = await waitFor(deliveryState, 10000);
  if (!sent) {
    const detail = hasFullMessage(composer, item.message) ? 'Tin vẫn ở trong ô soạn.' : 'Hãy kiểm tra tin trong cuộc trò chuyện.';
    throw new Error(`Đã bấm Gửi nhưng chưa xác nhận được nội dung và dấu xuống dòng trên Zalo. ${detail} Kiểm tra trước khi gửi lại.`);
  }
  return finishSent(sent);
}

async function handleZaloItem(item) {
  let result;
  try {
    result = await sendOne(item);
  } catch (error) {
    result = { ok: false, skipped: Boolean(error.skipped), error: error.message };
    showZaloStatus(`BaoVang: ${error.message}`, true);
  }
  // A reporting failure after a successful send is a connection failure,
  // not a failed send. Do not send a second, contradictory failure result.
  try {
    await sendRuntimeMessage({ type: 'BAOVANG_ZALO_ITEM_RESULT', itemId: item.id, ...result });
  } catch (error) {
    showZaloStatus(result.ok
      ? `BaoVang: tin đã gửi, nhưng chưa báo kết quả về BaoVang. ${error.message} Kiểm tra trạng thái trước khi gửi lại.`
      : `BaoVang: ${result.error} Chưa báo được kết quả về BaoVang. ${error.message}`, true);
  }
  return result;
}

// Remove listeners from an earlier injection of this script in the same tab.
window.__baovangZaloDispose?.();

if (isBaoVang) {
  const onRuntimeMessage = message => {
    if (message?.type === 'BAOVANG_EXTENSION_RESULT' || message?.type === 'BAOVANG_EXTENSION_STATUS') {
      window.postMessage({ source: 'baovang-zalo-extension', ...message }, '*');
    }
  };
  const reportConnectionError = error => {
    if (error.contextInvalidated) window.removeEventListener('message', onAppMessage);
    window.postMessage({ source: 'baovang-zalo-extension', type: 'BAOVANG_EXTENSION_STATUS', status: 'error', error: error.message }, location.origin);
  };
  const onAppMessage = event => {
    if (event.source !== window || event.data?.source !== 'baovang-app') return;
    if (event.data.type === 'START_AUTO') {
      sendRuntimeMessage({ type: 'BAOVANG_START_AUTO', items: event.data.items })
        .then(response => {
          if (response?.ok) return;
          window.postMessage({ source: 'baovang-zalo-extension', type: 'BAOVANG_EXTENSION_STATUS', status: 'error', error: response?.error || 'Extension không khởi động được.' }, location.origin);
        })
        .catch(reportConnectionError);
    }
    if (event.data.type === 'STOP_AUTO') sendRuntimeMessage({ type: 'BAOVANG_STOP_AUTO' }).catch(reportConnectionError);
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  window.addEventListener('message', onAppMessage);
  window.__baovangZaloDispose = () => {
    window.removeEventListener('message', onAppMessage);
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
  };
} else {
  const onRuntimeMessage = (message, sender, sendResponse) => {
    if (message?.type !== 'BAOVANG_ZALO_ITEM') return;
    // Acknowledge receipt now; the completed send is reported separately below.
    // Returning true without ever calling sendResponse leaves tabs.sendMessage pending.
    sendResponse({ accepted: true });
    handleZaloItem(message.item);
  };
  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  window.__baovangZaloDispose = () => {
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (_) {}
  };
}

})();
