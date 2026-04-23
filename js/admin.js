/* ============================================================
   ADMIN.JS — Логика админ-панели доставки
   ============================================================ */

const A = {
  session:       null,
  menu:          [],
  allOrders:     [],
  filteredOrders:[],
  editingId:     null,
  deletingId:    null,
  categories:    [],
  uploadedImgUrl:"",
};

// ---- Boot ----
window.addEventListener("DOMContentLoaded", async () => {
  const session = await verifySession("admin");
  if (!session) {
    setTimeout(() => showScreen("s-error"), 1600);
    return;
  }
  A.session = session;
  document.getElementById("admin-name-sub").textContent = session.name || "Администратор";
  listenMenu();
  loadSettings();
  setTimeout(() => showScreen("s-main"), 1200);
});

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

// ---- Menu ----
function listenMenu() {
  db.collection("menu").orderBy("order", "asc").onSnapshot(snap => {
    A.menu = [];
    snap.forEach(d => A.menu.push({ id: d.id, ...d.data() }));
    A.categories = [...new Set(A.menu.map(i => i.category).filter(Boolean))];
    renderAdminMenu();
    populateCategorySelect();
  }, () => {
    db.collection("menu").get().then(snap => {
      A.menu = [];
      snap.forEach(d => A.menu.push({ id: d.id, ...d.data() }));
      A.categories = [...new Set(A.menu.map(i => i.category).filter(Boolean))];
      renderAdminMenu();
      populateCategorySelect();
    });
  });
}

