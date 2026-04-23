/* ============================================================
   FIREBASE-CONFIG.JS — Shared Firebase init + shared utilities
   ============================================================ */

const FIREBASE_CFG = {
  apiKey:            "AIzaSyAx5hmhfSvtf57XZQEAZJYaj95iu4_zRHM",
  authDomain:        "delivery-8a607.firebaseapp.com",
  projectId:         "delivery-8a607",
  storageBucket:     "delivery-8a607.firebasestorage.app",
  messagingSenderId: "911902301431",
  appId:             "1:911902301431:web:a7a10e2ff6e58e4e97c7f2"
};

// GitHub Pages base URL (adjust if you change the repo name or folder)
const WEBAPP_BASE = "https://mathian.github.io/Delivery/MiniApp/";

// ---- Firebase init ----
if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CFG);
const db      = firebase.firestore();
const auth    = firebase.auth();
const storage = firebase.storage();

db.enablePersistence({ synchronizeTabs: true }).catch(() => {});

let _authUser = null;

// Always resolves — either with the Firebase user or null after 8s fallback
const _authReady = new Promise(resolve => {
  let done = false;
  const finish = u => { if (!done) { done = true; _authUser = u || null; resolve(_authUser); } };

  auth.onAuthStateChanged(u => { if (u) finish(u); });
  auth.signInAnonymously()
    .then(r => finish(r.user))
    .catch(e => { console.warn("[Auth] signInAnonymously failed:", e.message); finish(null); });

  // Safety timeout — never block the UI forever
  setTimeout(() => finish(null), 8000);
});

async function waitAuth() { return _authReady; }
function getAuthUser()   { return _authUser; }

// ---- Telegram WebApp ----
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

function getTgUser() {
  return tg?.initDataUnsafe?.user || null;
}

