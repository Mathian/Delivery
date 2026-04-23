/* ============================================================
   CLIENT.JS — Логика клиентского WebApp
   ============================================================ */

// ---- State ----
const S = {
  tgUser:       null,
  tgId:         null,
  cart:         [],        // [{id,name,price,image,qty}]
  menu:         [],        // [{id,name,desc,price,image,available,category,order}]
  categories:   [],
  activeCat:    "all",
  settings:     null,
  activeOrder:  null,
  pendingDetail:null,       // order shown in modal
  payment:      "cash",
  intercom:     false,
  miItem:       null,       // menu item in modal
  miQtyVal:     1,
  countdownTimer: null,
  notifUnsub:   null,
  orderUnsub:   null,
  historyOrders: [],
};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", () => {
  const user = getTgUser();
  if (!user) {
    setTimeout(() => showScreen("s-no-tg"), 1800);
    return;
  }
  S.tgUser = user;
  S.tgId   = String(user.id);

  waitAuth().then(() => {
    loadSettings();
    listenMenu();
    listenActiveOrder();
    listenNotifications();
    loadHistory();
    setTimeout(() => showScreen("s-main"), 1400);
  });
});

// ---- Screen switching ----
function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id)?.classList.add("active");
}

function switchTab(name) {
  document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name)?.classList.add("active");
  document.getElementById("tabbtn-" + name)?.classList.add("active");
}

// ---- Settings ----
async function loadSettings() {
  try {
    const snap = await db.collection("settings").doc("cafe").get();
    S.settings = snap.exists ? snap.data() : { deliveryHours: 0, deliveryMinutes: 45, isOpen: true };
    applySettings();
  } catch(e) { console.warn("settings:", e); }
}

function applySettings() {
  const s = S.settings;
  if (!s) return;
  const h = s.deliveryHours || 0;
  const m = s.deliveryMinutes || 45;
  document.getElementById("hdr-delivery").textContent =
    h > 0 ? `Доставка ~${h} ч ${m} мин` : `Доставка ~${m} мин`;

  const isOpen = checkCafeOpen(s);
  const pill = document.getElementById("cafe-pill");
  if (pill) {
    pill.textContent = isOpen ? "Открыто" : "Закрыто";
    pill.className = "status-pill " + (isOpen ? "open" : "closed");
  }
}

function checkCafeOpen(s) {
  if (!s) return true;
  if (s.isOpen === false) return false;
  if (!s.workStart || !s.workEnd) return true;
  const now  = new Date();
  const [sh, sm] = s.workStart.split(":").map(Number);
  const [eh, em] = s.workEnd.split(":").map(Number);
  const cur  = now.getHours() * 60 + now.getMinutes();
  const open = sh * 60 + sm;
  const end  = eh * 60 + em;
  return cur >= open && cur < end;
}

// ---- Menu ----
function listenMenu() {
  db.collection("menu").orderBy("order", "asc").onSnapshot(snap => {
    S.menu = [];
    snap.forEach(d => S.menu.push({ id: d.id, ...d.data() }));
    buildCategories();
    renderMenu();
  }, () => {
    // fallback: load once
    db.collection("menu").get().then(snap => {
      S.menu = [];
      snap.forEach(d => S.menu.push({ id: d.id, ...d.data() }));
      buildCategories();
      renderMenu();
    });
  });
}

function buildCategories() {
  const cats = ["all", ...new Set(S.menu.map(i => i.category).filter(Boolean))];
  S.categories = cats;
  const el = document.getElementById("cat-list");
  if (!el) return;
  el.innerHTML = cats.map(c =>
    `<div class="cat-chip ${c === S.activeCat ? "active" : ""}" onclick="setCategory('${c}')">${c === "all" ? "Все" : c}</div>`
  ).join("");
}

function setCategory(cat) {
  S.activeCat = cat;
  buildCategories();
  renderMenu();
}

