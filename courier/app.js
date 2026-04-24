'use strict';
/* ============================================================
   COURIER APP
   ============================================================ */

const STATE = { uid: null, user: null };
let _onShift        = false;
let _myDeliveries   = [];
let _currentOrderId = null;
let _unsubDeliveries = null;

// ── Boot ──
window.addEventListener('DOMContentLoaded', async () => {
  tgReady();
  try {
    const s = JSON.parse(localStorage.getItem('dlv_courier_state') || '{}');
    STATE.uid = s.uid || null; STATE.user = s.user || null;
  } catch {}

  const urlUid = readUidFromUrl();
  if (urlUid) { STATE.uid = urlUid; saveState(); }

  await initFirebase();

  if (!STATE.uid) { showScreen('s-no-access'); return; }

  const user = await dbGet('users', STATE.uid);
  if (!user || user.role !== 'courier') { showScreen('s-no-access'); return; }

  STATE.user = user; saveState();
  initMain();
});

function saveState() {
  try { localStorage.setItem('dlv_courier_state', JSON.stringify({ uid: STATE.uid, user: STATE.user })); } catch {}
}

function initMain() {
  document.getElementById('main-nav').style.display = 'flex';
  startHeartbeat(STATE.uid);
  loadCourierStatus();
  watchMyDeliveries();
  setCourierTab('s-deliveries', document.getElementById('nav-del'));
}

