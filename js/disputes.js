/* ============================================================
   DISPUTES — Cancellation handling, response notifications,
              dispute creation, auto-blocking system
   ============================================================ */

// Defaults — overridden by admin settings loaded in loadAppSettings()
let PASSENGER_CANCEL_PENALTY = 0.1;
let DRIVER_CANCEL_PENALTY    = 0.05;

// Пороги блокировок
const PENDING_DISPUTE_BLOCK  = 3;   // кол-во одновременно открытых диспутов → блок до решения
const LOST_TODAY_BLOCK       = 3;   // кол-во проигранных диспутов за сутки → блок на 24ч

// ---- Response modal state ----
let _rn_timer  = null;
let _rn_notif  = null;

// ---- Notification listener (persistent) ----
let _unsubNotifListener = null;

// ===========================================================
// PENALTY
// ===========================================================

/** Subtract rating directly (penalty, not weighted average) */
async function applyRatingPenalty(uid, amount) {
  try {
    const user = await dbGet('users', uid);
    if (!user) return;
    const newRating = Math.max(1.0, Math.round(((user.rating || 5.0) - amount) * 100) / 100);
    await dbSet('users', uid, { rating: newRating });
    if (uid === STATE.uid) {
      STATE.user.rating = newRating;
      saveState();
      updateAllUI && updateAllUI();
    }
  } catch (e) { console.warn('[penalty]', e); }
}

/** Increment daily cancellation counter for a user */
async function recordDailyCancel(uid) {
  const today = new Date().toDateString();
  try {
    const user  = await dbGet('users', uid);
    const same  = user?.lastCancelDate === today;
    const count = (same ? (user?.cancellationsToday || 0) : 0) + 1;
    await dbSet('users', uid, { cancellationsToday: count, lastCancelDate: today });
    if (uid === STATE.uid) {
      STATE.user.cancellationsToday = count;
      STATE.user.lastCancelDate = today;
      saveState();
    }
    return count;
  } catch (e) { return 1; }
}

// ===========================================================
// DISPUTE-BASED AUTO-BLOCK
// ===========================================================

/**
 * Подсчитать количество pending-диспутов пользователя (как пассажира + как водителя).
 * Используем dbQuery дважды и дедуплицируем.
 */
async function _countPendingDisputes(uid) {
  try {
    const asPax = await dbQuery('disputes', 'passengerId', '==', uid);
    const asDrv = await dbQuery('disputes', 'driverUid',   '==', uid);
    const seen  = new Set();
    return [...asPax, ...asDrv].filter(d => {
      if (d.status !== 'pending') return false;
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    }).length;
  } catch (e) { return 0; }
}

/**
 * Проверить: если у uid >= 3 открытых диспутов → заблокировать до решения.
 * Вызывается после создания нового диспута.
 */
async function checkDisputePendingBlock(uid, role) {
  try {
    const user = await dbGet('users', uid);
    if (!user || user.blocked) return;

    const pendingCount = await _countPendingDisputes(uid);
    if (pendingCount >= PENDING_DISPUTE_BLOCK) {
      await dbSet('users', uid, {
        tempBlocked:      true,
        tempBlockedUntil: null,              // нет срока — до решения диспутов
        tempBlockReason:  'pending_disputes',
        tempBlockCount:   (user.tempBlockCount || 0) + 1,
      });
      if (uid === STATE.uid) {
        STATE.user.tempBlocked      = true;
        STATE.user.tempBlockedUntil = null;
        STATE.user.tempBlockReason  = 'pending_disputes';
        saveState();
        if (role === 'driver' && typeof endShift === 'function') {
          try { await endShift(); } catch (_) {}
        }
        _showBlockedScreen(null);
      }
    }
  } catch (e) { console.warn('[checkDisputePendingBlock]', e); }
}

/**
 * Показать экран блокировки.
 * until — ISO-строка или null (если блок до решения диспутов).
 */
