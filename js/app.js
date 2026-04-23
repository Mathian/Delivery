/* ============================================================
   APP — Boot, screen management, tabs, UI updates
   ============================================================ */

// ---- Boot ----
window.addEventListener('DOMContentLoaded', () => {
  // Hard reset via URL parameter ?reset=1
  if (new URLSearchParams(location.search).get('reset') === '1') {
    localStorage.clear();
    location.replace(location.pathname);
    return;
  }

  loadState();

  // Read ?uid= from URL (personalized link sent by bot) and persist it
  const urlUid = new URLSearchParams(location.search).get('uid');
  if (urlUid && urlUid.length === 64) {
    STATE.uid = urlUid;
    saveState();
    // Clean uid from URL bar (no reload)
    history.replaceState(null, '', location.pathname);
  }

  initFirebase();
  buildDateScroll();
  buildTimeWheel();

  // Complaint checkbox
  const cc = document.getElementById('complaint-check');
  if (cc) {
    cc.addEventListener('change', function () {
      const cw = document.getElementById('complaint-wrap');
      if (cw) cw.style.display = this.checked ? 'block' : 'none';
    });
  }

  // Close modals on backdrop click
  document.querySelectorAll('.mo').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // Close autocomplete on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) {
      document.querySelectorAll('.autocomplete-list').forEach(l => l.classList.remove('open'));
    }
  });

  // Support chat enter key
  const supportInput = document.getElementById('support-input');
  if (supportInput) {
    supportInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendSupportMsg(); });
  }

  // Load app settings (bonus system, TON wallet, etc.)
  loadAppSettings();

  // Pre-load countries list in background (non-blocking)
  GEO.init();

  // Boot sequence
  setTimeout(async () => {
    _show('s-splash', false);
    document.getElementById('s-splash').classList.remove('active');

    if (!STATE.uid) {
      // No personalized link — user must open via bot
      showScreen('s-no-uid');
      return;
    }

    if (STATE.registered && STATE.user) {
      if (!STATE.user.consentGiven) { showConsentScreen(); return; }
      initMain();
    } else {
      // Try auto-login: check if uid already has a profile in Firebase
      try {
        const existing = await dbGet('users', STATE.uid);
        if (existing) {
          STATE.user = existing;
          STATE.role = existing.role || 'passenger';
          STATE.registered = true;
          saveState();
          if (!existing.consentGiven) { showConsentScreen(); return; }
          initMain();
          return;
        }
      } catch (e) { console.warn('[boot] auto-login check:', e); }
      // No profile yet — show onboarding
      prefillTg();
      showScreen('s-onboard');
    }
  }, 1800);
});

// ---- Firebase-ready init ----
async function initMain() {
  showLoading(true);
  // Refresh user data from Firebase
  if (isFirebaseReady && STATE.uid) {
    try {
      const fresh = await dbGet('users', STATE.uid);
      if (fresh) { STATE.user = { ...STATE.user, ...fresh }; saveState(); }
    } catch (e) { console.warn('[initMain] reload:', e); }
  }

  // Check temporary block
  if (STATE.user && STATE.user.tempBlocked) {
    const reason = STATE.user.tempBlockReason;

    if (reason === 'admin') {
      // Постоянная блокировка администратором — не снимается автоматически
      showLoading(false);
      setupNotificationListener();
      _showBlockedScreen(null);
      return;
    } else if (reason === 'pending_disputes') {
      // Блок до решения диспутов — проверить актуальное количество
      const pendingCount = await _countPendingDisputes(STATE.uid).catch(() => 99);
      if (pendingCount >= 3) {
        showLoading(false);
        setupNotificationListener();
        _showBlockedScreen(null);
        return;
      } else {
        // Диспутов < 3 — снять блок
        STATE.user.tempBlocked     = false;
        STATE.user.tempBlockedUntil = null;
        STATE.user.tempBlockReason  = null;
        saveState();
        try { await dbSet('users', STATE.uid, { tempBlocked: false, tempBlockedUntil: null, tempBlockReason: null }); } catch (_) {}
      }
    } else if (STATE.user.tempBlockedUntil) {
      // Блок на 24ч — проверить не истёк ли
      if (new Date(STATE.user.tempBlockedUntil) > new Date()) {
        showLoading(false);
        setupNotificationListener();
        _showBlockedScreen(STATE.user.tempBlockedUntil);
        return;
      } else {
        STATE.user.tempBlocked      = false;
        STATE.user.tempBlockedUntil = null;
        STATE.user.tempBlockReason  = null;
        saveState();
        try { await dbSet('users', STATE.uid, { tempBlocked: false, tempBlockedUntil: null, tempBlockReason: null }); } catch (_) {}
      }
    }
  }

  // Daily stats reset on app load
  if (STATE.user) {
    const today = new Date().toDateString();
    if (STATE.user.lastStatsDate && STATE.user.lastStatsDate !== today) {
      STATE.user.driverTripsToday = 0;
      STATE.user.driverEarningsToday = 0;
      STATE.user.lastStatsDate = today;
      saveState();
    }
  }
  showLoading(false);
  updateAllUI();
  setupNotificationListener();
  setTimeout(() => checkSupportUnread && checkSupportUnread(), 2000);
  if (STATE.role === 'passenger') {
    showScreen('s-passenger');
    setupPassengerListeners();
  } else {
    showScreen('s-driver');
    setupDriverListeners();
  }
  updateOnlineCount();
  startWebAppHeartbeat();
}

