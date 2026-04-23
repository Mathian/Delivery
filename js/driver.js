/* ============================================================
   DRIVER — Orders, shift management, active ride, passenger map
   Fixes:
     - startListeningOrders / stopListeningOrders don't conflict
     - Passenger trip count incremented on finishRide
     - Shift auto-end timeout uses proper JS timer
     - Driver history uses correct query
   ============================================================ */

let _unsubDriverOrders = null;
let _shiftTimer = null;
const _pendingOfferListeners = {}; // orderId -> unsubFn
const _pendingOfferData = {};      // orderId -> {offerTime, price}
let _driverOfferCountdown = null;  // interval for countdown bars
let _lastKnownOrders = [];         // latest orders from snapshot — for forced re-renders
let _lastKnownMode = 'city';
const _seenOrderIds = new Set();   // track orders we've already notified about

// ---- Update driver activity timestamp (resets inactivity timer) ----
function _updateDriverActivity() {
  if (STATE.uid && STATE.shiftActive) {
    dbSet('users', STATE.uid, { driverLastActivity: new Date().toISOString() }).catch(() => {});
  }
}

// ---- Init ----
function setupDriverListeners() {
  updateDriverUI();
  if (STATE.shiftActive && !STATE.driverActiveOrderId) {
    startListeningOrders();
  }
  if (STATE.driverActiveOrderId) {
    startListeningActiveOrder();
  }
  // Re-validate shift expiry
  if (STATE.shiftActive && STATE.shiftUntil) {
    const remaining = new Date(STATE.shiftUntil) - Date.now();
    if (remaining <= 0) {
      endShift();
    } else {
      clearTimeout(_shiftTimer);
      _shiftTimer = setTimeout(() => autoEndShift(), remaining);
    }
  }
  // Listen for approval status changes in real-time
  if (STATE.uid) {
    const _prevBlockedStateDrv = { tempBlocked: STATE.user?.tempBlocked || false };
    onDocSnapshot('users', STATE.uid, freshUser => {
      if (!freshUser) return;
      const wasApproved    = STATE.user.approved;
      const wasTempBlocked = _prevBlockedStateDrv.tempBlocked;
      STATE.user = { ...STATE.user, ...freshUser };
      saveState();
      _prevBlockedStateDrv.tempBlocked = !!freshUser.tempBlocked;
      if (freshUser.tempBlocked) {
        // Newly blocked — end shift and show blocked screen
        if (!wasTempBlocked) {
          if (typeof endShift === 'function') { try { endShift().catch(() => {}); } catch (_) {} }
          if (typeof _showBlockedScreen === 'function') _showBlockedScreen(freshUser.tempBlockedUntil || null);
        }
        // Always return — never call updateDriverUI while blocked
        return;
      }
      // Block was lifted — reinitialize
      if (wasTempBlocked && !freshUser.tempBlocked) {
        showToast('Ваш доступ восстановлен ✅', 'ok');
        if (typeof initMain === 'function') initMain();
        return;
      }
      // Remote shift end by bot (inactivity) — shiftActive set to false in Firestore
      if (STATE.shiftActive && freshUser.shiftActive === false) {
        showToast('⏰ Смена завершена автоматически из-за неактивности', 'warn');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
        STATE.shiftActive = false;
        STATE.user.shiftActive = false;
        saveState();
        clearTimeout(_shiftTimer); _shiftTimer = null;
        stopListeningOrders();
        _show('d-offline-box', true);
        _show('d-online-box', false);
        updateDriverUI();
        return;
      }
      updateDriverUI();
      // Notify driver when approved
      if (!wasApproved && freshUser.approved === true) {
        showToast('Ваш аккаунт одобрен! Можно выходить на линию 🟢', 'ok');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
      }
    });
  }
}

// ---- Listen for available orders ----
function startListeningOrders() {
  if (_unsubDriverOrders) return; // Already listening
  _unsubDriverOrders = onSnapshotQuery('orders', 'status', '==', 'searching', orders => {
    // Don't disrupt open offer modal
    const offerModal = document.getElementById('mo-drv-offer');
    if (offerModal && offerModal.classList.contains('open')) return;
    // Filter by city and driver mode
    const mode = STATE.driverMode || (STATE.user && STATE.user.driverMode) || 'city';
    const city = STATE.user ? STATE.user.city : '';
    const icCity = STATE.driverIcCity || city;
    const filtered = orders.filter(o => {
      if (mode === 'intercity') {
        if (o.type !== 'intercity') return false;
        return (o.icFromCity || o.city) === icCity;
      }
      return o.city === city && o.type !== 'intercity';
    });
    renderDriverOrders(filtered, mode);
  });
}

function stopListeningOrders() {
  if (_unsubDriverOrders) {
    _unsubDriverOrders();
    _unsubDriverOrders = null;
  }
  // Clean up any pending offer watches
  Object.keys(_pendingOfferListeners).forEach(stopWatchingOffer);
}

// ---- Listen for active order updates ----
function startListeningActiveOrder() {
  stopListeningOrders(); // Don't listen to new orders while on a trip
  if (!STATE.driverActiveOrderId) return;
  if (_unsubDriverOrders) { _unsubDriverOrders(); }
  _unsubDriverOrders = onDocSnapshot('orders', STATE.driverActiveOrderId, handleDriverOrderUpdate);
}