function _showBlockedScreen(until) {
  const reason = STATE.user?.tempBlockReason;
  let title = 'Временная блокировка';
  let desc  = 'Из-за большого числа отмен или диспутов доступ временно ограничен.';
  let text  = '';

  if (reason === 'admin') {
    title = 'Аккаунт заблокирован';
    desc  = 'Ваш аккаунт заблокирован администратором. Обратитесь в поддержку для разблокировки.';
    text  = '';
  } else if (reason === 'pending_disputes') {
    text = 'У вас 3 и более открытых диспута. Доступ будет восстановлен после их рассмотрения администратором.';
  } else if (until) {
    const dateStr = new Date(until).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    text = `до ${dateStr}`;
  }

  _setText('s-blocked-title', title);
  _setText('s-blocked-desc',  desc);
  _setText('s-blocked-until', text);
  showScreen('s-blocked');
}

// ===========================================================
// DISPUTES
// ===========================================================

/**
 * Создать документ диспута.
 * @param {string} type          'driver_late' | 'no_passenger'
 * @param {string} orderId
 * @param {string} driverUid
 * @param {string} passengerId
 * @param {object|null} driverGeo    {lat, lng}
 * @param {object|null} passengerGeo {lat, lng}
 * @returns {string|null} disputeId
 */
async function createDispute(type, orderId, driverUid, passengerId, driverGeo, passengerGeo) {
  try {
    const order = await dbGet('orders', orderId);
    const [pUser, dUser] = await Promise.all([
      dbGet('users', passengerId),
      dbGet('users', driverUid)
    ]);

    const disputeId = 'DISP-' + Date.now();

    await dbSet('disputes', disputeId, {
      id:           disputeId,
      type,
      orderId,
      passengerId,
      driverUid,
      passengerName:  pUser?.name  || '—',
      driverName:     dUser?.name  || '—',
      passengerPhone: pUser?.phone || '—',
      driverPhone:    dUser?.phone || '—',
      from:           order?.from  || '—',
      to:             order?.to    || '—',
      driverGeo:    driverGeo    || null,
      passengerGeo: passengerGeo || null,
      passengerDisputesWon:  pUser?.disputesWon  || 0,
      passengerDisputesLost: pUser?.disputesLost || 0,
      driverDisputesWon:     dUser?.disputesWon  || 0,
      driverDisputesLost:    dUser?.disputesLost || 0,
      status:     'pending',
      resolution: null,
      createdAt:  new Date().toISOString(),
      resolvedAt: null,
    });

    // После создания — проверить обоих на лимит открытых диспутов
    await checkDisputePendingBlock(passengerId, 'passenger');
    await checkDisputePendingBlock(driverUid,   'driver');

    return disputeId;
  } catch (e) {
    console.warn('[createDispute]', e);
    return null;
  }
}

// ===========================================================
// NOTIFICATIONS
// ===========================================================

/** Записать уведомление пользователю */
async function sendNotification(toUid, notifData) {
  await dbSet('notifications', toUid + '_pending', {
    ...notifData,
    status:    'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 11000).toISOString(), // 11s — чуть больше 10s UI-таймера
  });
}

// ===========================================================
// RESPONSE MODAL (10-секундный обратный отсчёт)
// ===========================================================

const _RN_TITLES = {
  driver_late_q:  '⚠️ Пассажир не дождался',
  no_passenger_q: '⚠️ Водитель не нашёл вас',
};
const _RN_MESSAGES = {
  driver_late_q:  'Пассажир отменил заказ, указав что вы не прибыли вовремя. Ваш ответ:',
  no_passenger_q: 'Водитель отменил заказ, указав что вас не было на месте. Ваш ответ:',
};
const _RN_BUTTONS = {
  driver_late_q: [
    { key: 'not_on_time',    label: '⏰ Я не успел',       cls: 'btn-out' },
    { key: 'decided_not_to', label: '🚫 Я решил не ехать', cls: 'btn-out' },
    { key: 'i_arrived',      label: '📍 Я приехал',        cls: 'btn-y'   },
  ],
  no_passenger_q: [
    { key: 'not_on_time',    label: '⏰ Я не успел',       cls: 'btn-out' },
    { key: 'decided_not_to', label: '🚫 Я решил не ехать', cls: 'btn-out' },
    { key: 'i_was_there',    label: '📍 Я был на месте',   cls: 'btn-y'   },
  ],
};

