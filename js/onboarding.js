/* ============================================================
   ONBOARDING — Registration flow
   Fixes:
     - DOB field removed
     - Phone auto-filled from Telegram (readonly)
     - Phone fetched from Firebase phone_shares if available
   ============================================================ */

// Pre-fill registration form from Telegram data and phone from user_links
async function prefillTg() {
  const u = tg.initDataUnsafe && tg.initDataUnsafe.user;
  const nameEl = document.getElementById('reg-name');
  const phoneEl = document.getElementById('reg-phone');

  // Fill name from Telegram
  if (u && u.first_name && nameEl) {
    nameEl.value = u.first_name + (u.last_name ? ' ' + u.last_name : '');
  }

  // Fill phone from user_links/{uid} — stored by bot when user shared contact
  if (STATE.uid) {
    try {
      const linkData = await dbGet('user_links', STATE.uid);
      if (linkData && linkData.phone && phoneEl) {
        phoneEl.value = linkData.phone;
        phoneEl.readOnly = true;
        const lockEl = document.getElementById('phone-lock-icon');
        if (lockEl) lockEl.style.display = '';
      }
      // Also pre-fill name from bot data if not yet filled
      if (linkData && linkData.firstName && nameEl && !nameEl.value) {
        nameEl.value = linkData.firstName;
      }
    } catch (e) {}
  }
}

// ---- Role selection (step 1) ----
function selRole(r) {
  STATE.obRole = r;
  document.querySelectorAll('.role-card').forEach(c =>
    c.classList.toggle('sel', c.dataset.role === r)
  );
}

// ---- Step navigation ----
function obNext(step) {
  if (step === 1) {
    if (!STATE.obRole) { showToast('Выберите роль', 'err'); return; }
    setObStep(2);
  } else if (step === 2) {
    const name = document.getElementById('reg-name').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const country = document.getElementById('reg-country').value;
    const city = document.getElementById('reg-city').value;

    if (!name) { showToast('Введите имя', 'err'); return; }
    if (!phone || phone.length < 6) { showToast('Введите телефон', 'err'); return; }
    if (!country) { showToast('Выберите страну из списка', 'err'); return; }
    if (!city) { showToast('Выберите город из списка', 'err'); return; }

    setObStep(3);
    _show('ob-driver-block', STATE.obRole === 'driver');
    _show('ob-passenger-block', STATE.obRole !== 'driver');
  }
}

function obBack(step) { setObStep(step - 1); }

function setObStep(n) {
  document.querySelectorAll('.ob-step').forEach((s, i) =>
    s.classList.toggle('active', i + 1 === n)
  );
  [1, 2, 3].forEach(i =>
    document.getElementById('sd' + i).classList.toggle('active', i <= n)
  );
}

