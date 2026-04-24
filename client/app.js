'use strict';
/* ============================================================
   CLIENT APP — Delivery Mini App
   ============================================================ */

const STATE = { uid: null, user: null };
let CART    = [];      // [{id, name, price, qty, emoji}]
let MENU    = [];      // cached menu items
let SETTINGS = {};     // cafe_settings
let ACTIVE_ORDER = null;
let _orderUnsub  = null;
let _paymentMethod = 'cash';
let _intercomChecked = false;
let _pendingNotif = null; // notification to show after any user gesture

// ── Boot ──
window.addEventListener('DOMContentLoaded', async () => {
  if (new URLSearchParams(location.search).get('reset') === '1') {
    localStorage.clear(); location.replace(location.pathname); return;
  }
  tgReady();

  // Load persisted state
  try {
    const s = JSON.parse(localStorage.getItem('dlv_client_state') || '{}');
    STATE.uid  = s.uid  || null;
    STATE.user = s.user || null;
    CART = JSON.parse(localStorage.getItem('dlv_cart') || '[]');
  } catch {}

  // Read uid from URL (from bot link)
  const urlUid = readUidFromUrl();
  if (urlUid) { STATE.uid = urlUid; saveClientState(); }

  await initFirebase();

  if (!STATE.uid) { showScreen('s-no-uid'); return; }

  if (STATE.user) { initMain(); return; }

  // Check Firebase for existing profile
  const existing = await dbGet('users', STATE.uid);
  if (existing && existing.role === 'client') {
    STATE.user = existing; saveClientState(); initMain();
  } else {
    // Prefill name from Telegram or user_links
    const linkData = await dbGet('user_links', STATE.uid);
    const tgUser   = tg?.initDataUnsafe?.user;
    let name = tgUser ? (tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : '')) : '';
    if (!name && linkData?.firstName) name = linkData.firstName;
    const inp = document.getElementById('ob-name');
    if (inp && name) inp.value = name;
    showScreen('s-onboard');
  }
});

function saveClientState() {
  try { localStorage.setItem('dlv_client_state', JSON.stringify({ uid: STATE.uid, user: STATE.user })); } catch {}
}
function saveCart() {
  try { localStorage.setItem('dlv_cart', JSON.stringify(CART)); } catch {}
}

// ── Onboarding submit ──
async function onboardSubmit() {
  const name = document.getElementById('ob-name').value.trim();
  if (!name) { showToast('Введите ваше имя', 'warning'); return; }

  const btn = document.getElementById('ob-btn');
  btn.disabled = true; btn.classList.add('btn-loading');

  const linkData = await dbGet('user_links', STATE.uid);
  const phone    = linkData?.phone || '';
  const tgId     = linkData?.tgId  || '';

  STATE.user = { name, phone, tgId, role: 'client', createdAt: new Date().toISOString() };
  await dbSet('users', STATE.uid, STATE.user);
  saveClientState();

  btn.disabled = false; btn.classList.remove('btn-loading');
  initMain();
}

// ── Init main app ──
function initMain() {
  document.getElementById('main-nav').style.display = 'flex';
  startHeartbeat(STATE.uid);
  loadSettings();
  loadMenu();
  watchActiveOrder();
  showScreen('s-menu');
}

// ── Load cafe settings ──
async function loadSettings() {
  SETTINGS = (await dbGet('cafe_settings', 'main')) || {};
  updateCafeStatus();
}

function updateCafeStatus() {
  const badge  = document.getElementById('cafe-status-badge');
  const banner = document.getElementById('closed-banner');
  const isOpen = isCafeOpen();
  if (badge) {
    badge.textContent = isOpen ? '● Открыто' : '● Закрыто';
    badge.className   = isOpen ? 'badge badge-delivered' : 'badge badge-cancelled';
  }
  if (banner) banner.classList.toggle('hidden', isOpen);
}

function isCafeOpen() {
  if (!SETTINGS.workOpen || !SETTINGS.workClose) return true;
  const now  = new Date();
  const [oh, om] = SETTINGS.workOpen.split(':').map(Number);
  const [ch, cm] = SETTINGS.workClose.split(':').map(Number);
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= oh * 60 + om && mins < ch * 60 + cm;
}

// ── Load menu ──
async function loadMenu() {
  MENU = await dbGetAll('menu_items');
  MENU = MENU.filter(i => i.available !== false);
  renderCategoryTabs();
  renderMenuGrid(null);
}

