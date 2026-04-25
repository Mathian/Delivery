'use strict';
/* ============================================================
   CLIENT APP — Delivery Mini App
   ============================================================ */

const STATE = { uid: null, user: null };
let CART     = [];   // [{cartKey, id, variantName, name, price, qty, emoji}]
let MENU     = [];   // cached menu items
let SETTINGS = {};   // cafe_settings
let ACTIVE_ORDERS  = [];   // все активные заказы клиента (макс 3)
let _ordersUnsub   = null;
let _shownNotifs   = new Set(); // ключи уже показанных уведомлений
let _cdIntervals   = {};        // {orderId: intervalId}
let _paymentMethod  = 'cash';
let _deliveryType   = 'delivery';
let _intercomChecked = false;

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
    CART = JSON.parse(localStorage.getItem('dlv_cart') || '[]')
      .map(c => ({ ...c, cartKey: c.cartKey || (c.variantName ? `${c.id}::${c.variantName}` : c.id) }));
  } catch {}

  // Read uid from URL (from bot link)
  const urlUid = readUidFromUrl();
  if (urlUid) { STATE.uid = urlUid; saveClientState(); }

  await initFirebase();

  // Последний резерв: найти uid через Telegram ID (uid_index)
  if (!STATE.uid) {
    const tgUid = await resolveUidByTgId();
    if (tgUid) { STATE.uid = tgUid; saveClientState(); }
  }

  if (!STATE.uid) { showScreen('s-no-uid'); return; }

  if (STATE.user) { initMain(); return; }

  // Check Firebase for existing profile
  const existing = await dbGet('users', STATE.uid);
  if (existing && existing.role === 'client') {
    if (existing.blocked) { showScreen('s-blocked'); return; }
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
  watchActiveOrders();
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
    const imgHtml = item.imageUrl
      ? `<div class="menu-card-img"><img src="${item.imageUrl}" alt="${item.name}" loading="lazy" onerror="this.parentElement.innerHTML='${item.emoji||'🍽️'}'"></div>`
      : `<div class="menu-card-img">${item.emoji || '🍽️'}</div>`;

    if (item.variants && item.variants.length > 0) {
      // Товар с вариантами/размерами
      const variantRows = item.variants.map(v => {
        const key = `${item.id}::${v.name}`;
        const qty = (CART.find(c => c.cartKey === key) || {qty:0}).qty;
        return `
          <div class="variant-row" id="vr-${key.replace(/[^a-zA-Z0-9_]/g,'_')}">
            <span class="variant-name">${v.name}</span>
            <div style="display:flex;align-items:center;gap:4px">
              <span class="variant-price">${fmtPrice(v.price)}</span>
              <div class="qty-ctrl">
                ${qty>0?`<div class="qty-btn" onclick="changeQty('${item.id}',-1,'${v.name}')">−</div><div class="qty-num">${qty}</div>`:''}
                <div class="qty-btn add" onclick="changeQty('${item.id}',1,'${v.name}')">+</div>
              </div>
            </div>
          </div>`;
      }).join('');
      return `
        <div class="menu-card menu-card-wide" id="mc-${item.id}">
          ${imgHtml}
          <div class="menu-card-body">
            <div class="menu-card-name">${item.name}</div>
            ${item.description ? `<div class="menu-card-desc">${item.description}</div>` : ''}
            <div class="variants-container">${variantRows}</div>
          </div>
        </div>`;
    } else {
      // Обычный товар
      const cartItem = CART.find(c => c.cartKey === item.id || (c.id === item.id && !c.variantName));
      const qty = cartItem ? cartItem.qty : 0;
      return `
        <div class="menu-card" id="mc-${item.id}">
          ${imgHtml}
          <div class="menu-card-body">
            <div class="menu-card-name">${item.name}</div>
            ${item.description ? `<div class="menu-card-desc">${item.description}</div>` : ''}
            <div class="qty-row">
              <div class="menu-card-price">${fmtPrice(item.price)}</div>
              <div class="qty-ctrl">
                ${qty>0?`<div class="qty-btn" onclick="changeQty('${item.id}',-1)">−</div><div class="qty-num" id="qty-${item.id}">${qty}</div>`:''}
                <div class="qty-btn add" onclick="changeQty('${item.id}',1)">+</div>
              </div>
            </div>
          </div>
        </div>`;
    }
  }).join('');
}