// ---- Complete registration ----
async function finishReg() {
  const btn = document.getElementById('btn-finish-reg');
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const country = document.getElementById('reg-country').value;
  const countryName = document.getElementById('reg-country-input').value.trim();
  const city = document.getElementById('reg-city').value || document.getElementById('reg-city-input').value.trim();

  if (!name) { showToast('Введите имя', 'err'); return; }
  if (!phone) { showToast('Введите телефон', 'err'); return; }
  if (!city) { showToast('Выберите город', 'err'); return; }

  if (STATE.obRole === 'driver') {
    const brand = document.getElementById('reg-car-brand').value.trim();
    const num = document.getElementById('reg-car-num').value.trim();
    const color = document.getElementById('reg-car-color').value.trim();
    const year = document.getElementById('reg-car-year').value;
    if (!brand || !num || !color) { showToast('Заполните данные авто', 'err'); return; }
    if (!year || parseInt(year) < 1990) { showToast('Укажите корректный год', 'err'); return; }
  }

  btn.disabled = true;
  btn.textContent = 'Сохранение...';
  showLoading(true);

  try {
    const tgUser = tg.initDataUnsafe && tg.initDataUnsafe.user;
    const tgId = (tgUser && tgUser.id) ? String(tgUser.id) : '';

    const currency = GEO.getCurrency(country); // {code, symbol} based on country

    const user = {
      uid: STATE.uid,
      tgId,
      name,
      phone,
      country,
      countryName,
      city,
      currency,
      username: (tgUser && tgUser.username) || '',
      role: STATE.obRole,
      rating: 5.0,
      ratingCount: 0,
      trips: 0,
      passengerTrips: 0,
      driverTrips: 0,
      createdAt: new Date().toISOString(),
      approved: STATE.obRole === 'passenger',
      freeUntil: new Date(Date.now() + FREE_MONTHS * 30 * 24 * 3600 * 1000).toISOString(),
      bonusTrips: 0,
      totalShifts: 0,
      avgShiftTrips: 0,
      blocked: false,
    };

    if (STATE.obRole === 'driver') {
      user.car = {
        brand: document.getElementById('reg-car-brand').value.trim(),
        num: document.getElementById('reg-car-num').value.trim().toUpperCase(),
        color: document.getElementById('reg-car-color').value.trim(),
        year: document.getElementById('reg-car-year').value,
      };
      user.approved = false;
      user.driverMode = 'city';
    }

    STATE.user = user;
    STATE.role = STATE.obRole;
    STATE.registered = true;
    saveState();

    // Save to Firebase keyed by uid (not tgId)
    await dbSet('users', STATE.uid, user);

    showLoading(false);
    showToast('Регистрация завершена! ✅', 'ok');
    setTimeout(() => showConsentScreen(), 600);
  } catch (e) {
    console.error('finishReg error:', e);
    showLoading(false);
    btn.disabled = false;
    btn.textContent = 'Начать 🚀';
    showToast('Ошибка. Попробуйте ещё раз', 'err');
  }
}

// ---- Become driver from settings (passenger → driver) ----
async function becomeDriver() {
  const brand = document.getElementById('set-car-brand').value.trim();
  const year = parseInt(document.getElementById('set-car-year').value);
  const num = document.getElementById('set-car-num').value.trim().toUpperCase();
  const color = document.getElementById('set-car-color').value.trim();
  if (!brand || !num || !color || !year) {
    showToast('Заполните все данные автомобиля!', 'err'); return;
  }
  showLoading(true);
  try {
    const updates = {
      role: 'driver',
      car: { brand, year, num, color },
      approved: false,
      appliedForDriverAt: new Date().toISOString(),
      freeUntil: new Date(Date.now() + FREE_MONTHS * 30 * 24 * 3600 * 1000).toISOString()
    };
    await dbSet('users', STATE.uid, updates);
    STATE.user = { ...STATE.user, ...updates };
    saveState();
    closeModal('mo-settings');
    showToast('✅ Заявка на водителя отправлена! Ожидайте проверки.', 'ok');
    updateAllUI();
  } catch (e) {
    showToast('Ошибка при отправке заявки', 'err');
    console.error(e);
  }
  showLoading(false);
}