function showResponseModal(notif) {
  _rn_notif = notif;

  _setText('rn-title',   _RN_TITLES[notif.type]   || 'Уведомление');
  _setText('rn-message', _RN_MESSAGES[notif.type] || '');

  const btns = document.getElementById('rn-buttons');
  if (btns) {
    btns.innerHTML = (_RN_BUTTONS[notif.type] || []).map(b =>
      `<button class="btn ${b.cls}" onclick="submitNotifResponse('${b.key}')">${b.label}</button>`
    ).join('');
  }

  const bar   = document.getElementById('rn-timer-bar');
  const secEl = document.getElementById('rn-seconds');
  const start = Date.now();
  const TTL   = 10000;
  if (bar)   bar.style.width   = '100%';
  if (secEl) secEl.textContent = '10';

  clearInterval(_rn_timer);
  _rn_timer = setInterval(() => {
    const rem = Math.max(0, TTL - (Date.now() - start));
    if (bar)   bar.style.width   = (rem / TTL * 100).toFixed(1) + '%';
    if (secEl) secEl.textContent = Math.ceil(rem / 1000);
    if (rem <= 0) {
      clearInterval(_rn_timer); _rn_timer = null;
      closeModal('mo-response-notif');
      // Таймер на стороне отправителя (11s) сам применит штраф если нет ответа
    }
  }, 200);

  openModal('mo-response-notif');
  tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
}

/** Вызывается при нажатии кнопки ответа */
async function submitNotifResponse(responseKey) {
  clearInterval(_rn_timer); _rn_timer = null;
  closeModal('mo-response-notif');
  if (!_rn_notif) return;
  const notif = _rn_notif;
  _rn_notif = null;

  // Пометить как responded — чтобы таймер на стороне отправителя не применил штраф
  try {
    await dbSet('notifications', STATE.uid + '_pending', { status: 'responded', response: responseKey });
  } catch (_) {}

  if (notif.type === 'driver_late_q') {
    await _handleDriverLateResponse(responseKey, notif);
  } else if (notif.type === 'no_passenger_q') {
    await _handleNoPassengerResponse(responseKey, notif);
  }
}

// Водитель отвечает на жалобу "не приехал"
async function _handleDriverLateResponse(key, notif) {
  const penalty = window._appSettings?.driverCancelPenalty ?? DRIVER_CANCEL_PENALTY;
  if (key === 'not_on_time' || key === 'decided_not_to') {
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    showToast('Ваш рейтинг снижен', 'warn');
  } else if (key === 'i_arrived') {
    const geo = await _getCurrentGeo();
    const id  = await createDispute(
      'driver_late', notif.orderId,
      STATE.uid,           // driverUid
      notif.passengerId,   // passengerId
      geo,                 // гео водителя в момент ответа
      null
    );
    if (id) showToast('Диспут открыт. Администратор рассмотрит ситуацию.', 'ok');
  }
}

// Пассажир отвечает на жалобу "не было на месте"
async function _handleNoPassengerResponse(key, notif) {
  const penalty = window._appSettings?.passengerCancelPenalty ?? PASSENGER_CANCEL_PENALTY;
  if (key === 'not_on_time' || key === 'decided_not_to') {
    await applyRatingPenalty(STATE.uid, penalty);
    await recordDailyCancel(STATE.uid);
    showToast('Ваш рейтинг снижен', 'warn');
  } else if (key === 'i_was_there') {
    const geo = await _getCurrentGeo();
    const id  = await createDispute(
      'no_passenger', notif.orderId,
      notif.driverUid,
      STATE.uid,
      notif.driverGeo || null,  // гео водителя из уведомления
      geo                       // текущее гео пассажира
    );
    if (id) showToast('Диспут открыт. Администратор рассмотрит ситуацию.', 'ok');
  }
}

