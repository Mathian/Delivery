'use strict';

// ─── STATE ────────────────────────────────────────────────────────────────────
const STATE = {
  uid: null,
  staffData: null,
  shiftActive: false,
  shiftData: null,
  activeOrders: [],
  historyOrders: [],
  activeTab: 'active',
  countdownInterval: null,
  shiftDurationInterval: null,
  unsubscribeActive: null,
  unsubscribeHistory: null,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function formatTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}ч ${m}м`;
  if (m > 0) return `${m}м ${s}с`;
  return `${s}с`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, type = 'info') {
  const existing = document.getElementById('courier-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'courier-toast';
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────────────────────
function showConfirm(message, onConfirm, onCancel) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <p class="confirm-message">${escapeHtml(message)}</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary confirm-cancel">Отмена</button>
        <button class="btn btn-primary confirm-ok">Подтвердить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.confirm-cancel').onclick = () => {
    overlay.remove();
    if (onCancel) onCancel();
  };
  overlay.querySelector('.confirm-ok').onclick = () => {
    overlay.remove();
    onConfirm();
  };
}

// ─── URL UID EXTRACTION ───────────────────────────────────────────────────────
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

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function init() {
  showScreen('s-loading');
  STATE.uid = extractUid() || localStorage.getItem('courier_uid');
  if (!STATE.uid) {
    showScreen('s-no-uid');
    return;
  }
  localStorage.setItem('courier_uid', STATE.uid);

  try {
    const staffData = await dbGet('staff_uids', STATE.uid);
    if (!staffData || staffData.role !== 'courier') {
      showScreen('s-no-uid');
      return;
    }
    STATE.staffData = staffData;
    startHeartbeat(STATE.uid);
    await loadShift();
    setupMainScreen();
    showScreen('s-main');
    subscribeActiveOrders();
    subscribeHistoryOrders();
  } catch (e) {
    console.error('Init error:', e);
    toast('Ошибка инициализации', 'error');
    showScreen('s-no-uid');
  }
}

// ─── SHIFT MANAGEMENT ────────────────────────────────────────────────────────
async function loadShift() {
  try {
    const shift = await dbGet('shifts', STATE.uid);
    STATE.shiftData = shift;
    STATE.shiftActive = !!(shift && shift.active);
    updateShiftUI();
  } catch (e) {
    console.error('Load shift error:', e);
  }
}

function updateShiftUI() {
  const banner = document.getElementById('shift-banner');
  const startBtn = document.getElementById('btn-start-shift');
  const endBtn = document.getElementById('btn-end-shift');

  if (STATE.shiftActive && STATE.shiftData) {
    if (banner) {
      banner.style.display = 'block';
      const startTime = new Date(STATE.shiftData.startTime);
      document.getElementById('shift-start-time').textContent = formatTime(STATE.shiftData.startTime);
      updateShiftDuration();
      if (STATE.shiftDurationInterval) clearInterval(STATE.shiftDurationInterval);
      STATE.shiftDurationInterval = setInterval(updateShiftDuration, 30000);
    }
    if (startBtn) startBtn.style.display = 'none';
    if (endBtn) endBtn.style.display = 'inline-flex';
  } else {
    if (banner) banner.style.display = 'none';
    if (startBtn) startBtn.style.display = 'inline-flex';
    if (endBtn) endBtn.style.display = 'none';
    if (STATE.shiftDurationInterval) {
      clearInterval(STATE.shiftDurationInterval);
      STATE.shiftDurationInterval = null;
    }
  }
}

function updateShiftDuration() {
  const el = document.getElementById('shift-duration');
  if (!el || !STATE.shiftData || !STATE.shiftData.startTime) return;
  const elapsed = Date.now() - new Date(STATE.shiftData.startTime).getTime();
  el.textContent = formatDuration(elapsed);
}

async function startShift() {
  if (!STATE.staffData) return;
  const shiftDoc = {
    uid: STATE.uid,
    tgId: STATE.staffData.tgId || null,
    name: STATE.staffData.name || 'Курьер',
    active: true,
    startTime: new Date().toISOString(),
  };
  try {
    await dbSet('shifts', STATE.uid, shiftDoc);
    STATE.shiftData = shiftDoc;
    STATE.shiftActive = true;
    updateShiftUI();
    toast('Смена начата', 'success');
  } catch (e) {
    console.error('Start shift error:', e);
    toast('Ошибка при начале смены', 'error');
  }
}

async function endShift() {
  showConfirm('Завершить смену?', async () => {
    try {
      await dbSet('shifts', STATE.uid, { ...STATE.shiftData, active: false });
      STATE.shiftActive = false;
      STATE.shiftData = { ...STATE.shiftData, active: false };
      updateShiftUI();
      toast('Смена завершена', 'success');
    } catch (e) {
      console.error('End shift error:', e);
      toast('Ошибка при завершении смены', 'error');
    }
  });
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  STATE.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.dataset.tab === tab);
  });
}

// ─── ACTIVE ORDERS ────────────────────────────────────────────────────────────
function subscribeActiveOrders() {
  if (STATE.unsubscribeActive) STATE.unsubscribeActive();
  STATE.unsubscribeActive = onSnapshotQuery(
    'orders',
    [
      { field: 'courierId', op: '==', value: STATE.uid },
      { field: 'status', op: '==', value: 'courier_assigned' },
    ],
    (orders) => {
      STATE.activeOrders = orders || [];
      renderActiveOrders();
    }
  );
}

function subscribeHistoryOrders() {
  if (STATE.unsubscribeHistory) STATE.unsubscribeHistory();
  STATE.unsubscribeHistory = onSnapshotQuery(
    'orders',
    [
      { field: 'courierId', op: '==', value: STATE.uid },
      { field: 'status', op: '==', value: 'delivered' },
    ],
    (orders) => {
      STATE.historyOrders = (orders || []).sort((a, b) =>
        new Date(b.deliveredAt || b.createdAt) - new Date(a.deliveredAt || a.createdAt)
      );
      renderHistoryOrders();
    }
  );
}

function renderActiveOrders() {
  const container = document.getElementById('active-orders-list');
  if (!container) return;

  if (STATE.countdownInterval) {
    clearInterval(STATE.countdownInterval);
    STATE.countdownInterval = null;
  }

  if (STATE.activeOrders.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📦</div>
      <p>Нет активных доставок</p>
    </div>`;
    return;
  }

  container.innerHTML = STATE.activeOrders.map(order => buildOrderCard(order)).join('');

  container.querySelectorAll('.order-card').forEach(card => {
    card.addEventListener('click', () => {
      const orderId = card.dataset.orderId;
      const order = STATE.activeOrders.find(o => o.id === orderId);
      if (order) showOrderDetail(order);
    });
  });

  updateCountdownBars();
  STATE.countdownInterval = setInterval(updateCountdownBars, 30000);
}