// ---- Switch between passenger/driver roles ----
function switchRole() {
  const newRole = STATE.role === 'passenger' ? 'driver' : 'passenger';

  // Build confirm message — warn if there's an active order or shift
  let confirmMsg = `Переключиться на ${newRole === 'driver' ? 'водителя' : 'пассажира'}?`;
  if (STATE.role === 'driver') {
    if (STATE.driverActiveOrderId) confirmMsg = 'У вас активная поездка! Она будет отменена. Переключиться?';
    else if (STATE.shiftActive) confirmMsg = 'У вас активная смена. Она завершится. Переключиться?';
  } else if (STATE.role === 'passenger' && STATE.activeOrderId) {
    confirmMsg = 'У вас активный заказ! Он будет отменён. Переключиться?';
  }

  tg.showConfirm(confirmMsg, async (ok) => {
    if (!ok) return;
    if (newRole === 'driver') {
      if (!STATE.user.car) {
        showToast('Для водителя нужно заполнить данные авто', 'warn');
        openModal('mo-settings');
        return;
      }
      if (STATE.user.blockedAsDriver || STATE.user.blocked) {
        showToast('Ваш аккаунт водителя заблокирован', 'err');
        return;
      }
    }

    // Switching AWAY from driver — clean up shift and any active order
    if (STATE.role === 'driver') {
      if (STATE.driverActiveOrderId) {
        try {
          await dbSet('orders', STATE.driverActiveOrderId, {
            status: 'cancelled',
            cancelledBy: 'driver',
            cancelledAt: new Date().toISOString(),
            cancelReason: 'Водитель сменил режим'
          });
          await dbSet('driver_shifts', STATE.uid + '_shift', { hasActiveOrder: false });
        } catch (e) { console.warn('[switchRole] cancel order:', e); }
        STATE.driverActiveOrderId = null;
      }
      if (STATE.shiftActive && typeof endShift === 'function') {
        await endShift();
        return; // endShift will call updateDriverUI, so we need to re-trigger the switch after it
      }
    }

    // Switching AWAY from passenger — cancel active order
    if (STATE.role === 'passenger' && STATE.activeOrderId) {
      try {
        await dbSet('orders', STATE.activeOrderId, {
          status: 'cancelled',
          cancelledBy: 'passenger',
          cancelledAt: new Date().toISOString(),
          cancelReason: 'Пассажир сменил режим'
        });
      } catch (e) { console.warn('[switchRole] cancel passenger order:', e); }
      STATE.activeOrderId = null;
      STATE.arrivalAcknowledged = false;
      if (typeof stopGeoTransmit === 'function') stopGeoTransmit();
      if (typeof stopArrivalSound === 'function') stopArrivalSound();
    }

    // Stop any active listeners before switching
    if (typeof stopListeningOrders === 'function') stopListeningOrders();
    if (typeof stopGeoTransmit === 'function') stopGeoTransmit();

    STATE.role = newRole;
    if (STATE.user) STATE.user.role = newRole;
    saveState();

    if (newRole === 'passenger') {
      showScreen('s-passenger');
      setupPassengerListeners();
    } else {
      showScreen('s-driver');
      setupDriverListeners();
    }
    updateAllUI();
    showToast('Режим переключён', 'ok');
  });
}

// ---- Save settings ----
async function saveSettings() {
  const name = document.getElementById('set-name').value.trim();
  const country = document.getElementById('set-country').value;
  const countryName = document.getElementById('set-country-input').value.trim();
  const city = document.getElementById('set-city').value || document.getElementById('set-city-input').value.trim();

  if (!name) { showToast('Введите имя', 'err'); return; }
  if (!city) { showToast('Выберите город', 'err'); return; }

  const currency = country ? GEO.getCurrency(country) : (STATE.user.currency || { code: 'KZT', symbol: '₸' });
  const updates = { name, country, countryName, city, currency };

  if (STATE.user.role === 'driver') {
    const brand = document.getElementById('edit-car-brand').value.trim();
    const year = document.getElementById('edit-car-year').value;
    const num = document.getElementById('edit-car-num').value.trim().toUpperCase();
    const color = document.getElementById('edit-car-color').value.trim();
    if (brand && num && color) {
      const newCar = { brand, num, color, year };
      if (JSON.stringify(newCar) !== JSON.stringify(STATE.user.car || {})) {
        updates.car = newCar;
        updates.approved = false;
        showToast('Данные авто изменены. Ожидайте подтверждения.', 'warn');
      }
    }
  }

  // Log changes to user_history
  try {
    const changed = {};
    if (updates.name && updates.name !== STATE.user.name) changed.name = { from: STATE.user.name, to: updates.name };
    if (updates.city && updates.city !== STATE.user.city) changed.city = { from: STATE.user.city, to: updates.city };
    if (updates.car) changed.car = { from: STATE.user.car || null, to: updates.car };
    if (Object.keys(changed).length > 0) {
      const histId = STATE.uid + '_' + Date.now();
      await dbSet('user_history', histId, {
        userId: STATE.uid,
        userName: STATE.user.name,
        changedAt: new Date().toISOString(),
        changes: changed
      });
    }
  } catch (e) { console.warn('[user_history]', e); }

  STATE.user = { ...STATE.user, ...updates };
  saveState();
  try { await dbSet('users', STATE.uid, updates); } catch (e) {}
  updateAllUI();
  updateDriverUI();
  closeModal('mo-settings');
  showToast('Сохранено ✅', 'ok');
}