// ===========================================================
// FULLSCREEN DISPUTE RESULT MODAL
// ===========================================================

function showDisputeResultModal(notif) {
  const isWarn = notif.msgType === 'warn';
  const iconEl = document.getElementById('dr-icon');
  const titleEl = document.getElementById('dr-title');
  const msgEl   = document.getElementById('dr-message');
  if (iconEl)  iconEl.textContent  = isWarn ? '⚠️' : '✅';
  if (titleEl) titleEl.textContent = isWarn ? 'Решение не в вашу пользу' : 'Решение в вашу пользу';
  if (msgEl)   msgEl.textContent   = notif.message || 'Администратор рассмотрел ситуацию.';
  openModal('mo-dispute-result');
  tg.HapticFeedback && tg.HapticFeedback.notificationOccurred(isWarn ? 'warning' : 'success');
}

function closeDisputeResult() {
  closeModal('mo-dispute-result');
  // Refresh user to determine next state after notification acknowledged
  dbGet('users', STATE.uid).then(fresh => {
    if (!fresh) return;
    STATE.user = { ...STATE.user, ...fresh };
    saveState();
    if (fresh.tempBlocked) {
      // Still blocked — show blocked screen
      _showBlockedScreen(fresh.tempBlockedUntil || null);
    } else if (!fresh.tempBlocked && document.getElementById('s-blocked')?.classList.contains('active')) {
      // Was on blocked screen and now unblocked — reinit
      showToast('Ваш доступ восстановлен ✅', 'ok');
      initMain();
    }
  }).catch(() => {});
}

// ===========================================================
// NOTIFICATION LISTENER (вызывается один раз из initMain)
// ===========================================================

function setupNotificationListener() {
  if (_unsubNotifListener) { _unsubNotifListener(); _unsubNotifListener = null; }
  if (!STATE.uid) return;

  _unsubNotifListener = onDocSnapshot('notifications', STATE.uid + '_pending', notif => {
    if (!notif || notif.status !== 'pending') return;

    // Проверить не истёк ли срок
    if (notif.expiresAt && new Date(notif.expiresAt) < new Date()) {
      dbSet('notifications', STATE.uid + '_pending', { status: 'expired' }).catch(() => {});
      return;
    }

    switch (notif.type) {
      case 'driver_late_q':
      case 'no_passenger_q':
        showResponseModal(notif);
        break;

      case 'driver_cancelled_info':
        showToast(notif.message || 'Водитель отменил заказ. Создайте заявку заново.', 'warn');
        tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('warning');
        if (STATE.activeOrderId && notif.orderId === STATE.activeOrderId) {
          STATE.activeOrderId = null;
          STATE.arrivalAcknowledged = false;
          saveState();
          if (typeof _unsubPassengerOrder !== 'undefined' && _unsubPassengerOrder) {
            _unsubPassengerOrder(); _unsubPassengerOrder = null;
          }
          if (typeof stopArrivalSound === 'function') stopArrivalSound();
          if (typeof stopGeoTransmit  === 'function') stopGeoTransmit();
          _show('p-active-ride', false);
          _show('p-new-order', true);
        }
        dbSet('notifications', STATE.uid + '_pending', { status: 'seen' }).catch(() => {});
        break;

      case 'dispute_result':
        // Полноэкранное окно вместо toast
        showDisputeResultModal(notif);
        dbSet('notifications', STATE.uid + '_pending', { status: 'seen' }).catch(() => {});
        break;
    }
  });
}

// ===========================================================
// HELPERS
// ===========================================================

/** Попытаться получить GPS; resolves null при ошибке */
function _getCurrentGeo() {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 8000, maximumAge: 30000 }
    );
  });
}
