/* ============================================================
   PAYMENT — TON shift payment
   ============================================================ */

function openTonPayment() {
  openModal('mo-ton');
  const wrap = document.getElementById('ton-connect-wrap');
  if (!wrap) return;

  // Get wallet from settings (loaded from Firebase)
  const wallet = window._appSettings && window._appSettings.tonWallet
    ? window._appSettings.tonWallet
    : 'UQD___НАСТРОЙТЕ_TON_КОШЕЛЁК_В_НАСТРОЙКАХ___';
  const shiftPrice = window._appSettings && window._appSettings.shiftPrice
    ? window._appSettings.shiftPrice
    : 500;
  // Approximate TON at ~200 KZT/TON (update rate in settings if needed)
  const tonRate = window._appSettings && window._appSettings.tonRate ? window._appSettings.tonRate : 200;
  const tonAmount = (shiftPrice / tonRate).toFixed(2);

  wrap.innerHTML = `
    <div style="background:var(--bg3);border-radius:var(--r2);padding:14px;text-align:center">
      <div style="font-size:13px;color:var(--text2);margin-bottom:6px">
        Отправьте <strong style="color:var(--y)">${tonAmount} TON</strong> (~${shiftPrice}₸) на адрес:
      </div>
      <div style="font-size:11px;color:var(--text3);word-break:break-all;padding:8px;background:var(--bg4);border-radius:8px;margin-bottom:10px;user-select:all;cursor:text">
        ${wallet}
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.4">
        В комментарии к переводу укажите ваш Telegram ID: <strong style="color:var(--text)">${STATE.user ? STATE.user.tgId : ''}</strong>
      </div>
      <div style="display:flex;gap:8px">
        <a href="ton://transfer/${wallet}?amount=${Math.round(tonAmount * 1e9)}&text=${STATE.user ? STATE.user.tgId : ''}"
           class="btn btn-y btn-sm" style="flex:1;text-align:center;text-decoration:none;line-height:2">
          💎 Открыть кошелёк
        </a>
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="_simulateTonPayment()">
          ✓ Я оплатил (тест)
        </button>
      </div>
    </div>`;
}

// Simulate payment for testing
async function _simulateTonPayment() {
  STATE.paidToday = new Date().toDateString();
  saveState();
  // Record payment in Firebase
  if (STATE.uid) {
    await dbSet('users', STATE.uid, { lastPaidAt: new Date().toISOString() });
  }
  closeModal('mo-ton');
  showToast('Оплата принята! (тест) ✅', 'ok');
  await goOnline();
}

// Load app settings (called on init)
async function loadAppSettings() {
  try {
    const settings = await dbGet('settings', 'app');
    if (settings) {
      window._appSettings = settings;
      STATE.bonusSystemEnabled = settings.bonusSystem !== false;
      updateDriverUI && updateDriverUI();
    }
  } catch (e) {}
}
