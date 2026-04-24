'use strict';
/* ============================================================
   OPERATOR APP
   ============================================================ */

const STATE = { uid: null, user: null };
let _pendingOrders  = [];   // new orders waiting acceptance
let _activeOrders   = [];   // accepted/cooking/delivering
let _currentOrderId = null; // order being reviewed
let _beepInterval   = null;
let _unsubPending   = null;
let _unsubActive    = null;
let _unsubDelivered = null;

// ── Boot ──
window.addEventListener('DOMContentLoaded', async () => {
  tgReady();
  try {
    const s = JSON.parse(localStorage.getItem('dlv_op_state') || '{}');
    STATE.uid = s.uid || null; STATE.user = s.user || null;
  } catch {}

  const urlUid = readUidFromUrl();
  if (urlUid) { STATE.uid = urlUid; saveState(); }

  await initFirebase();

  if (!STATE.uid) { showScreen('s-no-access'); return; }

  const user = await dbGet('users', STATE.uid);
  if (!user || user.role !== 'operator') { showScreen('s-no-access'); return; }
  if (user.blocked) { showScreen('s-blocked'); return; }

  STATE.user = user; saveState();
  initMain();
});

function saveState() {
  try { localStorage.setItem('dlv_op_state', JSON.stringify({ uid: STATE.uid, user: STATE.user })); } catch {}
}

function initMain() {
  document.getElementById('main-nav').style.display = 'flex';
  startHeartbeat(STATE.uid);
  watchPendingOrders();
  loadActiveOrders();
  watchDeliveredOrders();
  setTab('s-new', document.getElementById('nav-new'));
}

