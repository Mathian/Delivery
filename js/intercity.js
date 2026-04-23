/* ============================================================
   INTERCITY — Date scroll, time wheel (FIXED), IC orders
   Fixes:
     - Time wheel: padding-top/bottom in CSS so item 0 snaps to center
     - Scroll handler uses Math.round(scrollTop / ITEM_H) — correct
     - icFoundDriver lets passenger pick specific driver
   ============================================================ */

// ---- Date scroll (horizontal) ----
function buildDateScroll() {
  const container = document.getElementById('ic-date-scroll');
  if (!container) return;
  const days = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  const months = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  container.innerHTML = '';
  for (let i = 0; i < 31; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const chip = document.createElement('div');
    chip.className = 'date-chip' + (i === 0 ? ' on' : '');
    chip.innerHTML = `<div class="dc-day">${i === 0 ? 'Сегодня' : days[d.getDay()]}</div>
                      <div class="dc-num">${d.getDate()} ${months[d.getMonth()]}</div>`;
    const dateStr = d.toISOString().split('T')[0];
    chip.onclick = () => {
      document.querySelectorAll('.date-chip').forEach(c => c.classList.remove('on'));
      chip.classList.add('on');
      STATE.icDate = dateStr;
    };
    container.appendChild(chip);
    if (i === 0) STATE.icDate = dateStr;
  }
}

// ---- Time wheel (iOS-style, FIXED) ----
// Fix: .tw-inner has padding-top/bottom = WHEEL_PAD (47px) in CSS.
// This means item 0 at scrollTop=0 has its center at WHEEL_PAD + ITEM_H/2 = 47+23 = 70px
// which is exactly the center of the 140px container.
// So selected index = Math.round(scrollTop / ITEM_H) — correct formula.
function buildTimeWheel() {
  const inner = document.getElementById('tw-inner');
  if (!inner) return;
  inner.innerHTML = '';

  // Generate times from current rounded-up time to 23:55
  const now = new Date();
  const startMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  const times = [];
  for (let m = startMin; m < 24 * 60; m += 5) {
    const h = Math.floor(m / 60);
    const min = m % 60;
    times.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  // If no times today (very late), show tomorrow starting 00:00
  if (!times.length) {
    for (let m = 0; m < 24 * 60; m += 5) {
      const h = Math.floor(m / 60);
      const min = m % 60;
      times.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
    }
  }

  times.forEach((t, i) => {
    const div = document.createElement('div');
    // Initially item 0 is selected (it's centered with padding-top)
    div.className = 'tw-item' + (i === 0 ? ' sel' : '');
    div.textContent = t;
    inner.appendChild(div);
  });

  STATE.icTime = times[0] || '00:00';

  // Scroll handler — debounced, selects center item
  let scrollTimer = null;
  inner.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      // With padding-top=WHEEL_PAD, item n is centered at scrollTop = n * ITEM_H
      const idx = Math.min(
        Math.max(0, Math.round(inner.scrollTop / ITEM_H)),
        times.length - 1
      );
      document.querySelectorAll('.tw-item').forEach((el, i) =>
        el.classList.toggle('sel', i === idx)
      );
      STATE.icTime = times[idx] || times[0];
    }, 80);
  });
}

// ---- IC type selector ----
function selIcType(n) {
  STATE.icType = n;
  [0, 1, 2].forEach(i => {
    const el = document.getElementById('ic-t-' + i);
    if (el) el.classList.toggle('on', i === n);
  });
}

// ---- Open intercity screen ----
function openIntercity() {
  buildDateScroll();
  buildTimeWheel();
  renderIcMyOrders();
  showScreen('s-intercity');
}

function goBack() {
  showScreen(STATE.role === 'passenger' ? 's-passenger' : 's-driver');
}

