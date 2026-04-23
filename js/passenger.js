/* ============================================================
   PASSENGER — Order creation, offers, active ride
   Fixes:
     - Passenger trip count incremented on ride complete
     - Geo stops when ride starts (status='riding')
     - Offer auto-removed if driver cancels before passenger
   ============================================================ */

let _unsubPassengerOrder = null;

// ---- Bot task helpers for push notifications via Telegram bot ----

function _ensureArrivalBotTask(order) {
  if (STATE._arrivalBotTaskDone) return; // Already acknowledged
  const myTgId = String(tg.initDataUnsafe?.user?.id || '');
  if (!myTgId || !STATE.activeOrderId) return;
  dbSet('bot_tasks', STATE.activeOrderId + '_arrived', {
    type: 'arrived',
    status: 'active',
    orderId: STATE.activeOrderId,
    passengerUid: STATE.uid,
    passengerTgId: myTgId,
    driverName: order.acceptedDriver?.name || 'Водитель',
    createdAt: order.arrivedAt || new Date().toISOString(),
    lastSentAt: null,
    lastMsgId: null
  }).catch(() => {});
}

function _cancelArrivalBotTask(orderId) {
  STATE._arrivalBotTaskDone = true;
  if (!orderId) return;
  dbSet('bot_tasks', orderId + '_arrived', { status: 'done' }).catch(() => {});
}

// ---- Init listener ----
function setupPassengerListeners() {
  updateOnlineCount();
  // Refresh online count every 30s
  clearInterval(window._ocInterval);
  window._ocInterval = setInterval(updateOnlineCount, 30000);

  if (STATE.activeOrderId) {
    _unsubPassengerOrder = onDocSnapshot('orders', STATE.activeOrderId, handleOrderUpdate);
    checkActiveOrderStatus();
  } else {
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
  }

  // Listen for driver approval / block changes even while in passenger mode
  if (STATE.uid) {
    const _prevBlockedState = { tempBlocked: STATE.user?.tempBlocked || false };
    onDocSnapshot('users', STATE.uid, freshUser => {
      if (!freshUser) return;
      const wasApproved   = STATE.user.approved;
      const wasTempBlocked = _prevBlockedState.tempBlocked;
      STATE.user = { ...STATE.user, ...freshUser };
      saveState();
      _prevBlockedState.tempBlocked = !!freshUser.tempBlocked;
      if (freshUser.tempBlocked) {
        // Newly blocked — show blocked screen
        if (!wasTempBlocked) {
          if (typeof _showBlockedScreen === 'function') _showBlockedScreen(freshUser.tempBlockedUntil || null);
        }
        // Always return — no further UI updates while blocked
        return;
      }
      // Block was lifted — reinitialize
      if (wasTempBlocked && !freshUser.tempBlocked) {
        showToast('Ваш доступ восстановлен ✅', 'ok');
        if (typeof initMain === 'function') initMain();
        return;
      }
      if (freshUser.approved === true && !wasApproved) {
        showToast('Ваш водительский аккаунт одобрен! 🟢', 'ok');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
      }
    });
  }
}

// ---- Check state on tab switch ----
async function checkActiveOrderStatus() {
  if (!STATE.activeOrderId) {
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
    return;
  }
  const order = await dbGet('orders', STATE.activeOrderId);
  if (!order || ['cancelled', 'done'].includes(order.status)) {
    STATE.activeOrderId = null;
    saveState();
    _show('p-new-order', true);
    _show('p-searching', false);
    _show('p-active-ride', false);
    return;
  }
  if (order.status === 'searching') {
    _show('p-searching', true);
    _show('p-new-order', false);
    _show('p-active-ride', false);
    renderOffers(order);
    updateAob(order);
  } else if (['active', 'arrived', 'riding'].includes(order.status)) {
    _show('p-active-ride', true);
    _show('p-new-order', false);
    _show('p-searching', false);
    updateActiveRide(order);
  }
}