function renderCategoryTabs() {
  const cats   = ['Все', ...new Set(MENU.map(i => i.category).filter(Boolean))];
  const container = document.getElementById('cat-tabs');
  container.innerHTML = cats.map((c, idx) =>
    `<button class="cat-tab${idx===0?' active':''}" onclick="filterMenu(this,'${c}')">${c}</button>`
  ).join('');
}

function filterMenu(el, cat) {
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderMenuGrid(cat === 'Все' ? null : cat);
}

function renderMenuGrid(cat) {
  const items = cat ? MENU.filter(i => i.category === cat) : MENU;
  const grid  = document.getElementById('menu-grid');
  if (!items.length) { grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><div class="empty-icon">🍽️</div><div class="empty-text">Нет блюд в этой категории</div></div>'; return; }
  grid.innerHTML = items.map(item => {
    const cartItem = CART.find(c => c.id === item.id);
    const qty      = cartItem ? cartItem.qty : 0;
    const imgHtml  = item.imageUrl
      ? `<div class="menu-card-img"><img src="${item.imageUrl}" alt="${item.name}" loading="lazy" onerror="this.parentElement.innerHTML='${item.emoji||'🍽️'}'"></div>`
      : `<div class="menu-card-img">${item.emoji || '🍽️'}</div>`;
    return `
    <div class="menu-card" id="mc-${item.id}">
      ${imgHtml}
      <div class="menu-card-body">
        <div class="menu-card-name">${item.name}</div>
        ${item.description ? `<div class="menu-card-desc">${item.description}</div>` : ''}
        <div class="qty-row">
          <div class="menu-card-price">${fmtPrice(item.price)}</div>
          <div class="qty-ctrl">
            ${qty > 0 ? `<div class="qty-btn" onclick="changeQty('${item.id}',-1)">−</div><div class="qty-num" id="qty-${item.id}">${qty}</div>` : ''}
            <div class="qty-btn add" onclick="changeQty('${item.id}',1)">+</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Cart quantity ──
function changeQty(itemId, delta) {
  tgHaptic('light');
  const menuItem = MENU.find(i => i.id === itemId);
  if (!menuItem) return;
  let cartItem = CART.find(c => c.id === itemId);
  if (!cartItem) {
    if (delta < 0) return;
    cartItem = { id: itemId, name: menuItem.name, price: menuItem.price, qty: 0, emoji: menuItem.emoji || '🍽️' };
    CART.push(cartItem);
  }
  cartItem.qty = Math.max(0, cartItem.qty + delta);
  if (cartItem.qty === 0) CART = CART.filter(c => c.id !== itemId);
  saveCart();
  updateCartUI(itemId);
  updateCartFAB();
}

function updateCartUI(itemId) {
  const menuItem = MENU.find(i => i.id === itemId);
  if (!menuItem) return;
  const cartItem = CART.find(c => c.id === itemId);
  const qty = cartItem ? cartItem.qty : 0;
  const ctrl = document.querySelector(`#mc-${itemId} .qty-ctrl`);
  if (!ctrl) return;
  ctrl.innerHTML = qty > 0
    ? `<div class="qty-btn" onclick="changeQty('${itemId}',-1)">−</div><div class="qty-num" id="qty-${itemId}">${qty}</div><div class="qty-btn add" onclick="changeQty('${itemId}',1)">+</div>`
    : `<div class="qty-btn add" onclick="changeQty('${itemId}',1)">+</div>`;
}

function updateCartFAB() {
  const fab  = document.getElementById('cart-fab');
  const info = document.getElementById('cart-fab-info');
  const total = cartTotal();
  const count = CART.reduce((s, c) => s + c.qty, 0);
  if (count > 0 && document.getElementById('s-menu').classList.contains('active')) {
    fab.classList.remove('hidden');
    info.textContent = `${count} поз. · ${fmtPrice(total)}`;
  } else {
    fab.classList.add('hidden');
  }
}

function cartTotal() { return CART.reduce((s, c) => s + c.price * c.qty, 0); }

// ── Cart screen ──
function renderCartScreen() {
  const container = document.getElementById('cart-items');
  if (!CART.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🛒</div><div class="empty-text">Корзина пуста</div></div>';
    document.getElementById('order-btn').disabled = true;
    return;
  }
  document.getElementById('order-btn').disabled = false;
  container.innerHTML = `
    <div class="card card-body" style="gap:10px;display:flex;flex-direction:column">
      ${CART.map(c => `
        <div class="flex items-center gap-2" style="justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:22px">${c.emoji}</span>
            <div>
              <div style="font-weight:600;font-size:13px">${c.name}</div>
              <div style="font-size:12px;color:var(--text-dim)">${fmtPrice(c.price)} × ${c.qty}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-weight:700;font-size:14px">${fmtPrice(c.price * c.qty)}</div>
            <button class="btn-xs btn-ghost" onclick="changeQtyCart('${c.id}',-1)">−</button>
            <span style="font-weight:700;min-width:16px;text-align:center">${c.qty}</span>
            <button class="btn-xs btn-ghost" onclick="changeQtyCart('${c.id}',1)">+</button>
          </div>
        </div>
      `).join('')}
    </div>`;
  const t = cartTotal();
  document.getElementById('cart-total-sum').textContent   = fmtPrice(t);
  document.getElementById('cart-total-final').textContent = fmtPrice(t);
}

function changeQtyCart(itemId, delta) {
  changeQty(itemId, delta);
  renderCartScreen();
}

function toggleIntercom() {
  _intercomChecked = !_intercomChecked;
  document.getElementById('intercom-icon').textContent = _intercomChecked ? '✅' : '🔔';
  document.getElementById('intercom-code-wrap').classList.toggle('hidden', !_intercomChecked);
}

function selectPayment(el) {
  document.querySelectorAll('.payment-opt').forEach(b => b.classList.remove('btn-primary'));
  el.classList.add('btn-primary');
  el.classList.remove('btn-secondary');
  _paymentMethod = el.dataset.val;
}

// ── Submit order ──
async function submitOrder() {
  if (!CART.length) { showToast('Корзина пуста', 'warning'); return; }
  if (!isCafeOpen()) { showToast('Кафе сейчас закрыто', 'warning'); return; }

  const street  = document.getElementById('addr-street').value.trim();
  const house   = document.getElementById('addr-house').value.trim();
  const apt     = document.getElementById('addr-apt').value.trim();
  const comment = document.getElementById('order-comment').value.trim();
  const code    = _intercomChecked ? document.getElementById('intercom-code').value.trim() : '';

  if (!street || !house) { showToast('Укажите улицу и дом', 'warning'); return; }

  const btn = document.getElementById('order-btn');
  btn.disabled = true; btn.textContent = 'Оформляем...';

  const orderId   = genOrderId();
  const delivMins = (SETTINGS.deliveryHours || 0) * 60 + (SETTINGS.deliveryMinutes || 60);
  const estimatedAt = new Date(Date.now() + delivMins * 60 * 1000).toISOString();

  const order = {
    id:        orderId,
    clientUid: STATE.uid,
    clientName: STATE.user?.name || '',
    clientPhone: STATE.user?.phone || '',
    clientTgId:  STATE.user?.tgId  || '',
    items:    CART.map(c => ({ id: c.id, name: c.name, price: c.price, qty: c.qty, emoji: c.emoji })),
    total:    cartTotal(),
    address:  { street, house, apt, hasIntercom: _intercomChecked, intercomCode: code },
    payment:  _paymentMethod,
    comment,
    status:    'pending',
    createdAt: new Date().toISOString(),
    estimatedAt,
    deliveryMinutes: delivMins,
    clientNotification: { type: '', seen: true }
  };

  try {
    await dbSet('orders', orderId, order);
    CART = []; saveCart();
    ACTIVE_ORDER = order;
    tgHaptic('success');
    showToast('Заказ оформлен!', 'success');
    navTo('s-order');
    renderActiveOrder();
  } catch (e) {
    showToast('Ошибка при оформлении заказа', 'error');
    console.error(e);
  }

  btn.disabled = false; btn.textContent = 'Оформить заказ';
}

// ── Watch active order ──
function watchActiveOrder() {
  if (_orderUnsub) { _orderUnsub(); _orderUnsub = null; }

  // Find latest active order
  dbQuery('orders', 'clientUid', '==', STATE.uid).then(orders => {
    const active = orders.filter(o => !['delivered','cancelled'].includes(o.status))
                         .sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
    if (active.length) {
      ACTIVE_ORDER = active[0];
      subscribeOrder(ACTIVE_ORDER.id);
      updateOrderNavBadge(true);
      renderActiveOrder();
    }
  });
}

function subscribeOrder(orderId) {
  if (_orderUnsub) _orderUnsub();
  _orderUnsub = onDocSnap('orders', orderId, order => {
    if (!order) return;
    ACTIVE_ORDER = order;
    renderActiveOrder();
    updateOrderNavBadge(!['delivered','cancelled'].includes(order.status));

    // Handle client notifications
    if (order.clientNotification && !order.clientNotification.seen) {
      showClientNotification(order);
    }

    // Delivered/cancelled → unsubscribe after showing notif
    if (['delivered','cancelled'].includes(order.status)) {
      setTimeout(() => { if (_orderUnsub) { _orderUnsub(); _orderUnsub = null; } }, 5000);
    }
  });
}

function showClientNotification(order) {
  const type = order.clientNotification.type;
  const notifId = type === 'accepted' ? 'notif-accepted'
                : type === 'cancelled' ? 'notif-cancelled'
                : type === 'delivered' ? 'notif-delivered' : null;
  if (!notifId) return;

  if (type === 'accepted') {
    const mins = order.deliveryMinutes || 60;
    const h = Math.floor(mins / 60), m = mins % 60;
    const timeStr = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    document.getElementById('notif-accepted-text').textContent =
      `Ваш заказ принят в работу! Ожидайте доставку в течение ${timeStr}.`;
  }

  tgHaptic('heavy');
  playAlert();
  document.getElementById(notifId).classList.add('open');

  // Mark notification as seen
  dbSet('orders', order.id, { clientNotification: { ...order.clientNotification, seen: true } });
}

function closeNotif(id) {
  document.getElementById(id).classList.remove('open');
  tgHaptic('light');
}

// ── Render active order ──
function renderActiveOrder() {
  if (!ACTIVE_ORDER) return;
  const o = ACTIVE_ORDER;

  // Status badge
  const badge = document.getElementById('order-status-badge');
  badge.textContent = statusLabel(o.status);
  badge.className   = statusBadgeClass(o.status);

  // Status track
  const steps = [
    { key:'pending',    icon:'🕐', label:'Принят' },
    { key:'cooking',    icon:'👨‍🍳', label:'Готовится' },
    { key:'delivering', icon:'🚴', label:'В пути' },
    { key:'delivered',  icon:'✅', label:'Доставлен' }
  ];
  if (o.status === 'cancelled') {
    document.getElementById('status-track').innerHTML = '<div style="color:var(--danger);font-weight:600;font-size:14px;text-align:center;width:100%">❌ Заказ отменён</div>';
  } else {
    const si = steps.findIndex(s => s.key === o.status);
    const actualIdx = si < 0 ? 0 : si;
    document.getElementById('status-track').innerHTML = steps.map((s, i) => {
      const cls = i < actualIdx ? 'done' : i === actualIdx ? 'active' : '';
      const lineClass = i < actualIdx ? 'done' : i === actualIdx ? 'active' : '';
      return `
        <div class="st-step ${cls}"><div class="st-dot">${cls === 'done' ? '✓' : s.icon}</div><div style="margin-top:4px">${s.label}</div></div>
        ${i < steps.length - 1 ? `<div class="st-line ${lineClass}"></div>` : ''}
      `;
    }).join('');
  }

  // Countdown
  const cdWrap = document.getElementById('countdown-wrap');
  if (o.estimatedAt && !['delivered','cancelled'].includes(o.status)) {
    cdWrap.style.display = 'block';
    updateCountdown(o.estimatedAt);
  } else {
    cdWrap.style.display = 'none';
  }

  // Items
  document.getElementById('active-order-id').textContent  = '#' + (o.id || '').slice(-6);
  document.getElementById('active-order-total').textContent = fmtPrice(o.total);
  document.getElementById('active-order-payment').textContent = o.payment === 'cash' ? '💵 Наличные' : '💳 Карта';
  const addr = o.address;
  document.getElementById('active-order-addr').textContent =
    addr ? `${addr.street} ${addr.house}${addr.apt ? ', кв. ' + addr.apt : ''}` : '—';
  document.getElementById('active-order-items').innerHTML = (o.items || []).map(it =>
    `<div class="flex justify-between" style="font-size:13px;margin-bottom:6px">
       <span>${it.emoji || '🍽️'} ${it.name} ×${it.qty}</span>
       <span class="font-bold">${fmtPrice(it.price * it.qty)}</span>
     </div>`
  ).join('');

  // Info text
  const infoEl = document.getElementById('order-info-txt');
  const infoMap = {
    pending:    'ℹ️ Ваш заказ ожидает подтверждения оператором.',
    accepted:   '👨‍🍳 Ваш заказ подтверждён и готовится.',
    cooking:    '👨‍🍳 Ваш заказ готовится.',
    delivering: '🚴 Курьер уже везёт ваш заказ!',
    delivered:  '✅ Заказ доставлен. Приятного аппетита!',
    cancelled:  '❌ Заказ отменён. Оператор свяжется с вами.'
  };
  infoEl.textContent = infoMap[o.status] || '';
  infoEl.className   = `alert-box ${['delivered'].includes(o.status)?'success':o.status==='cancelled'?'danger':'info'}`;
}

let _cdInterval = null;
function updateCountdown(estimatedAt) {
  if (_cdInterval) clearInterval(_cdInterval);
  const target = new Date(estimatedAt).getTime();
  const orderTime = ACTIVE_ORDER?.createdAt ? new Date(ACTIVE_ORDER.createdAt).getTime() : target - 60 * 60 * 1000;
  const total = target - orderTime;

  const tick = () => {
    const remaining = target - Date.now();
    const val = document.getElementById('countdown-val');
    const bar = document.getElementById('countdown-bar');
    if (!val || !bar) { clearInterval(_cdInterval); return; }
    if (remaining <= 0) {
      val.textContent = 'Совсем скоро!';
      val.classList.add('urgent');
      bar.style.width = '0%';
      clearInterval(_cdInterval);
      return;
    }
    val.textContent = fmtCountdown(remaining);
    val.classList.toggle('urgent', remaining < 5 * 60 * 1000);
    bar.style.width = Math.max(0, (remaining / total) * 100) + '%';
    bar.classList.toggle('urgent', remaining < 5 * 60 * 1000);
  };
  tick();
  _cdInterval = setInterval(tick, 1000);
}

// ── History ──
async function loadHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  const orders = await dbQueryOrdered('orders', 'clientUid', '==', STATE.uid, 'createdAt', 'desc', 50);
  if (!orders.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Заказов ещё нет</div></div>';
    return;
  }
  container.innerHTML = orders.map(o => `
    <div class="order-card" style="cursor:pointer" onclick="showOrderDetail('${o.id}')">
      <div class="order-card-hdr">
        <div>
          <div class="font-bold" style="font-size:14px">${fmtDate(o.createdAt)}</div>
          <div class="order-id">#${(o.id||'').slice(-6)}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
          <span class="order-total">${fmtPrice(o.total)}</span>
        </div>
      </div>
      <div class="order-card-body">
        <div class="text-sm text-dim">${(o.items||[]).map(i=>`${i.emoji||'🍽️'} ${i.name} ×${i.qty}`).join(', ')}</div>
      </div>
      ${['delivered','cancelled'].includes(o.status)?'':`<div class="order-card-foot"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();repeatOrder('${o.id}')">🔄 Повторить</button></div>`}
    </div>
  `).join('');
}

function showOrderDetail(orderId) {
  const o = ACTIVE_ORDER?.id === orderId ? ACTIVE_ORDER : null;
  if (!o) return;
  navTo('s-order');
  setNav(document.getElementById('nav-order'));
}

async function repeatOrder(orderId) {
  const orders = await dbQuery('orders', 'clientUid', '==', STATE.uid);
  const o = orders.find(x => x.id === orderId);
  if (!o) return;

  // Re-add items with current prices
  CART = [];
  for (const item of (o.items || [])) {
    const current = MENU.find(m => m.id === item.id);
    const price   = current ? current.price : item.price;
    CART.push({ id: item.id, name: item.name, price, qty: item.qty, emoji: item.emoji || '🍽️' });
  }
  saveCart();

  // Pre-fill address
  if (o.address) {
    document.getElementById('addr-street').value = o.address.street || '';
    document.getElementById('addr-house').value  = o.address.house  || '';
    document.getElementById('addr-apt').value    = o.address.apt    || '';
  }
  if (o.payment === 'card') {
    document.querySelectorAll('.payment-opt').forEach(b => {
      b.classList.remove('btn-primary');
      if (b.dataset.val === 'card') b.classList.add('btn-primary');
    });
    _paymentMethod = 'card';
  }

  navTo('s-cart');
  renderCartScreen();
  showToast('Заказ добавлен в корзину', 'success');
}

// ── Navigation ──
function navTo(screenId) {
  showScreen(screenId);
  document.getElementById('cart-fab').classList.add('hidden');
  if (screenId === 's-menu') {
    renderMenuGrid(null);
    updateCartFAB();
  }
  if (screenId === 's-cart') renderCartScreen();
  if (screenId === 's-order') renderActiveOrder();
}

function navToOrder() {
  if (ACTIVE_ORDER && !['delivered','cancelled'].includes(ACTIVE_ORDER.status)) {
    navTo('s-order');
    setNav(document.getElementById('nav-order'));
  } else {
    navTo('s-history');
    setNav(document.getElementById('nav-hist'));
    loadHistory();
  }
}

function setNav(el) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

function updateOrderNavBadge(hasActive) {
  document.getElementById('order-nav-badge').classList.toggle('hidden', !hasActive);
}
