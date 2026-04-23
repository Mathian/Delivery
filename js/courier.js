/* ============================================================
   COURIER.JS — Логика панели курьера
   ============================================================ */

const CR = {
  tgId:         null,
  tgName:       null,
  shiftActive:  false,
  myOrders:     [],
  histOrders:   [],
  selectedId:   null,
  deliverConfirmId: null,
  returnConfirmId:  null,
  unsub:        null,
};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", () => {
  const user = getTgUser();
  if (!user) {
    setTimeout(() => showScreen("s-error"), 1800);
    return;
  }
  CR.tgId   = String(user.id);
  CR.tgName = user.first_name || "Курьер";

  if (sessionStorage.getItem("delivery_auth_courier") === CR.tgId) {
    initCourierApp();
    setTimeout(() => showScreen("s-main"), 800);
    return;
  }

  setTimeout(() => showScreen("s-auth"), 900);
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

  const ok = await checkAccessCode("courier", code);
  if (!ok) {
    errEl?.classList.remove("hidden");
    input?.classList.add("shake");
    setTimeout(() => input?.classList.remove("shake"), 400);
    if (btn) btn.disabled = false;
    return;
  }

  sessionStorage.setItem("delivery_auth_courier", CR.tgId);
  await initCourierApp();
  showScreen("s-main");
}