function renderAdminMenu() {
  const list  = document.getElementById("admin-menu-list");
  const empty = document.getElementById("menu-empty");
  if (!list) return;
  if (!A.menu.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list.innerHTML = A.menu.map(item => `
    <div class="admin-item">
      <div class="admin-item-img">
        ${item.image ? `<img src="${item.image}" onerror="this.parentElement.textContent='🍽️'">` : "🍽️"}
      </div>
      <div class="admin-item-info">
        <div class="admin-item-name">${esc(item.name)}</div>
        <div class="admin-item-meta">
          <span class="avail-dot ${item.available !== false ? "yes" : "no"}"></span>
          ${esc(item.category || "Без категории")}
        </div>
        <div class="admin-item-price">${fmtPrice(item.price)}</div>
      </div>
      <div class="admin-item-actions">
        <button class="btn-icon" onclick="openEditItem('${item.id}')">✏️</button>
        <button class="btn-icon" onclick="askDeleteItem('${item.id}')">🗑️</button>
      </div>
    </div>`).join("");
}

function populateCategorySelect() {
  const sel = document.getElementById("item-category");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">Категория…</option>` +
    A.categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = cur;
}

// ---- Add / Edit Item ----
function openAddItem() {
  A.editingId = null;
  A.uploadedImgUrl = "";
  document.getElementById("item-modal-title").textContent = "Новый пункт меню";
  ["item-name","item-desc","item-img-url","item-new-cat"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
  document.getElementById("item-price").value = "";
  document.getElementById("item-category").value = "";
  resetImgPreview();
  document.getElementById("item-avail-toggle")?.classList.add("on");
  openModal("modal-item-edit");
}

function openEditItem(id) {
  const item = A.menu.find(i => i.id === id);
  if (!item) return;
  A.editingId = id;
  A.uploadedImgUrl = item.image || "";
  document.getElementById("item-modal-title").textContent = "Редактировать";
  document.getElementById("item-name").value     = item.name || "";
  document.getElementById("item-desc").value     = item.description || "";
  document.getElementById("item-price").value    = item.price || 0;
  document.getElementById("item-img-url").value  = item.image || "";
  document.getElementById("item-new-cat").value  = "";
  populateCategorySelect();
  document.getElementById("item-category").value = item.category || "";
  document.getElementById("item-avail-toggle")?.classList.toggle("on", item.available !== false);
  const p = document.getElementById("item-img-preview");
  if (p) p.innerHTML = item.image
    ? `<img src="${item.image}" onerror="this.parentElement.innerHTML='<span>📷</span><span>Фото</span>'">`
    : "<span>📷</span><span>Фото</span>";
  openModal("modal-item-edit");
}

function resetImgPreview() {
  const p = document.getElementById("item-img-preview");
  if (p) p.innerHTML = "<span>📷</span><span>Фото</span>";
}

function previewImgUrl(url) {
  A.uploadedImgUrl = url;
  const p = document.getElementById("item-img-preview");
  if (!p) return;
  p.innerHTML = url
    ? `<img src="${url}" onerror="this.parentElement.innerHTML='<span>📷</span><span>Фото</span>'">`
    : "<span>📷</span><span>Фото</span>";
}

async function handleImgUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  showToast("Загрузка фото…", "info");
  try {
    await waitAuth();
    const ref = storage.ref(`menu/${Date.now()}_${file.name}`);
    await ref.put(file);
    const url = await ref.getDownloadURL();
    A.uploadedImgUrl = url;
    document.getElementById("item-img-url").value = url;
    previewImgUrl(url);
    showToast("Фото загружено ✓");
  } catch(e) {
    showToast("Ошибка загрузки: " + e.message, "error");
  }
}

async function saveItem() {
  const name  = document.getElementById("item-name").value.trim();
  const price = parseFloat(document.getElementById("item-price").value);
  if (!name)                    { showToast("Введите название", "error"); return; }
  if (isNaN(price) || price < 0){ showToast("Некорректная цена", "error"); return; }

  let cat = document.getElementById("item-category").value;
  const newCat = document.getElementById("item-new-cat").value.trim();
  if (newCat) cat = newCat;

  const imgUrl = document.getElementById("item-img-url").value.trim() || A.uploadedImgUrl;
  const avail  = document.getElementById("item-avail-toggle")?.classList.contains("on") ?? true;

  const data = {
    name,
    description: document.getElementById("item-desc").value.trim(),
    price, category: cat, image: imgUrl, available: avail,
    order: A.editingId ? (A.menu.find(i => i.id === A.editingId)?.order ?? 999) : A.menu.length,
  };
  try {
    if (A.editingId) {
      await db.collection("menu").doc(A.editingId).update(data);
    } else {
      await db.collection("menu").add(data);
    }
    closeModal("modal-item-edit");
    showToast(A.editingId ? "Изменения сохранены ✓" : "Пункт меню добавлен ✓");
  } catch(e) {
    showToast("Ошибка: " + e.message, "error");
  }
}

function askDeleteItem(id) {
  A.deletingId = id;
  openModal("modal-confirm-del");
}
async function confirmDeleteItem() {
  if (!A.deletingId) return;
  try {
    await db.collection("menu").doc(A.deletingId).delete();
    closeModal("modal-confirm-del");
    showToast("Удалено ✓");
  } catch(e) { showToast("Ошибка удаления", "error"); }
  A.deletingId = null;
}

// ---- Orders ----
async function loadAllOrders() {
  try {
    const snap = await db.collection("orders").orderBy("createdAt","desc").limit(200).get();
    A.allOrders = [];
    snap.forEach(d => A.allOrders.push({ id: d.id, ...d.data() }));
    filterOrders();
  } catch(e) { showToast("Ошибка загрузки заказов", "error"); }
}

function filterOrders() {
  const val = document.getElementById("orders-filter")?.value || "all";
  A.filteredOrders = val === "all" ? A.allOrders : A.allOrders.filter(o => o.status === val);
  renderOrdersList();
}

function renderOrdersList() {
  const list  = document.getElementById("admin-orders-list");
  const empty = document.getElementById("orders-empty");
  if (!list) return;
  if (!A.filteredOrders.length) {
    list.innerHTML = "";
    empty?.classList.remove("hidden");
    return;
  }
  empty?.classList.add("hidden");
  list.innerHTML = A.filteredOrders.map(o => `
    <div class="order-card" onclick="openAdminOrderDetail('${o.id}')">
      <div class="order-card-header">
        <div>
          <div class="order-num">Заказ #${shortId(o.id)}</div>
          <div class="order-addr">${esc(o.clientName||"Клиент")} · ${esc(o.address?.street||"")} д.${o.address?.house||""}</div>
        </div>
        ${statusBadge(o.status)}
      </div>
      <div class="order-items">${(o.items||[]).map(i=>`${esc(i.name)} ×${i.qty}`).join(", ")}</div>
      <div class="order-footer">
        <div class="order-total font-bold">${fmtPrice(o.totalPrice)}</div>
        <div class="order-time">${fmtDateTime(o.createdAt)}</div>
      </div>
    </div>`).join("");
}

function openAdminOrderDetail(id) {
  const o = A.allOrders.find(x => x.id === id);
  if (!o) return;
  const body = document.getElementById("admin-order-body");
  if (!body) return;
  const addr = o.address || {};
  body.innerHTML = `
    <div class="detail-row"><div class="detail-key">№ заказа</div><div class="detail-val">#${shortId(o.id)}</div></div>
    <div class="detail-row"><div class="detail-key">Статус</div><div class="detail-val">${statusBadge(o.status)}</div></div>
    <div class="detail-row"><div class="detail-key">Клиент</div><div class="detail-val">${esc(o.clientName||"")}${o.clientUsername?" @"+o.clientUsername:""}</div></div>
    <div class="detail-row"><div class="detail-key">Telegram ID</div><div class="detail-val">${o.clientTgId||""}</div></div>
    <div class="detail-row"><div class="detail-key">Время заказа</div><div class="detail-val">${fmtDateTime(o.createdAt)}</div></div>
    ${o.acceptedAt?`<div class="detail-row"><div class="detail-key">Принят</div><div class="detail-val">${fmtDateTime(o.acceptedAt)}</div></div>`:""}
    ${o.assignedAt?`<div class="detail-row"><div class="detail-key">Передан курьеру</div><div class="detail-val">${fmtDateTime(o.assignedAt)}</div></div>`:""}
    ${o.deliveredAt?`<div class="detail-row"><div class="detail-key">Доставлен</div><div class="detail-val">${fmtDateTime(o.deliveredAt)}</div></div>`:""}
    <div class="detail-row"><div class="detail-key">Адрес</div><div class="detail-val">${esc([addr.street,"д."+addr.house,addr.apt?"кв."+addr.apt:""].filter(Boolean).join(", "))}</div></div>
    <div class="detail-row"><div class="detail-key">Оплата</div><div class="detail-val">${o.payment==="cash"?"💵 Наличные":"💳 Карта"}</div></div>
    ${o.comment?`<div class="detail-row"><div class="detail-key">Комментарий</div><div class="detail-val">${esc(o.comment)}</div></div>`:""}
    ${o.courierName?`<div class="detail-row"><div class="detail-key">Курьер</div><div class="detail-val">${esc(o.courierName)}</div></div>`:""}
    <div style="margin-top:10px;font-weight:600;font-size:13px;color:var(--c-text-3);">СОСТАВ:</div>
    ${(o.items||[]).map(i=>`<div class="detail-row"><div class="detail-key">${esc(i.name)} ×${i.qty}</div><div class="detail-val">${fmtPrice(i.subtotal||i.price*i.qty)}</div></div>`).join("")}
    <div class="detail-row"><div class="detail-key font-bold">ИТОГО</div><div class="detail-val font-bold text-accent">${fmtPrice(o.totalPrice)}</div></div>
  `;
  openModal("modal-order-detail");
}

// ---- Statistics ----
async function loadStats() {
  try {
    const snap = await db.collection("orders").get();
    const orders = [];
    snap.forEach(d => orders.push(d.data()));
    const delivered = orders.filter(o => o.status === "delivered");
    const revenue   = delivered.reduce((s,o) => s + (o.totalPrice||0), 0);
    const avgOrder  = delivered.length ? Math.round(revenue / delivered.length) : 0;
    const grid = document.getElementById("stat-grid");
    if (grid) grid.innerHTML = `
      <div class="stat-card"><div class="stat-val">${orders.length}</div><div class="stat-label">Всего заказов</div></div>
      <div class="stat-card"><div class="stat-val">${delivered.length}</div><div class="stat-label">Доставлено</div></div>
      <div class="stat-card"><div class="stat-val">${fmtPrice(revenue)}</div><div class="stat-label">Выручка</div></div>
      <div class="stat-card"><div class="stat-val">${fmtPrice(avgOrder)}</div><div class="stat-label">Средний чек</div></div>
      <div class="stat-card"><div class="stat-val">${orders.filter(o=>o.status==="cancelled").length}</div><div class="stat-label">Отменено</div></div>
      <div class="stat-card"><div class="stat-val">${orders.filter(o=>["pending","accepted","preparing","courier"].includes(o.status)).length}</div><div class="stat-label">Активных</div></div>
    `;
    const recent = [...orders].sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||"")).slice(0,10);
    const list = document.getElementById("stats-orders-list");
    if (list) list.innerHTML = recent.map(o => `
      <div class="order-card" style="margin-bottom:8px;">
        <div class="order-card-header">
          <div class="order-num">${esc(o.clientName||"Клиент")} · ${fmtDateTime(o.createdAt)}</div>
          ${statusBadge(o.status)}
        </div>
        <div class="order-footer">
          <div class="order-total">${fmtPrice(o.totalPrice)}</div>
          <div class="order-time">${esc((o.items||[]).map(i=>i.name).join(", ")).slice(0,45)}</div>
        </div>
      </div>`).join("");
  } catch(e) { showToast("Ошибка статистики", "error"); }
}

