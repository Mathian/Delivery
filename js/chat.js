/* ============================================================
   CHAT — Support chat (user ↔ admin)
   ============================================================ */

let _unsubSupportChat = null;

function openSupportChat() {
  STATE.supportChatFrom = STATE.role;
  // Mark messages as read
  if (STATE.uid) {
    localStorage.setItem('support_last_read_' + STATE.uid, new Date().toISOString());
  }
  clearSupportBadge();
  showScreen('s-support');
  loadSupportMsgs();
}

function closeSupportChat() {
  if (_unsubSupportChat) { _unsubSupportChat(); _unsubSupportChat = null; }
  showScreen(STATE.supportChatFrom === 'driver' ? 's-driver' : 's-passenger');
}

async function loadSupportMsgs() {
  if (!STATE.uid) return;
  const chatId = 'support_' + STATE.uid;
  const msgsEl = document.getElementById('support-msgs');
  if (!msgsEl) return;

  const renderMsgs = msgs => {
    const sorted = msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const extra = sorted.map(m => `
      <div class="msg ${m.from === 'user' ? 'msg-out' : 'msg-in'}">
        ${escHtml(m.text)}
        <div class="msg-time">${fmtTime(m.createdAt)}</div>
      </div>`).join('');
    msgsEl.innerHTML = `
      <div class="msg msg-in">
        Привет! Чем могу помочь? 😊
        <div class="msg-time"></div>
      </div>${extra}`;
    msgsEl.scrollTop = msgsEl.scrollHeight;

    // Check for unread admin messages
    const lastReadKey = 'support_last_read_' + STATE.uid;
    const lastRead = localStorage.getItem(lastReadKey) || '1970-01-01';
    const hasUnread = sorted.some(m => m.from === 'admin' && m.createdAt > lastRead);
    if (hasUnread) {
      showSupportBadge();
      playNotificationSound();
    }
  };

  if (_unsubSupportChat) _unsubSupportChat();
  _unsubSupportChat = onSnapshotQuery('chats', 'chatId', '==', chatId, renderMsgs);
}

async function sendSupportMsg() {
  if (!STATE.uid || !STATE.user) return;
  const input = document.getElementById('support-input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  const chatId = 'support_' + STATE.uid;
  await dbSet('chats', 'MSG-' + Date.now(), {
    chatId,
    from: 'user',
    text,
    userId: STATE.uid,
    userName: STATE.user.name,
    createdAt: new Date().toISOString()
  });
  setTimeout(() => {
    const el = document.getElementById('support-msgs');
    if (el) el.scrollTop = el.scrollHeight;
  }, 100);
}

// ---- Badge management ----
function showSupportBadge() {
  ['p-ni-2', 'd-ni-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !el.querySelector('.support-badge')) {
      const badge = document.createElement('span');
      badge.className = 'support-badge';
      badge.style.cssText = 'display:inline-block;width:8px;height:8px;background:var(--red);border-radius:50%;position:absolute;top:4px;right:4px;pointer-events:none';
      el.style.position = 'relative';
      el.appendChild(badge);
    }
  });
  const arr = document.getElementById('mi-support-arr');
  if (arr) arr.textContent = '🔴';
}

function clearSupportBadge() {
  ['p-ni-2', 'd-ni-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { const b = el.querySelector('.support-badge'); if (b) b.remove(); }
  });
  const arr = document.getElementById('mi-support-arr');
  if (arr) arr.textContent = '›';
  if (STATE.uid) {
    localStorage.setItem('support_last_read_' + STATE.uid, new Date().toISOString());
  }
}

// ---- Notification sound ----
let _notifAudioCtx = null;
function playNotificationSound() {
  try {
    if (_notifAudioCtx) _notifAudioCtx.close();
    _notifAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = _notifAudioCtx.createOscillator();
    const g = _notifAudioCtx.createGain();
    o.connect(g); g.connect(_notifAudioCtx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.3, _notifAudioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _notifAudioCtx.currentTime + 0.4);
    o.start(); o.stop(_notifAudioCtx.currentTime + 0.4);
    setTimeout(() => { if (_notifAudioCtx) { _notifAudioCtx.close(); _notifAudioCtx = null; } }, 600);
  } catch (e) {}
}

// ---- Check unread on app init ----
function checkSupportUnread() {
  if (!STATE.uid) return;
  const chatId = 'support_' + STATE.uid;
  const lastReadKey = 'support_last_read_' + STATE.uid;
  const lastRead = localStorage.getItem(lastReadKey) || '1970-01-01';
  dbQuery('chats', 'chatId', '==', chatId).then(msgs => {
    const hasUnread = msgs.some(m => m.from === 'admin' && m.createdAt > lastRead);
    if (hasUnread) showSupportBadge();
  }).catch(() => {});
}
