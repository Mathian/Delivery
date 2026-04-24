'use strict';

// ─── MD5 IMPLEMENTATION ───────────────────────────────────────────────────────
function md5(str) {
  function safeAdd(x, y) {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }
  function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
  function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
  function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
  function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
  function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
  function md5blks(s) {
    const nblk = ((s.length + 64) >> 6) + 1;
    const blks = new Array(nblk * 16).fill(0);
    for (let i = 0; i < s.length; i++) blks[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
    blks[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
    blks[nblk * 16 - 2] = s.length * 8;
    return blks;
  }
  function md5core(x, len) {
    x[len >> 5] |= 0x80 << (len % 32);
    x[(((len + 64) >>> 9) << 4) + 14] = len;
    let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
    for (let i = 0; i < x.length; i += 16) {
      const olda = a, oldb = b, oldc = c, oldd = d;
      a = md5ff(a,b,c,d,x[i],7,-680876936); d = md5ff(d,a,b,c,x[i+1],12,-389564586);
      c = md5ff(c,d,a,b,x[i+2],17,606105819); b = md5ff(b,c,d,a,x[i+3],22,-1044525330);
      a = md5ff(a,b,c,d,x[i+4],7,-176418897); d = md5ff(d,a,b,c,x[i+5],12,1200080426);
      c = md5ff(c,d,a,b,x[i+6],17,-1473231341); b = md5ff(b,c,d,a,x[i+7],22,-45705983);
      a = md5ff(a,b,c,d,x[i+8],7,1770035416); d = md5ff(d,a,b,c,x[i+9],12,-1958414417);
      c = md5ff(c,d,a,b,x[i+10],17,-42063); b = md5ff(b,c,d,a,x[i+11],22,-1990404162);
      a = md5ff(a,b,c,d,x[i+12],7,1804603682); d = md5ff(d,a,b,c,x[i+13],12,-40341101);
      c = md5ff(c,d,a,b,x[i+14],17,-1502002290); b = md5ff(b,c,d,a,x[i+15],22,1236535329);
      a = md5gg(a,b,c,d,x[i+1],5,-165796510); d = md5gg(d,a,b,c,x[i+6],9,-1069501632);
      c = md5gg(c,d,a,b,x[i+11],14,643717713); b = md5gg(b,c,d,a,x[i],20,-373897302);
      a = md5gg(a,b,c,d,x[i+5],5,-701558691); d = md5gg(d,a,b,c,x[i+10],9,38016083);
      c = md5gg(c,d,a,b,x[i+15],14,-660478335); b = md5gg(b,c,d,a,x[i+4],20,-405537848);
      a = md5gg(a,b,c,d,x[i+9],5,568446438); d = md5gg(d,a,b,c,x[i+14],9,-1019803690);
      c = md5gg(c,d,a,b,x[i+3],14,-187363961); b = md5gg(b,c,d,a,x[i+8],20,1163531501);
      a = md5gg(a,b,c,d,x[i+13],5,-1444681467); d = md5gg(d,a,b,c,x[i+2],9,-51403784);
      c = md5gg(c,d,a,b,x[i+7],14,1735328473); b = md5gg(b,c,d,a,x[i+12],20,-1926607734);
      a = md5hh(a,b,c,d,x[i+5],4,-378558); d = md5hh(d,a,b,c,x[i+8],11,-2022574463);
      c = md5hh(c,d,a,b,x[i+11],16,1839030562); b = md5hh(b,c,d,a,x[i+14],23,-35309556);
      a = md5hh(a,b,c,d,x[i+1],4,-1530992060); d = md5hh(d,a,b,c,x[i+4],11,1272893353);
      c = md5hh(c,d,a,b,x[i+7],16,-155497632); b = md5hh(b,c,d,a,x[i+10],23,-1094730640);
      a = md5hh(a,b,c,d,x[i+13],4,681279174); d = md5hh(d,a,b,c,x[i],11,-358537222);
      c = md5hh(c,d,a,b,x[i+3],16,-722521979); b = md5hh(b,c,d,a,x[i+6],23,76029189);
      a = md5hh(a,b,c,d,x[i+9],4,-640364487); d = md5hh(d,a,b,c,x[i+12],11,-421815835);
      c = md5hh(c,d,a,b,x[i+15],16,530742520); b = md5hh(b,c,d,a,x[i+2],23,-995338651);
      a = md5ii(a,b,c,d,x[i],6,-198630844); d = md5ii(d,a,b,c,x[i+7],10,1126891415);
      c = md5ii(c,d,a,b,x[i+14],15,-1416354905); b = md5ii(b,c,d,a,x[i+5],21,-57434055);
      a = md5ii(a,b,c,d,x[i+12],6,1700485571); d = md5ii(d,a,b,c,x[i+3],10,-1894986606);
      c = md5ii(c,d,a,b,x[i+10],15,-1051523); b = md5ii(b,c,d,a,x[i+1],21,-2054922799);
      a = md5ii(a,b,c,d,x[i+8],6,1873313359); d = md5ii(d,a,b,c,x[i+15],10,-30611744);
      c = md5ii(c,d,a,b,x[i+6],15,-1560198380); b = md5ii(b,c,d,a,x[i+13],21,1309151649);
      a = md5ii(a,b,c,d,x[i+4],6,-145523070); d = md5ii(d,a,b,c,x[i+11],10,-1120210379);
      c = md5ii(c,d,a,b,x[i+2],15,718787259); b = md5ii(b,c,d,a,x[i+9],21,-343485551);
      a = safeAdd(a,olda); b = safeAdd(b,oldb); c = safeAdd(c,oldc); d = safeAdd(d,oldd);
    }
    return [a, b, c, d];
  }
  function rstr2hex(input) {
    const hexTab = '0123456789abcdef';
    let output = '';
    for (let i = 0; i < input.length; i++) {
      const x = input.charCodeAt(i);
      output += hexTab.charAt((x >>> 4) & 0x0f) + hexTab.charAt(x & 0x0f);
    }
    return output;
  }
  function str2rstr_utf8(input) {
    return unescape(encodeURIComponent(input));
  }
  function rstr_md5(s) {
    const encoded = str2rstr_utf8(s);
    const blks = md5blks(encoded);
    const res = md5core(blks, encoded.length * 8);
    let output = '';
    for (let i = 0; i < res.length; i++) {
      output += String.fromCharCode(
        res[i] & 0xff, (res[i] >> 8) & 0xff,
        (res[i] >> 16) & 0xff, (res[i] >> 24) & 0xff
      );
    }
    return output;
  }
  return rstr2hex(rstr_md5(str));
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE = {
  uid: null,
  staffData: null,
  currentTab: 'menu',
  menuItems: [],
  allOrders: [],
  cafeSettings: {},
  accessKeys: {},
  editingItemId: null,
  orderFilter: 'all',
  statsRange: 'today',
  unsubscribeOrders: null,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toast(msg, type = 'info') {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'admin-toast';
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function showConfirm(message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p class="confirm-message">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary confirm-cancel">Отмена</button>
        <button class="btn btn-danger confirm-ok">Удалить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-cancel').onclick = () => overlay.remove();
  overlay.querySelector('.confirm-ok').onclick = () => { overlay.remove(); onConfirm(); };
}

function extractUid() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid');
  if (uid) {
    params.delete('uid');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }
  return uid;
}

function getDateRange(range) {
  const now = new Date();
  const start = new Date();
  if (range === 'today') {
    start.setHours(0, 0, 0, 0);
  } else if (range === 'week') {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (range === 'month') {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }
  return { start, end: now };
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function init() {
  showScreen('s-loading');
  STATE.uid = extractUid() || localStorage.getItem('admin_uid');
  if (!STATE.uid) { showScreen('s-no-uid'); return; }
  localStorage.setItem('admin_uid', STATE.uid);

  try {
    const staffData = await dbGet('staff_uids', STATE.uid);
    if (!staffData || staffData.role !== 'admin') { showScreen('s-no-uid'); return; }
    STATE.staffData = staffData;

    // ── Onboarding: first-time name + ToS ──────────────────
    if (!staffData.tosAccepted) {
      const tgName = window.Telegram?.WebApp?.initDataUnsafe?.user?.first_name || '';
      const nameInput = document.getElementById('onboard-name');
      if (nameInput && tgName) nameInput.value = tgName;
      showScreen('s-onboard');
      return;
    }

    setupMainScreen();
    showScreen('s-main');
    switchTab('menu');
  } catch (e) {
    console.error('Init error:', e);
    showScreen('s-no-uid');
  }
}

// ─── MAIN SCREEN SETUP ────────────────────────────────────────────────────────
function setupMainScreen() {
  const nameEl = document.getElementById('admin-name');
  if (nameEl && STATE.staffData) nameEl.textContent = STATE.staffData.name || 'Администратор';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btn-add-item')?.addEventListener('click', () => openAddItemScreen(null));
  document.getElementById('btn-back-from-add')?.addEventListener('click', () => { showScreen('s-main'); switchTab('menu'); });
  document.getElementById('btn-back-from-order')?.addEventListener('click', () => { showScreen('s-main'); switchTab('orders'); });
  document.getElementById('add-item-form')?.addEventListener('submit', handleSaveItem);

  document.querySelectorAll('.order-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.orderFilter = btn.dataset.status;
      document.querySelectorAll('.order-filter-btn').forEach(b => b.classList.toggle('active', b.dataset.status === STATE.orderFilter));
      renderOrders();
    });
  });

  document.querySelectorAll('.stats-range-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      STATE.statsRange = btn.dataset.range;
      document.querySelectorAll('.stats-range-btn').forEach(b => b.classList.toggle('active', b.dataset.range === STATE.statsRange));
      renderStats();
    });
  });

  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);
  document.getElementById('btn-cafe-toggle')?.addEventListener('click', toggleCafe);

  ['admin', 'operator', 'courier'].forEach(role => {
    const input = document.getElementById(`key-input-${role}`);
    const preview = document.getElementById(`key-preview-${role}`);
    const saveBtn = document.getElementById(`key-save-${role}`);
    if (input && preview) {
      input.addEventListener('input', () => {
        preview.textContent = input.value ? md5(input.value) : '—';
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', () => saveAccessKey(role));
    }
  });
}

function switchTab(tab) {
  STATE.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.tab === tab);
  });
  showScreen('s-main');

  if (tab === 'menu') loadMenu();
  else if (tab === 'orders') loadOrders();
  else if (tab === 'stats') { loadOrders(true).then(renderStats); }
  else if (tab === 'settings') loadSettings();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MENU TAB