// ---- Driver order update handler ----
function handleDriverOrderUpdate(order) {
  if (!order) return;
  if (order.status === 'cancelled') {
    STATE.driverActiveOrderId = null;
    saveState();
    _unsubDriverOrders && _unsubDriverOrders();
    _unsubDriverOrders = null;
    _show('d-active-order', false);
    updateDriverUI();
    startListeningOrders();
    showToast('Пассажир отменил поездку', 'warn');
    tg.HapticFeedback.notificationOccurred('warning');
  } else {
    renderActiveDriverOrder(order);
    // Show geo indicator
    if (order.geoEnabled && order.passengerGeo) {
      _show('d-geo-indicator', true);
      _setText('d-geo-coords', `${order.passengerGeo.lat.toFixed(5)}, ${order.passengerGeo.lng.toFixed(5)}`);
    } else {
      _show('d-geo-indicator', false);
    }
  }
}

// ---- Build card HTML (no DOM ops) ----
function _buildIcCardHtml(o) {
  return `
    <div class="ord-hdr">
      <div style="font-size:11px;color:var(--text3)">${fmtRelTime(o.createdAt)}</div>
      <span class="tag tag-y">${escHtml(o.icType || 'Межгород')}</span>
    </div>
    <div class="ord-route">
      <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt"><strong>${escHtml(o.from)}</strong></div></div>
      <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt"><strong>${escHtml(o.to)}</strong></div></div>
    </div>
    <div class="ord-tags">
      <span class="tag">📅 ${o.date || ''} ${o.time || ''}</span>
      ${o.comment ? `<span class="tag">💬 ${escHtml(o.comment.substring(0,20))}${o.comment.length>20?'...':''}</span>` : ''}
    </div>
    <div class="ord-bot">
      <div><div style="font-size:10px;color:var(--text3)">Цена пассажира</div><div class="offer-price">${fmtMoney(o.price, o.currency?.symbol)}</div></div>
      <button class="btn btn-blue btn-sm" onclick="icDriverContact('${o.id}')">📞 Связаться</button>
    </div>`;
}

