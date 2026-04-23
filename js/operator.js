/* ============================================================
   OPERATOR.JS — Логика панели оператора
   ============================================================ */

const OP = {
  tgId:         null,
  tgName:       null,
  orders:       [],        // active orders
  beepInterval: null,
  hasPending:   false,
  selectedOrderId: null,
  cancelOrderId:   null,
  assignOrderId:   null,
  couriers:     [],
};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", () => {
  const user = getTgUser();
  if (!user) {
    setTimeout(() => showScreen("s-error"), 1800);
    return;
  }
  OP.tgId   = String(user.id);
  OP.tgName = user.first_name || "Оператор";

  // Resume cached session for this Telegram user
  if (sessionStorage.getItem("delivery_auth_operator") === OP.tgId) {
    initOperatorApp();
    setTimeout(() => showScreen("s-main"), 800);
    return;
  }

  // Show code entry screen
  setTimeout(() => showScreen("s-auth"), 900);
  document.addEventListener("click", initAudio, { once: true });
  setTimeout(() => {
    const inp = document.getElementById("auth-input");
    if (inp) inp.addEventListener("keydown", e => { if (e.key === "Enter") submitAuthCode(); });
  }, 1000);
});

async function submitAuthCode() {
  const input = document.getElementById("auth-input");
  const errEl = document.getElementById("auth-error");
  const btn   = document.getElementById("auth-btn");
  const code  = (input?.value || "").trim();

  if (code.length < 4) {
    input?.classList.add("shake");
    setTimeout(() => input?.classList.remove("shake"), 400);
    return;
  }
  if (btn) btn.disabled = true;
  errEl?.classList.add("hidden");
  input?.classList.remove("shake");

  const ok = await checkAccessCode("operator", code);
  if (!ok) {
    errEl?.classList.remove("hidden");
    input?.classList.add("shake");
    setTimeout(() => input?.classList.remove("shake"), 400);
    if (btn) btn.disabled = false;
    return;
  }

  sessionStorage.setItem("delivery_auth_operator", OP.tgId);
  await initOperatorApp();
  showScreen("s-main");
}

async function initOperatorApp() {
  await waitAuth();
  document.getElementById("op-name-sub").textContent = OP.tgName;
  setTodayDate();
  listenActiveOrders();
}

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
function setTodayDate() {
  const el = document.getElementById("history-date");
  if (el) el.value = new Date().toISOString().split("T")[0];
}

// ---- Real-time active orders ----
function listenActiveOrders() {
  db.collection("orders")
    .where("status", "in", ["pending","accepted","preparing","courier"])
    .orderBy("createdAt", "asc")
    .onSnapshot(snap => {
      OP.orders = [];
      snap.forEach(d => OP.orders.push({ id: d.id, ...d.data() }));
      renderActiveOrders();
      checkPendingAlert();
    });

  // Also listen for delivered orders to show toast notification
  db.collection("orders")
    .where("status", "==", "delivered")
    .orderBy("deliveredAt", "desc")
    .limit(1)
    .onSnapshot(snap => {
      snap.docChanges().forEach(change => {
        if (change.type === "added") {
          const o = change.doc.data();
          showDeliveredToast(`Заказ #${shortId(change.doc.id)} доставлен ✓`);
        }
      });
    });
}