// ═══════════════════════════════════════════════════════════════════════════════
async function loadMenu() {
  const container = document.getElementById('menu-list');
  if (container) container.innerHTML = '<div class="loading-spinner">Загрузка...</div>';
  try {
    STATE.menuItems = await dbQueryAll('menu');
    renderMenu();
  } catch (e) {
    console.error('Load menu error:', e);
    toast('Ошибка загрузки меню', 'error');
  }
}

function renderMenu() {
  const container = document.getElementById('menu-list');
  if (!container) return;
  if (!STATE.menuItems || STATE.menuItems.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🍽️</div><p>Меню пустое. Добавьте первое блюдо.</p></div>`;
    return;
  }

  const sorted = [...STATE.menuItems].sort((a, b) => {
    const catCmp = (a.category || '').localeCompare(b.category || '', 'ru');
    if (catCmp !== 0) return catCmp;
    return (a.order || 0) - (b.order || 0);
  });

  const groups = {};
  sorted.forEach(item => {
    const cat = item.category || 'Без категории';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  });

  container.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="menu-category">
      <h3 class="category-title">${escapeHtml(cat)}</h3>
      ${items.map(item => buildMenuItemCard(item)).join('')}
    </div>`).join('');

  container.querySelectorAll('.btn-edit-item').forEach(btn => {
    btn.onclick = () => openAddItemScreen(btn.dataset.itemId);
  });
  container.querySelectorAll('.btn-delete-item').forEach(btn => {
    btn.onclick = () => deleteMenuItem(btn.dataset.itemId);
  });
  container.querySelectorAll('.btn-toggle-avail').forEach(btn => {
    btn.onclick = () => toggleItemAvailability(btn.dataset.itemId, btn.dataset.available === 'true');
  });
}