function renderMenu() {
  const grid  = document.getElementById("menu-grid");
  const empty = document.getElementById("menu-empty");
  if (!grid) return;
  const items = S.activeCat === "all"
    ? S.menu
    : S.menu.filter(i => i.category === S.activeCat);
  const available = items.filter(i => i.available !== false);
  const unavail   = items.filter(i => i.available === false);
  const all = [...available, ...unavail];

  if (!all.length) {
    grid.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  grid.innerHTML = all.map(item => {
    const inCart = S.cart.find(c => c.id === item.id);
    const qty = inCart ? inCart.qty : 0;
    const imgHtml = item.image
      ? `<img src="${item.image}" alt="" onerror="this.style.display='none'">`
      : `<span>🍽️</span>`;
    return `
    <div class="menu-card" onclick="openItemModal('${item.id}')">
      <div class="menu-card-img">${imgHtml}${!item.available ? '<div class="menu-unavail">Недоступно</div>' : ''}</div>
      <div class="menu-card-body">
        <div class="menu-card-name">${esc(item.name)}</div>
        ${item.description ? `<div class="menu-card-desc">${esc(item.description)}</div>` : ""}
      </div>
      <div class="menu-card-footer">
        <div class="menu-card-price">${fmtPrice(item.price)}</div>
        ${item.available !== false ? (qty > 0
          ? `<div class="qty-ctrl" onclick="event.stopPropagation()">
               <button class="qty-btn minus" onclick="changeQty('${item.id}',-1)">−</button>
               <div class="qty-num">${qty}</div>
               <button class="qty-btn" onclick="changeQty('${item.id}',1)">+</button>
             </div>`
          : `<button class="add-btn" onclick="event.stopPropagation();addToCart('${item.id}')">+</button>`
        ) : ""}
      </div>
    </div>`;
  }).join("");
}

// ---- Item modal ----
function openItemModal(id) {
  const item = S.menu.find(i => i.id === id);
  if (!item || item.available === false) return;
  S.miItem = item;
  S.miQtyVal = 1;
  document.getElementById("mi-name").textContent  = item.name;
  document.getElementById("mi-desc").textContent  = item.description || "";
  document.getElementById("mi-price").textContent = fmtPrice(item.price);
  document.getElementById("mi-qty").textContent   = 1;
  const img = document.getElementById("mi-img");
  if (img) {
    img.src = item.image || "";
    img.style.display = item.image ? "" : "none";
  }
  openModal("modal-item");
}

function miQty(delta) {
  S.miQtyVal = Math.max(1, S.miQtyVal + delta);
  document.getElementById("mi-qty").textContent = S.miQtyVal;
}

function addFromModal() {
  if (!S.miItem) return;
  const existing = S.cart.find(c => c.id === S.miItem.id);
  if (existing) {
    existing.qty += S.miQtyVal;
  } else {
    S.cart.push({ id: S.miItem.id, name: S.miItem.name, price: S.miItem.price, image: S.miItem.image || "", qty: S.miQtyVal });
  }
  closeModal("modal-item");
  updateCartUI();
  showToast(`${S.miItem.name} добавлен в корзину ✓`);
}

// ---- Cart ----
function addToCart(id) {
  const item = S.menu.find(i => i.id === id);
  if (!item) return;
  const existing = S.cart.find(c => c.id === id);
  if (existing) { existing.qty++; }
  else { S.cart.push({ id, name: item.name, price: item.price, image: item.image || "", qty: 1 }); }
  updateCartUI();
  renderMenu();
}

function changeQty(id, delta) {
  const idx = S.cart.findIndex(c => c.id === id);
  if (idx < 0) return;
  S.cart[idx].qty += delta;
  if (S.cart[idx].qty <= 0) S.cart.splice(idx, 1);
  updateCartUI();
  renderMenu();
}

function clearCart() {
  S.cart = [];
  updateCartUI();
  renderMenu();
}

function cartTotal() {
  return S.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
}

function updateCartUI() {
  const total  = cartTotal();
  const count  = S.cart.reduce((n, i) => n + i.qty, 0);
  const badge  = document.getElementById("cart-badge");
  const empty  = document.getElementById("cart-empty");
  const list   = document.getElementById("cart-list");
  const footer = document.getElementById("cart-footer");
  const totalEl= document.getElementById("cart-total-price");

  if (badge)  { badge.textContent = count; badge.classList.toggle("hidden", count === 0); }
  if (totalEl) totalEl.textContent = fmtPrice(total);
  document.getElementById("checkout-total").textContent = fmtPrice(total);

  if (!S.cart.length) {
    empty?.classList.remove("hidden");
    list?.classList.add("hidden");
    footer?.classList.add("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list?.classList.remove("hidden");
  footer?.classList.remove("hidden");

  if (list) {
    list.innerHTML = S.cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-img">${item.image ? `<img src="${item.image}" onerror="this.style.display='none'">` : "🍽️"}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${esc(item.name)}</div>
          <div class="cart-item-price">${fmtPrice(item.price)} × ${item.qty}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn minus" onclick="changeQty('${item.id}',-1)">−</button>
          <div class="qty-num">${item.qty}</div>
          <button class="qty-btn" onclick="changeQty('${item.id}',1)">+</button>
        </div>
      </div>`).join("");
  }
}

function selectPayment(type) {
  S.payment = type;
  document.getElementById("pay-cash")?.classList.toggle("selected", type === "cash");
  document.getElementById("pay-card")?.classList.toggle("selected", type === "card");
}

// ---- Checkout ----
function openCheckout() {
  if (!S.cart.length) return;
  if (!checkCafeOpen(S.settings)) {
    showToast("Кафе сейчас закрыто", "error");
    return;
  }
  document.getElementById("checkout-total").textContent = fmtPrice(cartTotal());
  openModal("modal-checkout");
}

async function submitOrder() {
  const street = document.getElementById("addr-street").value.trim();
  const house  = document.getElementById("addr-house").value.trim();
  const apt    = document.getElementById("addr-apt").value.trim();
  if (!street || !house) {
    showToast("Укажите улицу и номер дома", "error");
    return;
  }
  const btn = document.getElementById("submit-btn");
  if (btn) btn.disabled = true;

  const s = S.settings || {};
  const delivMs = ((s.deliveryHours || 0) * 3600 + (s.deliveryMinutes || 45) * 60) * 1000;
  const now     = new Date();
  const deadline = new Date(now.getTime() + delivMs).toISOString();

  const order = {
    clientTgId:    S.tgId,
    clientName:    S.tgUser.first_name || "Клиент",
    clientUsername:S.tgUser.username || "",
    items:         S.cart.map(i => ({ id:i.id, name:i.name, price:i.price, qty:i.qty, subtotal:i.price*i.qty })),
    address: {
      street, house, apt,
      intercom: document.getElementById("intercom-toggle")?.classList.contains("on") || false,
    },
    comment:       document.getElementById("order-comment").value.trim(),
    payment:       S.payment,
    totalPrice:    cartTotal(),
    status:        "pending",
    createdAt:     now.toISOString(),
    deliveryDeadlineAt: deadline,
    deliveryDurationMs: delivMs,
    acceptedAt:    null,
    operatorTgId:  null,
    courierId:     null,
    courierName:   null,
    assignedAt:    null,
    deliveredAt:   null,
  };

  try {
    const ref = await db.collection("orders").add(order);
    S.cart = [];
    updateCartUI();
    renderMenu();
    closeModal("modal-checkout");
    switchTab("orders");
    showToast("Заказ отправлен! Ожидайте подтверждения 🎯", "success");
    // Reset form
    document.getElementById("addr-street").value = "";
    document.getElementById("addr-house").value  = "";
    document.getElementById("addr-apt").value    = "";
    document.getElementById("order-comment").value = "";
    document.getElementById("intercom-toggle")?.classList.remove("on");
    S.payment = "cash"; selectPayment("cash");
  } catch(e) {
    showToast("Ошибка при отправке заказа", "error");
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ---- Active order ----
function listenActiveOrder() {
  if (S.orderUnsub) S.orderUnsub();
  if (!S.tgId) return;

  S.orderUnsub = db.collection("orders")
    .where("clientTgId", "==", S.tgId)
    .where("status", "in", ["pending", "accepted", "preparing", "courier"])
    .orderBy("createdAt", "desc")
    .limit(1)
    .onSnapshot(snap => {
      if (snap.empty) {
        S.activeOrder = null;
        showActiveSection(false);
        return;
      }
      const doc = snap.docs[0];
      S.activeOrder = { id: doc.id, ...doc.data() };
      renderActiveOrder(S.activeOrder);
      showActiveSection(true);
      // Show orders badge
      document.getElementById("orders-badge")?.classList.remove("hidden");
    });
}

function showActiveSection(show) {
  const sec = document.getElementById("active-section");
  if (sec) sec.classList.toggle("hidden", !show);
  const badge = document.getElementById("orders-badge");
  if (badge) badge.classList.toggle("hidden", !show);
}

function renderActiveOrder(o) {
  document.getElementById("ao-num").textContent  = shortId(o.id);
  document.getElementById("ao-addr").textContent =
    `${o.address?.street || ""}, д. ${o.address?.house || ""}${o.address?.apt ? ", кв. " + o.address.apt : ""}`;
  document.getElementById("ao-badge").innerHTML  = statusBadge(o.status);

  // Steps
  const statusIdx = { accepted:0, preparing:1, courier:2, delivered:3 };
  const idx = statusIdx[o.status] ?? -1;
  ["accepted","preparing","courier","delivered"].forEach((s, i) => {
    const step = document.getElementById("step-" + s);
    if (!step) return;
    step.className = "step" + (i < idx ? " done" : i === idx ? " active" : "");
  });
  ["conn1","conn2","conn3"].forEach((c, i) => {
    const el = document.getElementById(c);
    if (el) el.className = "step-conn" + (i < idx ? " done" : "");
  });

  // Countdown
  if (o.deliveryDeadlineAt && o.deliveryDurationMs && o.status !== "delivered") {
    startCountdown(new Date(o.deliveryDeadlineAt).getTime(), o.deliveryDurationMs);
  } else {
    stopCountdown();
    if (o.status === "delivered") {
      document.getElementById("ao-time-left").textContent = "Доставлен ✓";
      document.getElementById("ao-progress").style.width = "100%";
      document.getElementById("ao-progress").className = "progress-fill ok";
    }
  }
}

function startCountdown(deadlineTs, totalMs) {
  stopCountdown();
  function tick() {
    const remaining = deadlineTs - Date.now();
    const pct = Math.max(0, Math.min(100, (remaining / totalMs) * 100));
    const bar = document.getElementById("ao-progress");
    const lbl = document.getElementById("ao-time-left");
    if (bar) {
      bar.style.width = pct + "%";
      bar.className = "progress-fill " + (pct > 50 ? "ok" : pct > 20 ? "warn" : "crit");
    }
    if (lbl) {
      if (remaining <= 0) {
        lbl.textContent = "Скоро будет доставлен…";
      } else {
        lbl.textContent = "Осталось ~" + fmtDuration(remaining);
      }
    }
  }
  tick();
  S.countdownTimer = setInterval(tick, 10000);
}

function stopCountdown() {
  if (S.countdownTimer) { clearInterval(S.countdownTimer); S.countdownTimer = null; }
}

// ---- History ----
async function loadHistory() {
  if (!S.tgId) return;
  try {
    const snap = await db.collection("orders")
      .where("clientTgId", "==", S.tgId)
      .orderBy("createdAt", "desc")
      .limit(30)
      .get();
    S.historyOrders = [];
    snap.forEach(d => S.historyOrders.push({ id: d.id, ...d.data() }));
    renderHistory();
  } catch(e) { console.warn("history:", e); }
}

function renderHistory() {
  const list  = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  const done  = S.historyOrders.filter(o => ["delivered","cancelled"].includes(o.status));
  if (!done.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list.innerHTML = done.map(o => `
    <div class="order-card" onclick="openOrderDetail('${o.id}',false)">
      <div class="order-card-header">
        <div class="order-num">Заказ #${shortId(o.id)}</div>
        ${statusBadge(o.status)}
      </div>
      <div class="order-items">${o.items?.map(i => `${i.name} ×${i.qty}`).join(", ") || "—"}</div>
      <div class="order-footer">
        <div class="order-total">${fmtPrice(o.totalPrice)}</div>
        <div class="order-time">${fmtDate(o.createdAt)}</div>
      </div>
    </div>`).join("");
}

// ---- Order detail modal ----
function openOrderDetail(id, isActive) {
  const order = isActive
    ? S.activeOrder
    : S.historyOrders.find(o => o.id === id);
  if (!order) return;
  S.pendingDetail = order;

  const body = document.getElementById("order-detail-body");
  const repeatBtn = document.getElementById("repeat-btn");
  if (!body) return;

  const addr = order.address || {};
  const addrStr = [addr.street, "д." + (addr.house || "—"), addr.apt ? "кв." + addr.apt : ""].filter(Boolean).join(", ");

  body.innerHTML = `
    <div class="detail-row"><div class="detail-key">Номер заказа</div><div class="detail-val">#${shortId(order.id)}</div></div>
    <div class="detail-row"><div class="detail-key">Статус</div><div class="detail-val">${statusBadge(order.status)}</div></div>
    <div class="detail-row"><div class="detail-key">Дата</div><div class="detail-val">${fmtDateTime(order.createdAt)}</div></div>
    <div class="detail-row"><div class="detail-key">Адрес</div><div class="detail-val">${esc(addrStr)}</div></div>
    <div class="detail-row"><div class="detail-key">Домофон</div><div class="detail-val">${addr.intercom ? "Есть" : "Нет"}</div></div>
    <div class="detail-row"><div class="detail-key">Оплата</div><div class="detail-val">${order.payment === "cash" ? "💵 Наличные" : "💳 Карта"}</div></div>
    ${order.comment ? `<div class="detail-row"><div class="detail-key">Комментарий</div><div class="detail-val">${esc(order.comment)}</div></div>` : ""}
    <div style="margin-top:8px;font-weight:600;font-size:14px;color:var(--c-text-3);">Состав заказа:</div>
    ${(order.items || []).map(i =>
      `<div class="detail-row"><div class="detail-key">${esc(i.name)} ×${i.qty}</div><div class="detail-val">${fmtPrice(i.subtotal || i.price * i.qty)}</div></div>`
    ).join("")}
    <div class="detail-row" style="margin-top:4px;"><div class="detail-key font-bold">Итого</div><div class="detail-val font-bold text-accent">${fmtPrice(order.totalPrice)}</div></div>
    ${order.courierName ? `<div class="detail-row"><div class="detail-key">Курьер</div><div class="detail-val">${esc(order.courierName)}</div></div>` : ""}
  `;

  // Show repeat only for historical completed orders
  if (repeatBtn) repeatBtn.style.display = isActive ? "none" : "";

  openModal("modal-order");
}

function repeatOrder() {
  const order = S.pendingDetail;
  if (!order) return;
  S.cart = (order.items || []).map(i => {
    const menuItem = S.menu.find(m => m.id === i.id);
    return {
      id: i.id,
      name: i.name,
      price: menuItem ? menuItem.price : i.price, // актуальная цена
      image: menuItem?.image || "",
      qty: i.qty,
    };
  }).filter(i => {
    const m = S.menu.find(m => m.id === i.id);
    return m && m.available !== false;
  });
  closeModal("modal-order");
  updateCartUI();
  renderMenu();
  switchTab("cart");
  showToast("Заказ добавлен в корзину с актуальными ценами ✓");
}

// ---- Notifications from Firebase ----
function listenNotifications() {
  if (!S.tgId) return;
  if (S.notifUnsub) S.notifUnsub();

  S.notifUnsub = db.collection("notifications")
    .where("tgId", "==", S.tgId)
    .where("read", "==", false)
    .orderBy("createdAt", "desc")
    .limit(5)
    .onSnapshot(snap => {
      snap.forEach(doc => {
        const n = doc.data();
        handleNotification(n, doc.id);
      });
    });
}

function handleNotification(n, docId) {
  let emoji, title, msg;
  switch (n.type) {
    case "order_accepted":
      emoji = "✅"; title = "Заказ принят!";
      msg   = n.message || "Ваш заказ принят в работу. Ожидайте доставки!";
      break;
    case "order_cancelled":
      emoji = "❌"; title = "Заказ отменён";
      msg   = "Ваш заказ был отменён. С вами свяжется оператор.";
      break;
    case "order_delivered":
      emoji = "🎉"; title = "Заказ доставлен!";
      msg   = "Приятного аппетита! 🍽️";
      loadHistory();
      break;
    default: return;
  }
  showNotif(emoji, title, msg, docId);
}

function showNotif(emoji, title, msg, docId) {
  document.getElementById("notif-emoji").textContent = emoji;
  document.getElementById("notif-title").textContent = title;
  document.getElementById("notif-msg").textContent   = msg;
  document.getElementById("notif-overlay").dataset.docId = docId || "";
  document.getElementById("notif-overlay").classList.remove("hidden");
}

function dismissNotif() {
  const overlay = document.getElementById("notif-overlay");
  overlay.classList.add("hidden");
  const docId = overlay.dataset.docId;
  if (docId) {
    db.collection("notifications").doc(docId).update({ read: true }).catch(() => {});
  }
}

// ---- Helpers ----
function esc(s) {
  return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function shortId(id) {
  return id ? id.slice(-5).toUpperCase() : "—";
}
