/* =========================================================
   client.js — Telegram MiniApp Delivery Client
   Vanilla JS + Firebase v8 (compat) SDK
   ========================================================= */

'use strict';

// ── Telegram WebApp ──────────────────────────────────────
const tg = window.Telegram.WebApp;

// ── STATE ────────────────────────────────────────────────
const STATE_KEY = 'dl_client_state';
let STATE = { uid: null, user: null, cart: {}, activeOrderId: null };

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) STATE = Object.assign(STATE, JSON.parse(raw));
  } catch (_) {}
}

function saveState() {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(STATE)); } catch (_) {}
}

// ── In-memory data ───────────────────────────────────────
let menuItems = [];          // [{id, name, desc, price, imageUrl, category, available, order}]
let cafeSettings = {};       // {isOpen, openTime, closeTime, deliveryHours, deliveryMinutes}
let activeOrderUnsub = null; // unsubscribe fn for active order listener
let orderHistoryCache = [];  // cached past orders

const STATUS_TEXT = {
  pending:          'Ожидает подтверждения',
  confirmed:        'Принят в работу',
  cooking:          'Готовится',
  courier_assigned: 'Передан курьеру',
  delivered:        'Доставлен',
  cancelled:        'Отменён',
};

const STATUS_STEPS = ['pending', 'confirmed', 'cooking', 'courier_assigned', 'delivered'];

// ── Screen helpers ───────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function showTab(tab) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('tab-' + tab);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
  if (btn) btn.classList.add('active');
  showScreen('s-main');
  if (tab === 'orders') loadOrdersTab();
  if (tab === 'profile') loadProfileTab();
}

// ── Notification overlay ─────────────────────────────────
function showNotification(emoji, title, body, duration = 4000) {
  const overlay = document.getElementById('notif-overlay');
  document.getElementById('notif-emoji').textContent = emoji;
  document.getElementById('notif-title').textContent = title;
  document.getElementById('notif-body').textContent = body;
  overlay.classList.add('visible');
  clearTimeout(overlay._timeout);
  overlay._timeout = setTimeout(() => overlay.classList.remove('visible'), duration);
}

document.getElementById('notif-overlay')?.addEventListener('click', () => {
  document.getElementById('notif-overlay').classList.remove('visible');
});

// ── Confirm dialog ───────────────────────────────────────
function showConfirm(message, onYes, onNo) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-msg').textContent = message;
  dialog.classList.add('visible');
  const yesBtn = document.getElementById('confirm-yes');
  const noBtn  = document.getElementById('confirm-no');
  const cleanup = () => { dialog.classList.remove('visible'); yesBtn.onclick = null; noBtn.onclick = null; };
  yesBtn.onclick = () => { cleanup(); onYes && onYes(); };
  noBtn.onclick  = () => { cleanup(); onNo && onNo(); };
}