function _buildCityCardHtml(o) {
  const pd = _pendingOfferData[o.id];
  const OFFER_TTL = 10000;
  let botHtml;
  if (pd) {
    const rem = Math.max(0, OFFER_TTL - (Date.now() - new Date(pd.offerTime).getTime()));
    const pct = rem / OFFER_TTL * 100;
    const remSec = Math.ceil(rem / 1000);
    botHtml = `
      <div class="ord-bot" style="flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><div style="font-size:10px;color:var(--text3)">Ваше предложение</div><div class="offer-price">${fmtMoney(pd.price, o.currency?.symbol)}</div></div>
          <span class="tag tag-g">⏳ Пассажир решает: <span id="dopb-sec-${o.id}">${remSec}</span>с</span>
        </div>
        <div class="offer-progress-wrap"><div class="offer-progress-bar" id="dopb-${o.id}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
  } else {
    botHtml = `
      <div class="ord-bot">
        <div><div style="font-size:10px;color:var(--text3)">Цена пассажира</div><div class="offer-price">${fmtMoney(o.price, o.currency?.symbol)}</div></div>
        <div style="display:flex;gap:7px">
          <button class="btn btn-ghost btn-sm" onclick="openDrvOffer('${o.id}',${o.price})">Предложить цену</button>
          <button class="btn btn-y btn-sm" onclick="drvAcceptOrder('${o.id}',${o.price})">Принять</button>
        </div>
      </div>`;
  }
  return `
    <div class="ord-hdr">
      <div style="font-size:11px;color:var(--text3)">${fmtRelTime(o.createdAt)}</div>
      <div class="stars">⭐ <span style="font-size:12px;color:var(--text2)">${fmtRating(o.passengerRating)} пасс.</span></div>
    </div>
    <div class="ord-route">
      <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt"><strong>${escHtml(o.from)}</strong>${o.fromEntrance ? ' · Подъезд '+o.fromEntrance : ''}</div></div>
      <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt"><strong>${escHtml(o.to)}</strong>${o.toEntrance ? ' · Подъезд '+o.toEntrance : ''}</div></div>
    </div>
    <div class="ord-tags">
      <span class="tag">${o.payMethod==='cash'?'💵 Нал.':'📲 Перевод'}</span>
      ${o.pax>1?`<span class="tag">👥 ${o.pax}</span>`:''}
      ${o.childSeat?'<span class="tag">👶 Кресло</span>':''}
      ${o.geoEnabled?'<span class="tag tag-g">📍 Гео</span>':''}
      ${o.comment?`<span class="tag">💬 ${escHtml(o.comment.substring(0,20))}${o.comment.length>20?'...':''}</span>`:''}
    </div>
    ${botHtml}`;
}

// ---- Fade-out then remove helper ----
function _fadeOutRemove(el) {
  el.style.transition = 'opacity .25s, transform .25s';
  el.style.opacity = '0';
  el.style.transform = 'translateY(-8px)';
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 270);
}

// ---- Render available orders list (DOM-diff — no flicker) ----
function renderDriverOrders(orders, mode) {
  // Always keep a reference to the latest data for forced re-renders
  _lastKnownOrders = orders || [];
  _lastKnownMode = mode || 'city';

  const list = document.getElementById('d-orders-list');
  if (!list) return;

  if (!orders || !orders.length) {
    const existing = list.querySelectorAll('.ord-card[data-oid]');
    if (existing.length) {
      existing.forEach(c => _fadeOutRemove(c));
      setTimeout(() => {
        if (!list.querySelector('.ord-card[data-oid]')) {
          list.innerHTML = '<div class="empty-st"><div class="empty-ico">🔍</div><div class="empty-txt">Нет заказов. Обновляется автоматически.</div></div>';
        }
      }, 300);
    } else {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">🔍</div><div class="empty-txt">Нет заказов. Обновляется автоматически.</div></div>';
    }
    _stopDriverOfferCountdown();
    return;
  }

  // Remove empty-state placeholder if present
  const emptyEl = list.querySelector('.empty-st');
  if (emptyEl) emptyEl.remove();

  const newIds = new Set(orders.map(o => o.id));

  // Remove cards no longer in list
  list.querySelectorAll('.ord-card[data-oid]').forEach(card => {
    if (!newIds.has(card.dataset.oid)) _fadeOutRemove(card);
  });

  // Add new cards / rebuild cards whose pending-offer state changed
  const existingCards = {};
  list.querySelectorAll('.ord-card[data-oid]').forEach(c => existingCards[c.dataset.oid] = c);

  orders.forEach(o => {
    const hasPending = !!_pendingOfferData[o.id];
    if (!existingCards[o.id]) {
      // New card — create and fade in
      const card = document.createElement('div');
      card.className = 'ord-card';
      card.dataset.oid = o.id;
      card.innerHTML = mode === 'intercity' ? _buildIcCardHtml(o) : _buildCityCardHtml(o);
      card.style.opacity = '0';
      card.style.transform = 'translateY(10px)';
      list.appendChild(card);
      requestAnimationFrame(() => {
        card.style.transition = 'opacity .25s, transform .25s';
        card.style.opacity = '1';
        card.style.transform = 'none';
      });
      // Sound + activity on genuinely new order
      if (!_seenOrderIds.has(o.id)) {
        _seenOrderIds.add(o.id);
        if (typeof playNewOrderBeep === 'function') playNewOrderBeep();
        _updateDriverActivity();
      }
    } else {
      // Existing card — rebuild bottom section if pending state changed
      const wasShowingPending = !!existingCards[o.id].querySelector('.offer-progress-wrap');
      if (wasShowingPending !== hasPending) {
        existingCards[o.id].innerHTML = mode === 'intercity' ? _buildIcCardHtml(o) : _buildCityCardHtml(o);
      }
    }
  });

  // Manage countdown for pending offers
  if (Object.keys(_pendingOfferData).length > 0) {
    _startDriverOfferCountdown();
  }
}

// ---- Driver offer countdown ticker ----
function _startDriverOfferCountdown() {
  if (_driverOfferCountdown) return;
  const OFFER_TTL = 10000;
  _driverOfferCountdown = setInterval(() => {
    const nowMs = Date.now();
    const expiredIds = [];
    Object.entries(_pendingOfferData).forEach(([orderId, pd]) => {
      const rem = Math.max(0, OFFER_TTL - (nowMs - new Date(pd.offerTime).getTime()));
      const bar = document.getElementById('dopb-' + orderId);
      const sec = document.getElementById('dopb-sec-' + orderId);
      if (bar) bar.style.width = (rem / OFFER_TTL * 100).toFixed(1) + '%';
      if (sec) sec.textContent = Math.ceil(rem / 1000);
      if (rem <= 0) expiredIds.push(orderId);
    });
    expiredIds.forEach(orderId => {
      // Offer expired without response — clean up and rebuild card with buttons
      stopWatchingOffer(orderId); // clears _pendingOfferData[orderId]
      renderDriverOrders(_lastKnownOrders, _lastKnownMode);
    });
    if (Object.keys(_pendingOfferData).length === 0) _stopDriverOfferCountdown();
  }, 500);
}

function _stopDriverOfferCountdown() {
  if (_driverOfferCountdown) { clearInterval(_driverOfferCountdown); _driverOfferCountdown = null; }
}

// ---- Render active driver order ----
function renderActiveDriverOrder(order) {
  _setText('d-act-route', `${order.from} → ${order.to}`);
  _setText('d-act-meta', `${fmtMoney(order.acceptedPrice || order.price, order.currency?.symbol)} · ${order.payMethod === 'cash' ? 'Наличные' : 'Перевод'}${order.comment ? ' · ' + order.comment : ''}`);
  _setText('d-act-pname', order.passengerName || '—');
  _setText('d-act-pphone', order.passengerPhone || '—');
  _setText('d-act-prating', fmtRating(order.passengerRating));
  _setText('d-act-price', fmtMoney(order.acceptedPrice || order.price, order.currency?.symbol));

  const arrBtn = document.getElementById('btn-arrived');
  const startBtn = document.getElementById('btn-start-ride');
  const finishBtn = document.getElementById('btn-finish-ride');

  if (order.status === 'arrived') {
    if (arrBtn) { arrBtn.disabled = true; arrBtn.textContent = '✅ Прибыл'; }
    if (startBtn) startBtn.disabled = false;
    if (finishBtn) finishBtn.style.display = 'none';
  } else if (order.status === 'riding') {
    if (arrBtn) { arrBtn.disabled = true; arrBtn.textContent = '✅ Прибыл'; }
    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.style.display = 'block';
  } else {
    // status === 'active'
    if (arrBtn) { arrBtn.disabled = false; arrBtn.textContent = 'Я приехал 📍'; }
    if (startBtn) startBtn.disabled = true;
    if (finishBtn) finishBtn.style.display = 'none';
  }
}

// ---- Driver offer modal ----
function openDrvOffer(orderId, passengerPrice) {
  STATE.currentOfferOrderId = orderId;
  STATE.currentOfferPassengerPrice = passengerPrice;
  _setText('doi-pprice', fmtMoney(passengerPrice));
  _setVal('doi-price', passengerPrice + 50);
  // Reset to 5 min radio
  const r5 = document.querySelector('input[name="doi-eta"][value="5"]');
  if (r5) r5.checked = true;
  openModal('mo-drv-offer');
}

function adjOfferPrice(delta) {
  const el = document.getElementById('doi-price');
  if (!el) return;
  const minPrice = STATE.currentOfferPassengerPrice || 0;
  const cur = parseInt(el.value) || (minPrice + 50);
  el.value = Math.max(minPrice, cur + delta);
}

async function submitOffer() {
  const price = parseInt(document.getElementById('doi-price').value);
  const minPrice = STATE.currentOfferPassengerPrice || 0;
  if (!price || price < minPrice) {
    showToast(`Цена не может быть ниже ${fmtMoney(minPrice)}`, 'err'); return;
  }
  const etaEl = document.querySelector('input[name="doi-eta"]:checked');
  const eta = etaEl ? parseInt(etaEl.value) : 5;
  if (!eta || eta < 1) { showToast('Укажите время прибытия', 'err'); return; }

  const order = await dbGet('orders', STATE.currentOfferOrderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже занят', 'warn');
    closeModal('mo-drv-offer');
    return;
  }
  const offer = {
    id: 'OFF-' + Date.now(),
    driverId: STATE.uid,
    name: STATE.user.name,
    car: STATE.user.car ? `${STATE.user.car.brand} · ${STATE.user.car.num}` : '',
    rating: STATE.user.rating,
    price,
    eta,
    offerTime: new Date().toISOString()
  };
  // Replace any existing offer from this driver
  const orderId = STATE.currentOfferOrderId;
  const newOffers = [...(order.offers || []).filter(o => o.driverId !== STATE.uid), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  _updateDriverActivity();
  // Store pending offer data for countdown display
  _pendingOfferData[orderId] = { offerTime: offer.offerTime, price };
  watchPendingOffer(orderId);
  // Immediately re-render card to show countdown bar, don't wait for Firestore callback
  renderDriverOrders(_lastKnownOrders, _lastKnownMode);
  closeModal('mo-drv-offer');
  showToast('Предложение отправлено! Ожидайте выбора пассажира ⏳', 'ok');
}

// ---- Watch pending offer — notify driver when passenger accepts/rejects/declines ----
function watchPendingOffer(orderId) {
  if (_pendingOfferListeners[orderId]) return; // already watching
  const unsub = onDocSnapshot('orders', orderId, order => {
    if (!order || order.status === 'cancelled') {
      stopWatchingOffer(orderId);
      return;
    }
    if (order.status === 'active') {
      stopWatchingOffer(orderId);
      if (order.acceptedDriver && order.acceptedDriver.driverId === STATE.uid) {
        // Our offer was accepted!
        if (STATE.driverActiveOrderId) return; // already on a ride
        STATE.driverActiveOrderId = orderId;
        saveState();
        dbSet('driver_shifts', STATE.uid + '_shift', { hasActiveOrder: true });
        stopListeningOrders();
        startListeningActiveOrder();
        _show('d-online-box', false);
        _show('d-active-order', true);
        renderActiveDriverOrder(order);
        showToast('Пассажир выбрал вас! Едьте к нему 🎉', 'ok');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
      } else {
        showToast('Пассажир выбрал другого водителя');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
      }
      return;
    }
    // status === 'searching': check if our offer is still in the list
    if (order.status === 'searching') {
      const myOffer = (order.offers || []).find(o => o.driverId === STATE.uid);
      if (!myOffer && _pendingOfferData[orderId]) {
        // Our offer was declined or expired by the passenger
        stopWatchingOffer(orderId);
        // Force card rebuild with latest order data
        renderDriverOrders(_lastKnownOrders, _lastKnownMode);
        showToast('Пассажир отклонил ваше предложение', 'warn');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
      }
    }
  });
  _pendingOfferListeners[orderId] = unsub;
}

function stopWatchingOffer(orderId) {
  if (_pendingOfferListeners[orderId]) {
    _pendingOfferListeners[orderId]();
    delete _pendingOfferListeners[orderId];
  }
  // Clear pending offer data so card reverts to normal buttons
  if (_pendingOfferData[orderId]) {
    delete _pendingOfferData[orderId];
    if (Object.keys(_pendingOfferData).length === 0) _stopDriverOfferCountdown();
  }
}

// ---- Accept order (adds driver to offer list at passenger's price) ----
async function drvAcceptOrder(orderId, price) {
  if (STATE.driverActiveOrderId) {
    showToast('У вас уже есть активный заказ', 'warn'); return;
  }
  const order = await dbGet('orders', orderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже занят', 'warn'); return;
  }
  // Check if driver already submitted an offer for this order
  const existing = (order.offers || []).find(o => o.driverId === STATE.uid);
  if (existing) {
    showToast('Вы уже отправили предложение', 'warn'); return;
  }
  const offer = {
    id: 'OFF-' + Date.now(),
    driverId: STATE.uid,
    name: STATE.user.name,
    car: STATE.user.car ? `${STATE.user.car.color} ${STATE.user.car.brand} · ${STATE.user.car.num}` : '',
    rating: STATE.user.rating,
    price,
    eta: 5,
    offerTime: new Date().toISOString()
  };
  const newOffers = [...(order.offers || []), offer];
  await dbSet('orders', orderId, { offers: newOffers });
  _updateDriverActivity();
  // Store pending offer data for countdown display
  _pendingOfferData[orderId] = { offerTime: offer.offerTime, price };
  watchPendingOffer(orderId);
  // Immediately re-render card to show countdown bar, don't wait for Firestore callback
  renderDriverOrders(_lastKnownOrders, _lastKnownMode);
  showToast('Предложение отправлено! Ожидайте выбора пассажира ⏳', 'ok');
  tg.HapticFeedback.impactOccurred('light');
}

// ---- Driver arrived ----
async function driverArrived() {
  if (!STATE.driverActiveOrderId) return;
  await dbSet('orders', STATE.driverActiveOrderId, {
    status: 'arrived',
    arrivedAt: new Date().toISOString()
  });
  const arr = document.getElementById('btn-arrived');
  if (arr) { arr.disabled = true; arr.textContent = '✅ Прибыл'; }
  const start = document.getElementById('btn-start-ride');
  if (start) start.disabled = false;
  showToast('Пассажир уведомлён! 📍', 'ok');
  tg.HapticFeedback.impactOccurred('medium');
}

// ---- Start ride ----
async function startRide() {
  if (!STATE.driverActiveOrderId) return;
  await dbSet('orders', STATE.driverActiveOrderId, {
    status: 'riding',
    startedAt: new Date().toISOString()
  });
  const start = document.getElementById('btn-start-ride');
  if (start) start.disabled = true;
  const finish = document.getElementById('btn-finish-ride');
  if (finish) finish.style.display = 'block';
  showToast('Поездка началась! 🛣️', 'ok');
}

// ---- Finish ride ----
async function finishRide() {
  if (!STATE.driverActiveOrderId) return;
  const orderId = STATE.driverActiveOrderId;
  showLoading(true);

  // Read order first to calculate duration and finalAmount
  let durationSeconds = null;
  let finalAmount = 0;
  try {
    const orderSnap = await dbGet('orders', orderId);
    if (orderSnap) {
      finalAmount = orderSnap.acceptedPrice || orderSnap.price || 0;
      if (orderSnap.startedAt) {
        durationSeconds = Math.round((Date.now() - new Date(orderSnap.startedAt).getTime()) / 1000);
      }
    }
  } catch (e) { console.warn('[finishRide] pre-read:', e); }

  const finishedAt = new Date().toISOString();
  await dbSet('orders', orderId, {
    status: 'done',
    finishedAt,
    durationSeconds,
    finalAmount
  });

  // Increment driver trip counters
  STATE.user.trips = (STATE.user.trips || 0) + 1;
  STATE.user.driverTrips = (STATE.user.driverTrips || 0) + 1;
  STATE.shiftTrips = (STATE.shiftTrips || 0) + 1;
  STATE.user.bonusTrips = (STATE.user.bonusTrips || 0) + 1;

  // Bonus system
  if (STATE.user.bonusTrips >= BONUS_TRIPS && STATE.bonusSystemEnabled) {
    STATE.user.bonusTrips = 0;
    STATE.user.nextShiftFree = true;
    showToast('🎉 Следующая смена бесплатная!', 'ok');
  }

  // Earnings + daily stats
  try {
    const order = await dbGet('orders', orderId);
    const earnedPrice = finalAmount || (order && (order.acceptedPrice || order.price)) || 0;
    const today = new Date().toDateString();
    if (STATE.user.lastStatsDate !== today) {
      STATE.user.driverTripsToday = 0;
      STATE.user.driverEarningsToday = 0;
      STATE.user.lastStatsDate = today;
    }
    STATE.user.driverTripsToday = (STATE.user.driverTripsToday || 0) + 1;
    STATE.user.driverEarnings = (STATE.user.driverEarnings || 0) + earnedPrice;
    STATE.user.driverEarningsToday = (STATE.user.driverEarningsToday || 0) + earnedPrice;

    if (order && order.passengerId) {
      await dbIncrement('users', order.passengerId, 'trips');
      await dbIncrement('users', order.passengerId, 'passengerTrips');
    }
  } catch (e) { console.warn('[finishRide] passenger trips / earnings:', e); }

  await dbSet('users', STATE.uid, {
    trips: STATE.user.trips,
    driverTrips: STATE.user.driverTrips,
    bonusTrips: STATE.user.bonusTrips,
    nextShiftFree: STATE.user.nextShiftFree || false,
    driverEarnings: STATE.user.driverEarnings || 0,
    driverEarningsToday: STATE.user.driverEarningsToday || 0,
    driverTripsToday: STATE.user.driverTripsToday || 0,
    lastStatsDate: new Date().toDateString()
  });

  await dbSet('driver_shifts', STATE.uid + '_shift', { hasActiveOrder: false });

  STATE.driverActiveOrderId = null;
  saveState();
  _updateDriverActivity(); // Reset inactivity timer after completing a trip

  if (_unsubDriverOrders) { _unsubDriverOrders(); _unsubDriverOrders = null; }
  _show('d-active-order', false);
  showLoading(false);
  updateDriverUI();
  updateAllUI();
  startListeningOrders();
  showToast('Поездка завершена! Спасибо! ✅', 'ok');
  setTimeout(() => openRatingModal('passenger', orderId), 700);
}

// ---- Driver cancel ride — ask reason first ----
function driverCancelRide() {
  openModal('mo-drv-cancel');
}

async function submitDriverCancel(reason) {
  closeModal('mo-drv-cancel');
  if (!STATE.driverActiveOrderId) return;

  const orderId = STATE.driverActiveOrderId;
  const order = await dbGet('orders', orderId);

  if (reason === 'no_passenger') {
    // Capture driver geo, ask passenger to respond
    const geo = await _getCurrentGeo();
    if (order && order.passengerId) {
      await sendNotification(order.passengerId, {
        type: 'no_passenger_q',
        orderId,
        driverUid: STATE.uid,
        driverGeo: geo,
      });
      // 11-second sender-side timeout — if passenger doesn't respond, apply penalty
      const passengerId = order.passengerId;
      setTimeout(async () => {
        try {
          const notif = await dbGet('notifications', passengerId + '_pending');
          if (notif && notif.status === 'pending') {
            const penalty = window._appSettings?.passengerCancelPenalty ?? 0.1;
            await applyRatingPenalty(passengerId, penalty);
            await recordDailyCancel(passengerId);
            await checkAutoBlock(passengerId, 'passenger');
            await dbSet('notifications', passengerId + '_pending', { status: 'expired' });
          }
        } catch (e) { console.warn('[sender-timer no_passenger]', e); }
      }, 11000);
    }
  } else {
    // 'changed_mind', 'accidental', 'breakdown' — penalty for driver
    const penalty = window._appSettings?.driverCancelPenalty ?? 0.05;
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    await checkAutoBlock(STATE.uid, 'driver');
    showToast('Ваш рейтинг снижен', 'warn');
    // Notify passenger that driver cancelled
    if (order && order.passengerId) {
      await sendNotification(order.passengerId, {
        type: 'driver_cancelled_info',
        orderId,
        message: 'Водитель отменил заказ. Создайте заявку заново.',
      });
    }
  }

  // Cancel the order
  await dbSet('orders', orderId, {
    status: 'cancelled',
    cancelledBy: 'driver',
    cancelReason: reason,
    cancelledAt: new Date().toISOString()
  });
  await dbSet('driver_shifts', STATE.uid + '_shift', { hasActiveOrder: false });

  STATE.driverActiveOrderId = null;
  saveState();
  if (_unsubDriverOrders) { _unsubDriverOrders(); _unsubDriverOrders = null; }

  _show('d-active-order', false);
  updateDriverUI();
  startListeningOrders();
  showToast('Поездка отменена');
}

// ---- Shift management ----
async function goOnline() {
  if (!STATE.user.approved) {
    showToast('Аккаунт не подтверждён. Ожидайте проверки.', 'warn'); return;
  }
  if (STATE.user.blockedAsDriver || STATE.user.blocked) {
    showToast('Ваш аккаунт водителя заблокирован', 'err'); return;
  }
  const freeUntil = STATE.user.freeUntil ? new Date(STATE.user.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  const isNextFree = STATE.user.nextShiftFree;

  if (!isFree && !isNextFree) {
    const today = new Date().toDateString();
    if (STATE.paidToday !== today) {
      openTonPayment(); return;
    }
  }
  if (isNextFree) {
    STATE.user.nextShiftFree = false;
    await dbSet('users', STATE.uid, { nextShiftFree: false });
  }

  const hour = new Date().getHours();
  const shiftUntil = hour >= 16
    ? new Date(Date.now() + 12 * 3600 * 1000)
    : new Date(new Date().setHours(23, 59, 59, 999));

  STATE.shiftActive = true;
  STATE.shiftUntil = shiftUntil.toISOString();
  STATE.shiftTrips = 0;
  saveState();

  const myTgId = String(tg.initDataUnsafe?.user?.id || '');
  await dbSet('driver_shifts', STATE.uid + '_shift', {
    driverId: STATE.uid,
    driverName: STATE.user.name,
    city: STATE.user.city,
    mode: STATE.driverMode || 'city',
    tgId: myTgId,
    active: true,
    until: STATE.shiftUntil,
    hasActiveOrder: false,
    startedAt: new Date().toISOString()
  });
  await dbSet('users', STATE.uid, {
    shiftActive: true,
    driverLastActivity: new Date().toISOString(),
    tgId: myTgId
  });

  clearTimeout(_shiftTimer);
  _shiftTimer = setTimeout(() => autoEndShift(), shiftUntil - Date.now());

  _show('d-offline-box', false);
  _show('d-online-box', true);
  updateDriverUI();
  startListeningOrders();
  showToast('Вы на линии 🟢', 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

async function goOffline() {
  tg.showConfirm('Завершить смену?', async ok => { if (ok) await endShift(); });
}

async function autoEndShift() {
  if (!STATE.shiftActive) return;
  await endShift();
  showToast('Смена завершена автоматически (время вышло)');
}

async function endShift() {
  clearTimeout(_shiftTimer);
  _shiftTimer = null;
  // Clean up all pending offer watches
  Object.keys(_pendingOfferListeners).forEach(stopWatchingOffer);
  _stopDriverOfferCountdown();

  // If driver has an active order — cancel it and notify passenger
  if (STATE.driverActiveOrderId) {
    try {
      await dbSet('orders', STATE.driverActiveOrderId, {
        status: 'cancelled',
        cancelledBy: 'driver',
        cancelledAt: new Date().toISOString(),
        cancelReason: 'Водитель завершил смену'
      });
    } catch (e) { console.warn('[endShift] cancel order:', e); }
    await dbSet('driver_shifts', STATE.uid + '_shift', { hasActiveOrder: false });
    if (_unsubDriverOrders) { _unsubDriverOrders(); _unsubDriverOrders = null; }
    STATE.driverActiveOrderId = null;
    _show('d-active-order', false);
    showToast('Активный заказ отменён — пассажир уведомлён', 'warn');
  }

  STATE.shiftActive = false;
  const prevShifts = STATE.user.totalShifts || 0;
  STATE.user.totalShifts = prevShifts + 1;
  STATE.user.avgShiftTrips = ((STATE.user.avgShiftTrips || 0) * prevShifts + (STATE.shiftTrips || 0)) / STATE.user.totalShifts;
  saveState();
  await dbSet('driver_shifts', STATE.uid + '_shift', {
    active: false,
    endedAt: new Date().toISOString()
  });
  await dbSet('users', STATE.uid, {
    totalShifts: STATE.user.totalShifts,
    avgShiftTrips: STATE.user.avgShiftTrips,
    shiftActive: false
  });
  stopListeningOrders();
  _show('d-offline-box', true);
  _show('d-online-box', false);
  updateDriverUI();
  showToast('Смена завершена ✅', 'ok');
}

// ---- Driver intercity city picker (via GEO API) ----
function openDriverIcCityPicker() {
  const list = document.getElementById('drv-ic-city-list');
  const search = document.getElementById('drv-ic-city-search');
  if (search) search.value = '';
  if (list) list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Введите название города для поиска</div>';
  openModal('mo-drv-ic-city');
  setTimeout(() => { if (search) search.focus(); }, 350);
}

function filterDrvIcCities(val) {
  const list = document.getElementById('drv-ic-city-list');
  if (!list) return;
  const q = (val || '').trim();
  if (q.length < 2) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Введите название города для поиска</div>';
    return;
  }
  list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">🔍 Поиск...</div>';
  GEO.searchCities(q, '', results => {
    if (!results.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text3);font-size:13px">Город не найден</div>';
      return;
    }
    list.innerHTML = results.map(r => {
      const cEsc = r.name.replace(/'/g, "\\'");
      const ctEsc = r.country.replace(/'/g, "\\'");
      return `<button class="btn btn-out" style="margin-bottom:6px;text-align:left;width:100%;padding:10px 12px"
        onclick="selDriverIcCity('${cEsc}','${ctEsc}')">
        <strong>${r.name}</strong>
        <span style="color:var(--text3);font-size:11px;margin-left:6px">${r.country}</span>
      </button>`;
    }).join('');
  });
}

function selDriverIcCity(city, country) {
  STATE.driverIcCity = city;
  STATE.driverIcCountry = country;
  saveState();
  _setText('d-ic-city-label', city);
  closeModal('mo-drv-ic-city');
  // Also update the offline city label if visible
  const offlineLabel = document.getElementById('d-ic-city-label-offline');
  if (offlineLabel) offlineLabel.textContent = city;
  if (STATE.shiftActive) {
    stopListeningOrders();
    startListeningOrders();
  }
  showToast('Город: ' + city + ' ✅', 'ok');
}

// ---- Driver mode (city / intercity) ----
function selDrvMode(mode) {
  STATE.driverMode = mode;
  if (STATE.user) STATE.user.driverMode = mode;
  saveState();
  if (STATE.uid) dbSet('users', STATE.uid, { driverMode: mode }).catch(() => {});
  document.getElementById('d-mode-city').classList.toggle('on', mode === 'city');
  document.getElementById('d-mode-ic').classList.toggle('on', mode === 'intercity');
  // Show/hide offline city row
  const offlineRow = document.getElementById('d-ic-city-offline-row');
  if (offlineRow) offlineRow.style.display = mode === 'intercity' ? '' : 'none';
  // Sync offline label with current city
  const offLabel = document.getElementById('d-ic-city-label-offline');
  if (offLabel) offLabel.textContent = STATE.driverIcCity || STATE.user?.city || '—';
  const icRow = document.getElementById('d-ic-city-row');
  if (icRow) icRow.style.display = mode === 'intercity' ? 'block' : 'none';
  if (mode === 'intercity' && !STATE.driverIcCity && STATE.user) {
    STATE.driverIcCity = STATE.user.city;
    _setText('d-ic-city-label', STATE.user.city || '—');
  }
}

// ---- Driver UI state ----
function updateDriverUI() {
  const u = STATE.user;
  if (!u) return;
  const approved = u.approved !== false;
  _show('d-pending-box', !approved);
  _show('d-approved-box', approved);
  if (!approved) return;

  const hasActive = !!STATE.driverActiveOrderId;
  _show('d-offline-box', !STATE.shiftActive && !hasActive);
  _show('d-online-box', STATE.shiftActive && !hasActive);
  _show('d-active-order', hasActive);

  if (STATE.shiftActive && STATE.shiftUntil) {
    _setText('d-shift-until', 'До ' + fmtTime(STATE.shiftUntil));
  }
  _setText('d-shift-trips', STATE.shiftTrips || 0);
  _setText('d-avg-trips', u.avgShiftTrips ? u.avgShiftTrips.toFixed(1) : '—');
  const today = new Date().toDateString();
  if (u.lastStatsDate && u.lastStatsDate !== today) {
    u.driverTripsToday = 0;
    u.driverEarningsToday = 0;
  }
  _setText('dp-trips-today', u.driverTripsToday || 0);
  _setText('dp-earnings-today', fmtMoney(u.driverEarningsToday || 0));
  _setText('dp-earnings-total', fmtMoney(u.driverEarnings || 0));
  const icCity = STATE.driverIcCity || u.city || '—';
  _setText('d-ic-city-label', icCity);
  _setText('d-ic-city-label-offline', icCity);

  // Show intercity city row when in intercity mode
  const mode = STATE.driverMode || u.driverMode || 'city';
  const icOnlineRow = document.getElementById('d-ic-city-row');
  if (icOnlineRow) icOnlineRow.style.display = (STATE.shiftActive && mode === 'intercity') ? '' : 'none';
  const icOfflineRow = document.getElementById('d-ic-city-offline-row');
  if (icOfflineRow) icOfflineRow.style.display = (!STATE.shiftActive && mode === 'intercity') ? '' : 'none';

  const bonusEnabled = STATE.bonusSystemEnabled;
  _show('d-bonus-row', bonusEnabled);
  if (bonusEnabled) {
    _setText('d-bonus-left', Math.max(0, BONUS_TRIPS - (STATE.shiftTrips || 0)));
  }

  // Pay warning
  const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  _show('d-pay-warning', !isFree);
}

// ---- Passenger map ----
let _passengerMap = null;
let _passengerMarker = null;
let _mapOrderUnsub = null;

function openPassengerMap() {
  STATE.mapFrom = STATE.role === 'driver' ? 's-driver' : null;
  showScreen('s-passenger-map');

  setTimeout(() => {
    const mapEl = document.getElementById('passenger-map');
    if (!mapEl) return;

    const defaultLat = 51.18;
    const defaultLng = 71.45;

    if (!_passengerMap) {
      _passengerMap = L.map('passenger-map', {
        zoomControl: true,
        attributionControl: true
      }).setView([defaultLat, defaultLng], 15);

      L.maplibreGL({
        style: 'https://tiles.openfreemap.org/styles/dark',
      }).addTo(_passengerMap);

      const icon = L.divIcon({
        html: '<div style="width:22px;height:22px;background:#f5c518;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(245,197,24,.4),0 3px 10px rgba(0,0,0,.6)"></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        className: ''
      });
      _passengerMarker = L.marker([defaultLat, defaultLng], { icon }).addTo(_passengerMap);
      _passengerMarker.bindPopup('📍 Пассажир');
    } else {
      _passengerMap.invalidateSize();
    }

    if (STATE.driverActiveOrderId) {
      if (_mapOrderUnsub) _mapOrderUnsub();
      _mapOrderUnsub = onDocSnapshot('orders', STATE.driverActiveOrderId, order => {
        if (!order || !order.passengerGeo) return;
        const { lat, lng } = order.passengerGeo;
        const pos = [lat, lng];
        _passengerMarker.setLatLng(pos);
        _passengerMap.panTo(pos);
        _passengerMarker.openPopup();
        _setText('d-geo-coords', `${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      });
    }
  }, 150);
}