function buildMenuItemCard(item) {
  const available = item.available !== false;
  return `
    <div class="menu-item-card ${available ? '' : 'item-unavailable'}">
      ${item.imageUrl ? `<img class="item-thumb" src="${escapeHtml(item.imageUrl)}" alt="" onerror="this.style.display='none'">` : ''}
      <div class="item-info">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="item-price">${item.price || 0} ₽</div>
      </div>
      <div class="item-actions">
        <button class="btn-icon btn-toggle-avail" data-item-id="${escapeHtml(item.id)}" data-available="${available}" title="${available ? 'Скрыть' : 'Показать'}">
          ${available ? '👁️' : '🙈'}
        </button>
        <button class="btn-icon btn-edit-item" data-item-id="${escapeHtml(item.id)}" title="Редактировать">✏️</button>
        <button class="btn-icon btn-delete-item" data-item-id="${escapeHtml(item.id)}" title="Удалить">🗑️</button>
      </div>
    </div>`;
}

function openAddItemScreen(itemId) {
  STATE.editingItemId = itemId || null;
  const form = document.getElementById('add-item-form');
  if (!form) return;
  form.reset();

  const titleEl = document.getElementById('add-item-title');
  if (titleEl) titleEl.textContent = itemId ? 'Редактировать блюдо' : 'Добавить блюдо';

  const existingCategories = [...new Set(STATE.menuItems.map(i => i.category).filter(Boolean))];
  const catDatalist = document.getElementById('category-suggestions');
  if (catDatalist) {
    catDatalist.innerHTML = existingCategories.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  if (itemId) {
    const item = STATE.menuItems.find(i => i.id === itemId);
    if (item) {
      form.querySelector('#item-name').value = item.name || '';
      form.querySelector('#item-description').value = item.description || '';
      form.querySelector('#item-price').value = item.price || '';
      form.querySelector('#item-imageUrl').value = item.imageUrl || '';
      form.querySelector('#item-category').value = item.category || '';
      form.querySelector('#item-order').value = item.order || 0;
      form.querySelector('#item-available').checked = item.available !== false;
    }
  } else {
    form.querySelector('#item-available').checked = true;
  }

  showScreen('s-add-item');
}

async function handleSaveItem(e) {
  e.preventDefault();
  const form = e.target;
  const name = form.querySelector('#item-name').value.trim();
  const price = parseFloat(form.querySelector('#item-price').value);

  if (!name) { toast('Введите название блюда', 'error'); return; }
  if (isNaN(price) || price < 0) { toast('Введите корректную цену', 'error'); return; }

  const itemData = {
    name,
    description: form.querySelector('#item-description').value.trim(),
    price,
    imageUrl: form.querySelector('#item-imageUrl').value.trim(),
    category: form.querySelector('#item-category').value.trim() || 'Основное',
    order: parseInt(form.querySelector('#item-order').value, 10) || 0,
    available: form.querySelector('#item-available').checked,
    updatedAt: new Date().toISOString(),
  };

  const saveBtn = form.querySelector('#btn-save-item');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...'; }

  try {
    if (STATE.editingItemId) {
      await dbSet('menu', STATE.editingItemId, { ...itemData, id: STATE.editingItemId });
      toast('Блюдо обновлено', 'success');
    } else {
      itemData.createdAt = new Date().toISOString();
      const newId = await dbAddTask(null, 'menu', itemData);
      if (!newId) {
        const autoId = 'item_' + Date.now();
        await dbSet('menu', autoId, { ...itemData, id: autoId });
      }
      toast('Блюдо добавлено', 'success');
    }
    showScreen('s-main');
    await loadMenu();
    switchTab('menu');
  } catch (err) {
    console.error('Save item error:', err);
    toast('Ошибка сохранения', 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Сохранить'; }
  }
}

async function deleteMenuItem(itemId) {
  showConfirm('Удалить блюдо из меню?', async () => {
    try {
      await dbSet('menu', itemId, null);
      STATE.menuItems = STATE.menuItems.filter(i => i.id !== itemId);
      renderMenu();
      toast('Блюдо удалено', 'success');
    } catch (e) {
      console.error('Delete item error:', e);
      toast('Ошибка удаления', 'error');
    }
  });
}

async function toggleItemAvailability(itemId, currentlyAvailable) {
  const item = STATE.menuItems.find(i => i.id === itemId);
  if (!item) return;
  try {
    const updated = { ...item, available: !currentlyAvailable, updatedAt: new Date().toISOString() };
    await dbSet('menu', itemId, updated);
    const idx = STATE.menuItems.findIndex(i => i.id === itemId);
    if (idx !== -1) STATE.menuItems[idx] = updated;
    renderMenu();
    toast(`Блюдо ${!currentlyAvailable ? 'показано' : 'скрыто'}`, 'success');
  } catch (e) {
    console.error('Toggle availability error:', e);
    toast('Ошибка обновления', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS TAB
// ═══════════════════════════════════════════════════════════════════════════════
async function loadOrders(silent = false) {
  if (!silent) {
    const container = document.getElementById('orders-list');
    if (container) container.innerHTML = '<div class="loading-spinner">Загрузка...</div>';
  }
  try {
    STATE.allOrders = await dbQueryAll('orders');
    STATE.allOrders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (!silent) renderOrders();
  } catch (e) {
    console.error('Load orders error:', e);
    if (!silent) toast('Ошибка загрузки заказов', 'error');
  }
}

const STATUS_LABELS = {
  pending: 'Новый',
  confirmed: 'Подтверждён',
  cooking: 'Готовится',
  courier_assigned: 'У курьера',
  delivered: 'Доставлен',
  cancelled: 'Отменён',
  returned: 'Возврат',
};

const STATUS_COLORS = {
  pending: '#f59e0b',
  confirmed: '#3b82f6',
  cooking: '#8b5cf6',
  courier_assigned: '#06b6d4',
  delivered: '#10b981',
  cancelled: '#ef4444',
  returned: '#6b7280',
};

function renderOrders() {
  const container = document.getElementById('orders-list');
  if (!container) return;

  const filtered = STATE.orderFilter === 'all'
    ? STATE.allOrders
    : STATE.allOrders.filter(o => o.status === STATE.orderFilter);

  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📋</div><p>Нет заказов${STATE.orderFilter !== 'all' ? ' с выбранным статусом' : ''}</p></div>`;
    return;
  }

  container.innerHTML = filtered.map(order => {
    const status = order.status || 'pending';
    const label = STATUS_LABELS[status] || status;
    const color = STATUS_COLORS[status] || '#6b7280';
    const total = order.total || order.totalPrice || 0;
    const address = escapeHtml(order.address || order.deliveryAddress || '—');
    const clientName = escapeHtml(order.clientName || '—');
    return `
      <div class="order-row" data-order-id="${escapeHtml(order.id)}">
        <div class="order-row-left">
          <span class="order-num">#${escapeHtml(String(order.orderNumber || order.id.slice(-6)))}</span>
          <span class="order-status-badge" style="background:${color}">${escapeHtml(label)}</span>
        </div>
        <div class="order-row-info">
          <span class="order-client-name">${clientName}</span>
          <span class="order-addr">${address}</span>
        </div>
        <div class="order-row-right">
          <span class="order-amount">${total} ₽</span>
          <span class="order-date">${formatDateTime(order.createdAt)}</span>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.order-row').forEach(row => {
    row.addEventListener('click', () => {
      const orderId = row.dataset.orderId;
      const order = STATE.allOrders.find(o => o.id === orderId);
      if (order) showOrderDetail(order);
    });
  });
}

function showOrderDetail(order) {
  const screen = document.getElementById('s-order-detail');
  if (!screen) return;

  const status = order.status || 'pending';
  const label = STATUS_LABELS[status] || status;
  const color = STATUS_COLORS[status] || '#6b7280';
  const items = (order.items || []).map(item =>
    `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td class="text-center">${item.quantity || 1}</td>
      <td class="text-right">${(item.price || 0) * (item.quantity || 1)} ₽</td>
    </tr>`
  ).join('');

  const detailEl = document.getElementById('order-detail-content');
  if (detailEl) {
    detailEl.innerHTML = `
      <div class="detail-header">
        <h3>Заказ #${escapeHtml(String(order.orderNumber || order.id.slice(-6)))}</h3>
        <span class="order-status-badge" style="background:${color}">${escapeHtml(label)}</span>
      </div>

      <div class="detail-section">
        <h4 class="section-title">Клиент</h4>
        <div class="detail-row"><span class="detail-label">Имя</span><span>${escapeHtml(order.clientName || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Телефон</span><span>${escapeHtml(order.clientPhone || order.phone || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Telegram ID</span><span>${escapeHtml(String(order.clientTgId || '—'))}</span></div>
      </div>

      <div class="detail-section">
        <h4 class="section-title">Доставка</h4>
        <div class="detail-row"><span class="detail-label">Адрес</span><span>${escapeHtml(order.address || order.deliveryAddress || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Оплата</span><span>${escapeHtml(order.paymentType || order.payment || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">Курьер</span><span>${escapeHtml(order.courierName || order.courierId || '—')}</span></div>
      </div>

      <div class="detail-section">
        <h4 class="section-title">Состав заказа</h4>
        ${items ? `<table class="items-table"><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Сумма</th></tr></thead><tbody>${items}</tbody></table>` : '<p class="text-muted">Нет данных</p>'}
        <div class="detail-total">Итого: <strong>${order.total || order.totalPrice || 0} ₽</strong></div>
      </div>

      <div class="detail-section">
        <h4 class="section-title">Временные метки</h4>
        <div class="detail-row"><span class="detail-label">Создан</span><span>${formatDateTime(order.createdAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Подтверждён</span><span>${formatDateTime(order.confirmedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Готовится с</span><span>${formatDateTime(order.cookingAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Передан курьеру</span><span>${formatDateTime(order.assignedAt)}</span></div>
        <div class="detail-row"><span class="detail-label">Доставлен</span><span>${formatDateTime(order.deliveredAt)}</span></div>
        ${order.cancelledAt ? `<div class="detail-row"><span class="detail-label">Отменён</span><span>${formatDateTime(order.cancelledAt)}</span></div>` : ''}
        ${order.returnedAt ? `<div class="detail-row"><span class="detail-label">Возврат</span><span>${formatDateTime(order.returnedAt)}</span></div>` : ''}
      </div>

      <div class="detail-section">
        <h4 class="section-title">Оператор</h4>
        <div class="detail-row"><span class="detail-label">Имя</span><span>${escapeHtml(order.operatorName || '—')}</span></div>
        <div class="detail-row"><span class="detail-label">ID</span><span>${escapeHtml(order.operatorId || '—')}</span></div>
      </div>`;
  }

  showScreen('s-order-detail');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function renderStats() {
  const { start, end } = getDateRange(STATE.statsRange);
  const filtered = STATE.allOrders.filter(o => {
    const d = new Date(o.createdAt || 0);
    return d >= start && d <= end;
  });

  const total = filtered.length;
  const cancelled = filtered.filter(o => o.status === 'cancelled').length;
  const delivered = filtered.filter(o => o.status === 'delivered');
  const revenue = delivered.reduce((sum, o) => sum + (o.total || o.totalPrice || 0), 0);
  const avgValue = delivered.length > 0 ? Math.round(revenue / delivered.length) : 0;

  const summaryEl = document.getElementById('stats-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Всего заказов</div></div>
      <div class="stat-card"><div class="stat-value">${revenue} ₽</div><div class="stat-label">Выручка</div></div>
      <div class="stat-card"><div class="stat-value">${cancelled}</div><div class="stat-label">Отменено</div></div>
      <div class="stat-card"><div class="stat-value">${avgValue} ₽</div><div class="stat-label">Средний чек</div></div>`;
  }

  renderTopItems(filtered);
  renderHourlyChart(filtered);
  renderOperatorStats(filtered);
  renderCourierStats(filtered);
}

function renderTopItems(orders) {
  const itemCounts = {};
  orders.forEach(order => {
    (order.items || []).forEach(item => {
      const key = item.name || 'Без названия';
      itemCounts[key] = (itemCounts[key] || 0) + (item.quantity || 1);
    });
  });

  const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const el = document.getElementById('stats-top-items');
  if (!el) return;

  if (sorted.length === 0) { el.innerHTML = '<p class="text-muted">Нет данных</p>'; return; }

  const max = sorted[0][1];
  el.innerHTML = sorted.map(([name, count]) => `
    <div class="top-item-row">
      <span class="top-item-name">${escapeHtml(name)}</span>
      <div class="top-item-bar-wrap">
        <div class="top-item-bar" style="width:${Math.round((count/max)*100)}%"></div>
      </div>
      <span class="top-item-count">${count}</span>
    </div>`).join('');
}

function renderHourlyChart(orders) {
  const hours = new Array(24).fill(0);
  orders.forEach(o => {
    const h = new Date(o.createdAt || 0).getHours();
    hours[h]++;
  });
  const maxCount = Math.max(...hours, 1);
  const el = document.getElementById('stats-hourly-chart');
  if (!el) return;

  el.innerHTML = `<div class="hourly-chart">` + hours.map((count, h) => `
    <div class="hourly-col">
      <div class="hourly-bar" style="height:${Math.round((count/maxCount)*100)}%" title="${h}:00 — ${count} заказов"></div>
      <div class="hourly-label">${h % 3 === 0 ? h : ''}</div>
    </div>`).join('') + '</div>';
}

function renderOperatorStats(orders) {
  const ops = {};
  orders.forEach(o => {
    if (!o.operatorId) return;
    const key = o.operatorId;
    if (!ops[key]) ops[key] = { name: o.operatorName || key, count: 0, totalConfirmMs: 0, withTime: 0 };
    ops[key].count++;
    if (o.confirmedAt && o.createdAt) {
      const ms = new Date(o.confirmedAt) - new Date(o.createdAt);
      if (ms > 0) { ops[key].totalConfirmMs += ms; ops[key].withTime++; }
    }
  });

  const el = document.getElementById('stats-operators');
  if (!el) return;
  const list = Object.values(ops).sort((a, b) => b.count - a.count);
  if (list.length === 0) { el.innerHTML = '<p class="text-muted">Нет данных</p>'; return; }

  el.innerHTML = `<table class="stats-table">
    <thead><tr><th>Оператор</th><th>Заказов</th><th>Среднее время подтверждения</th></tr></thead>
    <tbody>${list.map(op => {
      const avgMs = op.withTime > 0 ? op.totalConfirmMs / op.withTime : 0;
      const avgMin = avgMs > 0 ? Math.round(avgMs / 60000) : '—';
      return `<tr><td>${escapeHtml(op.name)}</td><td>${op.count}</td><td>${avgMs > 0 ? avgMin + ' мин' : '—'}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

function renderCourierStats(orders) {
  const couriers = {};
  orders.forEach(o => {
    if (!o.courierId) return;
    const key = o.courierId;
    if (!couriers[key]) couriers[key] = { name: o.courierName || key, total: 0, delivered: 0, onTime: 0 };
    if (o.status === 'delivered') {
      couriers[key].total++;
      couriers[key].delivered++;
      if (o.estimatedDeliveryAt && o.deliveredAt) {
        if (new Date(o.deliveredAt) <= new Date(o.estimatedDeliveryAt)) couriers[key].onTime++;
      }
    } else if (o.courierId) {
      couriers[key].total++;
    }
  });

  const el = document.getElementById('stats-couriers');
  if (!el) return;
  const list = Object.values(couriers).sort((a, b) => b.delivered - a.delivered);
  if (list.length === 0) { el.innerHTML = '<p class="text-muted">Нет данных</p>'; return; }

  el.innerHTML = `<table class="stats-table">
    <thead><tr><th>Курьер</th><th>Доставок</th><th>В срок</th></tr></thead>
    <tbody>${list.map(c => {
      const onTimeRate = c.delivered > 0 ? Math.round((c.onTime / c.delivered) * 100) : 0;
      return `<tr><td>${escapeHtml(c.name)}</td><td>${c.delivered}</td><td>${c.delivered > 0 ? onTimeRate + '%' : '—'}</td></tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════════════════
async function loadSettings() {
  try {
    const settings = await dbGet('settings', 'cafe');
    STATE.cafeSettings = settings || {};
    fillSettingsForm(STATE.cafeSettings);
  } catch (e) {
    console.error('Load settings error:', e);
    toast('Ошибка загрузки настроек', 'error');
  }

  try {
    for (const role of ['admin', 'operator', 'courier']) {
      const keyDoc = await dbGet('access_keys', role);
      const el = document.getElementById(`key-current-${role}`);
      if (el) el.textContent = keyDoc?.keyHash || '—';
    }
  } catch (e) {
    console.error('Load access keys error:', e);
  }
}

function fillSettingsForm(s) {
  const toggle = document.getElementById('cafe-open-toggle');
  if (toggle) toggle.checked = !!s.isOpen;
  updateCafeToggleLabel(!!s.isOpen);

  const openTime = document.getElementById('setting-open-time');
  if (openTime) openTime.value = s.openTime || '09:00';

  const closeTime = document.getElementById('setting-close-time');
  if (closeTime) closeTime.value = s.closeTime || '22:00';

  const delivH = document.getElementById('setting-delivery-hours');
  if (delivH) delivH.value = s.deliveryHours || 0;

  const delivM = document.getElementById('setting-delivery-minutes');
  if (delivM) delivM.value = s.deliveryMinutes || 30;
}

async function toggleCafe() {
  const toggle = document.getElementById('cafe-open-toggle');
  if (!toggle) return;
  const newState = !toggle.checked;
  toggle.checked = newState;
  updateCafeToggleLabel(newState);
  try {
    await dbSet('settings', 'cafe', { ...(STATE.cafeSettings || {}), isOpen: newState });
    STATE.cafeSettings.isOpen = newState;
    toast(newState ? 'Кафе открыто' : 'Кафе закрыто', 'success');
  } catch (e) {
    toggle.checked = !newState;
    updateCafeToggleLabel(!newState);
    toast('Ошибка обновления', 'error');
  }
}

function updateCafeToggleLabel(isOpen) {
  const label = document.getElementById('cafe-status-label');
  if (label) {
    label.textContent = isOpen ? 'Кафе открыто' : 'Кафе закрыто';
    label.className = isOpen ? 'cafe-status open' : 'cafe-status closed';
  }
}

async function saveSettings() {
  const openTime = document.getElementById('setting-open-time')?.value || '09:00';
  const closeTime = document.getElementById('setting-close-time')?.value || '22:00';
  const deliveryHours = parseInt(document.getElementById('setting-delivery-hours')?.value, 10) || 0;
  const deliveryMinutes = parseInt(document.getElementById('setting-delivery-minutes')?.value, 10) || 30;
  const isOpen = document.getElementById('cafe-open-toggle')?.checked || false;

  const settingsData = { isOpen, openTime, closeTime, deliveryHours, deliveryMinutes, updatedAt: new Date().toISOString() };
  try {
    await dbSet('settings', 'cafe', settingsData);
    STATE.cafeSettings = settingsData;
    toast('Настройки сохранены', 'success');
  } catch (e) {
    console.error('Save settings error:', e);
    toast('Ошибка сохранения настроек', 'error');
  }
}

async function saveAccessKey(role) {
  const input = document.getElementById(`key-input-${role}`);
  if (!input || !input.value.trim()) {
    toast('Введите новый ключ', 'error');
    return;
  }
  const hash = md5(input.value.trim());
  try {
    await dbSet('access_keys', role, { keyHash: hash });
    const currentEl = document.getElementById(`key-current-${role}`);
    if (currentEl) currentEl.textContent = hash;
    input.value = '';
    const preview = document.getElementById(`key-preview-${role}`);
    if (preview) preview.textContent = '—';
    toast(`Ключ для роли "${role}" обновлён`, 'success');
  } catch (e) {
    console.error('Save access key error:', e);
    toast('Ошибка сохранения ключа', 'error');
  }
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
async function submitOnboarding() {
  const nameVal = document.getElementById('onboard-name')?.value.trim();
  const tosVal  = document.getElementById('onboard-tos')?.checked;
  if (!nameVal) { toast('Введите ваше имя', 'error'); return; }
  if (!tosVal)  { toast('Примите условия соглашения', 'error'); return; }

  const btn = document.getElementById('btn-onboard-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем...'; }
  try {
    await dbSet('staff_uids', STATE.uid, { name: nameVal, tosAccepted: true, tosDate: new Date().toISOString() });
    STATE.staffData = { ...STATE.staffData, name: nameVal, tosAccepted: true };
    setupMainScreen();
    showScreen('s-main');
    switchTab('menu');
  } catch (e) {
    console.error('Onboarding error:', e);
    toast('Ошибка сохранения', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Войти в систему →'; }
  }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  init();
  document.getElementById('btn-onboard-submit')?.addEventListener('click', submitOnboarding);
});