// ---- Create intercity order ----
async function createIcOrder() {
  if (!STATE.icFromAddr) { showToast('Укажите откуда', 'err'); return; }
  if (!STATE.icToAddr) { showToast('Укажите куда', 'err'); return; }
  const price = parseInt(document.getElementById('ic-price').value);
  if (!price || price <= 0) { showToast('Укажите цену', 'err'); return; }
  if (!STATE.icDate) { showToast('Выберите дату', 'err'); return; }
  if (!STATE.icTime) { showToast('Выберите время', 'err'); return; }

  if (STATE.user.blockedAsPassenger || STATE.user.blocked) { showToast('Ваш аккаунт заблокирован', 'err'); return; }

  const icTypes = ['С попутчиками', 'Посылка', 'Весь салон'];
  const orderId = 'IC-' + Date.now();
  const comment = document.getElementById('ic-comment').value.trim();

  showLoading(true);
  try {
    await dbSet('orders', orderId, {
      id: orderId,
      passengerId: STATE.uid,
      passengerName: STATE.user.name,
      passengerPhone: STATE.user.phone,
      passengerRating: STATE.user.rating,
      from: STATE.icFromAddr.address,
      to: STATE.icToAddr.address,
      date: STATE.icDate,
      time: STATE.icTime,
      type: 'intercity',
      icType: icTypes[STATE.icType],
      price,
      comment,
      status: 'searching',
      contacts: [],
      city: STATE.user.city,
      icFromCity: STATE.icFromCity || STATE.user.city,
      currency: STATE.user.currency || { code: 'KZT', symbol: '₸' },
      createdAt: new Date().toISOString(),
    });
    _setVal('ic-price', '');
    _setVal('ic-comment', '');
    STATE.icFromAddr = null;
    STATE.icToAddr = null;
    _setText('ic-from-txt', '');
    _setText('ic-to-txt', '');
    const fromEl = document.getElementById('ic-from-txt');
    if (fromEl) fromEl.innerHTML = '<span class="rtext-ph">Город и адрес отправления</span>';
    const toEl = document.getElementById('ic-to-txt');
    if (toEl) toEl.innerHTML = '<span class="rtext-ph">Город и адрес назначения</span>';
    showToast('Заявка размещена! ✅', 'ok');
    renderIcMyOrders();
  } catch (e) {
    console.error(e);
    showToast('Ошибка создания заявки', 'err');
  }
  showLoading(false);
}