// ---- Formatters ----
function fmtPrice(n) {
  return (n ?? 0).toLocaleString("ru-RU") + " ₽";
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function fmtTime(ts) {
  if (!ts) return "—";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}
function fmtDateTime(ts) {
  if (!ts) return "—";
  return fmtDate(ts) + " " + fmtTime(ts);
}
function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

// ---- ID generator ----
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---- Status labels ----
const STATUS_LABEL = {
  pending:   "Ожидает",
  accepted:  "Принят",
  preparing: "Готовится",
  courier:   "У курьера",
  delivered: "Доставлен",
  cancelled: "Отменён"
};
function statusBadge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABEL[status] ?? status}</span>`;
}

// ---- Toast ----
function showToast(msg, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 350);
  }, 3000);
}

// ---- Audio beep (requires user gesture first) ----
let _audioCtx = null;
function initAudio() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
}
document.addEventListener("click", initAudio, { once: true });
document.addEventListener("touchstart", initAudio, { once: true });

function playBeep(freq = 880, dur = 0.18, vol = 0.35) {
  if (!_audioCtx) return;
  try {
    const osc  = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.connect(gain);
    gain.connect(_audioCtx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(vol, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + dur);
    osc.start(_audioCtx.currentTime);
    osc.stop(_audioCtx.currentTime + dur + 0.05);
  } catch(e) {}
}

// Two-tone notification beep
function playNotifBeep() {
  playBeep(880, 0.1, 0.4);
  setTimeout(() => playBeep(1100, 0.12, 0.3), 130);
}

// ---- Image with fallback ----
function imgOrEmoji(url, emoji = "🍽️") {
  if (!url) return `<span>${emoji}</span>`;
  return `<img src="${url}" alt="" onerror="this.parentElement.innerHTML='<span>${emoji}</span>'">`;
}

// ---- Firestore helpers ----
async function dbSet(col, id, data) {
  await waitAuth();
  return db.collection(col).doc(String(id)).set({ ...data, _updatedAt: new Date().toISOString() }, { merge: true });
}
async function dbGet(col, id) {
  await waitAuth();
  const snap = await db.collection(col).doc(String(id)).get();
  return snap.exists ? snap.data() : null;
}
async function dbDel(col, id) {
  await waitAuth();
  return db.collection(col).doc(String(id)).delete();
}
async function dbAdd(col, data) {
  await waitAuth();
  return db.collection(col).add({ ...data, _createdAt: new Date().toISOString() });
}

// ---- MD5 (pure JS, matches C# MD5.HashData output) ----
function md5(input) {
  function safeAdd(x,y){const lsw=(x&0xffff)+(y&0xffff),msw=(x>>16)+(y>>16)+(lsw>>16);return(msw<<16)|(lsw&0xffff);}
  function bitRotateLeft(num,cnt){return(num<<cnt)|(num>>>(32-cnt));}
  function md5cmn(q,a,b,x,s,t){return safeAdd(bitRotateLeft(safeAdd(safeAdd(a,q),safeAdd(x,t)),s),b);}
  function md5ff(a,b,c,d,x,s,t){return md5cmn((b&c)|(~b&d),a,b,x,s,t);}
  function md5gg(a,b,c,d,x,s,t){return md5cmn((b&d)|(c&~d),a,b,x,s,t);}
  function md5hh(a,b,c,d,x,s,t){return md5cmn(b^c^d,a,b,x,s,t);}
  function md5ii(a,b,c,d,x,s,t){return md5cmn(c^(b|~d),a,b,x,s,t);}
  let str=unescape(encodeURIComponent(input));
  let m=[];
  for(let i=0;i<str.length;i++)m[i>>2]|=str.charCodeAt(i)<<((i%4)*8);
  m[str.length>>2]|=0x80<<((str.length%4)*8);
  m[(((str.length+8)>>6)<<4)+14]=str.length*8;
  let a=1732584193,b=-271733879,c=-1732584194,d=271733878;
  for(let i=0;i<m.length;i+=16){
    let [aa,bb,cc,dd]=[a,b,c,d];
    a=md5ff(a,b,c,d,m[i],7,-680876936);d=md5ff(d,a,b,c,m[i+1],12,-389564586);c=md5ff(c,d,a,b,m[i+2],17,606105819);b=md5ff(b,c,d,a,m[i+3],22,-1044525330);
    a=md5ff(a,b,c,d,m[i+4],7,-176418897);d=md5ff(d,a,b,c,m[i+5],12,1200080426);c=md5ff(c,d,a,b,m[i+6],17,-1473231341);b=md5ff(b,c,d,a,m[i+7],22,-45705983);
    a=md5ff(a,b,c,d,m[i+8],7,1770035416);d=md5ff(d,a,b,c,m[i+9],12,-1958414417);c=md5ff(c,d,a,b,m[i+10],17,-42063);b=md5ff(b,c,d,a,m[i+11],22,-1990404162);
    a=md5ff(a,b,c,d,m[i+12],7,1804603682);d=md5ff(d,a,b,c,m[i+13],12,-40341101);c=md5ff(c,d,a,b,m[i+14],17,-1502002290);b=md5ff(b,c,d,a,m[i+15],22,1236535329);
    a=md5gg(a,b,c,d,m[i+1],5,-165796510);d=md5gg(d,a,b,c,m[i+6],9,-1069501632);c=md5gg(c,d,a,b,m[i+11],14,643717713);b=md5gg(b,c,d,a,m[i],20,-373897302);
    a=md5gg(a,b,c,d,m[i+5],5,-701558691);d=md5gg(d,a,b,c,m[i+10],9,38016083);c=md5gg(c,d,a,b,m[i+15],14,-660478335);b=md5gg(b,c,d,a,m[i+4],20,-405537848);
    a=md5gg(a,b,c,d,m[i+9],5,568446438);d=md5gg(d,a,b,c,m[i+14],9,-1019803690);c=md5gg(c,d,a,b,m[i+3],14,-187363961);b=md5gg(b,c,d,a,m[i+8],20,1163531501);
    a=md5gg(a,b,c,d,m[i+13],5,-1444681467);d=md5gg(d,a,b,c,m[i+2],9,-51403784);c=md5gg(c,d,a,b,m[i+7],14,1735328473);b=md5gg(b,c,d,a,m[i+12],20,-1926607734);
    a=md5hh(a,b,c,d,m[i+5],4,-378558);d=md5hh(d,a,b,c,m[i+8],11,-2022574463);c=md5hh(c,d,a,b,m[i+11],16,1839030562);b=md5hh(b,c,d,a,m[i+14],23,-35309556);
    a=md5hh(a,b,c,d,m[i+1],4,-1530992060);d=md5hh(d,a,b,c,m[i+4],11,1272893353);c=md5hh(c,d,a,b,m[i+7],16,-155497632);b=md5hh(b,c,d,a,m[i+10],23,-1094730640);
    a=md5hh(a,b,c,d,m[i+13],4,681279174);d=md5hh(d,a,b,c,m[i],11,-358537222);c=md5hh(c,d,a,b,m[i+3],16,-722521979);b=md5hh(b,c,d,a,m[i+6],23,76029189);
    a=md5hh(a,b,c,d,m[i+9],4,-640364487);d=md5hh(d,a,b,c,m[i+12],11,-421815835);c=md5hh(c,d,a,b,m[i+15],16,530742520);b=md5hh(b,c,d,a,m[i+2],23,-995338651);
    a=md5ii(a,b,c,d,m[i],6,-198630844);d=md5ii(d,a,b,c,m[i+7],10,1126891415);c=md5ii(c,d,a,b,m[i+14],15,-1416354905);b=md5ii(b,c,d,a,m[i+5],21,-57434055);
    a=md5ii(a,b,c,d,m[i+12],6,1700485571);d=md5ii(d,a,b,c,m[i+3],10,-1894986606);c=md5ii(c,d,a,b,m[i+10],15,-1051523);b=md5ii(b,c,d,a,m[i+1],21,-2054922799);
    a=md5ii(a,b,c,d,m[i+8],6,1873313359);d=md5ii(d,a,b,c,m[i+15],10,-30611744);c=md5ii(c,d,a,b,m[i+6],15,-1560198380);b=md5ii(b,c,d,a,m[i+13],21,1309151649);
    a=md5ii(a,b,c,d,m[i+4],6,-145523070);d=md5ii(d,a,b,c,m[i+11],10,-1120210379);c=md5ii(c,d,a,b,m[i+2],15,718787259);b=md5ii(b,c,d,a,m[i+9],21,-343485551);
    a=safeAdd(a,aa);b=safeAdd(b,bb);c=safeAdd(c,cc);d=safeAdd(d,dd);
  }
  return [a,b,c,d].map(n=>(n>>>0).toString(16).padStart(8,'0').match(/../g).reverse().join('')).join('');
}

// ---- Access code check (reads settings/access_keys — public read, no auth needed) ----
async function checkAccessCode(role, plainCode) {
  try {
    const hash = md5(plainCode.trim());
    const snap = await db.collection("settings").doc("access_keys").get();
    if (!snap.exists) return false;
    const stored = snap.data()[role];
    return typeof stored === "string" && stored.toLowerCase() === hash.toLowerCase();
  } catch(e) {
    console.warn("[checkAccessCode]", e);
    return false;
  }
}

// ---- Create bot_task ----
async function createBotTask(type, data) {
  const id = type + "_" + genId();
  await dbSet("bot_tasks", id, { type, ...data, status: "pending", createdAt: new Date().toISOString() });
}

// ---- Modal helpers ----
function openModal(id) {
  document.getElementById(id)?.classList.add("open");
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove("open");
}