// ---- Settings ----
async function loadSettings() {
  try {
    const snap = await db.collection("settings").doc("cafe").get();
    const s = snap.exists ? snap.data() : {};
    document.getElementById("cafe-open-toggle")?.classList.toggle("on", s.isOpen !== false);
    document.getElementById("work-start").value  = s.workStart  || "09:00";
    document.getElementById("work-end").value    = s.workEnd    || "22:00";
    document.getElementById("deliv-hours").value = s.deliveryHours    || 0;
    document.getElementById("deliv-mins").value  = s.deliveryMinutes  || 45;
  } catch(e) {}
  try {
    const snap = await db.collection("settings").doc("access_keys").get();
    const k = snap.exists ? snap.data() : {};
    document.getElementById("key-admin-sub").textContent    = k.admin    ? "Задан ✓" : "Не задан";
    document.getElementById("key-operator-sub").textContent = k.operator ? "Задан ✓" : "Не задан";
    document.getElementById("key-courier-sub").textContent  = k.courier  ? "Задан ✓" : "Не задан";
  } catch(e) {}
}

async function saveSettings() {
  const data = {
    isOpen:          document.getElementById("cafe-open-toggle")?.classList.contains("on") ?? true,
    workStart:       document.getElementById("work-start")?.value || "09:00",
    workEnd:         document.getElementById("work-end")?.value   || "22:00",
    deliveryHours:   parseInt(document.getElementById("deliv-hours")?.value) || 0,
    deliveryMinutes: parseInt(document.getElementById("deliv-mins")?.value)  || 45,
  };
  try {
    await dbSet("settings","cafe",data);
    showToast("Настройки сохранены ✓");
  } catch(e) { showToast("Ошибка сохранения","error"); }
}

