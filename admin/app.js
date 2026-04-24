'use strict';
/* ============================================================
   ADMIN APP
   ============================================================ */

const STATE = { uid: null, user: null };
let MENU_ITEMS  = [];
let ALL_ORDERS  = [];
let CATEGORIES  = [];
let _editItemId = null;
let _unsubOrders = null;

// ── Boot ──
window.addEventListener('DOMContentLoaded', async () => {
  tgReady();
  try {
    const s = JSON.parse(localStorage.getItem('dlv_admin_state') || '{}');
    STATE.uid = s.uid || null; STATE.user = s.user || null;
  } catch {}

  const urlUid = readUidFromUrl();
  if (urlUid) { STATE.uid = urlUid; saveAdminState(); }

  initFirebase();
  await new Promise(r => setTimeout(r, 800));

  if (!STATE.uid) { showScreen('s-no-access'); return; }

  const user = await dbGet('users', STATE.uid);
  if (!user || user.role !== 'admin') { showScreen('s-no-access'); return; }

  STATE.user = user; saveAdminState();
  initMain();
});

function saveAdminState() {
  try { localStorage.setItem('dlv_admin_state', JSON.stringify({ uid: STATE.uid, user: STATE.user })); } catch {}
}

function initMain() {
  document.getElementById('main-nav').style.display = 'flex';
  startHeartbeat(STATE.uid);
  loadMenuItems();
  watchNewOrders();
  setAdminTab('s-menu', document.getElementById('nav-menu'));
}