async function initCourierApp() {
  await waitAuth();
  document.getElementById("cr-name-sub").textContent = CR.tgName;
  await checkShiftStatus();
  listenMyOrders();
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

// ---- Shift management ----
async function checkShiftStatus() {
  try {
    const doc = await db.collection("courier_shifts").doc(CR.tgId).get();
    CR.shiftActive = doc.exists && doc.data().active === true;
  } catch(e) { CR.shiftActive = false; }
  updateShiftUI();
}

async function toggleShift() {
  const btn = document.getElementById("shift-btn");
  if (btn) btn.disabled = true;
  try {
    if (CR.shiftActive) {
      // End shift
      await db.collection("courier_shifts").doc(CR.tgId).set({
        tgId: CR.tgId,
        name: CR.tgName || "Курьер",
        active: false,
        endedAt: new Date().toISOString(),
      }, { merge: true });
      CR.shiftActive = false;
      showToast("Смена завершена");
    } else {
      // Start shift
      await db.collection("courier_shifts").doc(CR.tgId).set({
        tgId: CR.tgId,
        name: CR.tgName || "Курьер",
        active: true,
        startedAt: new Date().toISOString(),
        endedAt: null,
      }, { merge: true });
      CR.shiftActive = true;
      showToast("Смена начата ✓", "success");
    }
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
  if (btn) btn.disabled = false;
  updateShiftUI();
}

function updateShiftUI() {
  const dot   = document.getElementById("shift-dot");
  const title = document.getElementById("shift-title");
  const sub   = document.getElementById("shift-sub");
  const btn   = document.getElementById("shift-btn");
  const emptySub = document.getElementById("empty-sub-text");

  if (CR.shiftActive) {
    dot?.classList.add("on");
    if (title) title.textContent = "Смена активна";
    if (sub)   sub.textContent   = "Вы принимаете заказы";
    if (btn)   { btn.textContent = "Завершить"; btn.className = "btn btn-danger btn-sm"; }
    if (emptySub) emptySub.textContent = "Заказов пока нет";
  } else {
    dot?.classList.remove("on");
    if (title) title.textContent = "Смена не начата";
    if (sub)   sub.textContent   = "Нажмите кнопку, чтобы начать";
    if (btn)   { btn.textContent = "Начать"; btn.className = "btn btn-success btn-sm"; }
    if (emptySub) emptySub.textContent = "Начните смену, чтобы получать заказы";
  }
}

// ---- Listen to my orders ----
function listenMyOrders() {
  if (CR.unsub) CR.unsub();
  CR.unsub = db.collection("orders")
    .where("courierId", "==", CR.tgId)
    .where("status", "==", "courier")
    .orderBy("assignedAt", "asc")
    .onSnapshot(snap => {
      CR.myOrders = [];
      snap.forEach(d => CR.myOrders.push({ id: d.id, ...d.data() }));
      renderMyOrders();
    });
}

function renderMyOrders() {
  const list  = document.getElementById("my-orders-list");
  const empty = document.getElementById("orders-empty");
  const badge = document.getElementById("orders-badge");

  if (badge) {
    badge.textContent = CR.myOrders.length;
    badge.classList.toggle("hidden", !CR.myOrders.length);
  }
  if (!list) return;

  if (!CR.myOrders.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");

  list.innerHTML = CR.myOrders.map(o => {
    const addr = o.address || {};
    const deadline = o.deliveryDeadlineAt ? new Date(o.deliveryDeadlineAt).getTime() : null;
    const remaining = deadline ? Math.max(0, deadline - Date.now()) : null;
    const totalMs   = o.deliveryDurationMs || 2700000;
    const pct = remaining !== null ? Math.max(0, Math.min(100, (remaining / totalMs) * 100)) : 100;
    const cls = pct > 50 ? "ok" : pct > 20 ? "warn" : "crit";
    const timeLeft = remaining !== null
      ? (remaining <= 0 ? "Время истекло!" : "~" + fmtDuration(remaining))
      : "—";

    return `
    <div class="order-card" onclick="openOrderDetail('${o.id}')">
      <div class="order-card-header">
        <div>
          <div class="order-num">Заказ #${shortId(o.id)}</div>
          <div class="order-client">${esc(o.clientName||"Клиент")}</div>
        </div>
        ${statusBadge(o.status)}
      </div>
      <div class="order-items">${(o.items||[]).map(i=>`${esc(i.name)} ×${i.qty}`).join(", ")}</div>
      <div class="order-addr">📍 ${esc([addr.street,"д."+(addr.house||""),addr.apt?"кв."+addr.apt:""].filter(Boolean).join(", "))}</div>
      <div class="countdown" style="margin-top:8px;">
        <div class="progress-track"><div class="progress-fill ${cls}" style="width:${pct}%"></div></div>
        <div class="countdown-label">Осталось: ${timeLeft}</div>
      </div>
      <div class="order-footer" style="margin-top:6px;">
        <div class="order-total">${fmtPrice(o.totalPrice)}</div>
        <div class="order-time">${o.payment==="cash"?"💵 Наличные":"💳 Карта"}</div>
      </div>
    </div>`;
  }).join("");
}

// ---- Order detail modal ----
function openOrderDetail(id) {
  const o = CR.myOrders.find(x => x.id === id);
  if (!o) return;
  CR.selectedId = id;

  document.getElementById("cr-od-num").textContent = shortId(id);
  const body   = document.getElementById("cr-order-body");
  const footer = document.getElementById("cr-order-footer");
  if (!body) return;

  const addr = o.address || {};
  body.innerHTML = `
    <div class="detail-row"><div class="detail-key">Клиент</div><div class="detail-val">${esc(o.clientName||"")}</div></div>
    <div class="detail-row"><div class="detail-key">Адрес</div><div class="detail-val">${esc([addr.street,"д."+(addr.house||""),addr.apt?"кв."+addr.apt:""].filter(Boolean).join(", "))}</div></div>
    <div class="detail-row"><div class="detail-key">Домофон</div><div class="detail-val">${addr.intercom?"Есть":"Нет"}</div></div>
    <div class="detail-row"><div class="detail-key">Оплата</div><div class="detail-val">${o.payment==="cash"?"💵 Наличные":"💳 Карта"}</div></div>
    ${o.comment?`<div class="detail-row"><div class="detail-key">Комментарий</div><div class="detail-val">${esc(o.comment)}</div></div>`:""}
    <div style="margin-top:10px;font-size:13px;font-weight:600;color:var(--c-text-3);">СОСТАВ:</div>
    ${(o.items||[]).map(i=>`<div class="detail-row"><div class="detail-key">${esc(i.name)} ×${i.qty}</div><div class="detail-val">${fmtPrice(i.subtotal||i.price*i.qty)}</div></div>`).join("")}
    <div class="detail-row"><div class="detail-key font-bold">ИТОГО</div><div class="detail-val font-bold text-accent">${fmtPrice(o.totalPrice)}</div></div>
    <div class="detail-row"><div class="detail-key">Время заказа</div><div class="detail-val">${fmtDateTime(o.createdAt)}</div></div>
    ${o.deliveryDeadlineAt?`<div class="detail-row"><div class="detail-key">Доставить до</div><div class="detail-val">${fmtTime(o.deliveryDeadlineAt)}</div></div>`:""}
  `;

  if (footer) {
    footer.innerHTML = `
      <button class="btn btn-success" onclick="askDelivered('${id}')">✅ Доставил</button>
      <button class="btn btn-danger" onclick="askReturn('${id}')">↩️ Возврат</button>
      <button class="btn btn-secondary" onclick="closeModal('modal-order')">Закрыть</button>
    `;
  }
  openModal("modal-order");
}

// ---- Delivered ----
function askDelivered(id) {
  CR.deliverConfirmId = id;
  closeModal("modal-order");
  openModal("modal-delivered");
}

async function confirmDelivered() {
  const id = CR.deliverConfirmId;
  if (!id) return;
  closeModal("modal-delivered");
  const o = CR.myOrders.find(x => x.id === id);
  try {
    await db.collection("orders").doc(id).update({
      status:      "delivered",
      deliveredAt: new Date().toISOString(),
    });
    // Notify client
    if (o) {
      await createBotTask("order_delivered", { orderId: id, clientTgId: o.clientTgId });
      await dbSet("notifications", `notif_${id}_delivered`, {
        tgId: o.clientTgId, type: "order_delivered", orderId: id,
        message: "Заказ доставлен. Приятного аппетита! 🍽️",
        read: false, createdAt: new Date().toISOString(),
      });
      // Also notify operator via bot_task
      await createBotTask("order_delivered_op", { orderId: id, orderNum: shortId(id) });
    }
    showToast("Заказ помечен как доставленный ✓", "success");
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
  CR.deliverConfirmId = null;
}

// ---- Return ----
function askReturn(id) {
  CR.returnConfirmId = id;
  closeModal("modal-order");
  openModal("modal-return");
}

async function confirmReturn() {
  const id = CR.returnConfirmId;
  if (!id) return;
  closeModal("modal-return");
  try {
    await db.collection("orders").doc(id).update({
      status:     "cancelled",
      returnedAt: new Date().toISOString(),
      returnNote: "Возврат курьером",
    });
    showToast("Возврат оформлен", "error");
  } catch(e) { showToast("Ошибка: " + e.message, "error"); }
  CR.returnConfirmId = null;
}

// ---- History ----
async function loadHistory() {
  const list  = document.getElementById("delivery-history");
  const empty = document.getElementById("hist-empty");
  if (!list) return;
  try {
    const snap = await db.collection("orders")
      .where("courierId", "==", CR.tgId)
      .where("status", "==", "delivered")
      .orderBy("deliveredAt", "desc")
      .limit(50)
      .get();
    CR.histOrders = [];
    snap.forEach(d => CR.histOrders.push({ id: d.id, ...d.data() }));

    if (!CR.histOrders.length) {
      list.innerHTML = "";
      empty?.classList.remove("hidden");
      return;
    }
    empty?.classList.add("hidden");
    list.innerHTML = CR.histOrders.map(o => `
      <div class="order-card">
        <div class="order-card-header">
          <div class="order-num">Заказ #${shortId(o.id)}</div>
          ${statusBadge(o.status)}
        </div>
        <div class="order-client">${esc(o.clientName||"Клиент")}</div>
        <div class="order-addr">📍 ${esc([o.address?.street,"д."+(o.address?.house||""),o.address?.apt?"кв."+o.address.apt:""].filter(Boolean).join(", "))}</div>
        <div class="order-footer">
          <div class="order-total">${fmtPrice(o.totalPrice)}</div>
          <div class="order-time">${fmtDateTime(o.deliveredAt||o.createdAt)}</div>
        </div>
      </div>`).join("");
  } catch(e) { showToast("Ошибка загрузки истории", "error"); }
}

// ---- Helpers ----
function esc(s) {
  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function shortId(id) { return id ? id.slice(-5).toUpperCase() : "—"; }
