/* ═══════════════════════════════════════════════════════════════
   operator.js — Delivery Operator Panel Logic
   Firebase v8 compat SDK, vanilla JS, no frameworks
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── State ──────────────────────────────────────────────────── */
const STATE = {
  uid: null,
  staffData: null,
  activeTab: 'active',       // 'active' | 'history'
  currentOrderId: null,
  activeOrders: [],          // live from snapshot
  historyOrders: [],
  couriers: [],
  cafeSettings: null,
  historyDate: todayISO(),
  pendingAlarmInterval: null,
  audioCtx: null,
  knownPendingIds: new Set(),
  knownDeliveredIds: new Set(),
  unsubOrders: null,
};

/* ── Helpers ─────────────────────────────────────────────────── */
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function orderNum(id) {
  return id ? '#' + String(id).slice(-5).toUpperCase() : '';
}

function statusLabel(s) {
  const map = {
    pending:          'Новый',
    confirmed:        'Принят',
    cooking:          'Готовится',
    courier_assigned: 'У курьера',
    delivered:        'Доставлен',
    cancelled:        'Отменён',
  };
  return map[s] || s;
}

function statusBadgeClass(s) {
  const map = {
    pending:          'badge-pending',
    confirmed:        'badge-confirmed',
    cooking:          'badge-cooking',
    courier_assigned: 'badge-courier',
    delivered:        'badge-delivered',
    cancelled:        'badge-cancelled',
  };
  return map[s] || '';
}

function paymentLabel(p) {
  const map = { cash: 'Наличные', card: 'Карта', online: 'Онлайн' };
  return map[p] || p || '—';
}

function el(id) { return document.getElementById(id); }

/* ── Screen router ───────────────────────────────────────────── */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = el('s-' + name);
  if (target) target.classList.add('active');
}

/* ── Audio ───────────────────────────────────────────────────── */
function getAudioCtx() {
  if (!STATE.audioCtx) {
    try { STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { console.warn('[Audio] Not supported'); }
  }
  return STATE.audioCtx;
}

function playBeep(freq = 880, duration = 0.18, gain = 0.4) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gainNode.gain.setValueAtTime(gain, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration + 0.05);
  } catch (e) { console.warn('[Audio] Beep error:', e); }
}

function playNewOrderSound() {
  playBeep(880, 0.15, 0.45);
  setTimeout(() => playBeep(1100, 0.15, 0.35), 180);
  setTimeout(() => playBeep(1320, 0.22, 0.30), 360);
}

function playDeliveredSound() {
  playBeep(660, 0.12, 0.3);
  setTimeout(() => playBeep(880, 0.12, 0.25), 150);
  setTimeout(() => playBeep(1100, 0.18, 0.2), 300);
}

function startPendingAlarm() {
  if (STATE.pendingAlarmInterval) return;
  playNewOrderSound();
  STATE.pendingAlarmInterval = setInterval(() => {
    const hasPending = STATE.activeOrders.some(o => o.status === 'pending');
    if (hasPending) {
      playNewOrderSound();
    } else {
      stopPendingAlarm();
    }
  }, 2000);

  // Show alarm indicator
  const ind = el('alarm-indicator');
  if (ind) ind.classList.add('show');
}

function stopPendingAlarm() {
  if (STATE.pendingAlarmInterval) {
    clearInterval(STATE.pendingAlarmInterval);
    STATE.pendingAlarmInterval = null;
  }
  const ind = el('alarm-indicator');
  if (ind) ind.classList.remove('show');
}

/* ── UID from URL ────────────────────────────────────────────── */
function extractUid() {
  const params = new URLSearchParams(window.location.search);
  const uid = params.get('uid');
  if (uid) {
    // Remove uid from URL without reload
    params.delete('uid');
    const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    history.replaceState(null, '', newUrl);
  }
  return uid;
}