function setAdminTab(screenId, el) {
  showScreen(screenId);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════
// MENU MANAGEMENT
// ══════════════════════════════════════════════════════════

async function loadMenuItems() {
  MENU_ITEMS = await dbGetAll('menu_items', 'name', 'asc', 500);
  renderMenuAdminList();
}

function renderMenuAdminList() {
  const container = document.getElementById('menu-admin-list');
  if (!MENU_ITEMS.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🍽️</div><div class="empty-text">Меню пусто. Добавьте первое блюдо!</div></div>';
    return;
  }
  // Group by category
  const byCat = {};
  MENU_ITEMS.forEach(item => {
    const cat = item.category || 'Без категории';
    if (!byCat[cat]) byCat[cat] = [];
    byCat[cat].push(item);
  });
  container.innerHTML = Object.entries(byCat).map(([cat, items]) => `
    <div class="section">
      <div class="section-title">${cat}</div>
      ${items.map(item => `
        <div class="admin-item">
          <div class="admin-item-img">
            ${item.imageUrl ? `<img src="${item.imageUrl}" onerror="this.parentElement.textContent='${item.emoji||'🍽️'}'" alt="">` : (item.emoji || '🍽️')}
          </div>
          <div class="admin-item-body">
            <div class="admin-item-name">${item.name} ${item.available===false?'<span class="badge badge-cancelled" style="font-size:10px">недоступно</span>':''}</div>
            <div class="admin-item-price">${fmtPrice(item.price)}</div>
            ${item.description ? `<div class="text-xs text-dim" style="margin-top:2px">${item.description}</div>` : ''}
          </div>
          <div class="admin-item-actions">
            <button class="btn-xs btn-secondary" onclick="openEditItem('${item.id}')">✏️</button>
          </div>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function openAddItem() {
  _editItemId = null;
  document.getElementById('item-sheet-title').textContent = 'Новое блюдо';
  document.getElementById('item-name').value = '';
  document.getElementById('item-desc').value = '';
  document.getElementById('item-price').value = '';
  document.getElementById('item-emoji').value = '🍽️';
  document.getElementById('item-img').value = '';
  document.getElementById('item-available').checked = true;
  document.getElementById('item-delete-btn').classList.add('hidden');
  populateCatSelect();
  document.getElementById('item-sheet-overlay').classList.add('open');
}

function openEditItem(itemId) {
  _editItemId = itemId;
  const item = MENU_ITEMS.find(i => i.id === itemId);
  if (!item) return;
  document.getElementById('item-sheet-title').textContent = 'Редактировать';
  document.getElementById('item-name').value  = item.name || '';
  document.getElementById('item-desc').value  = item.description || '';
  document.getElementById('item-price').value = item.price || '';
  document.getElementById('item-emoji').value = item.emoji || '🍽️';
  document.getElementById('item-img').value   = item.imageUrl || '';
  document.getElementById('item-available').checked = item.available !== false;
  document.getElementById('item-delete-btn').classList.remove('hidden');
  populateCatSelect(item.category);
  document.getElementById('item-sheet-overlay').classList.add('open');
}

function populateCatSelect(selected = '') {
  const sel = document.getElementById('item-cat');
  sel.innerHTML = '<option value="">Без категории</option>' +
    CATEGORIES.map(c => `<option value="${c}" ${c===selected?'selected':''}>${c}</option>`).join('');
}

function closeItemSheet() {
  document.getElementById('item-sheet-overlay').classList.remove('open');
}

async function saveItem() {
  const name  = document.getElementById('item-name').value.trim();
  const price = parseFloat(document.getElementById('item-price').value);
  if (!name || isNaN(price) || price <= 0) { showToast('Укажите название и цену', 'warning'); return; }

  const itemId   = _editItemId || ('item_' + Date.now().toString(36));
  const itemData = {
    id:          itemId,
    name,
    description: document.getElementById('item-desc').value.trim(),
    price,
    category:    document.getElementById('item-cat').value || '',
    emoji:       document.getElementById('item-emoji').value.trim() || '🍽️',
    imageUrl:    document.getElementById('item-img').value.trim(),
    available:   document.getElementById('item-available').checked
  };

  await dbSet('menu_items', itemId, itemData);
  showToast(_editItemId ? 'Блюдо обновлено' : 'Блюдо добавлено', 'success');
  closeItemSheet();
  await loadMenuItems();
}

async function deleteItem() {
  if (!_editItemId) return;
  if (!confirm('Удалить это блюдо из меню?')) return;
  await dbDelete('menu_items', _editItemId);
  showToast('Блюдо удалено', 'success');
  closeItemSheet();
  await loadMenuItems();
}

// ══════════════════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════════════════

function watchNewOrders() {
  _unsubOrders = onQuerySnap('orders', 'status', '==', 'pending', orders => {
    const badge = document.getElementById('new-orders-badge');
    if (orders.length > 0) {
      badge.textContent = orders.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

async function loadAllOrders(filter = 'all') {
  const container = document.getElementById('orders-list');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  ALL_ORDERS = await dbGetAll('orders', 'createdAt', 'desc', 200);

  const activeStatuses = ['pending','accepted','cooking','delivering'];
  let filtered = ALL_ORDERS;
  if (filter === 'pending')   filtered = ALL_ORDERS.filter(o => o.status === 'pending');
  else if (filter === 'active') filtered = ALL_ORDERS.filter(o => activeStatuses.includes(o.status));
  else if (filter === 'delivered') filtered = ALL_ORDERS.filter(o => o.status === 'delivered');
  else if (filter === 'cancelled') filtered = ALL_ORDERS.filter(o => o.status === 'cancelled');

  if (!filtered.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Нет заказов</div></div>';
    return;
  }

  container.innerHTML = filtered.map(o => `
    <div class="order-card" style="cursor:pointer" onclick="showOrderDetail('${o.id}')">
      <div class="order-card-hdr">
        <div>
          <div class="font-bold text-sm">${fmtDate(o.createdAt)}</div>
          <div class="order-id">#${(o.id||'').slice(-6)} · ${o.clientName||'Клиент'}</div>
        </div>
        <div style="text-align:right">
          <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
          <div class="order-total" style="font-size:16px;margin-top:4px">${fmtPrice(o.total)}</div>
        </div>
      </div>
      <div class="order-card-body">
        <div class="order-row"><span class="order-row-icon">📍</span><span class="text-dim text-sm">${o.address ? o.address.street + ' ' + o.address.house : '—'}</span></div>
        <div class="order-row"><span class="order-row-icon">🍽️</span><span class="text-dim text-sm">${(o.items||[]).map(i=>i.name).join(', ')}</span></div>
        ${o.operatorUid ? `<div class="order-row"><span class="order-row-icon">👤</span><span class="text-dim text-sm">Оператор: ${o.operatorName||'—'} в ${fmtTime(o.acceptedAt)}</span></div>` : ''}
        ${o.courierUid  ? `<div class="order-row"><span class="order-row-icon">🚴</span><span class="text-dim text-sm">Курьер: ${o.courierName||'—'} в ${fmtTime(o.sentToCourierAt)}</span></div>` : ''}
        ${o.deliveredAt ? `<div class="order-row"><span class="order-row-icon">✅</span><span class="text-dim text-sm">Доставлен в ${fmtTime(o.deliveredAt)}</span></div>` : ''}
      </div>
    </div>
  `).join('');
}

function filterOrders(val) { loadAllOrders(val); }

function showOrderDetail(orderId) {
  const o = ALL_ORDERS.find(x => x.id === orderId);
  if (!o) return;
  const addr = o.address || {};
  document.getElementById('order-detail-content').innerHTML = `
    <div class="section-title">Заказ #${(o.id||'').slice(-6)}</div>
    <div style="margin:12px 0;display:flex;flex-direction:column;gap:8px">
      <div class="order-row"><span class="order-row-icon">👤</span><b>${o.clientName||'—'}</b> ${o.clientPhone ? '· ' + o.clientPhone : ''}</div>
      <div class="order-row"><span class="order-row-icon">📍</span>${addr.street||''} ${addr.house||''}, кв.${addr.apt||'—'} ${addr.hasIntercom?'(домофон: '+(addr.intercomCode||'есть')+')':''}</div>
      <div class="order-row"><span class="order-row-icon">💳</span>${o.payment==='cash'?'Наличные':'Карта'}</div>
      ${o.comment ? `<div class="order-row"><span class="order-row-icon">💬</span>${o.comment}</div>` : ''}
      <div class="order-row"><span class="order-row-icon">🕐</span>${fmtDate(o.createdAt)}</div>
      ${o.acceptedAt ? `<div class="order-row"><span class="order-row-icon">✅</span>Принят: ${fmtDate(o.acceptedAt)} (${o.operatorName||'—'})</div>` : ''}
      ${o.sentToCourierAt ? `<div class="order-row"><span class="order-row-icon">🚴</span>Передан курьеру: ${fmtDate(o.sentToCourierAt)} (${o.courierName||'—'})</div>` : ''}
      ${o.deliveredAt ? `<div class="order-row"><span class="order-row-icon">📦</span>Доставлен: ${fmtDate(o.deliveredAt)}</div>` : ''}
    </div>
    <div class="separator"></div>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:6px">
      ${(o.items||[]).map(it=>`
        <div class="flex justify-between text-sm">
          <span>${it.emoji||'🍽️'} ${it.name} ×${it.qty}</span>
          <span class="font-bold">${fmtPrice(it.price*it.qty)}</span>
        </div>`).join('')}
      <div class="separator" style="margin:8px 0"></div>
      <div class="flex justify-between font-bold"><span>Итого</span><span class="text-primary">${fmtPrice(o.total)}</span></div>
    </div>
  `;
  document.getElementById('order-detail-overlay').classList.add('open');
}

// ══════════════════════════════════════════════════════════
// STATISTICS
// ══════════════════════════════════════════════════════════

async function loadStats() {
  const orders = await dbGetAll('orders', 'createdAt', 'desc', 1000);
  const delivered = orders.filter(o => o.status === 'delivered');
  const cancelled = orders.filter(o => o.status === 'cancelled');
  const revenue   = delivered.reduce((s, o) => s + (o.total || 0), 0);

  document.getElementById('st-total').textContent     = orders.length;
  document.getElementById('st-delivered').textContent = delivered.length;
  document.getElementById('st-cancelled').textContent = cancelled.length;
  document.getElementById('st-revenue').textContent   = fmtPrice(revenue);

  // Top items
  const itemMap = {};
  delivered.forEach(o => (o.items||[]).forEach(it => {
    if (!itemMap[it.name]) itemMap[it.name] = { count: 0, revenue: 0 };
    itemMap[it.name].count   += it.qty;
    itemMap[it.name].revenue += it.qty * it.price;
  }));
  const topItems = Object.entries(itemMap).sort((a,b) => b[1].count - a[1].count).slice(0, 5);
  document.getElementById('st-top-items').innerHTML = topItems.length
    ? topItems.map(([name, d]) => `<div class="flex justify-between text-sm" style="margin-bottom:6px"><span>${name}</span><span class="font-bold">${d.count} шт · ${fmtPrice(d.revenue)}</span></div>`).join('')
    : '<div class="text-dim text-sm">Нет данных</div>';

  // Operators
  const opMap = {};
  orders.forEach(o => { if (o.operatorName) { if (!opMap[o.operatorName]) opMap[o.operatorName] = 0; opMap[o.operatorName]++; } });
  document.getElementById('st-operators').innerHTML = Object.entries(opMap).length
    ? Object.entries(opMap).map(([n,c]) => `<div class="flex justify-between text-sm" style="margin-bottom:5px"><span>${n}</span><span class="font-bold">${c} заказов</span></div>`).join('')
    : '<div class="text-dim text-sm">Нет данных</div>';

  // Couriers
  const coMap = {};
  orders.forEach(o => { if (o.courierName) { if (!coMap[o.courierName]) coMap[o.courierName] = 0; coMap[o.courierName]++; } });
  document.getElementById('st-couriers').innerHTML = Object.entries(coMap).length
    ? Object.entries(coMap).map(([n,c]) => `<div class="flex justify-between text-sm" style="margin-bottom:5px"><span>${n}</span><span class="font-bold">${c} доставок</span></div>`).join('')
    : '<div class="text-dim text-sm">Нет данных</div>';
}

// ══════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════

async function loadSettings() {
  const s = await dbGet('cafe_settings', 'main') || {};
  document.getElementById('set-open').checked      = s.isOpen !== false;
  document.getElementById('set-open-time').value   = s.workOpen  || '10:00';
  document.getElementById('set-close-time').value  = s.workClose || '22:00';
  document.getElementById('set-deliv-h').value     = s.deliveryHours   || 1;
  document.getElementById('set-deliv-m').value     = s.deliveryMinutes || 0;
  CATEGORIES = s.categories || [];
  renderCategories();
}

async function saveSetting() {
  const data = {
    isOpen:          document.getElementById('set-open').checked,
    workOpen:        document.getElementById('set-open-time').value,
    workClose:       document.getElementById('set-close-time').value,
    deliveryHours:   parseInt(document.getElementById('set-deliv-h').value) || 0,
    deliveryMinutes: parseInt(document.getElementById('set-deliv-m').value) || 0,
    deliveryTime: `${document.getElementById('set-deliv-h').value}:${String(document.getElementById('set-deliv-m').value).padStart(2,'0')}`,
    categories: CATEGORIES
  };
  await dbSet('cafe_settings', 'main', data);
  showToast('Настройки сохранены', 'success');
}

function renderCategories() {
  document.getElementById('cat-list').innerHTML = CATEGORIES.map((c, i) => `
    <div class="flex items-center gap-2" style="margin-bottom:6px">
      <div class="inp" style="flex:1;padding:8px 12px;font-size:13px">${c}</div>
      <button class="btn-xs btn-danger" onclick="removeCategory(${i})">✕</button>
    </div>`).join('');
}

function addCategory() {
  const val = document.getElementById('new-cat').value.trim();
  if (!val || CATEGORIES.includes(val)) return;
  CATEGORIES.push(val);
  document.getElementById('new-cat').value = '';
  renderCategories();
  saveSetting();
}

function removeCategory(idx) {
  CATEGORIES.splice(idx, 1);
  renderCategories();
  saveSetting();
}