function promptSetKey(role) {
  const key = prompt(`Новый ключ для "${role}" (4 символа):`);
  if (!key) return;
  if (key.length !== 4) { showToast("Ключ должен быть ровно 4 символа","error"); return; }
  setAccessKey(role, key);
}

async function setAccessKey(role, key) {
  // MD5 hash via SparkMD5 polyfill fallback — use SHA-256 prefix for now.
  // C# bot must hash with the same algorithm. See README.
  const hash = await hashKey(key);
  try {
    await db.collection("settings").doc("access_keys").set({ [role]: hash }, { merge: true });
    showToast(`Ключ "${role}" установлен ✓`);
    loadSettings();
  } catch(e) { showToast("Ошибка: "+e.message,"error"); }
}

async function hashKey(key) {
  // Pure MD5 via simple implementation (no library dependency)
  return md5(key);
}

// ---- Minimal MD5 implementation ----
function md5(input) {
  function safeAdd(x,y){const lsw=(x&0xFFFF)+(y&0xFFFF),msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xFFFF);}
  function bitRotateLeft(num,cnt){return(num<<cnt)|(num>>>(32-cnt));}
  function md5cmn(q,a,b,x,s,t){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5blk(s){const md5blks=[];for(let i=0;i<64;i+=4)md5blks[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);return md5blks;}
  function md5blk_array(a){const md5blks=[];for(let i=0;i<64;i+=4)md5blks[i>>2]=a[i]+(a[i+1]<<8)+(a[i+2]<<16)+(a[i+3]<<24);return md5blks;}
  function md51(s){const n=s.length,state=[1732584193,-271733879,-1732584194,271733878];let i;const tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=64;i<=n;i+=64)md5cycle(state,md5blk(s.substring(i-64,i)));const s2=s.substring(i-64);tail[s2.length>>2]|=0x80<<((s2.length%4)<<3);tail[14]=n*8;if(s2.length>55){md5cycle(state,md5blk(s2));md5cycle(state,tail);}else{const chunk=md5blk(s2);for(let j=0;j<16;j++)chunk[j]|=tail[j];md5cycle(state,chunk);}return state;}
  function md5cycle(x,k){let a=x[0],b=x[1],c=x[2],d=x[3];a=md5ff(a,b,c,d,k[0],7,-680876936);d=md5ff(d,a,b,c,k[1],12,-389564586);c=md5ff(c,d,a,b,k[2],17,606105819);b=md5ff(b,c,d,a,k[3],22,-1044525330);a=md5ff(a,b,c,d,k[4],7,-176418897);d=md5ff(d,a,b,c,k[5],12,1200080426);c=md5ff(c,d,a,b,k[6],17,-1473231341);b=md5ff(b,c,d,a,k[7],22,-45705983);a=md5ff(a,b,c,d,k[8],7,1770035416);d=md5ff(d,a,b,c,k[9],12,-1958414417);c=md5ff(c,d,a,b,k[10],17,-42063);b=md5ff(b,c,d,a,k[11],22,-1990404162);a=md5ff(a,b,c,d,k[12],7,1804603682);d=md5ff(d,a,b,c,k[13],12,-40341101);c=md5ff(c,d,a,b,k[14],17,-1502002290);b=md5ff(b,c,d,a,k[15],22,1236535329);a=md5gg(a,b,c,d,k[1],5,-165796510);d=md5gg(d,a,b,c,k[6],9,-1069501632);c=md5gg(c,d,a,b,k[11],14,643717713);b=md5gg(b,c,d,a,k[0],20,-373897302);a=md5gg(a,b,c,d,k[5],5,-701558691);d=md5gg(d,a,b,c,k[10],9,38016083);c=md5gg(c,d,a,b,k[15],14,-660478335);b=md5gg(b,c,d,a,k[4],20,-405537848);a=md5gg(a,b,c,d,k[9],5,568446438);d=md5gg(d,a,b,c,k[14],9,-1019803690);c=md5gg(c,d,a,b,k[3],14,-187363961);b=md5gg(b,c,d,a,k[8],20,1163531501);a=md5gg(a,b,c,d,k[13],5,-1444681467);d=md5gg(d,a,b,c,k[2],9,-51403784);c=md5gg(c,d,a,b,k[7],14,1735328473);b=md5gg(b,c,d,a,k[12],20,-1926607734);a=md5hh(a,b,c,d,k[5],4,-378558);d=md5hh(d,a,b,c,k[8],11,-2022574463);c=md5hh(c,d,a,b,k[11],16,1839030562);b=md5hh(b,c,d,a,k[14],23,-35309556);a=md5hh(a,b,c,d,k[1],4,-1530992060);d=md5hh(d,a,b,c,k[4],11,1272893353);c=md5hh(c,d,a,b,k[7],16,-155497632);b=md5hh(b,c,d,a,k[10],23,-1094730640);a=md5hh(a,b,c,d,k[13],4,681279174);d=md5hh(d,a,b,c,k[0],11,-358537222);c=md5hh(c,d,a,b,k[3],16,-722521979);b=md5hh(b,c,d,a,k[6],23,76029189);a=md5hh(a,b,c,d,k[9],4,-640364487);d=md5hh(d,a,b,c,k[12],11,-421815835);c=md5hh(c,d,a,b,k[15],16,530742520);b=md5hh(b,c,d,a,k[2],23,-995338651);a=md5ii(a,b,c,d,k[0],6,-198630844);d=md5ii(d,a,b,c,k[7],10,1126891415);c=md5ii(c,d,a,b,k[14],15,-1416354905);b=md5ii(b,c,d,a,k[5],21,-57434055);a=md5ii(a,b,c,d,k[12],6,1700485571);d=md5ii(d,a,b,c,k[3],10,-1894986606);c=md5ii(c,d,a,b,k[10],15,-1051523);b=md5ii(b,c,d,a,k[1],21,-2054922799);a=md5ii(a,b,c,d,k[8],6,1873313359);d=md5ii(d,a,b,c,k[15],10,-30611744);c=md5ii(c,d,a,b,k[6],15,-1560198380);b=md5ii(b,c,d,a,k[13],21,1309151649);a=md5ii(a,b,c,d,k[4],6,-145523070);d=md5ii(d,a,b,c,k[11],10,-1120210379);c=md5ii(c,d,a,b,k[2],15,718787259);b=md5ii(b,c,d,a,k[9],21,-343485551);x[0]=safeAdd(a,x[0]);x[1]=safeAdd(b,x[1]);x[2]=safeAdd(c,x[2]);x[3]=safeAdd(d,x[3]);}
  function hex_md5(s){return rhex(md51(s));}
  function rhex(n){let s="",j;for(let i=0;i<4;i++){for(j=0;j<4;j++)s+=("0"+((n[i]>>>(j*8+4))&0x0F).toString(16)).slice(-1)+("0"+((n[i]>>>(j*8))&0x0F).toString(16)).slice(-1);}return s;}
  return hex_md5(input);
}

// ---- Helpers ----
function esc(s) {
  return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function shortId(id) { return id ? id.slice(-5).toUpperCase() : "—"; }