/* ── Auth & Init ─────────────────────────────────────────────── */
async function init() {
  showScreen('loading');

  // Init Firebase
  try { initFirebase(); } catch (e) { console.error('[OP] Firebase init failed:', e); }

  // Get UID
  STATE.uid = extractUid() || localStorage.getItem('op_uid');
  if (!STATE.uid) {
    showScreen('no-uid');
    return;
  }
  localStorage.setItem('op_uid', STATE.uid);

  // Load staff profile
  const staff = await dbGet('staff_uids', STATE.uid);
  if (!staff || staff.role !== 'operator') {
    localStorage.removeItem('op_uid');
    showScreen('no-uid');
    return;
  }

  STATE.staffData = staff;
  const nameEl = el('op-name');
  if (nameEl) nameEl.textContent = staff.name || 'Оператор';

  // Start heartbeat
  startHeartbeat(STATE.uid);

  // Load cafe settings
  loadCafeSettings();

  // Subscribe to orders
  subscribeActiveOrders();

  // Load history for today
  loadHistory(STATE.historyDate);

  showScreen('main');
}

/* ── Cafe Settings ───────────────────────────────────────────── */
async function loadCafeSettings() {
  const settings = await dbGet('settings', 'cafe');
  STATE.cafeSettings = settings;
  renderCafeStatus(settings);
}

function renderCafeStatus(s) {
  const wrap = el('cafe-status-bar');
  if (!wrap) return;
  if (!s) { wrap.innerHTML = ''; return; }

  const isOpen = s.isOpen !== false;
  const deliveryMin = s.deliveryTimeMin || s.deliveryMinutes || 30;
  wrap.innerHTML = `
    <div class="cafe-status-pill ${isOpen ? 'open' : 'closed'}">
      <span>${isOpen ? '🟢' : '🔴'}</span>
      <span>${isOpen ? 'Кафе открыто' : 'Кафе закрыто'}</span>
    </div>
    <div class="cafe-delivery-time">
      <span>⏱</span>
      <span>Доставка ~${deliveryMin} мин</span>
    </div>
  `;
}

/* ── Active Orders Subscription ──────────────────────────────── */
function subscribeActiveOrders() {
  if (STATE.unsubOrders) { STATE.unsubOrders(); STATE.unsubOrders = null; }

  if (!isFirebaseReady) {
    // Fallback polling
    const poll = async () => {
      const statuses = ['pending', 'confirmed', 'cooking', 'courier_assigned'];
      let all = [];
      for (const s of statuses) {
        const res = await dbQuery('orders', 'status', '==', s);
        all = all.concat(res);
      }
      handleActiveOrdersUpdate(all);
    };
    poll();
    const t = setInterval(poll, 5000);
    STATE.unsubOrders = () => clearInterval(t);
    return;
  }

  // Real-time: Firestore 'in' query
  try {
    const unsub = db.collection('orders')
      .where('status', 'in', ['pending', 'confirmed', 'cooking', 'courier_assigned'])
      .onSnapshot(snap => {
        const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        handleActiveOrdersUpdate(orders);
      }, e => console.warn('[OP] orders snapshot error:', e));
    STATE.unsubOrders = unsub;
  } catch (e) {
    console.warn('[OP] onSnapshot failed, fallback:', e);
  }
}

function handleActiveOrdersUpdate(orders) {
  const prevPendingIds = new Set(
    STATE.activeOrders.filter(o => o.status === 'pending').map(o => o.id)
  );

  // Check for newly delivered (from previous active list perspective)
  const activeIds = new Set(orders.map(o => o.id));
  STATE.activeOrders.forEach(prev => {
    if (!activeIds.has(prev.id) && !STATE.knownDeliveredIds.has(prev.id)) {
      // Might have moved to delivered — check via one-time get
      checkIfDelivered(prev.id);
    }
  });

  STATE.activeOrders = orders;

  // Detect new pending orders
  let hasNewPending = false;
  orders.forEach(o => {
    if (o.status === 'pending' && !prevPendingIds.has(o.id) && !STATE.knownPendingIds.has(o.id)) {
      STATE.knownPendingIds.add(o.id);
      hasNewPending = true;
    }
  });

  if (hasNewPending) {
    startPendingAlarm();
  } else if (!orders.some(o => o.status === 'pending')) {
    stopPendingAlarm();
  }

  renderActiveOrders();
  updateBadges();
}