// ---- WebApp visibility heartbeat (lets bot know if app is open) ----
function startWebAppHeartbeat() {
  const myTgId = String(tg.initDataUnsafe?.user?.id || '');
  const sendHb = () => {
    if (!STATE.uid) return;
    const fields = { webAppLastSeen: new Date().toISOString() };
    if (myTgId) fields.tgId = myTgId;
    dbSet('users', STATE.uid, fields).catch(() => {});
  };
  sendHb();
  if (window._hbInterval) clearInterval(window._hbInterval);
  window._hbInterval = setInterval(sendHb, 5000);
  if (!window._hbVisibilityBound) {
    window._hbVisibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sendHb();
    });
  }
}

// ---- Screen transitions ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ---- UI: update all UI elements ----
function updateAllUI() {
  if (!STATE.user) return;
  const u = STATE.user;
  _setText('p-hdr-name', u.name.split(' ')[0]);
  _setText('pp-name', u.name);
  _setText('pp-phone', u.phone);
  _setText('pp-city', (u.city || '') + (u.countryName ? ', ' + u.countryName : ''));
  _setText('pp-trips', u.passengerTrips || u.trips || 0);
  _setText('pp-rating', fmtRating(u.rating));
  _setText('d-hdr-name', u.name.split(' ')[0]);
  _setText('dp-name', u.name);
  _setText('dp-phone', u.phone);
  if (u.car) _setText('dp-car', `${u.car.color} ${u.car.brand} ${u.car.year} · ${u.car.num}`);
  _setText('dp-trips', u.driverTrips || u.trips || 0);
  _setText('dp-rating', fmtRating(u.rating));
  _setText('dp-shift-trips', STATE.shiftTrips || 0);
  _setText('dp-trips-today', u.driverTripsToday || 0);
  _setText('dp-earnings-today', fmtMoney(u.driverEarningsToday || 0));
  _setText('dp-earnings-total', fmtMoney(u.driverEarnings || 0));
  updateTonStatus();
}

function updateTonStatus() {
  const u = STATE.user;
  if (!u || u.role !== 'driver') return;
  const freeUntil = u.freeUntil ? new Date(u.freeUntil) : null;
  const isFree = freeUntil && freeUntil > new Date();
  const el = document.getElementById('dp-ton-desc');
  if (el) {
    el.textContent = isFree
      ? `Бесплатный период до ${fmtDate(freeUntil.toISOString())}. После — ${fmtMoney(500)}/день.`
      : 'Бесплатный период истёк. Оплачивайте каждую смену через TON.';
  }
  const warn = document.getElementById('d-pay-warning');
  if (warn) warn.style.display = isFree ? 'none' : 'block';
}

// ---- Tabs: passenger ----
function pTab(n) {
  [0, 1, 2].forEach(i => {
    const ni = document.getElementById('p-ni-' + i);
    if (ni) ni.classList.toggle('on', i === n);
  });

  // Hide all content
  ['p-new-order', 'p-searching', 'p-active-ride', 'p-hist-content', 'p-prof-content'].forEach(id => _show(id, false));

  if (n === 0) {
    // Orders tab — show correct state
    if (STATE.activeOrderId) {
      checkActiveOrderStatus();
    } else {
      _show('p-new-order', true);
    }
  } else if (n === 1) {
    _show('p-hist-content', true);
    renderPHistory();
  } else if (n === 2) {
    _show('p-prof-content', true);
    updateAllUI();
  }
}

// ---- Tabs: driver ----
function dTab(n) {
  [0, 1, 2].forEach(i => {
    const ni = document.getElementById('d-ni-' + i);
    if (ni) ni.classList.toggle('on', i === n);
  });
  _show('d-orders-tab', n === 0);
  _show('d-hist-tab', n === 1);
  _show('d-prof-tab', n === 2);
  if (n === 0) updateDriverUI();
  if (n === 1) renderDHistory();
  if (n === 2) updateAllUI();
}