function buildOrderCard(order) {
  const clientName = escapeHtml(order.clientName || 'Клиент');
  const address = escapeHtml(order.address || order.deliveryAddress || '—');
  const orderTime = formatDateTime(order.createdAt);
  const estimatedTime = formatDateTime(order.estimatedDeliveryAt);

  const now = Date.now();
  const assigned = order.assignedAt ? new Date(order.assignedAt).getTime() : now;
  const estimated = order.estimatedDeliveryAt ? new Date(order.estimatedDeliveryAt).getTime() : (now + 3600000);
  const total = estimated - assigned;
  const elapsed = now - assigned;
  const percent = Math.min(100, Math.max(0, total > 0 ? (elapsed / total) * 100 : 0));
  const isLate = now > estimated;

  return `
    <div class="order-card ${isLate ? 'order-late' : ''}" data-order-id="${escapeHtml(order.id)}" data-assigned="${assigned}" data-estimated="${estimated}">
      <div class="order-card-header">
        <span class="order-client">${clientName}</span>
        <span class="order-number">#${escapeHtml(String(order.orderNumber || order.id.slice(-6)))}</span>
      </div>
      <div class="order-address"><span class="icon">📍</span> ${address}</div>
      <div class="order-times">
        <span>Принят: ${orderTime}</span>
        <span>Доставить до: ${estimatedTime}</span>
      </div>
      <div class="countdown-bar-wrap">
        <div class="countdown-bar ${isLate ? 'bar-late' : ''}" data-order-id="${escapeHtml(order.id)}" style="width:${percent}%"></div>
      </div>
      <div class="countdown-label ${isLate ? 'text-danger' : ''}" data-countdown-label="${escapeHtml(order.id)}">
        ${isLate ? 'Время истекло' : 'Осталось: ' + formatDuration(estimated - now)}
      </div>
    </div>`;
}

function updateCountdownBars() {
  const now = Date.now();
  document.querySelectorAll('.order-card[data-order-id]').forEach(card => {
    const assigned = parseInt(card.dataset.assigned, 10);
    const estimated = parseInt(card.dataset.estimated, 10);
    const total = estimated - assigned;
    const elapsed = now - assigned;
    const percent = Math.min(100, Math.max(0, total > 0 ? (elapsed / total) * 100 : 0));
    const isLate = now > estimated;
    const orderId = card.dataset.orderId;

    const bar = card.querySelector(`.countdown-bar[data-order-id="${orderId}"]`);
    const label = card.querySelector(`[data-countdown-label="${orderId}"]`);
    if (bar) {
      bar.style.width = percent + '%';
      bar.classList.toggle('bar-late', isLate);
    }
    if (label) {
      label.textContent = isLate ? 'Время истекло' : 'Осталось: ' + formatDuration(estimated - now);
      label.classList.toggle('text-danger', isLate);
    }
    card.classList.toggle('order-late', isLate);
  });
}