function renderActiveOrders() {
  const list  = document.getElementById("active-orders-list");
  const empty = document.getElementById("active-empty");
  const badge = document.getElementById("active-badge");
  if (!list) return;

  if (badge) {
    badge.textContent = OP.orders.length;
    badge.classList.toggle("hidden", !OP.orders.length);
  }

  if (!OP.orders.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  list.innerHTML = OP.orders.map(o => {
    const addr = o.address || {};
    const addrStr = `${addr.street || ""}, д. ${addr.house || ""}${addr.apt ? ", кв. " + addr.apt : ""}`;
    return `
    <div class="order-card" onclick="openOrderDetail('${o.id}')">
      <div class="order-card-header">
        <div>
          <div class="order-num">Заказ #${shortId(o.id)}</div>
          <div class="order-client">${esc(o.clientName || "Клиент")}</div>
        </div>
        ${statusBadge(o.status)}
      </div>
      <div class="order-items">${(o.items||[]).map(i=>`${esc(i.name)} ×${i.qty}`).join(", ")}</div>
      <div class="order-addr">${esc(addrStr)}</div>
      <div class="order-footer">
        <div class="order-total">${fmtPrice(o.totalPrice)}</div>
        <div class="order-time">${fmtTime(o.createdAt)}</div>
      </div>
      ${o.status === "pending" ? `
      <div class="order-actions">
        <button class="btn btn-success btn-sm flex-1" onclick="event.stopPropagation();acceptOrder('${o.id}')">✓ Подтвердить</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();askCancel('${o.id}')">✗ Отменить</button>
      </div>` : ""}
      ${o.status === "accepted" || o.status === "preparing" ? `
      <div class="order-actions">
        <button class="btn btn-blue btn-sm flex-1" onclick="event.stopPropagation();openAssign('${o.id}')">🚴 Передать курьеру</button>
        <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();askCancel('${o.id}')">✗ Отменить</button>
      </div>` : ""}
    </div>`;
  }).join("");
}

// ---- Pending alert + beep ----
function checkPendingAlert() {
  const hasPending = OP.orders.some(o => o.status === "pending");
  const banner = document.getElementById("alert-banner");
  const pill   = document.getElementById("new-orders-pill");

  if (hasPending && !OP.hasPending) {
    // Started having pending orders
    startBeep();
    banner?.classList.remove("hidden");
    if (pill) { pill.style.display = ""; }
  } else if (!hasPending && OP.hasPending) {
    stopBeep();
    banner?.classList.add("hidden");
    if (pill) { pill.style.display = "none"; }
  }
  OP.hasPending = hasPending;
}

function startBeep() {
  if (OP.beepInterval) return;
  playNotifBeep();
  OP.beepInterval = setInterval(playNotifBeep, 2000);
}
function stopBeep() {
  if (OP.beepInterval) { clearInterval(OP.beepInterval); OP.beepInterval = null; }
}

// ---- Order detail modal ----
function openOrderDetail(id) {
  const o = OP.orders.find(x => x.id === id);
  if (!o) return;
  OP.selectedOrderId = id;

  document.getElementById("od-num").textContent = shortId(id);
  const body   = document.getElementById("op-order-body");
  const footer = document.getElementById("op-order-footer");
  if (!body) return;

  const addr = o.address || {};
  body.innerHTML = `
    <div class="detail-row"><div class="detail-key">Клиент</div><div class="detail-val">${esc(o.clientName||"")}${o.clientUsername?" @"+o.clientUsername:""}</div></div>
    <div class="detail-row"><div class="detail-key">Время заказа</div><div class="detail-val">${fmtDateTime(o.createdAt)}</div></div>
    <div class="detail-row"><div class="detail-key">Адрес</div><div class="detail-val">${esc([addr.street,"д."+addr.house,addr.apt?"кв."+addr.apt:""].filter(Boolean).join(", "))}</div></div>
    <div class="detail-row"><div class="detail-key">Домофон</div><div class="detail-val">${addr.intercom?"Есть":"Нет"}</div></div>
    <div class="detail-row"><div class="detail-key">Оплата</div><div class="detail-val">${o.payment==="cash"?"💵 Наличные":"💳 Карта"}</div></div>
    ${o.comment?`<div class="detail-row"><div class="detail-key">Комментарий</div><div class="detail-val">${esc(o.comment)}</div></div>`:""}
    <div style="margin-top:10px;font-size:13px;font-weight:600;color:var(--c-text-3);">СОСТАВ:</div>
    ${(o.items||[]).map(i=>`<div class="detail-row"><div class="detail-key">${esc(i.name)} ×${i.qty}</div><div class="detail-val">${fmtPrice(i.subtotal||i.price*i.qty)}</div></div>`).join("")}
    <div class="detail-row"><div class="detail-key font-bold">ИТОГО</div><div class="detail-val font-bold text-accent">${fmtPrice(o.totalPrice)}</div></div>
    ${o.courierName?`<div class="detail-row"><div class="detail-key">Курьер</div><div class="detail-val">${esc(o.courierName)}</div></div>`:""}
    <div class="detail-row"><div class="detail-key">Статус</div><div class="detail-val">${statusBadge(o.status)}</div></div>
  `;

  if (footer) {
    if (o.status === "pending") {
      footer.innerHTML = `
        <button class="btn btn-success" onclick="acceptOrder('${id}');closeModal('modal-order')">✓ Подтвердить заказ</button>
        <button class="btn btn-danger" onclick="askCancel('${id}');closeModal('modal-order')">✗ Отменить заказ</button>
        <button class="btn btn-secondary" onclick="closeModal('modal-order')">Закрыть</button>
      `;
    } else if (o.status === "accepted" || o.status === "preparing") {
      footer.innerHTML = `
        <button class="btn btn-blue" onclick="openAssign('${id}');closeModal('modal-order')">🚴 Передать курьеру</button>
        <button class="btn btn-danger" onclick="askCancel('${id}');closeModal('modal-order')">✗ Отменить заказ</button>
        <button class="btn btn-secondary" onclick="closeModal('modal-order')">Закрыть</button>
      `;
    } else {
      footer.innerHTML = `<button class="btn btn-secondary" onclick="closeModal('modal-order')">Закрыть</button>`;
    }
  }
  openModal("modal-order");
}

// ---- Accept order ----
async function acceptOrder(id) {
  const o = OP.orders.find(x => x.id === id);
  if (!o) return;
  const s = (await db.collection("settings").doc("cafe").get()).data() || {};
  const delivMs = ((s.deliveryHours||0)*3600 + (s.deliveryMinutes||45)*60) * 1000;
  const deadline = new Date(Date.now() + delivMs).toISOString();
  const delivLabel = s.deliveryHours
    ? `${s.deliveryHours} ч ${s.deliveryMinutes||0} мин`
    : `${s.deliveryMinutes||45} мин`;

  try {
    await db.collection("orders").doc(id).update({
      status:             "accepted",
      acceptedAt:         new Date().toISOString(),
      operatorTgId:       OP.tgId,
      deliveryDeadlineAt: deadline,
      deliveryDurationMs: delivMs,
    });
    // Notify client via bot_task
    await createBotTask("order_accepted", {
      orderId:     id,
      clientTgId:  o.clientTgId,
      message:     `✅ Ваш заказ принят в работу! Ожидайте доставки в течение ${delivLabel}.`,
    });
    // In-app notification for client
    await dbSet("notifications", `notif_${id}_accepted`, {
      tgId:      o.clientTgId,
      type:      "order_accepted",
      orderId:   id,
      message:   `Ваш заказ принят в работу! Ожидайте доставки в течение ${delivLabel}.`,
      read:      false,
      createdAt: new Date().toISOString(),
    });
    showToast("Заказ подтверждён ✓", "success");
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
}

// ---- Cancel order ----
function askCancel(id) {
  OP.cancelOrderId = id;
  openModal("modal-cancel");
}

async function confirmCancel() {
  const id = OP.cancelOrderId;
  if (!id) return;
  const o = OP.orders.find(x => x.id === id);
  closeModal("modal-cancel");
  try {
    await db.collection("orders").doc(id).update({
      status:      "cancelled",
      cancelledAt: new Date().toISOString(),
      operatorTgId: OP.tgId,
    });
    if (o) {
      await createBotTask("order_cancelled", { orderId: id, clientTgId: o.clientTgId });
      await dbSet("notifications", `notif_${id}_cancelled`, {
        tgId: o.clientTgId, type: "order_cancelled", orderId: id,
        message: "Ваш заказ был отменён. С вами свяжется оператор.", read: false,
        createdAt: new Date().toISOString(),
      });
    }
    showToast("Заказ отменён", "error");
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
  OP.cancelOrderId = null;
}

// ---- Assign courier ----
async function openAssign(orderId) {
  OP.assignOrderId = orderId;
  const listEl   = document.getElementById("couriers-list-assign");
  const noEl     = document.getElementById("no-couriers");
  if (!listEl) return;

  // Load active couriers
  try {
    const snap = await db.collection("courier_shifts").where("active","==",true).get();
    OP.couriers = [];
    snap.forEach(d => OP.couriers.push({ id: d.id, ...d.data() }));
  } catch(e) { OP.couriers = []; }

  if (!OP.couriers.length) {
    listEl.innerHTML = "";
    noEl?.classList.remove("hidden");
  } else {
    noEl?.classList.add("hidden");
    listEl.innerHTML = OP.couriers.map(c => `
      <div class="list-item" onclick="assignToCourier('${c.id}','${esc(c.name||c.id)}')">
        <div class="list-item-icon">🚴</div>
        <div class="list-item-info">
          <div class="list-item-title">${esc(c.name || c.id)}</div>
          <div class="list-item-sub">На смене</div>
        </div>
        <div class="list-item-right">→</div>
      </div>`).join("");
  }
  openModal("modal-assign");
}

async function assignToCourier(courierId, courierName) {
  const id = OP.assignOrderId;
  if (!id) return;
  closeModal("modal-assign");
  try {
    await db.collection("orders").doc(id).update({
      status:      "courier",
      courierId,
      courierName,
      assignedAt:  new Date().toISOString(),
      operatorTgId: OP.tgId,
    });
    showToast(`Заказ передан курьеру ${courierName} ✓`, "success");
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
  OP.assignOrderId = null;
}

// ---- History ----
async function loadHistory() {
  const dateVal = document.getElementById("history-date")?.value;
  if (!dateVal) return;
  const list  = document.getElementById("history-list");
  const empty = document.getElementById("history-empty");
  if (!list) return;

  const start = new Date(dateVal + "T00:00:00").toISOString();
  const end   = new Date(dateVal + "T23:59:59").toISOString();
  try {
    const snap = await db.collection("orders")
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .orderBy("createdAt", "desc")
      .get();
    const orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));

    if (!orders.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }
    empty?.classList.add("hidden");
    list.innerHTML = orders.map(o => `
      <div class="order-card">
        <div class="order-card-header">
          <div>
            <div class="order-num">Заказ #${shortId(o.id)}</div>
            <div class="order-client">${esc(o.clientName||"Клиент")}</div>
          </div>
          ${statusBadge(o.status)}
        </div>
        <div class="order-items">${(o.items||[]).map(i=>`${esc(i.name)} ×${i.qty}`).join(", ")}</div>
        <div class="order-addr">${esc([o.address?.street,"д."+(o.address?.house||""),o.address?.apt?"кв."+o.address.apt:""].filter(Boolean).join(", "))}</div>
        <div class="order-footer">
          <div class="order-total">${fmtPrice(o.totalPrice)}</div>
          <div class="order-time">${fmtTime(o.createdAt)}</div>
        </div>
        ${o.operatorTgId?`<div style="font-size:12px;color:var(--c-text-3);margin-top:2px;">Оператор: ${o.operatorTgId}${o.acceptedAt?" · принят "+fmtTime(o.acceptedAt):""}</div>`:""}
        ${o.courierName?`<div style="font-size:12px;color:var(--c-text-3);">Курьер: ${esc(o.courierName)}${o.assignedAt?" · передан "+fmtTime(o.assignedAt):""}${o.deliveredAt?" · доставлен "+fmtTime(o.deliveredAt):""}</div>`:""}
      </div>`).join("");
  } catch(e) { showToast("Ошибка загрузки истории", "error"); }
}

// ---- Delivered toast ----
function showDeliveredToast(msg) {
  const el = document.getElementById("delivered-toast");
  const txt = document.getElementById("delivered-toast-text");
  if (!el || !txt) return;
  txt.textContent = msg;
  el.classList.add("show");
  playBeep(660, 0.15, 0.3);
  setTimeout(() => el.classList.remove("show"), 4000);
}

// ---- Helpers ----
function esc(s) {
  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function shortId(id) { return id ? id.slice(-5).toUpperCase() : "—"; }