function setTab(screenId, el) {
  showScreen(screenId);
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════
// PENDING ORDERS (with sound alert)
// ══════════════════════════════════════════════════════════

function watchPendingOrders() {
  if (_unsubPending) _unsubPending();
  _unsubPending = onQuerySnap('orders', 'status', '==', 'pending', orders => {
    orders.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const isNew = orders.length > _pendingOrders.length;
    _pendingOrders = orders;
    renderPendingOrders();
    updateNewBadge(orders.length);

    if (orders.length > 0) {
      startBeeping();
      if (isNew) playNewOrder();
    } else {
      stopBeeping();
    }
  });
}

function startBeeping() {
  if (_beepInterval) return;
  _beepInterval = setInterval(() => {
    if (_pendingOrders.length > 0 && document.getElementById('s-new').classList.contains('active')) {
      playBeep();
    }
  }, 2000);
}

function stopBeeping() {
  if (_beepInterval) { clearInterval(_beepInterval); _beepInterval = null; }
}

function updateNewBadge(count) {
  const b1 = document.getElementById('new-count-badge');
  const b2 = document.getElementById('new-nav-badge');
  if (count > 0) {
    b1.textContent = count; b1.classList.remove('hidden');
    b2.textContent = count; b2.classList.remove('hidden');
  } else {
    b1.classList.add('hidden');
    b2.classList.add('hidden');
  }
}

function renderPendingOrders() {
  const container = document.getElementById('new-orders-list');
  if (!_pendingOrders.length) {
    stopBeeping();
    container.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">Нет новых заказов</div></div>';
    return;
  }
  container.innerHTML = _pendingOrders.map(o => `
    <div class="order-card" style="border-color:var(--warning);cursor:pointer" onclick="openOrderConfirm('${o.id}')">
      <div class="order-card-hdr">
        <div>
          <div class="font-bold text-sm">🆕 Новый заказ</div>
          <div class="order-id">#${(o.id||'').slice(-6)} · ${fmtTime(o.createdAt)}</div>
        </div>
        <div class="order-total">${fmtPrice(o.total)}</div>
      </div>
      <div class="order-card-body">
        <div class="order-row"><span class="order-row-icon">👤</span><b>${o.clientName||'Клиент'}</b> ${o.clientPhone ? '· ' + o.clientPhone : ''}</div>
        <div class="order-row"><span class="order-row-icon">📍</span>${o.address ? o.address.street + ' ' + o.address.house + (o.address.apt?', кв.'+o.address.apt:'') : '—'}</div>
        <div class="order-row"><span class="order-row-icon">💳</span>${o.payment === 'cash' ? 'Наличные' : 'Карта'}</div>
        <div class="order-row"><span class="order-row-icon">🍽️</span>${(o.items||[]).map(i=>`${i.emoji||''}${i.name} ×${i.qty}`).join(', ')}</div>
        ${o.comment ? `<div class="order-row"><span class="order-row-icon">💬</span>${o.comment}</div>` : ''}
      </div>
      <div class="order-card-foot">
        <button class="btn btn-success btn-sm" onclick="event.stopPropagation();quickAccept('${o.id}')">✅ Принять</button>
      </div>
    </div>
  `).join('');
}

// ── Open full confirm dialog ──
function openOrderConfirm(orderId) {
  _currentOrderId = orderId;
  const o = _pendingOrders.find(x => x.id === orderId);
  if (!o) return;
  const addr = o.address || {};

  document.getElementById('confirm-order-content').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px">
      <div class="order-row"><span class="order-row-icon">👤</span><b>${o.clientName||'—'}</b></div>
      ${o.clientPhone ? `<div class="order-row"><span class="order-row-icon">📞</span>${o.clientPhone}</div>` : ''}
      <div class="order-row"><span class="order-row-icon">📍</span>${addr.street||''} ${addr.house||''}, кв.${addr.apt||'—'}${addr.hasIntercom?' (домофон: '+(addr.intercomCode||'есть')+')':''}</div>
      <div class="order-row"><span class="order-row-icon">💳</span>${o.payment==='cash'?'Наличные':'Карта'}</div>
      ${o.comment ? `<div class="order-row"><span class="order-row-icon">💬</span>${o.comment}</div>` : ''}
      <div class="separator" style="margin:4px 0"></div>
      ${(o.items||[]).map(it=>`
        <div class="flex justify-between text-sm">
          <span>${it.emoji||'🍽️'} ${it.name} ×${it.qty}</span>
          <span class="font-bold">${fmtPrice(it.price*it.qty)}</span>
        </div>`).join('')}
      <div class="separator" style="margin:4px 0"></div>
      <div class="flex justify-between font-bold"><span>Итого</span><span class="text-primary">${fmtPrice(o.total)}</span></div>
      <div class="order-id" style="margin-top:4px">🕐 ${fmtDate(o.createdAt)}</div>
    </div>
  `;
  document.getElementById('confirm-overlay').classList.add('open');
}

function closeConfirm() {
  document.getElementById('confirm-overlay').classList.remove('open');
  _currentOrderId = null;
}

async function quickAccept(orderId) {
  _currentOrderId = orderId;
  await acceptOrder();
}

async function acceptOrder() {
  if (!_currentOrderId) return;
  const orderId = _currentOrderId;
  const o = _pendingOrders.find(x => x.id === orderId);
  if (!o) { closeConfirm(); return; }

  const settings  = await dbGet('cafe_settings', 'main') || {};
  const isPickup  = o.deliveryType === 'pickup';
  const baseMins  = isPickup
    ? (settings.cookingTimeMinutes || 30)
    : (settings.deliveryHours || 0) * 60 + (settings.deliveryMinutes || 60);
  const estimatedAt = new Date(Date.now() + baseMins * 60 * 1000).toISOString();

  const h = Math.floor(baseMins / 60), m = baseMins % 60;
  const timeStr = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  const msgText = isPickup
    ? `Ваш заказ принят! Он будет готов примерно через ${timeStr}. Можете прийти забрать.`
    : `Ваш заказ принят! Ожидайте доставку в течение ${timeStr}.`;

  await dbSet('orders', orderId, {
    status:       'cooking',
    operatorUid:  STATE.uid,
    operatorName: STATE.user?.name || 'Оператор',
    acceptedAt:   new Date().toISOString(),
    estimatedAt,
    deliveryMinutes: baseMins,
    clientNotification: { type: 'accepted', message: msgText, seen: false }
  });

  tgHaptic('success');
  playSuccess();
  showToast('Заказ принят!', 'success');
  closeConfirm();
}

function promptCancelOrder() {
  document.getElementById('confirm-overlay').classList.remove('open');
  document.getElementById('cancel-overlay').classList.add('open');
}

async function confirmCancel() {
  if (!_currentOrderId) return;
  await dbSet('orders', _currentOrderId, {
    status:      'cancelled',
    cancelledAt: new Date().toISOString(),
    operatorUid: STATE.uid,
    operatorName: STATE.user?.name || 'Оператор',
    clientNotification: { type: 'cancelled', message: 'Заказ отменён.', seen: false }
  });
  document.getElementById('cancel-overlay').classList.remove('open');
  _currentOrderId = null;
  showToast('Заказ отменён', 'warning');
}

// ══════════════════════════════════════════════════════════
// ACTIVE ORDERS (cooking / delivering)
// ══════════════════════════════════════════════════════════

async function loadActiveOrders() {
  if (_unsubActive) _unsubActive();
  const statuses = ['cooking', 'delivering'];

  const container = document.getElementById('active-orders-list');

  const refresh = async () => {
    const all = await dbGetAll('orders', 'createdAt', 'desc', 100);
    _activeOrders = all.filter(o => statuses.includes(o.status));
    renderActiveOrders(container);
  };

  // Use snapshot for cooking
  _unsubActive = onQuerySnap('orders', 'status', '==', 'cooking', () => refresh());
  await refresh();
}

function renderActiveOrders(container) {
  if (!_activeOrders.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">🍳</div><div class="empty-text">Нет активных заказов</div></div>';
    return;
  }
  container.innerHTML = _activeOrders.map(o => `
    <div class="order-card">
      <div class="order-card-hdr">
        <div>
          <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
          <div class="order-id" style="margin-top:4px">#${(o.id||'').slice(-6)} · ${fmtTime(o.createdAt)}</div>
        </div>
        <div class="order-total">${fmtPrice(o.total)}</div>
      </div>
      <div class="order-card-body">
        <div class="order-row"><span class="order-row-icon">👤</span>${o.clientName||'—'} ${o.clientPhone?'· '+o.clientPhone:''}</div>
        <div class="order-row"><span class="order-row-icon">📍</span>${o.address?o.address.street+' '+o.address.house+(o.address.apt?', кв.'+o.address.apt:''):'—'}</div>
        <div class="order-row"><span class="order-row-icon">🍽️</span>${(o.items||[]).map(i=>i.name+'×'+i.qty).join(', ')}</div>
        ${o.courierName ? `<div class="order-row"><span class="order-row-icon">🚴</span>Курьер: ${o.courierName}</div>` : ''}
        ${_countdownInline(o.estimatedAt)}
      </div>
      <div class="order-card-foot">
        ${o.deliveryType === 'pickup'
          ? (o.status === 'cooking'
            ? `<button class="btn btn-sm btn-success" onclick="issuePickupOrder('${o.id}')">🏪 Выдать заказ клиенту</button>`
            : `<div class="alert-box success text-sm">✅ Самовывоз — заказ выдан</div>`)
          : (o.status === 'cooking'
            ? `<button class="btn btn-sm btn-primary" onclick="openAssignCourier('${o.id}')">🚴 Передать курьеру</button>`
            : `<div class="alert-box success text-sm">🚴 Передан курьеру ${o.courierName||'—'}</div>`)
        }
      </div>
    </div>
  `).join('');
}

function _countdownInline(estimatedAt) {
  if (!estimatedAt) return '';
  const rem = new Date(estimatedAt).getTime() - Date.now();
  if (rem <= 0) return '<div class="order-row text-danger"><span class="order-row-icon">⏰</span>Время вышло!</div>';
  return `<div class="order-row"><span class="order-row-icon">⏳</span>${fmtCountdown(rem)} осталось</div>`;
}

// ── Issue pickup order (самовывоз) ──
async function issuePickupOrder(orderId) {
  if (!confirm('Выдать заказ клиенту?')) return;
  await dbSet('orders', orderId, {
    status:      'delivered',
    deliveredAt: new Date().toISOString(),
    issuedByOperator: STATE.uid,
    clientNotification: { type: 'delivered', message: 'Заказ выдан. Приятного аппетита!', seen: false }
  });
  showToast('Заказ выдан клиенту', 'success');
  playSuccess();
  await loadActiveOrders();
}

// ── Assign courier ──
let _assignOrderId = null;

async function openAssignCourier(orderId) {
  _assignOrderId = orderId;
  // Load online couriers
  const all = await dbGetAll('couriers', null, 'asc', 50);
  const online = all.filter(c => c.onShift);
  const container = document.getElementById('courier-list-assign');
  if (!online.length) {
    container.innerHTML = '<div class="empty" style="padding:24px 0"><div class="empty-icon">🚴</div><div class="empty-text">Нет курьеров на смене</div></div>';
  } else {
    container.innerHTML = online.map(c => `
      <div class="list-item" onclick="assignCourier('${c.id}','${c.name}')">
        <div class="li-icon orange">🚴</div>
        <div class="li-body">
          <div class="li-title">${c.name}</div>
          <div class="li-sub">${c.phone || ''}</div>
        </div>
        <span class="badge badge-online">● На смене</span>
      </div>
    `).join('');
  }
  document.getElementById('courier-overlay').classList.add('open');
}

async function assignCourier(courierId, courierName) {
  if (!_assignOrderId) return;
  await dbSet('orders', _assignOrderId, {
    status:         'delivering',
    courierUid:     courierId,
    courierName,
    sentToCourierAt: new Date().toISOString()
  });
  document.getElementById('courier-overlay').classList.remove('open');
  showToast(`Передано курьеру ${courierName}`, 'success');
  _assignOrderId = null;
  await loadActiveOrders();
}

// ══════════════════════════════════════════════════════════
// WATCH DELIVERED (sound + banner)
// ══════════════════════════════════════════════════════════

let _knownDelivered = new Set();

function watchDeliveredOrders() {
  _unsubDelivered = onQuerySnap('orders', 'status', '==', 'delivered', orders => {
    orders.forEach(o => {
      if (!_knownDelivered.has(o.id) && o.deliveredAt) {
        _knownDelivered.add(o.id);
        // Only show banner if order was delivered recently (< 30s)
        const age = Date.now() - new Date(o.deliveredAt).getTime();
        if (age < 30000) {
          showDeliveredBanner(o);
          playBeep();
        }
      }
    });
  });
}

function showDeliveredBanner(o) {
  const banner = document.getElementById('delivered-banner');
  document.getElementById('delivered-banner-text').textContent =
    `#${(o.id||'').slice(-6)} · ${o.clientName||'Клиент'} · ${fmtPrice(o.total)}`;
  banner.classList.remove('hidden');
  setTimeout(() => banner.classList.add('hidden'), 8000);
}

// ══════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════

function initHistory() {
  const inp = document.getElementById('hist-date');
  if (!inp.value) inp.value = new Date().toISOString().slice(0, 10);
  loadHistory();
}

async function loadHistory() {
  const dateStr = document.getElementById('hist-date').value;
  if (!dateStr) return;
  const container = document.getElementById('history-orders-list');
  container.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  const dayStart = new Date(dateStr + 'T00:00:00').toISOString();
  const dayEnd   = new Date(dateStr + 'T23:59:59').toISOString();

  const all = await dbGetAll('orders', 'createdAt', 'desc', 500);
  const dayOrders = all.filter(o => o.createdAt >= dayStart && o.createdAt <= dayEnd);

  if (!dayOrders.length) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">📋</div><div class="empty-text">Нет заказов за этот день</div></div>';
    return;
  }

  const total    = dayOrders.reduce((s, o) => s + (o.total || 0), 0);
  const delivered = dayOrders.filter(o => o.status === 'delivered').length;

  container.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-val text-primary">${dayOrders.length}</div><div class="stat-lbl">Заказов</div></div>
      <div class="stat-card"><div class="stat-val text-success">${delivered}</div><div class="stat-lbl">Доставлено</div></div>
    </div>
    <div class="card card-body"><div class="flex justify-between font-bold"><span>Выручка за день</span><span class="text-primary">${fmtPrice(total)}</span></div></div>
    ${dayOrders.map(o => `
      <div class="order-card">
        <div class="order-card-hdr">
          <div>
            <div class="font-bold text-sm">${fmtTime(o.createdAt)} · ${o.clientName||'Клиент'}</div>
            <div class="order-id">#${(o.id||'').slice(-6)}</div>
          </div>
          <div style="text-align:right">
            <span class="${statusBadgeClass(o.status)}">${statusLabel(o.status)}</span>
            <div class="order-total" style="font-size:15px;margin-top:4px">${fmtPrice(o.total)}</div>
          </div>
        </div>
        <div class="order-card-body">
          <div class="text-sm text-dim">${(o.items||[]).map(i=>i.name+'×'+i.qty).join(', ')}</div>
          ${o.courierName ? `<div class="text-xs text-dim" style="margin-top:4px">🚴 ${o.courierName}</div>` : ''}
        </div>
      </div>
    `).join('')}
  `;
}