async function checkIfDelivered(orderId) {
  if (STATE.knownDeliveredIds.has(orderId)) return;
  const order = await dbGet('orders', orderId);
  if (order && order.status === 'delivered') {
    STATE.knownDeliveredIds.add(orderId);
    showDeliveredToast(order);
    playDeliveredSound();
  }
}

/* ── Subscribe delivered orders ──────────────────────────────── */
function subscribeDeliveredOrders() {
  if (!isFirebaseReady) return;
  try {
    db.collection('orders')
      .where('status', '==', 'delivered')
      .onSnapshot(snap => {
        snap.docChanges().forEach(change => {
          if (change.type === 'added' || change.type === 'modified') {
            const order = { id: change.doc.id, ...change.doc.data() };
            if (!STATE.knownDeliveredIds.has(order.id)) {
              // Only notify if this was previously in our active set
              if (STATE.knownPendingIds.has(order.id) || STATE.activeOrders.some(o => o.id === order.id)) {
                STATE.knownDeliveredIds.add(order.id);
                showDeliveredToast(order);
                playDeliveredSound();
              } else {
                // Mark as known silently
                STATE.knownDeliveredIds.add(order.id);
              }
            }
          }
        });
      }, () => {});
  } catch (e) {}
}

/* ── Render Active Orders ────────────────────────────────────── */
const STATUS_SORT = { pending: 0, confirmed: 1, cooking: 2, courier_assigned: 3 };