function closePassengerMap() {
  if (_mapOrderUnsub) { _mapOrderUnsub(); _mapOrderUnsub = null; }
  if (_passengerMap) { _passengerMap.remove(); _passengerMap = null; _passengerMarker = null; }
  showScreen('s-driver');
}

// ---- Driver history ----
async function renderDHistory() {
  const list = document.getElementById('d-hist-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-st"><div class="empty-ico">⏳</div><div class="empty-txt">Загрузка...</div></div>';
  try {
    // Query all done orders and filter client-side (Firestore needs composite index for two-field query)
    const orders = await dbQuery('orders', 'status', '==', 'done');
    const mine = orders
      .filter(o => o.acceptedDriver && o.acceptedDriver.driverId === STATE.uid)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!mine.length) {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">📋</div><div class="empty-txt">Поездок пока нет</div></div>';
      return;
    }
    list.innerHTML = mine.map(o => `
      <div class="hist-card">
        <div class="hist-hdr">
          <div class="hist-date">${fmtDate(o.createdAt)}</div>
          <div class="hist-price">${fmtMoney(o.acceptedPrice || o.price, o.currency?.symbol)}</div>
        </div>
        <div class="hist-route">${escHtml(o.from)} → ${escHtml(o.to)}</div>
        <span class="hist-b hb-ok">✓ Завершена</span>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">⚠️</div><div class="empty-txt">Ошибка загрузки</div></div>';
  }
}