// ---- Real-time order update handler ----
function handleOrderUpdate(order) {
  if (!order) return;
  // Safety: ignore updates for orders that don't belong to this passenger
  if (order.passengerId && STATE.uid && order.passengerId !== STATE.uid) {
    console.warn('[handleOrderUpdate] Ignoring order from another passenger:', order.id);
    return;
  }
  // Safety: ignore if this isn't the currently active order
  if (STATE.activeOrderId && order.id && order.id !== STATE.activeOrderId) {
    console.warn('[handleOrderUpdate] Ignoring stale order update:', order.id);
    return;
  }
  const showOnly = id => {
    ['p-new-order', 'p-searching', 'p-active-ride'].forEach(i => _show(i, i === id));
  };
  if (order.status === 'searching') {
    showOnly('p-searching');
    renderOffers(order);
    updateAob(order);
  } else if (['active', 'arrived', 'riding'].includes(order.status)) {
    showOnly('p-active-ride');
    updateActiveRide(order);
  } else if (order.status === 'done') {
    const _doneOrderId = STATE.activeOrderId;
    STATE.activeOrderId = null;
    STATE.arrivalAcknowledged = false;
    STATE._arrivalBotTaskDone = false;
    saveState();
    if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
    showOnly('p-new-order');
    stopArrivalSound();
    _cancelArrivalBotTask(_doneOrderId);
    stopGeoTransmit();
    showToast('Поездка завершена! ✅', 'ok');
    tg.HapticFeedback.notificationOccurred('success');
    setTimeout(() => openRatingModal('driver', order.id), 700);
  } else if (order.status === 'cancelled') {
    const _canxOrderId = STATE.activeOrderId;
    STATE.activeOrderId = null;
    STATE._arrivalBotTaskDone = false;
    saveState();
    if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
    showOnly('p-new-order');
    stopArrivalSound();
    _cancelArrivalBotTask(_canxOrderId);
    stopGeoTransmit();
    showToast('Заказ отменён');
  }
}

// ---- Active order box ----
function updateAob(order) {
  _setText('p-aob-route', `${order.from} → ${order.to}`);
  _setText('p-aob-meta', `${fmtMoney(order.price, order.currency?.symbol)} · ${order.payMethod === 'cash' ? 'Наличные' : 'Перевод'}`);
}

// ---- Build single offer card HTML ----
function _buildOfferCard(o, orderId) {
  const OFFER_TTL = 10000;
  const hasTimer = !!o.offerTime;
  const elapsed = hasTimer ? Date.now() - new Date(o.offerTime).getTime() : 0;
  const pct = hasTimer ? Math.max(0, (OFFER_TTL - elapsed) / OFFER_TTL * 100) : 100;
  const safeOid = escHtml(o.id);
  const safeOrdId = escHtml(orderId);
  return `
    <div class="offer-card" data-oid="${safeOid}">
      <div style="display:flex;align-items:center;gap:11px">
        <div class="drv-av">🚗</div>
        <div style="flex:1">
          <div class="offer-name">${escHtml(o.name)}</div>
          <div class="offer-meta">
            <div class="stars">⭐ ${fmtRating(o.rating)}</div>
            <div class="offer-car">${escHtml(o.car || '')}</div>
          </div>
        </div>
        <div style="text-align:right">
          <div class="offer-price">${fmtMoney(o.price, o.currency?.symbol)}</div>
          <div class="offer-eta">~${o.eta} мин</div>
        </div>
      </div>
      ${hasTimer ? `<div class="offer-progress-wrap"><div class="offer-progress-bar" id="opb-${safeOid}" style="width:${pct.toFixed(1)}%"></div></div>` : ''}
      <div class="offer-acts">
        <button class="btn btn-green btn-sm" onclick="acceptOffer('${safeOid}','${safeOrdId}')">✓ Принять</button>
        <button class="btn btn-ghost btn-sm" onclick="declineOffer('${safeOid}','${safeOrdId}')">✗ Отклонить</button>
      </div>
    </div>`;
}