function renderActiveOrders() {
  const container = el('active-orders-list');
  if (!container) return;

  const sorted = [...STATE.activeOrders].sort((a, b) => {
    const sa = STATUS_SORT[a.status] ?? 9;
    const sb = STATUS_SORT[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  });

  if (!sorted.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <h3>Нет активных заказов</h3>
        <p>Новые заказы появятся здесь</p>
      </div>`;
    return;
  }

  container.innerHTML = sorted.map(o => renderOrderCard(o)).join('');
}

function renderOrderCard(o) {
  const isPending = o.status === 'pending';
  const itemsText = (o.items || []).map(i => `${i.name} ×${i.qty}`).join(', ');
  const total = (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);

  return `
    <div class="order-card ${isPending ? 'pulse order-card-pending' : ''}"
         onclick="openOrderDetail('${o.id}')">
      <div class="order-card-header">
        <span class="order-card-id">${orderNum(o.id)}</span>
        <span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
      </div>
      <div class="order-card-info">
        <span>👤 ${o.clientName || 'Клиент'}</span>
        ${o.deliveryAddress ? `<span> · 📍 ${o.deliveryAddress}</span>` : ''}
      </div>
      <div class="order-card-info" style="margin-top:4px">
        ${itemsText ? `<span>${itemsText}</span>` : ''}
      </div>
      ${o.comment ? `<div class="order-card-info" style="margin-top:4px;color:var(--warning)">💬 ${o.comment}</div>` : ''}
      <div class="row" style="margin-top:8px">
        <span class="order-card-info">${fmtTime(o.createdAt)}</span>
        <span class="order-card-total">${total} ₽</span>
      </div>
    </div>`;
}

/* ── Update badges ───────────────────────────────────────────── */
function updateBadges() {
  const pendingCount = STATE.activeOrders.filter(o => o.status === 'pending').length;
  const badgeEl = el('active-tab-badge');
  if (badgeEl) {
    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount;
      badgeEl.style.display = 'inline-flex';
    } else {
      badgeEl.style.display = 'none';
    }
  }
}

/* ── Order Detail ────────────────────────────────────────────── */
async function openOrderDetail(orderId) {
  STATE.currentOrderId = orderId;
  showScreen('order-detail');

  el('order-detail-content').innerHTML = `<div class="spinner"></div>`;

  // Try from active orders first
  let order = STATE.activeOrders.find(o => o.id === orderId);
  if (!order) order = STATE.historyOrders.find(o => o.id === orderId);
  if (!order) order = await dbGet('orders', orderId);

  if (!order) {
    el('order-detail-content').innerHTML = `<div class="empty-state"><div class="icon">❌</div><h3>Заказ не найден</h3></div>`;
    return;
  }

  renderOrderDetail(order);

  // Live updates for this order if still active
  if (['pending','confirmed','cooking','courier_assigned'].includes(order.status)) {
    const unsub = onDocSnapshot('orders', orderId, updated => {
      renderOrderDetail(updated);
    });
    // Store unsub on element for cleanup on back
    el('order-detail-content').dataset.unsub = 'active';
    window._currentOrderUnsub = unsub;
  }
}

function renderOrderDetail(o) {
  const content = el('order-detail-content');
  if (!content) return;

  // Header
  const hdr = el('order-detail-title');
  if (hdr) hdr.textContent = orderNum(o.id);

  const items = o.items || [];
  const total = items.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);

  const itemsHtml = items.length
    ? items.map(i => `
        <div class="order-item-row">
          <span class="order-item-name">${i.name || '—'}</span>
          <span class="order-item-qty">×${i.qty || 1}</span>
          <span class="order-item-price">${(i.price || 0) * (i.qty || 1)} ₽</span>
        </div>`).join('')
    : '<div class="row-label">Нет позиций</div>';

  const deliveryTime = (o.deliveryHours != null && o.deliveryMinutes != null)
    ? `${o.deliveryHours}ч ${o.deliveryMinutes}мин`
    : o.deliveryTime || '—';

  content.innerHTML = `
    <!-- Status -->
    <div class="detail-section">
      <div class="row" style="margin-bottom:8px">
        <span class="section-label">Статус</span>
        <span class="badge ${statusBadgeClass(o.status)} badge-lg">${statusLabel(o.status)}</span>
      </div>
      <div class="row">
        <span class="section-label">Создан</span>
        <span class="detail-value">${fmtDateTime(o.createdAt)}</span>
      </div>
      ${o.confirmedAt ? `<div class="row"><span class="section-label">Принят</span><span class="detail-value">${fmtDateTime(o.confirmedAt)}</span></div>` : ''}
      ${o.assignedAt ? `<div class="row"><span class="section-label">Передан</span><span class="detail-value">${fmtDateTime(o.assignedAt)}</span></div>` : ''}
      ${o.deliveredAt ? `<div class="row"><span class="section-label">Доставлен</span><span class="detail-value">${fmtDateTime(o.deliveredAt)}</span></div>` : ''}
    </div>

    <div class="sep"></div>

    <!-- Client -->
    <div class="detail-section">
      <div class="section-title">Клиент</div>
      <div class="row"><span class="section-label">Имя</span><span class="detail-value">${o.clientName || '—'}</span></div>
      ${o.clientPhone ? `<div class="row"><span class="section-label">Телефон</span><a href="tel:${o.clientPhone}" class="detail-value detail-link">${o.clientPhone}</a></div>` : ''}
    </div>

    <div class="sep"></div>

    <!-- Delivery -->
    <div class="detail-section">
      <div class="section-title">Доставка</div>
      <div class="row"><span class="section-label">Адрес</span><span class="detail-value">${o.deliveryAddress || '—'}</span></div>
      <div class="row"><span class="section-label">Оплата</span><span class="detail-value">${paymentLabel(o.paymentType)}</span></div>
      <div class="row"><span class="section-label">Время</span><span class="detail-value">${deliveryTime}</span></div>
      ${o.comment ? `<div class="row"><span class="section-label">Комментарий</span><span class="detail-value" style="color:var(--warning)">${o.comment}</span></div>` : ''}
    </div>

    <div class="sep"></div>

    <!-- Items -->
    <div class="detail-section">
      <div class="section-title">Состав заказа</div>
      <div class="items-list">${itemsHtml}</div>
      <div class="sep"></div>
      <div class="row">
        <span style="font-weight:700">Итого</span>
        <span style="font-weight:700;font-size:18px;color:var(--accent)">${total} ₽</span>
      </div>
    </div>

    ${o.courierId ? `
    <div class="sep"></div>
    <div class="detail-section">
      <div class="section-title">Курьер</div>
      <div class="row"><span class="section-label">Имя</span><span class="detail-value">${o.courierName || '—'}</span></div>
    </div>` : ''}

    <!-- Action buttons -->
    <div class="detail-actions" id="detail-actions">
      ${renderDetailActions(o)}
    </div>
  `;
}

function renderDetailActions(o) {
  if (o.status === 'pending') {
    return `
      <button class="btn btn-success" onclick="acceptOrder('${o.id}')">✅ Принять заказ</button>
      <button class="btn btn-danger" onclick="showCancelConfirm('${o.id}', '${o.clientTgId || ''}', '${o.clientUid || ''}')">❌ Отменить</button>
    `;
  }
  if (o.status === 'confirmed') {
    return `
      <button class="btn btn-primary" onclick="markCooking('${o.id}')">👨‍🍳 Заказ готовится</button>
      <button class="btn btn-danger" onclick="showCancelConfirm('${o.id}', '${o.clientTgId || ''}', '${o.clientUid || ''}')">❌ Отменить</button>
    `;
  }
  if (o.status === 'cooking') {
    return `
      <button class="btn btn-primary" onclick="showCourierSheet('${o.id}')">🛵 Передать курьеру</button>
      <button class="btn btn-danger" onclick="showCancelConfirm('${o.id}', '${o.clientTgId || ''}', '${o.clientUid || ''}')">❌ Отменить</button>
    `;
  }
  if (o.status === 'courier_assigned') {
    return `<div class="status-info-box">🛵 Заказ передан курьеру — ожидайте доставки</div>`;
  }
  if (o.status === 'delivered') {
    return `<div class="status-info-box success-box">✅ Заказ успешно доставлен</div>`;
  }
  if (o.status === 'cancelled') {
    return `<div class="status-info-box danger-box">❌ Заказ отменён</div>`;
  }
  return '';
}

/* ── Order Actions ───────────────────────────────────────────── */
async function acceptOrder(orderId) {
  const btn = document.querySelector('#detail-actions .btn-success');
  if (btn) { btn.disabled = true; btn.textContent = 'Принимаем...'; }

  const order = STATE.activeOrders.find(o => o.id === orderId) || await dbGet('orders', orderId);

  await dbSet('orders', orderId, {
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    operatorId: STATE.uid,
    operatorName: STATE.staffData?.name || '',
  });

  // Create bot task
  if (order) {
    await dbAddTask('order_confirmed', {
      orderId,
      clientTgId: order.clientTgId || null,
      clientUid:  order.clientUid  || null,
      deliveryHours:   order.deliveryHours   ?? null,
      deliveryMinutes: order.deliveryMinutes ?? null,
    });
  }

  stopPendingAlarm();
  goBack();
}

async function markCooking(orderId) {
  const btn = document.querySelector('#detail-actions .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Обновляем...'; }

  await dbSet('orders', orderId, {
    status: 'cooking',
    cookingAt: new Date().toISOString(),
  });

  goBack();
}

/* ── Cancel (2-step) ─────────────────────────────────────────── */
let _cancelTarget = null;

function showCancelConfirm(orderId, clientTgId, clientUid) {
  _cancelTarget = { orderId, clientTgId, clientUid };
  el('cancel-confirm-overlay').classList.add('show');
}

function hideCancelConfirm() {
  el('cancel-confirm-overlay').classList.remove('show');
  _cancelTarget = null;
}

async function confirmCancel() {
  if (!_cancelTarget) return;
  const { orderId, clientTgId, clientUid } = _cancelTarget;

  const confirmBtn = el('cancel-confirm-btn');
  if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Отменяем...'; }

  await dbSet('orders', orderId, {
    status: 'cancelled',
    cancelledAt: new Date().toISOString(),
    cancelledBy: STATE.uid,
  });

  await dbAddTask('order_cancelled', {
    orderId,
    clientTgId: clientTgId || null,
    clientUid:  clientUid  || null,
  });

  hideCancelConfirm();
  if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Да, отменить'; }
  goBack();
}

/* ── Courier Sheet ───────────────────────────────────────────── */
let _assignOrderId = null;

async function showCourierSheet(orderId) {
  _assignOrderId = orderId;
  const sheet = el('courier-sheet');
  const list  = el('courier-sheet-list');

  sheet.classList.add('show');
  list.innerHTML = '<div class="spinner"></div>';

  // Load active couriers from shifts
  try {
    const shifts = await dbQuery('shifts', 'active', '==', true);
    STATE.couriers = shifts;

    if (!shifts.length) {
      list.innerHTML = `
        <div class="empty-state" style="padding:24px">
          <div class="icon">😔</div>
          <h3>Нет активных курьеров</h3>
          <p>Все курьеры офлайн</p>
        </div>`;
      return;
    }

    list.innerHTML = shifts.map(s => `
      <div class="courier-item" onclick="assignCourier('${s.uid || s.id}', '${encodeURIComponent(s.name || s.courierName || 'Курьер')}')">
        <div class="courier-avatar">🛵</div>
        <div class="courier-info">
          <div class="courier-name">${s.name || s.courierName || 'Курьер'}</div>
          <div class="courier-meta">На смене с ${fmtTime(s.startedAt || s.shiftStart)}</div>
        </div>
        <div class="courier-arrow">›</div>
      </div>`).join('');
  } catch (e) {
    console.warn('[OP] Load couriers error:', e);
    list.innerHTML = '<div class="empty-state"><p>Ошибка загрузки</p></div>';
  }
}

function hideCourierSheet() {
  el('courier-sheet').classList.remove('show');
  _assignOrderId = null;
}

async function assignCourier(courierUid, encodedName) {
  if (!_assignOrderId) return;
  const courierName = decodeURIComponent(encodedName);

  hideCourierSheet();

  await dbSet('orders', _assignOrderId, {
    status: 'courier_assigned',
    courierId:   courierUid,
    courierName: courierName,
    assignedAt:  new Date().toISOString(),
    assignedBy:  STATE.uid,
  });

  goBack();
}

/* ── History Tab ─────────────────────────────────────────────── */
async function loadHistory(dateStr) {
  STATE.historyDate = dateStr;
  const container = el('history-orders-list');
  if (!container) return;
  container.innerHTML = '<div class="spinner"></div>';

  try {
    // Query orders for the given date
    const startOfDay = dateStr + 'T00:00:00.000Z';
    const endOfDay   = dateStr + 'T23:59:59.999Z';

    let orders = [];
    if (isFirebaseReady) {
      const snap = await db.collection('orders')
        .where('createdAt', '>=', startOfDay)
        .where('createdAt', '<=', endOfDay)
        .orderBy('createdAt', 'desc')
        .get();
      orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } else {
      // Fallback: load all and filter
      const all = await dbQueryAll('orders');
      orders = all.filter(o => o.createdAt && o.createdAt.startsWith(dateStr));
    }

    STATE.historyOrders = orders;
    renderHistoryOrders(orders);
  } catch (e) {
    console.warn('[OP] History load error:', e);
    container.innerHTML = '<div class="empty-state"><p>Ошибка загрузки</p></div>';
  }
}

function renderHistoryOrders(orders) {
  const container = el('history-orders-list');
  if (!container) return;

  if (!orders.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="icon">📋</div>
        <h3>Заказов нет</h3>
        <p>В этот день заказов не было</p>
      </div>`;
    return;
  }

  // Group by status summary
  const delivered  = orders.filter(o => o.status === 'delivered').length;
  const cancelled  = orders.filter(o => o.status === 'cancelled').length;
  const totalSum   = orders.reduce((s, o) => {
    const t = (o.items || []).reduce((ss, i) => ss + (i.price || 0) * (i.qty || 1), 0);
    return s + t;
  }, 0);

  container.innerHTML = `
    <div class="history-summary">
      <div class="history-stat">
        <span class="history-stat-val">${orders.length}</span>
        <span class="history-stat-lbl">Всего</span>
      </div>
      <div class="history-stat">
        <span class="history-stat-val" style="color:var(--success)">${delivered}</span>
        <span class="history-stat-lbl">Доставлено</span>
      </div>
      <div class="history-stat">
        <span class="history-stat-val" style="color:var(--danger)">${cancelled}</span>
        <span class="history-stat-lbl">Отменено</span>
      </div>
      <div class="history-stat">
        <span class="history-stat-val" style="color:var(--accent)">${totalSum} ₽</span>
        <span class="history-stat-lbl">Выручка</span>
      </div>
    </div>
    ${orders.map(o => {
      const total = (o.items || []).reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
      return `
        <div class="order-card" onclick="openOrderDetail('${o.id}')">
          <div class="order-card-header">
            <span class="order-card-id">${orderNum(o.id)}</span>
            <span class="badge ${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
          </div>
          <div class="order-card-info">${o.clientName || 'Клиент'} · ${fmtTime(o.createdAt)}</div>
          <div class="row" style="margin-top:6px">
            <span class="order-card-info">${(o.items || []).map(i => i.name).join(', ')}</span>
            <span class="order-card-total">${total} ₽</span>
          </div>
        </div>`;
    }).join('')}
  `;
}

/* ── Tabs ─────────────────────────────────────────────────────── */
function switchTab(tab) {
  STATE.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const activeBtn = el('tab-' + tab);
  if (activeBtn) activeBtn.classList.add('active');

  el('panel-active')?.classList.toggle('hidden', tab !== 'active');
  el('panel-history')?.classList.toggle('hidden', tab !== 'history');

  if (tab === 'history') {
    el('history-date-input').value = STATE.historyDate;
    loadHistory(STATE.historyDate);
  }
}

/* ── Toast ───────────────────────────────────────────────────── */
function showDeliveredToast(order) {
  const container = el('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast toast-delivered';
  toast.innerHTML = `<span>✅</span> Заказ ${orderNum(order.id)} доставлен`;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 4000);
}

function showToast(msg, type = 'info') {
  const container = el('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/* ── Navigation ──────────────────────────────────────────────── */
function goBack() {
  if (window._currentOrderUnsub) {
    try { window._currentOrderUnsub(); } catch (e) {}
    window._currentOrderUnsub = null;
  }
  STATE.currentOrderId = null;
  showScreen('main');
}

/* ── Refresh on resume ────────────────────────────────────────── */
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && STATE.uid) {
    if (STATE.activeTab === 'history') loadHistory(STATE.historyDate);
  }
});

/* ── Boot ─────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Try to init Telegram WebApp
  try {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  } catch (e) {}

  init().then(() => {
    // Start delivered orders subscription after init
    if (STATE.uid) subscribeDeliveredOrders();
  });
});
