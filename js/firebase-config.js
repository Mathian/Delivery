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
const _authReady = new Promise(resolve => {
  auth.onAuthStateChanged(u => { if (u) { _authUser = u; resolve(u); } });
});
auth.signInAnonymously().catch(console.error);

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

// ---- Session auth helpers (for staff apps) ----
async function verifySession(expectedRole) {
  const params = new URLSearchParams(location.search);
  let token = params.get("token") || sessionStorage.getItem("delivery_session");
  if (!token) return null;

  // Clean token from URL bar
  if (params.get("token")) {
    sessionStorage.setItem("delivery_session", token);
    history.replaceState(null, "", location.pathname);
  }

  await waitAuth();
  const session = await dbGet("sessions", token);
  if (!session) return null;
  if (session.role !== expectedRole) return null;

  const expires = new Date(session.expiresAt);
  if (Date.now() > expires.getTime()) {
    sessionStorage.removeItem("delivery_session");
    return null;
  }
  return session; // { tgId, role, name, expiresAt }
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