// ── Toast ────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.className = 'toast toast-' + type + ' visible';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ── Cafe closed banner ───────────────────────────────────
function updateCafeBanner() {
  const banner = document.getElementById('cafe-closed-banner');
  if (!banner) return;
  if (cafeSettings.isOpen === false) {
    banner.textContent = `🕐 Кафе закрыто. Работаем с ${cafeSettings.openTime || '10:00'} до ${cafeSettings.closeTime || '22:00'}`;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

// ── Cart helpers ─────────────────────────────────────────
function getCartCount() {
  return Object.values(STATE.cart).reduce((s, q) => s + q, 0);
}

function getCartTotal() {
  return Object.entries(STATE.cart).reduce((s, [id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    return s + (item ? item.price * qty : 0);
  }, 0);
}

function setCartQty(itemId, qty) {
  if (qty <= 0) delete STATE.cart[itemId];
  else STATE.cart[itemId] = qty;
  saveState();
  updateCartFab();
  updateMenuItemQty(itemId);
}

function updateCartFab() {
  const count = getCartCount();
  const total = getCartTotal();
  const fab = document.getElementById('cart-fab');
  if (!fab) return;
  if (count > 0) {
    fab.classList.add('visible');
    document.getElementById('cart-fab-count').textContent = count + (count === 1 ? ' товар' : count < 5 ? ' товара' : ' товаров');
    document.getElementById('cart-fab-total').textContent = formatPrice(total);
  } else {
    fab.classList.remove('visible');
  }
}

function updateMenuItemQty(itemId) {
  const qty = STATE.cart[itemId] || 0;
  const card = document.querySelector(`.menu-card[data-id="${itemId}"]`);
  if (!card) return;
  const addBtn  = card.querySelector('.add-btn');
  const qtyCtrl = card.querySelector('.qty-ctrl');
  const qtyNum  = card.querySelector('.qty-num');
  if (addBtn && qtyCtrl) {
    if (qty > 0) {
      addBtn.style.display = 'none';
      qtyCtrl.style.display = 'flex';
      if (qtyNum) qtyNum.textContent = qty;
    } else {
      addBtn.style.display = 'flex';
      qtyCtrl.style.display = 'none';
    }
  }
}

function formatPrice(p) { return p.toLocaleString('ru-RU') + ' ₽'; }

function formatAddress(addr) {
  let parts = [];
  if (addr.street) parts.push('ул. ' + addr.street);
  if (addr.house)  parts.push('д. ' + addr.house);
  if (addr.flat)   parts.push('кв. ' + addr.flat);
  if (addr.intercom) parts.push('домофон');
  return parts.join(', ');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ' в ' +
         d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

// ── Menu rendering ───────────────────────────────────────
function renderMenu() {
  const list = document.getElementById('menu-list');
  if (!list) return;

  if (menuItems.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🍽️</div><div>Меню пока пусто</div></div>';
    return;
  }

  // Group by category preserving order
  const cats = {};
  const catOrder = [];
  menuItems
    .filter(m => m.available !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .forEach(m => {
      const c = m.category || 'Прочее';
      if (!cats[c]) { cats[c] = []; catOrder.push(c); }
      cats[c].push(m);
    });

  let html = '';
  catOrder.forEach(cat => {
    html += `<div class="menu-category"><h3 class="category-title">${cat}</h3><div class="menu-grid">`;
    cats[cat].forEach(m => {
      const qty = STATE.cart[m.id] || 0;
      html += `
        <div class="menu-card" data-id="${m.id}">
          <div class="menu-card-img-wrap" onclick="openDetail('${m.id}')">
            ${m.imageUrl
              ? `<img src="${m.imageUrl}" alt="${escHtml(m.name)}" class="menu-card-img" loading="lazy">`
              : `<div class="menu-card-img-placeholder">🍽️</div>`}
          </div>
          <div class="menu-card-body">
            <div class="menu-card-name" onclick="openDetail('${m.id}')">${escHtml(m.name)}</div>
            ${m.description ? `<div class="menu-card-desc">${escHtml(m.description)}</div>` : ''}
            <div class="menu-card-footer">
              <span class="menu-card-price">${formatPrice(m.price)}</span>
              <button class="add-btn icon-btn" style="${qty > 0 ? 'display:none' : ''}" onclick="setCartQty('${m.id}', 1)">
                <span>+</span>
              </button>
              <div class="qty-ctrl" style="${qty > 0 ? 'display:flex' : 'display:none'}">
                <button class="qty-btn" onclick="setCartQty('${m.id}', (STATE.cart['${m.id}']||0)-1)">−</button>
                <span class="qty-num">${qty}</span>
                <button class="qty-btn" onclick="setCartQty('${m.id}', (STATE.cart['${m.id}']||0)+1)">+</button>
              </div>
            </div>
          </div>
        </div>`;
    });
    html += `</div></div>`;
  });

  list.innerHTML = html;
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Item detail ──────────────────────────────────────────
let detailItemId = null;

window.openDetail = function(itemId) {
  const item = menuItems.find(m => m.id === itemId);
  if (!item) return;
  detailItemId = itemId;

  document.getElementById('detail-img-wrap').innerHTML = item.imageUrl
    ? `<img src="${item.imageUrl}" alt="${escHtml(item.name)}" class="detail-img">`
    : `<div class="detail-img-placeholder">🍽️</div>`;
  document.getElementById('detail-name').textContent = item.name;
  document.getElementById('detail-desc').textContent = item.description || '';
  document.getElementById('detail-price').textContent = formatPrice(item.price);
  updateDetailQty();
  showScreen('s-detail');
};

function updateDetailQty() {
  if (!detailItemId) return;
  const qty = STATE.cart[detailItemId] || 0;
  const ctrl = document.getElementById('detail-qty-ctrl');
  const addBtn = document.getElementById('detail-add-btn');
  document.getElementById('detail-qty-num').textContent = qty;
  if (qty > 0) {
    ctrl.style.display = 'flex';
    addBtn.style.display = 'none';
  } else {
    ctrl.style.display = 'none';
    addBtn.style.display = 'flex';
  }
}

document.getElementById('detail-add-btn')?.addEventListener('click', () => {
  if (detailItemId) { setCartQty(detailItemId, 1); updateDetailQty(); }
});
document.getElementById('detail-qty-minus')?.addEventListener('click', () => {
  if (detailItemId) { setCartQty(detailItemId, (STATE.cart[detailItemId] || 0) - 1); updateDetailQty(); }
});
document.getElementById('detail-qty-plus')?.addEventListener('click', () => {
  if (detailItemId) { setCartQty(detailItemId, (STATE.cart[detailItemId] || 0) + 1); updateDetailQty(); }
});
document.getElementById('detail-back')?.addEventListener('click', () => showScreen('s-main'));

// ── Cart screen ──────────────────────────────────────────
function openCart() {
  renderCart();
  showScreen('s-cart');
}

function renderCart() {
  const list = document.getElementById('cart-items');
  const summary = document.getElementById('cart-summary');
  if (!list) return;

  const entries = Object.entries(STATE.cart).filter(([, q]) => q > 0);
  if (entries.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🛒</div><div>Корзина пуста</div></div>';
    if (summary) summary.style.display = 'none';
    document.getElementById('to-checkout-btn').style.display = 'none';
    return;
  }

  let html = '';
  let total = 0;
  entries.forEach(([id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    if (!item) return;
    const sub = item.price * qty;
    total += sub;
    html += `
      <div class="cart-item">
        ${item.imageUrl ? `<img src="${item.imageUrl}" class="cart-item-img" alt="">` : `<div class="cart-item-img-placeholder">🍽️</div>`}
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          <div class="cart-item-price">${formatPrice(item.price)} × ${qty}</div>
        </div>
        <div class="cart-item-controls">
          <div class="qty-ctrl">
            <button class="qty-btn" onclick="setCartQty('${id}', ${qty - 1}); renderCart()">−</button>
            <span class="qty-num">${qty}</span>
            <button class="qty-btn" onclick="setCartQty('${id}', ${qty + 1}); renderCart()">+</button>
          </div>
          <div class="cart-item-sub">${formatPrice(sub)}</div>
        </div>
      </div>`;
  });

  list.innerHTML = html;
  if (summary) {
    summary.style.display = 'flex';
    document.getElementById('cart-total-price').textContent = formatPrice(total);
  }
  document.getElementById('to-checkout-btn').style.display = 'flex';

  // Closed check
  const closedNote = document.getElementById('cart-closed-note');
  if (closedNote) {
    closedNote.style.display = cafeSettings.isOpen === false ? 'block' : 'none';
  }
}

document.getElementById('cart-back')?.addEventListener('click', () => showScreen('s-main'));
document.getElementById('cart-fab')?.addEventListener('click', openCart);
document.getElementById('to-checkout-btn')?.addEventListener('click', openCheckout);
document.getElementById('cart-clear-btn')?.addEventListener('click', () => {
  showConfirm('Очистить корзину?', () => {
    STATE.cart = {};
    saveState();
    updateCartFab();
    renderCart();
    menuItems.forEach(m => updateMenuItemQty(m.id));
  });
});

// ── Checkout ─────────────────────────────────────────────
function openCheckout() {
  if (cafeSettings.isOpen === false) {
    showToast('Кафе сейчас закрыто', 'error');
    return;
  }
  if (getCartCount() === 0) {
    showToast('Корзина пуста', 'error');
    return;
  }
  // Prefill phone from profile
  const phoneInput = document.getElementById('co-phone');
  if (phoneInput && STATE.user?.phone) phoneInput.value = STATE.user.phone;

  renderCheckoutSummary();
  showScreen('s-checkout');
}

function renderCheckoutSummary() {
  const list = document.getElementById('co-items');
  if (!list) return;
  let html = '';
  let total = 0;
  Object.entries(STATE.cart).forEach(([id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    if (!item || qty <= 0) return;
    const sub = item.price * qty;
    total += sub;
    html += `<div class="co-item"><span>${escHtml(item.name)} × ${qty}</span><span>${formatPrice(sub)}</span></div>`;
  });
  html += `<div class="co-item co-total"><span>Итого</span><span>${formatPrice(total)}</span></div>`;
  list.innerHTML = html;
}

document.getElementById('co-back')?.addEventListener('click', () => showScreen('s-cart'));

// Intercom toggle
const intercomToggle = document.getElementById('co-intercom-toggle');
let hasIntercom = false;
intercomToggle?.addEventListener('click', () => {
  hasIntercom = !hasIntercom;
  intercomToggle.classList.toggle('on', hasIntercom);
  intercomToggle.textContent = hasIntercom ? 'Есть домофон ✓' : 'Нет домофона';
});

// Place order
document.getElementById('co-submit-btn')?.addEventListener('click', placeOrder);

async function placeOrder() {
  const street = document.getElementById('co-street')?.value.trim();
  const house  = document.getElementById('co-house')?.value.trim();
  const flat   = document.getElementById('co-flat')?.value.trim();
  const phone  = document.getElementById('co-phone')?.value.trim();
  const paymentType = document.getElementById('co-payment')?.value;
  const comment = document.getElementById('co-comment')?.value.trim();

  if (!street) { showToast('Укажите улицу', 'error'); return; }
  if (!house)  { showToast('Укажите номер дома', 'error'); return; }

  const btn = document.getElementById('co-submit-btn');
  btn.disabled = true;
  btn.textContent = 'Оформляем...';

  const tgUser = tg.initDataUnsafe?.user;
  const tgId   = tgUser?.id || null;
  const clientName = tgUser
    ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ')
    : (STATE.user?.firstName || 'Клиент');

  const items = Object.entries(STATE.cart)
    .filter(([, q]) => q > 0)
    .map(([id, qty]) => {
      const m = menuItems.find(x => x.id === id);
      return m ? { id, name: m.name, price: m.price, qty } : null;
    })
    .filter(Boolean);

  const totalPrice = items.reduce((s, i) => s + i.price * i.qty, 0);

  const address = { street, house, flat, intercom: hasIntercom };
  const orderId = 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

  const orderDoc = {
    uid: STATE.uid,
    tgId,
    clientName,
    clientPhone: phone || STATE.user?.phone || '',
    items,
    totalPrice,
    address,
    paymentType: paymentType || 'cash',
    comment,
    status: 'pending',
    createdAt: new Date().toISOString(),
    deliveryHours:   cafeSettings.deliveryHours   || 0,
    deliveryMinutes: cafeSettings.deliveryMinutes || 30,
  };

  try {
    await dbSet('orders/' + orderId, orderDoc);

    const addrStr = formatAddress(address);
    await dbAddTask('new_order', {
      orderId,
      clientName,
      clientTgId:  tgId,
      clientUid:   STATE.uid,
      totalPrice,
      address: addrStr,
    });

    STATE.cart = {};
    STATE.activeOrderId = orderId;
    saveState();
    updateCartFab();
    menuItems.forEach(m => updateMenuItemQty(m.id));

    showNotification('✅', 'Заказ оформлен!', 'Ожидайте подтверждения от оператора.', 5000);
    subscribeActiveOrder(orderId);
    showActiveOrder(orderId);

  } catch (e) {
    console.error('placeOrder error', e);
    showToast('Ошибка при оформлении: ' + (e.message || e), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Оформить заказ';
  }
}

// ── Active order tracking ────────────────────────────────
function subscribeActiveOrder(orderId) {
  if (activeOrderUnsub) { activeOrderUnsub(); activeOrderUnsub = null; }

  let lastStatus = null;

  activeOrderUnsub = onDocSnapshot('orders/' + orderId, (data) => {
    if (!data) return;

    // Update STATE
    STATE.activeOrderId = (data.status !== 'delivered' && data.status !== 'cancelled') ? orderId : null;
    saveState();

    // Push notifications for status changes
    if (data.status !== lastStatus) {
      if (lastStatus !== null) {
        handleStatusChange(data);
      }
      lastStatus = data.status;
    }

    // Refresh active order screen if visible
    if (document.getElementById('s-active-order')?.classList.contains('active')) {
      renderActiveOrder(data);
    }

    // If finished, stop
    if (data.status === 'delivered' || data.status === 'cancelled') {
      if (activeOrderUnsub) { activeOrderUnsub(); activeOrderUnsub = null; }
    }
  });
}

function handleStatusChange(order) {
  const { status, deliveryHours, deliveryMinutes } = order;
  const mins = (deliveryHours || 0) * 60 + (deliveryMinutes || 30);
  if (status === 'confirmed') {
    showNotification('🎉', 'Заказ принят!', `Ожидайте ${mins} мин. Курьер уже готовится!`, 6000);
  } else if (status === 'delivered') {
    showNotification('🎊', 'Заказ доставлен!', 'Приятного аппетита 🎉', 6000);
  } else if (status === 'cancelled') {
    showNotification('❌', 'Заказ отменён', 'Оператор свяжется с вами для уточнения деталей.', 6000);
  } else if (status === 'cooking') {
    showNotification('👨‍🍳', 'Готовится!', 'Повар приступил к приготовлению вашего заказа.', 4000);
  } else if (status === 'courier_assigned') {
    showNotification('🛵', 'Курьер в пути!', 'Курьер уже везёт ваш заказ.', 4000);
  }
}

function showActiveOrder(orderId) {
  showScreen('s-active-order');
  // Load initial data
  dbGet('orders/' + orderId).then(data => {
    if (data) renderActiveOrder(data);
  });
}

function renderActiveOrder(order) {
  if (!order) return;

  document.getElementById('ao-status-text').textContent = STATUS_TEXT[order.status] || order.status;
  document.getElementById('ao-order-id').textContent = '#' + (order.createdAt || '').slice(0, 10).replace(/-/g, '') + (order.uid || '').slice(-4);

  // Step bar
  const steps = STATUS_STEPS;
  const curIdx = steps.indexOf(order.status);
  const bars = document.querySelectorAll('.ao-step');
  bars.forEach((bar, i) => {
    bar.classList.toggle('done', i <= curIdx);
    bar.classList.toggle('active', i === curIdx);
  });

  // Step labels
  const labels = document.querySelectorAll('.ao-step-label');
  labels.forEach((lbl, i) => {
    lbl.classList.toggle('done', i <= curIdx);
    lbl.classList.toggle('active', i === curIdx);
  });

  // Countdown / ETA
  const etaEl = document.getElementById('ao-eta');
  if (order.status === 'delivered') {
    etaEl.textContent = 'Доставлен ✓';
  } else if (order.status === 'cancelled') {
    etaEl.textContent = 'Отменён ✗';
  } else if (order.createdAt) {
    const totalMins = (order.deliveryHours || 0) * 60 + (order.deliveryMinutes || 30);
    const created = new Date(order.createdAt).getTime();
    const eta = new Date(created + totalMins * 60000);
    const now = new Date();
    const diffMins = Math.max(0, Math.round((eta - now) / 60000));
    etaEl.textContent = diffMins > 0
      ? `Примерно через ${diffMins} мин`
      : 'Скоро доставим!';
  }

  // Items list
  const itemsEl = document.getElementById('ao-items');
  if (itemsEl && order.items) {
    itemsEl.innerHTML = order.items.map(it =>
      `<div class="ao-item"><span>${escHtml(it.name)} × ${it.qty}</span><span>${formatPrice(it.price * it.qty)}</span></div>`
    ).join('');
  }

  // Total
  const totalEl = document.getElementById('ao-total');
  if (totalEl) totalEl.textContent = formatPrice(order.totalPrice || 0);

  // Address
  const addrEl = document.getElementById('ao-address');
  if (addrEl) addrEl.textContent = formatAddress(order.address || {});

  // Payment
  const payEl = document.getElementById('ao-payment');
  if (payEl) payEl.textContent = order.paymentType === 'card' ? 'Картой курьеру' : 'Наличными';
}

document.getElementById('ao-back')?.addEventListener('click', () => showTab('orders'));

// ── Orders tab ───────────────────────────────────────────
async function loadOrdersTab() {
  const container = document.getElementById('orders-list');
  if (!container) return;
  container.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><div>Загрузка...</div></div>';

  try {
    // Check active order first
    if (STATE.activeOrderId) {
      const active = await dbGet('orders/' + STATE.activeOrderId);
      if (active && active.status !== 'delivered' && active.status !== 'cancelled') {
        container.innerHTML = '';
        const card = buildActiveOrderCard(STATE.activeOrderId, active);
        container.appendChild(card);

        // Load history too
        await appendOrderHistory(container);
        return;
      } else {
        STATE.activeOrderId = null;
        saveState();
      }
    }

    await appendOrderHistory(container);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">❌</div><div>Ошибка загрузки</div></div>`;
  }
}

function buildActiveOrderCard(orderId, order) {
  const div = document.createElement('div');
  div.className = 'order-card order-card-active';
  div.innerHTML = `
    <div class="order-card-header">
      <span class="order-card-badge badge-active">Активный</span>
      <span class="order-card-date">${formatDate(order.createdAt)}</span>
    </div>
    <div class="order-card-status">${STATUS_TEXT[order.status] || order.status}</div>
    <div class="order-card-total">${formatPrice(order.totalPrice || 0)}</div>
    <button class="btn btn-primary btn-sm" onclick="showActiveOrder('${orderId}')">Отследить заказ →</button>
  `;
  return div;
}

async function appendOrderHistory(container) {
  // Query past orders for this user, ordered by createdAt desc
  let orders = [];
  try {
    orders = await dbQueryAll('orders', [
      { field: 'uid', op: '==', value: STATE.uid },
    ]);
    orders = orders
      .filter(o => o.status === 'delivered' || o.status === 'cancelled')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    orderHistoryCache = orders;
  } catch (e) { orders = []; }

  if (orders.length === 0 && !STATE.activeOrderId) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.innerHTML = '<div class="empty-icon">📋</div><div>Заказов пока нет</div>';
    container.appendChild(el);
    return;
  }

  orders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'order-card';
    card.innerHTML = `
      <div class="order-card-header">
        <span class="order-card-badge badge-${order.status}">${STATUS_TEXT[order.status] || order.status}</span>
        <span class="order-card-date">${formatDate(order.createdAt)}</span>
      </div>
      <div class="order-card-items">${(order.items || []).map(i => `${i.name} × ${i.qty}`).join(', ')}</div>
      <div class="order-card-footer">
        <span class="order-card-total">${formatPrice(order.totalPrice || 0)}</span>
        <button class="btn btn-outline btn-sm" onclick="openOrderDetail('${order._id}')">Детали</button>
        <button class="btn btn-primary btn-sm" onclick="repeatOrder('${order._id}')">Повторить</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Order detail ─────────────────────────────────────────
window.openOrderDetail = function(orderId) {
  const order = orderHistoryCache.find(o => o._id === orderId);
  if (!order) return;

  document.getElementById('od-date').textContent    = formatDate(order.createdAt);
  document.getElementById('od-status').textContent  = STATUS_TEXT[order.status] || order.status;
  document.getElementById('od-address').textContent = formatAddress(order.address || {});
  document.getElementById('od-payment').textContent = order.paymentType === 'card' ? 'Картой курьеру' : 'Наличными';
  document.getElementById('od-comment').textContent = order.comment || '—';

  const itemsEl = document.getElementById('od-items');
  itemsEl.innerHTML = (order.items || []).map(it =>
    `<div class="od-item">
      <span>${escHtml(it.name)} × ${it.qty}</span>
      <span>${formatPrice(it.price * it.qty)}</span>
    </div>`
  ).join('');

  document.getElementById('od-total').textContent = formatPrice(order.totalPrice || 0);

  showScreen('s-order-detail');
};

document.getElementById('od-back')?.addEventListener('click', () => showTab('orders'));
document.getElementById('od-repeat')?.addEventListener('click', () => {
  // Find current order from screen (stored in detail)
  const order = orderHistoryCache.find(o => formatDate(o.createdAt) === document.getElementById('od-date')?.textContent);
  if (order) repeatOrder(order._id);
});

// ── Repeat order ─────────────────────────────────────────
window.repeatOrder = function(orderId) {
  const order = orderHistoryCache.find(o => o._id === orderId);
  if (!order) return;

  const newCart = {};
  (order.items || []).forEach(it => {
    // Use current price from menu
    const cur = menuItems.find(m => m.id === it.id);
    if (cur) newCart[it.id] = it.qty;
  });

  if (Object.keys(newCart).length === 0) {
    showToast('Товары из заказа больше недоступны', 'error');
    return;
  }

  STATE.cart = newCart;
  saveState();
  updateCartFab();
  menuItems.forEach(m => updateMenuItemQty(m.id));
  showToast('Товары добавлены в корзину ✓', 'success');
  openCart();
};

// ── Profile tab ──────────────────────────────────────────
function loadProfileTab() {
  const tgUser = tg.initDataUnsafe?.user;
  const nameEl  = document.getElementById('profile-name');
  const phoneEl = document.getElementById('profile-phone');

  if (nameEl) {
    nameEl.textContent = tgUser
      ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ')
      : (STATE.user?.firstName || 'Пользователь');
  }
  if (phoneEl) {
    phoneEl.textContent = STATE.user?.phone || '—';
  }

  const avatarEl = document.getElementById('profile-avatar-text');
  if (avatarEl) {
    const name = nameEl?.textContent || 'U';
    avatarEl.textContent = name.charAt(0).toUpperCase();
  }

  // Stats
  const histEl = document.getElementById('profile-orders-count');
  if (histEl) histEl.textContent = orderHistoryCache.length;

  const spendEl = document.getElementById('profile-total-spend');
  if (spendEl) {
    const total = orderHistoryCache
      .filter(o => o.status === 'delivered')
      .reduce((s, o) => s + (o.totalPrice || 0), 0);
    spendEl.textContent = formatPrice(total);
  }
}

// ── Load cafe settings ───────────────────────────────────
async function loadCafeSettings() {
  try {
    const s = await dbGet('settings/cafe');
    if (s) cafeSettings = s;
  } catch (_) {}
  updateCafeBanner();
}

// ── Load menu ────────────────────────────────────────────
async function loadMenu() {
  try {
    const items = await dbQueryAll('menu', []);
    menuItems = items.map(it => ({ ...it }));
  } catch (e) {
    console.error('loadMenu error', e);
  }
  renderMenu();
  updateCartFab();
  menuItems.forEach(m => updateMenuItemQty(m.id));
}

// ── Navigation ───────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Init ─────────────────────────────────────────────────
async function init() {
  tg.expand();
  tg.ready();
  tg.enableClosingConfirmation();

  initFirebase();
  loadState();
  showScreen('s-loading');

  // Read uid from URL
  const params = new URLSearchParams(window.location.search);
  let uid = params.get('uid') || STATE.uid;

  if (uid) {
    // Remove uid from URL cleanly
    params.delete('uid');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
    window.history.replaceState({}, '', newUrl);
  }

  if (!uid) {
    showScreen('s-no-uid');
    return;
  }

  STATE.uid = uid;
  saveState();

  // Load user data
  try {
    let user = await dbGet('users', uid);
    if (!user) user = await dbGet('user_links', uid);
    STATE.user = user || {};
    saveState();
  } catch (_) {}

  // ── Onboarding: first-time name + ToS ────────────────────
  if (!STATE.user?.tosAccepted) {
    // Pre-fill name from Telegram if available
    const tgName = tg.initDataUnsafe?.user?.first_name || '';
    const nameInput = document.getElementById('onboard-name');
    if (nameInput && tgName) nameInput.value = tgName;
    showScreen('s-onboard');
    return; // submitOnboarding() will resume
  }

  await afterOnboarding();
}

async function submitOnboarding() {
  const nameVal = document.getElementById('onboard-name')?.value.trim();
  const tosVal  = document.getElementById('onboard-tos')?.checked;

  if (!nameVal) { showToast('Введите ваше имя', 'error'); return; }
  if (!tosVal)  { showToast('Примите пользовательское соглашение', 'error'); return; }

  const btn = document.getElementById('btn-onboard-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Сохраняем...'; }

  try {
    await dbSet('users', STATE.uid, { firstName: nameVal, tosAccepted: true, tosDate: new Date().toISOString() });
    STATE.user = { ...STATE.user, firstName: nameVal, tosAccepted: true };
    saveState();
    await afterOnboarding();
  } catch (e) {
    console.error('Onboarding save error:', e);
    showToast('Ошибка сохранения', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Продолжить →'; }
  }
}

async function afterOnboarding() {
  // Start heartbeat
  startHeartbeat(STATE.uid);

  // Load menu & settings
  await Promise.all([loadMenu(), loadCafeSettings()]);

  // Check for active order
  if (STATE.activeOrderId) {
    const active = await dbGet('orders', STATE.activeOrderId);
    if (active && active.status !== 'delivered' && active.status !== 'cancelled') {
      subscribeActiveOrder(STATE.activeOrderId);
    } else {
      STATE.activeOrderId = null;
      saveState();
    }
  }

  showTab('menu');
}

document.getElementById('btn-onboard-submit')?.addEventListener('click', submitOnboarding);

// Kick off
init().catch(e => {
  console.error('init error', e);
  showToast('Ошибка инициализации', 'error');
  showScreen('s-no-uid');
});