// ---- Render passenger's IC orders ----
async function renderIcMyOrders() {
  const list = document.getElementById('ic-my-orders-list');
  if (!list) return;
  try {
    const orders = await dbQuery('orders', 'passengerId', '==', STATE.uid);
    const ic = orders
      .filter(o => o.type === 'intercity')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!ic.length) {
      list.innerHTML = '<div class="empty-st" style="padding:20px"><div class="empty-ico" style="font-size:28px">🛣️</div><div class="empty-txt">Нет заявок</div></div>';
      return;
    }
    list.innerHTML = ic.map(o => {
      const contacts = o.contacts || [];
      const isSearching = o.status === 'searching';
      return `
      <div class="ord-card">
        <div class="ord-hdr">
          <div style="font-size:11px;color:var(--text3)">${o.date} ${o.time}</div>
          <span class="tag ${o.status === 'done' ? 'tag-g' : o.status === 'cancelled' ? '' : 'tag-y'}">
            ${o.status === 'searching' ? '🔍 Поиск' : o.status === 'done' ? '✓ Поездка состоялась' : '✗ Закрыто'}
          </span>
        </div>
        <div class="ord-route">
          <div class="ord-rrow"><div class="ord-rdot rdot-a"></div><div class="ord-rtxt">${escHtml(o.from)}</div></div>
          <div class="ord-rrow"><div class="ord-rdot rdot-b"></div><div class="ord-rtxt">${escHtml(o.to)}</div></div>
        </div>
        <div class="ord-bot">
          <div>
            <div style="font-size:10px;color:var(--text3)">${escHtml(o.icType || '')}</div>
            <div class="offer-price">${fmtMoney(o.price, o.currency?.symbol)}</div>
          </div>
          ${isSearching ? `<div style="display:flex;gap:7px">
            <button class="btn btn-y btn-sm" onclick="icClose('${o.id}')">Закрыть заявку ✓</button>
          </div>` : ''}
        </div>
        ${contacts.length > 0 ? `<div style="padding:0 14px 12px;font-size:12px;color:var(--green)">📞 Водителей позвонило: ${contacts.length}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = '<div class="empty-st"><div class="empty-ico">⚠️</div><div class="empty-txt">Ошибка загрузки</div></div>';
  }
}

// ---- Passenger: close order — show driver selection if anyone called ----
async function icClose(orderId) {
  showLoading(true);
  const order = await dbGet('orders', orderId);
  showLoading(false);
  if (!order) return;

  const contacts = order.contacts || [];

  if (!contacts.length) {
    // Nobody called — just ask to close with no driver
    tg.showConfirm('Закрыть заявку? Никто ещё не звонил.', async ok => {
      if (!ok) return;
      await dbSet('orders', orderId, {
        status: 'cancelled',
        cancelledBy: 'passenger',
        cancelledAt: new Date().toISOString(),
        cancelReason: 'Закрыто пассажиром'
      });
      renderIcMyOrders();
      showToast('Заявка закрыта');
    });
    return;
  }

  // Drivers called — show selection modal
  _showIcDriverSelectModal(orderId, contacts);
}

function _showIcDriverSelectModal(orderId, contacts) {
  let html = '<div class="mhandle"></div>';
  html += '<div class="mtitle">С кем договорились?</div>';
  html += '<div style="font-size:13px;color:var(--text2);margin-bottom:16px;padding:0 20px">Выберите водителя, с которым договорились о поездке:</div>';
  html += '<div style="padding:0 20px;overflow-y:auto;max-height:55vh">';
  html += contacts.map(c => `
    <button class="btn btn-out" style="margin-bottom:8px;text-align:left;width:100%;padding:12px 14px"
      onclick="icSelectDriver('${escHtml(orderId)}','${escHtml(c.driverId)}')">
      <div style="font-weight:700;font-size:14px">${escHtml(c.name)}</div>
      <div style="font-size:13px;color:var(--y);margin-top:2px">📞 ${escHtml(c.phone)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:1px">${fmtRelTime(c.contactedAt)}</div>
    </button>`).join('');
  html += `
    <button class="btn" style="margin-bottom:8px;width:100%;padding:12px;background:rgba(239,68,68,.12);color:var(--red);border:1px solid rgba(239,68,68,.3)"
      onclick="icNoDriver('${escHtml(orderId)}')">
      😔 Не удалось договориться
    </button>
  </div>`;

  let mo = document.getElementById('mo-ic-select');
  if (!mo) {
    mo = document.createElement('div');
    mo.className = 'mo';
    mo.id = 'mo-ic-select';
    document.body.appendChild(mo);
    mo.addEventListener('click', e => { if (e.target === mo) mo.classList.remove('open'); });
  }
  mo.innerHTML = `<div class="ms" style="padding:0 0 40px">${html}</div>`;
  mo.classList.add('open');
}

async function icSelectDriver(orderId, driverId) {
  closeModal('mo-ic-select');
  showLoading(true);
  const order = await dbGet('orders', orderId);
  if (!order) { showLoading(false); return; }
  const drv = (order.contacts || []).find(c => c.driverId === driverId);
  if (!drv) { showLoading(false); return; }

  await dbSet('orders', orderId, {
    status: 'done',
    acceptedDriver: {
      driverId: drv.driverId,
      name: drv.name,
      phone: drv.phone,
      price: order.price,
      eta: 0,
      car: drv.car || ''
    },
    finishedAt: new Date().toISOString()
  });

  // Increment counters for both sides
  await dbIncrement('users', STATE.uid, 'trips');
  await dbIncrement('users', STATE.uid, 'passengerTrips');
  await dbIncrement('users', driverId, 'trips');
  await dbIncrement('users', driverId, 'driverTrips');

  showLoading(false);
  showToast('Поездка записана в историю ✅', 'ok');
  tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success');
  renderIcMyOrders();
}

async function icNoDriver(orderId) {
  closeModal('mo-ic-select');
  await dbSet('orders', orderId, {
    status: 'cancelled',
    cancelledBy: 'passenger',
    cancelledAt: new Date().toISOString(),
    cancelReason: 'Не удалось договориться'
  });
  renderIcMyOrders();
  showToast('Заявка закрыта');
}

// ---- Driver contacts passenger ----
async function icDriverContact(orderId) {
  const order = await dbGet('orders', orderId);
  if (!order) return;
  if (order.status !== 'searching') {
    showToast('Заявка уже не активна', 'warn'); return;
  }
  STATE.icContactOrderId = orderId;
  _setText('ic-contact-name', order.passengerName);
  _setText('ic-contact-phone', order.passengerPhone);
  _setText('ic-contact-route', `${order.from} → ${order.to} · ${order.date} ${order.time}`);
  const btn = document.getElementById('ic-call-btn');
  if (btn) btn.onclick = () => {
    const a = document.createElement('a');
    a.href = 'tel:' + order.passengerPhone;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 300);
  };
  openModal('mo-ic-contact');

  // Register contact
  const contacts = order.contacts || [];
  if (!contacts.find(c => c.driverId === STATE.uid)) {
    contacts.push({
      driverId: STATE.uid,
      name: STATE.user.name,
      phone: STATE.user.phone,
      car: STATE.user.car ? `${STATE.user.car.color} ${STATE.user.car.brand} · ${STATE.user.car.num}` : '',
      contactedAt: new Date().toISOString()
    });
    await dbSet('orders', orderId, { contacts });
  }
}