function setCourierTab(screenId, el) {
  showScreen(screenId);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════
// SHIFT MANAGEMENT
// ══════════════════════════════════════════════════════════

async function loadCourierStatus() {
  const data = await dbGet('couriers', STATE.uid) || {};
  _onShift = !!data.onShift;
  updateShiftUI(data);
}

function updateShiftUI(data = {}) {
  const badge     = document.getElementById('shift-badge');
  const offCard   = document.getElementById('shift-off-card');
  const onContent = document.getElementById('deliveries-content');
  const dot       = document.getElementById('shift-dot');
  const title     = document.getElementById('shift-title');

  if (_onShift) {
    badge.textContent = '● На смене';
    badge.className   = 'badge badge-online';
    dot.classList.add('online');
    title.textContent = 'Вы на смене';
    offCard.classList.add('hidden');
    onContent.classList.remove('hidden');
    if (data.shiftStartedAt) {
      document.getElementById('shift-since').textContent =
        'С ' + fmtTime(data.shiftStartedAt);
    }
  } else {
    badge.textContent = '● Не на смене';
    badge.className   = 'badge badge-cancelled';
    dot.classList.remove('online');
    title.textContent = 'Вы не на смене';
    offCard.classList.remove('hidden');
    onContent.classList.add('hidden');
  }
}

async function startShift() {
  _onShift = true;
  const now = new Date().toISOString();
  await dbSet('couriers', STATE.uid, {
    id:             STATE.uid,
    name:           STATE.user?.name || 'Курьер',
    phone:          STATE.user?.phone || '',
    tgId:           STATE.user?.tgId  || '',
    onShift:        true,
    shiftStartedAt: now
  });
  tgHaptic('success');
  playSuccess();
  showToast('Смена начата!', 'success');
  updateShiftUI({ onShift: true, shiftStartedAt: now });
}

async function endShift() {
  if (_myDeliveries.length > 0) {
    showToast('Завершите все доставки перед окончанием смены', 'warning');
    return;
  }
  _onShift = false;
  await dbSet('couriers', STATE.uid, { onShift: false, shiftEndedAt: new Date().toISOString() });
  tgHaptic('light');
  showToast('Смена завершена', 'info');
  updateShiftUI({ onShift: false });
}

function toggleShift() {
  if (_onShift) endShift(); else startShift();
}

// ══════════════════════════════════════════════════════════
// MY DELIVERIES
// ══════════════════════════════════════════════════════════

function watchMyDeliveries() {
  if (_unsubDeliveries) _unsubDeliveries();
  _unsubDeliveries = onQuerySnap('orders', 'courierUid', '==', STATE.uid, orders => {
    _myDeliveries = orders.filter(o => o.status === 'delivering')
                          .sort((a, b) => (a.createdAt||'').localeCompare(b.createdAt||''));
    renderMyDeliveries();
    const badge = document.getElementById('del-badge');
    if (_myDeliveries.length > 0) {
      badge.textContent = _myDeliveries.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  });
}

function renderMyDeliveries() {
  const container = document.getElementById('my-deliveries-list');
  if (!_myDeliveries.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📦</div><div class="empty-text">Нет активных доставок.<br>Ожидайте заказы от оператора.</div></div>';
    return;
  }
  container.innerHTML = _myDeliveries.map(o => {
    const rem = o.estimatedAt ? new Date(o.estimatedAt).getTime() - Date.now() : null;
    const urgent = rem !== null && rem < 5 * 60 * 1000;
    const addr = o.address || {};
    return `
    <div class="delivery-card" style="${urgent ? 'border-color:var(--danger)' : ''}">
      <div class="delivery-card-hdr">
        <div>
          <div class="font-bold text-sm">#${(o.id||'').slice(-6)}</div>
          <div class="text-xs text-dim">${fmtTime(o.createdAt)}</div>
        </div>
        ${rem !== null ? `<div class="countdown-val ${urgent?'urgent':''}" style="font-size:20px">${fmtCountdown(rem)}</div>` : ''}
      </div>
      <div class="delivery-card-body">
        <div class="order-row"><span class="order-row-icon">👤</span><b>${o.clientName||'Клиент'}</b> ${o.clientPhone?'· '+o.clientPhone:''}</div>
        <div class="order-row" style="font-weight:700"><span class="order-row-icon">📍</span>${addr.street||''} ${addr.house||''}, кв. ${addr.apt||'—'}${addr.hasIntercom?' 🔔 код: '+(addr.intercomCode||'есть'):''}</div>
        <div class="order-row"><span class="order-row-icon">💳</span>${o.payment==='cash'?'💵 Наличные':'💳 Карта'}</div>
        <div class="order-row"><span class="order-row-icon">💰</span>Сумма: <b class="text-primary">${fmtPrice(o.total)}</b></div>
        ${urgent ? '<div class="alert-box danger text-xs" style="margin-top:4px">⚠️ Срок доставки скоро истекает!</div>' : ''}
      </div>
      <div class="delivery-card-foot">
        <div class="btn-row">
          <button class="btn btn-sm btn-secondary" onclick="openOrderDetail('${o.id}')">📋 Детали</button>
          <button class="btn btn-sm btn-success" onclick="promptDelivered('${o.id}')">✅ Доставил</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Update countdowns every second
  startCountdownTick();
}

let _tickInterval = null;
function startCountdownTick() {
  if (_tickInterval) return;
  _tickInterval = setInterval(() => {
    _myDeliveries.forEach(o => {
      if (!o.estimatedAt) return;
      const rem = new Date(o.estimatedAt).getTime() - Date.now();
      // Minimal DOM update to avoid full re-render
    });
  }, 1000);
}

// ── Order detail ──
function openOrderDetail(orderId) {
  _currentOrderId = orderId;
  const o = _myDeliveries.find(x => x.id === orderId);
  if (!o) return;
  const addr = o.address || {};

  document.getElementById('order-detail-content').innerHTML = `
    <div class="sheet-title" style="margin-bottom:12px">#${(o.id||'').slice(-6)}</div>
    <div style="display:flex;flex-direction:column;gap:7px">
      <div class="order-row"><span class="order-row-icon">👤</span><b>${o.clientName||'—'}</b></div>
      ${o.clientPhone ? `<div class="order-row"><span class="order-row-icon">📞</span>${o.clientPhone}</div>` : ''}
      <div class="order-row"><span class="order-row-icon">📍</span><b>${addr.street||''} ${addr.house||''}, кв.${addr.apt||'—'}${addr.hasIntercom?' (домофон: '+(addr.intercomCode||'есть')+')':''}</b></div>
      <div class="order-row"><span class="order-row-icon">💳</span>${o.payment==='cash'?'💵 Наличные':'💳 Карта'}</div>
      <div class="separator" style="margin:6px 0"></div>
      ${(o.items||[]).map(it=>`
        <div class="flex justify-between text-sm">
          <span>${it.emoji||'🍽️'} ${it.name} ×${it.qty}</span>
          <span class="font-bold">${fmtPrice(it.price*it.qty)}</span>
        </div>`).join('')}
      <div class="separator" style="margin:6px 0"></div>
      <div class="flex justify-between font-bold"><span>Итого</span><span class="text-primary">${fmtPrice(o.total)}</span></div>
      ${o.comment ? `<div class="alert-box info text-sm" style="margin-top:4px">💬 ${o.comment}</div>` : ''}
    </div>
  `;
  document.getElementById('order-detail-actions').innerHTML = `
    <button class="btn btn-success" onclick="document.getElementById('order-detail-overlay').classList.remove('open');promptDelivered('${o.id}')">✅ Доставил</button>
    <button class="btn btn-danger"  onclick="document.getElementById('order-detail-overlay').classList.remove('open');promptReturn('${o.id}')">↩️ Возврат</button>
  `;
  document.getElementById('order-detail-overlay').classList.add('open');
}

// ── Delivered confirm ──
function promptDelivered(orderId) {
  _currentOrderId = orderId;
  document.getElementById('delivered-overlay').classList.add('open');
}

async function confirmDelivered() {
  if (!_currentOrderId) return;
  const orderId = _currentOrderId;

  await dbSet('orders', orderId, {
    status:      'delivered',
    deliveredAt: new Date().toISOString(),
    clientNotification: { type: 'delivered', message: 'Заказ доставлен!', seen: false }
  });

  document.getElementById('delivered-overlay').classList.remove('open');
  _currentOrderId = null;
  tgHaptic('success');
  playSuccess();
  showToast('Доставка подтверждена!', 'success');
}

// ── Return confirm ──
function promptReturn(orderId) {
  _currentOrderId = orderId;
  document.getElementById('return-overlay').classList.add('open');
}

async function confirmReturn() {
  if (!_currentOrderId) return;
  await dbSet('orders', _currentOrderId, {
    status:      'cancelled',
    cancelledAt: new Date().toISOString(),
    returnedByCourier: true,
    clientNotification: { type: 'cancelled', message: 'Заказ не был доставлен.', seen: false }
  });
  document.getElementById('return-overlay').classList.remove('open');
  _currentOrderId = null;
  showToast('Возврат оформлен', 'warning');
}

// ══════════════════════════════════════════════════════════
// DELIVERY HISTORY
// ══════════════════════════════════════════════════════════

async function loadDeliveryHistory() {
  const container = document.getElementById('delivery-history-list');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  const all = (await dbQuery('orders', 'courierUid', '==', STATE.uid))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    .slice(0, 100);
  const done = all.filter(o => ['delivered','cancelled'].includes(o.status));

  if (!done.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">История доставок пуста</div></div>';
    return;
  }

  const delivered = done.filter(o => o.status === 'delivered');
  const revenue   = delivered.reduce((s, o) => s + (o.total || 0), 0);

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val text-success">${delivered.length}</div><div class="stat-lbl">Доставлено</div></div>
      <div class="stat-card"><div class="stat-val text-primary">${fmtPrice(revenue)}</div><div class="stat-lbl">Сумма</div></div>
    </div>
    ${done.map(o => `
      <div class="delivery-card">
        <div class="delivery-card-hdr">
          <div>
            <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
            <div class="order-id" style="margin-top:3px">#${(o.id||'').slice(-6)}</div>
          </div>
          <div style="text-align:right">
            <div class="font-bold text-primary">${fmtPrice(o.total)}</div>
            <div class="text-xs text-dim">${fmtDate(o.createdAt)}</div>
          </div>
        </div>
        <div class="delivery-card-body">
          <div class="order-row"><span class="order-row-icon">👤</span>${o.clientName||'—'}</div>
          <div class="order-row"><span class="order-row-icon">📍</span>${o.address?o.address.street+' '+o.address.house:'—'}</div>
          <div class="text-xs text-dim">${(o.items||[]).map(i=>i.name+'×'+i.qty).join(', ')}</div>
        </div>
      </div>
    `).join('')}
  `;
}