// ---- Render offers list (DOM-diff — no flicker, no phantom offers) ----
function renderOffers(order) {
  const list = document.getElementById('p-offers-list');
  const titleEl = document.getElementById('p-offers-title');
  const offers = order.offers || [];
  if (!list) return;

  // Safety: only render offers for the order we're currently subscribed to
  if (STATE.activeOrderId && order.id && order.id !== STATE.activeOrderId) return;

  if (!offers.length) {
    if (window._offerCountdown) { clearInterval(window._offerCountdown); window._offerCountdown = null; }
    if (titleEl) titleEl.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  if (titleEl) titleEl.style.display = 'block';

  const newIds = new Set(offers.map(o => o.id));

  // Remove cards that are no longer in the offer list (declined / expired)
  list.querySelectorAll('[data-oid]').forEach(card => {
    if (!newIds.has(card.dataset.oid)) {
      card.style.transition = 'opacity .2s, transform .2s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(30px)';
      setTimeout(() => { if (card.parentNode) card.parentNode.removeChild(card); }, 220);
    }
  });

  // Add new cards (ones not yet rendered)
  const existingCards = {};
  list.querySelectorAll('[data-oid]').forEach(c => existingCards[c.dataset.oid] = c);
  offers.forEach(o => {
    if (!existingCards[o.id]) {
      const tmp = document.createElement('div');
      tmp.innerHTML = _buildOfferCard(o, order.id);
      const card = tmp.firstElementChild;
      card.style.opacity = '0';
      card.style.transform = 'translateY(8px)';
      list.appendChild(card);
      requestAnimationFrame(() => {
        card.style.transition = 'opacity .2s, transform .2s';
        card.style.opacity = '1';
        card.style.transform = 'none';
      });
    }
  });

  // Countdown: update progress bars in-place, or start ticker
  const OFFER_TTL = 10000;
  if (!window._offerCountdown && offers.some(o => o.offerTime)) {
    window._offerCountdown = setInterval(async () => {
      const nowMs = Date.now();
      let anyExpired = false;
      offers.forEach(o => {
        if (!o.offerTime) return;
        const rem = Math.max(0, OFFER_TTL - (nowMs - new Date(o.offerTime).getTime()));
        const bar = document.getElementById('opb-' + o.id);
        if (bar) bar.style.width = (rem / OFFER_TTL * 100).toFixed(1) + '%';
        if (rem <= 0) anyExpired = true;
      });
      if (anyExpired) {
        clearInterval(window._offerCountdown);
        window._offerCountdown = null;
        // Remove expired offers from Firebase
        try {
          if (!STATE.activeOrderId) return;
          const freshOrder = await dbGet('orders', order.id);
          if (!freshOrder || freshOrder.status !== 'searching') return;
          const validOffers = (freshOrder.offers || []).filter(o => {
            if (!o.offerTime) return true;
            return (nowMs - new Date(o.offerTime).getTime()) < OFFER_TTL;
          });
          if (validOffers.length !== (freshOrder.offers || []).length) {
            await dbSet('orders', order.id, { offers: validOffers });
          }
        } catch (e) { console.warn('[offerCountdown]', e); }
      }
    }, 500);
  }
}

// ---- Active ride display ----
function updateActiveRide(order) {
  _setText('p-ride-route', `${order.from} → ${order.to}`);
  const drv = order.acceptedDriver;
  if (drv) {
    const av = document.getElementById('p-ride-drv-av');
    if (av) av.textContent = '🚗';
    _setText('p-ride-drv-name', drv.name);
    _setText('p-ride-drv-car', drv.car || '');
    _setText('p-ride-drv-rating', fmtRating(drv.rating));
    _setText('p-ride-price', fmtMoney(drv.price, STATE.activeOrder?.currency?.symbol));
    _setText('p-ride-meta', `Водитель: ${drv.name}`);
  }
  const alertEl = document.getElementById('p-arrival-alert');
  const spillEl = document.getElementById('p-ride-spill');
  const statusEl = document.getElementById('p-ride-status');

  if (order.status === 'arrived') {
    if (statusEl) statusEl.textContent = '🚗 Водитель прибыл!';
    if (spillEl) spillEl.className = 'spill sp-arrived';
    // Only show alert and play sound if passenger hasn't acknowledged yet
    const acknowledged = order.passengerBoarded || STATE.arrivalAcknowledged;
    if (alertEl) alertEl.style.display = acknowledged ? 'none' : 'block';
    _setText('p-ride-eta', acknowledged ? '🚶 Выходите' : '✅ Ожидает вас');
    if (!acknowledged) { startArrivalSound(); _ensureArrivalBotTask(order); }
    else stopArrivalSound();
  } else if (order.status === 'riding') {
    if (statusEl) statusEl.textContent = '🛣️ Поездка началась';
    if (spillEl) spillEl.className = 'spill sp-active';
    if (alertEl) alertEl.style.display = 'none';
    stopArrivalSound();
    stopGeoTransmit(); // Stop geo when ride starts
  } else {
    if (alertEl) alertEl.style.display = 'none';
    if (spillEl) spillEl.className = 'spill sp-active';
    if (statusEl) statusEl.textContent = '🚗 Водитель едет к вам';
    _setText('p-ride-eta', drv ? `~${drv.eta} мин` : '');
    if (STATE.geoEnabled && order.id) startGeoTransmit(order.id);
  }
}

// ---- Online count ----
async function updateOnlineCount() {
  if (!STATE.user) return;
  try {
    const shifts = await dbQuery('driver_shifts', 'city', '==', STATE.user.city);
    const now = new Date();
    const active = shifts.filter(s => s.active && new Date(s.until) > now && s.mode === 'city');
    const free = active.filter(s => !s.hasActiveOrder);
    _setText('oc-total', active.length);
    _setText('oc-free', free.length);
  } catch (e) {
    // Fallback: show plausible numbers
    const t = document.getElementById('oc-total');
    const f = document.getElementById('oc-free');
    if (t && !t.textContent.match(/^\d+$/)) t.textContent = '—';
    if (f && !f.textContent.match(/^\d+$/)) f.textContent = '—';
  }
}

// ---- Create order ----
async function createOrder() {
  if (!STATE.fromAddr) { showToast('Укажите откуда', 'err'); return; }
  if (!STATE.toAddr) { showToast('Укажите куда', 'err'); return; }
  const price = parseInt(document.getElementById('p-price').value);
  if (!price || price <= 0) { showToast('Укажите цену', 'err'); return; }

  if (STATE.user.blockedAsPassenger || STATE.user.blocked) { showToast('Ваш аккаунт заблокирован', 'err'); return; }

  const btn = document.getElementById('btn-create-order');
  btn.disabled = true;
  showLoading(true);

  // Immediately cancel any old subscriptions and clear stale UI
  if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
  if (window._offerCountdown) { clearInterval(window._offerCountdown); window._offerCountdown = null; }
  const offerList = document.getElementById('p-offers-list');
  if (offerList) offerList.innerHTML = '';
  const offerTitle = document.getElementById('p-offers-title');
  if (offerTitle) offerTitle.style.display = 'none';
  STATE.activeOrderId = null; // Reset before creating new — prevents stale ID in listener

  const orderId = 'ORD-' + Date.now();
  const order = {
    id: orderId,
    passengerId: STATE.uid,
    passengerName: STATE.user.name,
    passengerPhone: STATE.user.phone,
    passengerRating: STATE.user.rating,
    from: STATE.fromAddr.address,
    fromEntrance: STATE.fromAddr.entrance || '',
    to: STATE.toAddr.address,
    toEntrance: STATE.toAddr.entrance || '',
    pax: STATE.pax,
    childSeat: STATE.childSeat,
    payMethod: STATE.payMethod,
    price,
    comment: document.getElementById('p-comment').value.trim(),
    geoEnabled: STATE.geoEnabled,
    status: 'searching',
    offers: [],
    city: STATE.user.city,
    currency: STATE.user.currency || { code: 'KZT', symbol: '₸' },
    type: 'city',
    createdAt: new Date().toISOString(),
  };

  STATE._arrivalBotTaskDone = false;
  try {
    await dbSet('orders', orderId, order);
    // Notify offline drivers via bot
    dbSet('bot_tasks', orderId + '_new_order', {
      type: 'new_order',
      status: 'pending',
      orderId,
      from: order.from,
      to: order.to,
      price: order.price,
      city: order.city,
      createdAt: order.createdAt
    }).catch(() => {});
    STATE.activeOrderId = orderId;
    saveState();

    if (_unsubPassengerOrder) _unsubPassengerOrder();
    _unsubPassengerOrder = onDocSnapshot('orders', orderId, handleOrderUpdate);

    _show('p-new-order', false);
    _show('p-searching', true);
    updateAob(order);

    if (STATE.geoEnabled) startGeoTransmit(orderId);
    showToast('Заказ создан! Ищем водителя... 🔍', 'ok');
    tg.HapticFeedback.impactOccurred('medium');
  } catch (e) {
    console.error(e);
    showToast('Ошибка создания заказа', 'err');
  }
  showLoading(false);
  btn.disabled = false;
}

// ---- Cancel order (searching phase) — ask reason first ----
function cancelOrder() {
  openModal('mo-pax-cancel-search');
}

async function submitPassengerCancelSearch(reason) {
  closeModal('mo-pax-cancel-search');
  if (STATE.activeOrderId) {
    await dbSet('orders', STATE.activeOrderId, {
      status: 'cancelled',
      cancelledBy: 'passenger',
      cancelReason: reason,
      cancelledAt: new Date().toISOString()
    });
    STATE.activeOrderId = null;
    STATE.arrivalAcknowledged = false;
    saveState();
    if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
    stopGeoTransmit();
  }
  if (window._offerCountdown) { clearInterval(window._offerCountdown); window._offerCountdown = null; }
  _show('p-searching', false);
  _show('p-new-order', true);
  showToast('Заказ отменён');
}

// ---- Accept offer ----
async function acceptOffer(offerId, orderId) {
  const order = await dbGet('orders', orderId);
  if (!order || order.status !== 'searching') {
    showToast('Заказ уже не актуален', 'warn'); return;
  }
  const offer = (order.offers || []).find(o => o.id === offerId);
  if (!offer) return;
  // Make sure driverId is explicitly set so watchPendingOffer on driver side works
  const acceptedDriver = { ...offer, driverId: offer.driverId };
  await dbSet('orders', orderId, {
    status: 'active',
    acceptedDriver,
    acceptedPrice: offer.price,
    acceptedAt: new Date().toISOString(),
    offers: []
  });
  showToast(`${escHtml(offer.name)} едет к вам! ~${offer.eta} мин ✅`, 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

// ---- Decline offer ----
async function declineOffer(offerId, orderId) {
  const order = await dbGet('orders', orderId);
  if (!order) return;
  const newOffers = (order.offers || []).filter(o => o.id !== offerId);
  await dbSet('orders', orderId, { offers: newOffers });
  showToast('Предложение отклонено');
}

// ---- Passenger boarded (hide arrival alert) ----
async function passengerBoarded() {
  stopArrivalSound();
  STATE.arrivalAcknowledged = true;
  saveState();
  _show('p-arrival-alert', false);
  if (STATE.activeOrderId) {
    await dbSet('orders', STATE.activeOrderId, { passengerBoarded: true });
    _cancelArrivalBotTask(STATE.activeOrderId);
  }
  showToast('Отлично! Приятной поездки 🚗', 'ok');
  tg.HapticFeedback.notificationOccurred('success');
}

// ---- Cancel active ride (passenger side) — ask reason first ----
function passengerCancelRide() {
  openModal('mo-pax-cancel-active');
}

async function submitPassengerCancelActive(reason) {
  closeModal('mo-pax-cancel-active');
  if (!STATE.activeOrderId) return;

  const orderId = STATE.activeOrderId;
  const order = await dbGet('orders', orderId);

  if (reason === 'driver_late' && order && order.acceptedDriver && order.acceptedDriver.driverId) {
    // Driver claims they arrived but didn't — ask driver to respond
    await sendNotification(order.acceptedDriver.driverId, {
      type: 'driver_late_q',
      orderId,
      passengerId: STATE.uid,
    });
    // 11-second sender-side timeout — if driver doesn't respond, apply penalty to driver
    const driverId = order.acceptedDriver.driverId;
    setTimeout(async () => {
      try {
        const notif = await dbGet('notifications', driverId + '_pending');
        if (notif && notif.status === 'pending') {
          const penalty = window._appSettings?.driverCancelPenalty ?? 0.05;
          await applyRatingPenalty(driverId, penalty);
          await recordDailyCancel(driverId);
          await checkAutoBlock(driverId, 'driver');
          await dbSet('notifications', driverId + '_pending', { status: 'expired' });
        }
      } catch (e) { console.warn('[sender-timer driver_late]', e); }
    }, 11000);
  } else {
    // 'not_needed' or 'too_long' — penalty for passenger
    const penalty = window._appSettings?.passengerCancelPenalty ?? 0.1;
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    await checkAutoBlock(STATE.uid, 'passenger');
    showToast('Ваш рейтинг снижен', 'warn');
  }

  // Cancel the order
  await dbSet('orders', orderId, {
    status: 'cancelled',
    cancelledBy: 'passenger',
    cancelReason: reason,
    cancelledAt: new Date().toISOString()
  });

  STATE.activeOrderId = null;
  STATE.arrivalAcknowledged = false;
  saveState();
  if (_unsubPassengerOrder) { _unsubPassengerOrder(); _unsubPassengerOrder = null; }
  stopArrivalSound();
  stopGeoTransmit();
  _show('p-active-ride', false);
  _show('p-new-order', true);
  showToast('Поездка отменена');
}

// ---- History ----
async function renderPHistory() {
  const list = document.getElementById('p-hist-list');
  if (!list) return;
  list.innerHTML = '<div class="empty-st"><div class="empty-ico">⏳</div><div class="empty-txt">Загрузка...</div></div>';
  try {
    const orders = await dbQuery('orders', 'passengerId', '==', STATE.uid);
    const done = orders
      .filter(o => ['done', 'cancelled'].includes(o.status))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!done.length) {
      list.innerHTML = '<div class="empty-st"><div class="empty-ico">📋</div><div class="empty-txt">Поездок пока нет</div></div>';
      return;
    }
    list.innerHTML = done.map(o => `
      <div class="hist-card">
        <div class="hist-hdr">
          <div class="hist-date">${fmtDate(o.createdAt)}</div>
          <div class="hist-price">${fmtMoney(o.acceptedDriver ? o.acceptedDriver.price : o.price, o.currency?.symbol)}</div>
        </div>
        <div class="hist-route">${escHtml(o.from)} → ${escHtml(o.to)}</div>
        ${o.status === 'done'
          ? '<span class="hist-b hb-ok">✓ Завершена</span>'
          : '<span class="hist-b hb-cx">✗ Отменена</span>'}
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">⚠️</div><div class="empty-txt">Ошибка загрузки</div></div>';
  }
}

// ---- Address modal ----
function openAddrModal(target) {
  STATE.addrTarget = target;
  const titles = {
    from: 'Откуда едем?',
    to: 'Куда едем?',
    'ic-from': 'Откуда (город + адрес)',
    'ic-to': 'Куда (город + адрес)'
  };
  _setText('mo-addr-title', titles[target] || 'Адрес');

  const cur = target === 'from' ? STATE.fromAddr
    : target === 'to' ? STATE.toAddr
    : target === 'ic-from' ? STATE.icFromAddr
    : STATE.icToAddr;

  _setVal('mo-addr-input', cur ? cur.address : '');
  _setVal('mo-ent-input', cur ? cur.entrance || '' : '');

  // City field: show only for intercity
  const isIc = target === 'ic-from' || target === 'ic-to';
  const cityWrap = document.getElementById('mo-city-wrap');
  if (cityWrap) cityWrap.style.display = isIc ? '' : 'none';
  if (isIc) {
    _setVal('mo-city-input', cur ? cur.city || '' : '');
    const cityInput = document.getElementById('mo-city-input');
    const cityList = document.getElementById('mo-city-ac-list');
    if (cityInput && cityList) {
      cityInput.oninput = function() {
        const q = this.value.trim();
        cityList.innerHTML = '';
        if (q.length < 2) { cityList.classList.remove('open'); return; }
        cityList.innerHTML = '<div class="ac-item ac-loading">🔍 Поиск...</div>';
        cityList.classList.add('open');
        GEO.searchCities(q, '', results => {
          if (!results.length) { cityList.classList.remove('open'); return; }
          cityList.innerHTML = '';
          results.forEach(m => {
            const li = document.createElement('div');
            li.className = 'ac-item';
            li.innerHTML = `${m.name}<span class="ac-sub">, ${m.country}</span>`;
            li.onclick = () => {
              cityInput.value = m.name;
              if (STATE.addrTarget === 'ic-from') STATE.icFromCity = m.name;
              if (STATE.addrTarget === 'ic-to') STATE.icToCity = m.name;
              cityList.classList.remove('open');
            };
            cityList.appendChild(li);
          });
          cityList.classList.add('open');
        });
      };
    }
  }

  openModal('mo-address');
  setTimeout(() => {
    const el = document.getElementById('mo-addr-input');
    if (el) el.focus();
  }, 350);
}

function saveAddr() {
  const addr = document.getElementById('mo-addr-input').value.trim();
  const entrance = document.getElementById('mo-ent-input').value.trim();
  const isIc = STATE.addrTarget === 'ic-from' || STATE.addrTarget === 'ic-to';
  const cityEl = document.getElementById('mo-city-input');
  const city = isIc && cityEl ? cityEl.value.trim() : '';
  if (isIc) {
    if (STATE.addrTarget === 'ic-from') STATE.icFromCity = city;
    if (STATE.addrTarget === 'ic-to') STATE.icToCity = city;
  }

  if (!addr) { showToast('Введите адрес', 'err'); return; }
  if (isIc && !city) { showToast('Укажите город', 'err'); return; }

  const data = { address: isIc ? `${city}, ${addr}` : addr, entrance, city };
  const t = STATE.addrTarget;

  if (t === 'from') {
    STATE.fromAddr = data;
    const el = document.getElementById('p-from-txt');
    if (el) el.innerHTML = escHtml(addr);
    _setText('p-from-ent', entrance ? 'Подъезд ' + entrance : '');
  } else if (t === 'to') {
    STATE.toAddr = data;
    const el = document.getElementById('p-to-txt');
    if (el) el.innerHTML = escHtml(addr);
    _setText('p-to-ent', entrance ? 'Подъезд ' + entrance : '');
  } else if (t === 'ic-from') {
    STATE.icFromAddr = data;
    _setText('ic-from-txt', data.address);
  } else if (t === 'ic-to') {
    STATE.icToAddr = data;
    _setText('ic-to-txt', data.address);
  }
  closeModal('mo-address');
}

// ---- Chips ----
function chPax(d) {
  STATE.pax = Math.max(1, Math.min(8, STATE.pax + d));
  _setText('mo-pax-num', STATE.pax);
}
function savePax() {
  _setText('chip-pax-lbl', `${STATE.pax} пасс.`);
  closeModal('mo-pax');
}
function toggleChip(name) {
  if (name === 'child') {
    STATE.childSeat = !STATE.childSeat;
    const el = document.getElementById('chip-child');
    if (el) el.classList.toggle('on', STATE.childSeat);
  }
}
function selPay(m) {
  STATE.payMethod = m;
  const cc = document.getElementById('pay-cash-check');
  const tc = document.getElementById('pay-transfer-check');
  if (cc) cc.style.color = m === 'cash' ? 'var(--y)' : 'var(--text3)';
  if (tc) tc.style.color = m === 'transfer' ? 'var(--y)' : 'var(--text3)';
  _setText('chip-pay-lbl', m === 'cash' ? 'Наличные' : 'Перевод');
}

// ---- XSS protection ----
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