// ── Cart quantity ──
function changeQty(itemId, delta, variantName = null) {
  tgHaptic('light');
  const menuItem = MENU.find(i => i.id === itemId);
  if (!menuItem) return;
  const key = variantName ? `${itemId}::${variantName}` : itemId;
  let cartItem = CART.find(c => c.cartKey === key);
  if (!cartItem) {
    if (delta < 0) return;
    const price = variantName
      ? (menuItem.variants?.find(v => v.name === variantName)?.price ?? menuItem.price)
      : menuItem.price;
    const name  = variantName ? `${menuItem.name} (${variantName})` : menuItem.name;
    cartItem = { cartKey: key, id: itemId, variantName: variantName||null, name, price, qty: 0, emoji: menuItem.emoji || '🍽️' };
    CART.push(cartItem);
  }
  cartItem.qty = Math.max(0, cartItem.qty + delta);
  if (cartItem.qty === 0) CART = CART.filter(c => c.cartKey !== key);
  saveCart();
  updateCartUI(itemId);
  updateCartFAB();
}

function updateCartUI(itemId) {
  const menuItem = MENU.find(i => i.id === itemId);
  if (!menuItem) return;
  if (menuItem.variants && menuItem.variants.length > 0) {
    menuItem.variants.forEach(v => {
      const key = `${itemId}::${v.name}`;
      const qty = (CART.find(c => c.cartKey === key) || {qty:0}).qty;
      const safeId = key.replace(/[^a-zA-Z0-9_]/g,'_');
      const row = document.getElementById(`vr-${safeId}`);
      if (!row) return;
      const ctrl = row.querySelector('.qty-ctrl');
      if (!ctrl) return;
      ctrl.innerHTML = qty > 0
        ? `<div class="qty-btn" onclick="changeQty('${itemId}',-1,'${v.name}')">−</div><div class="qty-num">${qty}</div><div class="qty-btn add" onclick="changeQty('${itemId}',1,'${v.name}')">+</div>`
        : `<div class="qty-btn add" onclick="changeQty('${itemId}',1,'${v.name}')">+</div>`;
    });
  } else {
    const cartItem = CART.find(c => c.cartKey === itemId || (c.id === itemId && !c.variantName));
    const qty = cartItem ? cartItem.qty : 0;
    const ctrl = document.querySelector(`#mc-${itemId} .qty-ctrl`);
    if (!ctrl) return;
    ctrl.innerHTML = qty > 0
      ? `<div class="qty-btn" onclick="changeQty('${itemId}',-1)">−</div><div class="qty-num" id="qty-${itemId}">${qty}</div><div class="qty-btn add" onclick="changeQty('${itemId}',1)">+</div>`
      : `<div class="qty-btn add" onclick="changeQty('${itemId}',1)">+</div>`;
  }
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
      ${CART.map(c => {
        const key = c.cartKey || c.id;
        return `
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
            <button class="btn-xs btn-ghost" onclick="changeQtyCart('${key}',-1)">−</button>
            <span style="font-weight:700;min-width:16px;text-align:center">${c.qty}</span>
            <button class="btn-xs btn-ghost" onclick="changeQtyCart('${key}',1)">+</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  const t = cartTotal();
  document.getElementById('cart-total-sum').textContent   = fmtPrice(t);
  document.getElementById('cart-total-final').textContent = fmtPrice(t);
}

function changeQtyCart(key, delta) {
  const cartItem = CART.find(c => (c.cartKey||c.id) === key);
  if (!cartItem) return;
  changeQty(cartItem.id, delta, cartItem.variantName || null);
  renderCartScreen();
}

function toggleIntercom() {
  _intercomChecked = !_intercomChecked;
  document.getElementById('intercom-icon').textContent = _intercomChecked ? '✅' : '🔔';
  document.getElementById('intercom-code-wrap').classList.toggle('hidden', !_intercomChecked);
}

function selectDeliveryType(el) {
  _deliveryType = el.dataset.val;
  document.querySelectorAll('.delivery-type-btn').forEach(b => {
    b.classList.toggle('btn-primary',   b.dataset.val === _deliveryType);
    b.classList.toggle('btn-secondary', b.dataset.val !== _deliveryType);
  });
  const isPickup = _deliveryType === 'pickup';
  document.getElementById('address-section').classList.toggle('hidden', isPickup);
  document.getElementById('pickup-info').classList.toggle('hidden', !isPickup);
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
  if (ACTIVE_ORDERS.length >= 3) {
    showToast('У вас уже 3 активных заказа. Дождитесь доставки хотя бы одного.', 'warning');
    return;
  }

  const isPickup = _deliveryType === 'pickup';
  const street  = document.getElementById('addr-street').value.trim();
  const house   = document.getElementById('addr-house').value.trim();
  const apt     = document.getElementById('addr-apt').value.trim();
  const comment = document.getElementById('order-comment').value.trim();
  const code    = _intercomChecked ? document.getElementById('intercom-code').value.trim() : '';

  if (!isPickup && (!street || !house)) { showToast('Укажите улицу и дом', 'warning'); return; }

  const btn = document.getElementById('order-btn');
  btn.disabled = true; btn.textContent = 'Оформляем...';

  const orderId = genOrderId();

  const order = {
    id:          orderId,
    clientUid:   STATE.uid,
    clientName:  STATE.user?.name  || '',
    clientPhone: STATE.user?.phone || '',
    clientTgId:  STATE.user?.tgId  || '',
    items:       CART.map(c => ({ id: c.id, name: c.name, price: c.price, qty: c.qty, emoji: c.emoji })),
    total:       cartTotal(),
    address:     isPickup ? null : { street, house, apt, hasIntercom: _intercomChecked, intercomCode: code },
    payment:     _paymentMethod,
    deliveryType: _deliveryType,
    comment,
    status:      'pending',
    createdAt:   new Date().toISOString(),
    // estimatedAt/deliveryMinutes set by operator on acceptance
    clientNotification: { type: '', seen: true }
  };

  try {
    await dbSet('orders', orderId, order);
    CART = []; saveCart();
    tgHaptic('success');
    showToast('Заказ оформлен!', 'success');
    navTo('s-order');
    setNav(document.getElementById('nav-order'));
  } catch (e) {
    showToast('Ошибка при оформлении заказа', 'error');
    console.error(e);
  }

  btn.disabled = false; btn.textContent = 'Оформить заказ';
}

// ── Watch all active orders (real-time) ──
function watchActiveOrders() {
  if (_ordersUnsub) { _ordersUnsub(); _ordersUnsub = null; }
  _ordersUnsub = onQuerySnap('orders', 'clientUid', '==', STATE.uid, orders => {
    ACTIVE_ORDERS = orders
      .filter(o => !['delivered','cancelled'].includes(o.status))
      .sort((a, b) => (b.createdAt||'').localeCompare(a.createdAt||''));

    updateOrderNavBadge(ACTIVE_ORDERS.length > 0);

    // Show unseen notifications (dedup by orderId+type)
    orders.forEach(o => {
      if (o.clientNotification && !o.clientNotification.seen) {
        const key = `${o.id}:${o.clientNotification.type}`;
        if (!_shownNotifs.has(key)) {
          _shownNotifs.add(key);
          showClientNotification(o);
        }
      }
    });

    // Refresh order screen if open
    if (document.getElementById('s-order').classList.contains('active')) {
      renderAllActiveOrders();
    }
  });
}

function showClientNotification(order) {
  const type = order.clientNotification.type;
  const notifId = type === 'accepted'   ? 'notif-accepted'
                : type === 'cancelled'  ? 'notif-cancelled'
                : type === 'delivered'  ? 'notif-delivered'
                : type === 'delivering' ? 'notif-delivering' : null;
  if (!notifId) return;

  if (type === 'accepted') {
    const mins = order.deliveryMinutes || 60;
    const h = Math.floor(mins / 60), m = mins % 60;
    const timeStr = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
    const el = document.getElementById('notif-accepted-text');
    if (el) el.textContent = order.deliveryType === 'pickup'
      ? `Заказ принят! Он будет готов примерно через ${timeStr}.`
      : `Заказ принят! Ожидайте доставку в течение ${timeStr}.`;
  }
  if (type === 'delivering') {
    const el = document.getElementById('notif-delivering-text');
    if (el) el.textContent = order.clientNotification.message || 'Курьер везёт ваш заказ!';
  }

  tgHaptic('heavy');
  playAlert();
  const notifEl = document.getElementById(notifId);
  if (notifEl) notifEl.classList.add('open');

  dbSet('orders', order.id, { clientNotification: { ...order.clientNotification, seen: true } });
}

function closeNotif(id) {
  document.getElementById(id).classList.remove('open');
  tgHaptic('light');
}

// ── Render all active orders in s-order screen ──
function renderAllActiveOrders() {
  const container = document.getElementById('orders-content');
  if (!container) return;

  if (!ACTIVE_ORDERS.length) {
    container.innerHTML = `
      <div class="empty" style="padding-top:60px">
        <div class="empty-icon">📦</div>
        <div class="empty-text">Нет активных заказов</div>
        <button class="btn btn-primary" style="margin-top:20px" onclick="navTo('s-menu');setNav(document.getElementById('nav-menu'))">🍽️ В меню</button>
      </div>`;
    return;
  }

  container.innerHTML = ACTIVE_ORDERS.map(renderOrderCard).join('');
  startAllCountdowns();
}

function renderOrderCard(o) {
  const isPickup = o.deliveryType === 'pickup';
  const steps = isPickup
    ? [{key:'pending',icon:'🕐',label:'Принят'},{key:'cooking',icon:'👨‍🍳',label:'Готовится'},{key:'delivered',icon:'✅',label:'Готов'}]
    : [{key:'pending',icon:'🕐',label:'Принят'},{key:'cooking',icon:'👨‍🍳',label:'Готовится'},{key:'delivering',icon:'🚴',label:'В пути'},{key:'delivered',icon:'✅',label:'Доставлен'}];

  const si = steps.findIndex(s => s.key === o.status);
  const statusTrack = o.status === 'cancelled'
    ? '<div style="color:var(--danger);font-weight:600;font-size:14px;text-align:center">❌ Заказ отменён</div>'
    : steps.map((s, i) => {
        const cls = i < si ? 'done' : i === si ? 'active' : '';
        return `<div class="st-step ${cls}"><div class="st-dot">${cls==='done'?'✓':s.icon}</div><div style="margin-top:4px;font-size:11px">${s.label}</div></div>${i<steps.length-1?`<div class="st-line ${i<si?'done':i===si?'active':''}"></div>`:''}`;
      }).join('');

  const showCd = o.estimatedAt && !['pending','delivered','cancelled'].includes(o.status);
  const cdLabel = isPickup ? 'Готовность заказа' : 'Время доставки';

  const infoMap = isPickup
    ? {pending:'ℹ️ Ожидает подтверждения.',cooking:'🏪 Принят! Приходите когда будет готов.',delivered:'✅ Выдан. Приятного аппетита!',cancelled:'❌ Отменён.'}
    : {pending:'ℹ️ Ожидает подтверждения оператором.',cooking:'👨‍🍳 Готовится.',delivering:'🚴 Курьер везёт ваш заказ!',delivered:'✅ Доставлен. Приятного аппетита!',cancelled:'❌ Отменён.'};

  const addr = o.address;
  const oid = (o.id||'').slice(-6);

  return `
    <div class="card" style="margin-bottom:14px">
      <div class="card-hdr">
        <span class="font-bold">Заказ #${oid}</span>
        <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
      </div>
      <div class="card-body">
        <div class="status-track" style="margin-bottom:14px">${statusTrack}</div>
        ${showCd ? `
          <div class="countdown-box" id="cd-wrap-${o.id}" style="margin-bottom:14px">
            <div class="countdown-lbl">${cdLabel}</div>
            <div class="countdown-val" id="cd-val-${o.id}">—</div>
            <div class="progress-wrap" style="margin-top:8px"><div class="progress-bar" id="cd-bar-${o.id}"></div></div>
          </div>` : ''}
        <div style="display:flex;flex-direction:column;gap:5px;font-size:13px;margin-bottom:10px">
          ${(o.items||[]).map(it=>`<div class="flex justify-between"><span>${it.emoji||'🍽️'} ${it.name} ×${it.qty}</span><span class="font-bold">${fmtPrice(it.price*it.qty)}</span></div>`).join('')}
        </div>
        <div class="divider" style="margin:8px 0"></div>
        <div class="flex justify-between"><span class="text-dim">Итого</span><span class="font-bold text-primary">${fmtPrice(o.total)}</span></div>
        <div class="flex justify-between mt-1"><span class="text-dim">Оплата</span><span>${o.payment==='cash'?'💵 Наличные':'💳 Карта'}</span></div>
        ${addr?`<div class="flex justify-between mt-1"><span class="text-dim">Адрес</span><span style="text-align:right;max-width:60%;font-size:12px">${addr.street} ${addr.house}${addr.apt?', кв.'+addr.apt:''}</span></div>`:''}
        <div class="alert-box ${o.status==='delivered'?'success':o.status==='cancelled'?'danger':'info'}" style="margin-top:10px;font-size:13px">${infoMap[o.status]||''}</div>
      </div>
    </div>`;
}

function startAllCountdowns() {
  Object.values(_cdIntervals).forEach(clearInterval);
  _cdIntervals = {};
  ACTIVE_ORDERS.forEach(o => {
    if (o.estimatedAt && !['pending','delivered','cancelled'].includes(o.status)) {
      _startOrderCountdown(o);
    }
  });
}

function _startOrderCountdown(o) {
  const target    = new Date(o.estimatedAt).getTime();
  const startTime = o.acceptedAt ? new Date(o.acceptedAt).getTime() : target - 60*60*1000;
  const total     = target - startTime;
  const tick = () => {
    const val = document.getElementById(`cd-val-${o.id}`);
    const bar = document.getElementById(`cd-bar-${o.id}`);
    if (!val) { clearInterval(_cdIntervals[o.id]); delete _cdIntervals[o.id]; return; }
    const remaining = target - Date.now();
    if (remaining <= 0) {
      val.textContent = 'Совсем скоро!'; val.classList.add('urgent');
      if (bar) { bar.style.width = '0%'; bar.classList.add('urgent'); }
      clearInterval(_cdIntervals[o.id]); delete _cdIntervals[o.id]; return;
    }
    val.textContent = fmtCountdown(remaining);
    val.classList.toggle('urgent', remaining < 5*60*1000);
    if (bar) { bar.style.width = Math.max(0,(remaining/total)*100)+'%'; bar.classList.toggle('urgent', remaining < 5*60*1000); }
  };
  tick();
  _cdIntervals[o.id] = setInterval(tick, 1000);
}

// ── History ──
async function loadHistory() {
  const container = document.getElementById('history-list');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  const orders = (await dbQuery('orders', 'clientUid', '==', STATE.uid))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 50);
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
      <div class="order-card-foot"><button class="btn btn-sm btn-primary" onclick="event.stopPropagation();repeatOrder('${o.id}')">🔄 Повторить</button></div>
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

  CART = [];
  for (const item of (o.items || [])) {
    const variantName = item.variantName || null;
    const key = variantName ? `${item.id}::${variantName}` : item.id;
    CART.push({ cartKey: key, id: item.id, variantName, name: item.name, price: item.price, qty: item.qty, emoji: item.emoji || '🍽️' });
  }
  saveCart();

  if (o.address) {
    document.getElementById('addr-street').value = o.address.street || '';
    document.getElementById('addr-house').value  = o.address.house  || '';
    document.getElementById('addr-apt').value    = o.address.apt    || '';
  }
  if (o.deliveryType === 'pickup') {
    selectDeliveryType(document.getElementById('dt-pickup'));
  }
  if (o.payment === 'card') {
    document.querySelectorAll('.payment-opt').forEach(b => {
      b.classList.remove('btn-primary'); b.classList.add('btn-secondary');
      if (b.dataset.val === 'card') { b.classList.add('btn-primary'); b.classList.remove('btn-secondary'); }
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
  if (screenId === 's-menu') { renderMenuGrid(null); updateCartFAB(); }
  if (screenId === 's-cart') renderCartScreen();
  if (screenId === 's-order') renderAllActiveOrders();
}

function navToOrder() {
  if (ACTIVE_ORDERS.length > 0) {
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