// ─── HISTORY ORDERS ───────────────────────────────────────────────────────────
function renderHistoryOrders() {
  const container = document.getElementById('history-orders-list');
  if (!container) return;

  if (STATE.historyOrders.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>История доставок пуста</p>
    </div>`;
    return;
  }

  container.innerHTML = STATE.historyOrders.map(order => {
    const address = escapeHtml(order.address || order.deliveryAddress || '—');
    const deliveredAt = formatDateTime(order.deliveredAt);
    const total = order.total || order.totalPrice || 0;
    return `
      <div class="history-card">
        <div class="history-card-header">
          <span class="history-number">#${escapeHtml(String(order.orderNumber || order.id.slice(-6)))}</span>
          <span class="history-total">${total} ₽</span>
        </div>
        <div class="history-address"><span class="icon">📍</span> ${address}</div>
        <div class="history-time">Доставлено: ${deliveredAt}</div>
      </div>`;
  }).join('');
}

// ─── ORDER DETAIL SHEET ───────────────────────────────────────────────────────
function showOrderDetail(order) {
  const existing = document.getElementById('order-detail-sheet');
  if (existing) existing.remove();

  const items = (order.items || []).map(item =>
    `<div class="detail-item">
      <span class="detail-item-name">${escapeHtml(item.name)}</span>
      <span class="detail-item-qty">×${item.quantity || 1}</span>
      <span class="detail-item-price">${(item.price || 0) * (item.quantity || 1)} ₽</span>
    </div>`
  ).join('');

  const total = order.total || order.totalPrice || 0;
  const address = escapeHtml(order.address || order.deliveryAddress || '—');
  const phone = escapeHtml(order.clientPhone || order.phone || '—');
  const paymentType = escapeHtml(order.paymentType || order.payment || '—');
  const clientName = escapeHtml(order.clientName || '—');

  const sheet = document.createElement('div');
  sheet.id = 'order-detail-sheet';
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = `
    <div class="bottom-sheet-overlay"></div>
    <div class="bottom-sheet-content">
      <div class="sheet-header">
        <h3>Заказ #${escapeHtml(String(order.orderNumber || order.id.slice(-6)))}</h3>
        <button class="sheet-close" id="sheet-close-btn">✕</button>
      </div>
      <div class="sheet-body">
        <div class="detail-section">
          <div class="detail-row"><span class="detail-label">Клиент</span><span>${clientName}</span></div>
          <div class="detail-row"><span class="detail-label">Телефон</span><span>${phone}</span></div>
          <div class="detail-row"><span class="detail-label">Адрес</span><span>${address}</span></div>
          <div class="detail-row"><span class="detail-label">Оплата</span><span>${paymentType}</span></div>
        </div>
        <div class="detail-section">
          <h4 class="section-title">Состав заказа</h4>
          ${items || '<p class="text-muted">Нет данных о составе</p>'}
        </div>
        <div class="detail-total">Итого: <strong>${total} ₽</strong></div>
        <div class="sheet-actions">
          <button class="btn btn-success btn-lg" id="btn-delivered">✓ Доставил</button>
          <button class="btn btn-warning btn-lg" id="btn-return">↩ Возврат</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('open'));

  function closeSheet() {
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 300);
  }

  sheet.querySelector('.bottom-sheet-overlay').onclick = closeSheet;
  sheet.querySelector('#sheet-close-btn').onclick = closeSheet;

  sheet.querySelector('#btn-delivered').onclick = () => {
    showConfirm('Подтвердить доставку заказа?', async () => {
      closeSheet();
      await markDelivered(order);
    });
  };

  sheet.querySelector('#btn-return').onclick = () => {
    showConfirm('Оформить возврат заказа?', async () => {
      closeSheet();
      await markReturned(order);
    });
  };
}

// ─── ORDER ACTIONS ────────────────────────────────────────────────────────────
async function markDelivered(order) {
  try {
    await dbSet('orders', order.id, {
      ...order,
      status: 'delivered',
      deliveredAt: new Date().toISOString(),
    });
    await dbAddTask({
      type: 'order_delivered',
      orderId: order.id,
      clientTgId: order.clientTgId || null,
      clientUid: order.clientUid || null,
      courierId: STATE.uid,
      createdAt: new Date().toISOString(),
    });
    toast('Доставка подтверждена', 'success');
  } catch (e) {
    console.error('Mark delivered error:', e);
    toast('Ошибка при обновлении статуса', 'error');
  }
}

async function markReturned(order) {
  try {
    await dbSet('orders', order.id, {
      ...order,
      status: 'returned',
      returnedAt: new Date().toISOString(),
    });
    toast('Возврат оформлен', 'success');
  } catch (e) {
    console.error('Mark returned error:', e);
    toast('Ошибка при оформлении возврата', 'error');
  }
}

// ─── SETUP MAIN SCREEN ────────────────────────────────────────────────────────
function setupMainScreen() {
  const nameEl = document.getElementById('courier-name');
  if (nameEl && STATE.staffData) {
    nameEl.textContent = STATE.staffData.name || 'Курьер';
  }

  document.getElementById('btn-start-shift')?.addEventListener('click', startShift);
  document.getElementById('btn-end-shift')?.addEventListener('click', endShift);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  switchTab('active');
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
