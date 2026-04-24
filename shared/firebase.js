'use strict';
/* ============================================================
   DELIVERY — Shared Firebase + Utilities
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAx5hmhfSvtf57XZQEAZJYaj95iu4_zRHM",
  authDomain:        "delivery-8a607.firebaseapp.com",
  projectId:         "delivery-8a607",
  storageBucket:     "delivery-8a607.firebasestorage.app",
  messagingSenderId: "911902301431",
  appId:             "1:911902301431:web:a7a10e2ff6e58e4e97c7f2"
};

const WEBAPP_BASE = "https://mathian.github.io/Delivery";

// ── Firebase state ──
let db   = null;
let _fbR = false; // firebase ready

function initFirebase() {
  return new Promise(resolve => {
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.firestore();
      // _fbR устанавливается ТОЛЬКО после успешной авторизации.
      // Если auth зависнет — все операции упадут в localStorage-fallback, сплэш не зависнет.
      const timer = setTimeout(() => {
        console.warn('[Firebase] Auth timeout — offline mode');
        resolve();
      }, 6000);
      firebase.auth().signInAnonymously()
        .then(() => { clearTimeout(timer); _fbR = true; console.log('[Firebase] Auth OK'); resolve(); })
        .catch(e  => { clearTimeout(timer); console.warn('[Firebase] Auth fail:', e.message); resolve(); });
    } catch (e) {
      console.error('[Firebase] Init error:', e);
      resolve();
    }
  });
}

// ── Write (merge) ──
async function dbSet(col, id, data) {
  const payload = { ...data, _upd: new Date().toISOString() };
  try { localStorage.setItem(`dlv_${col}_${id}`, JSON.stringify(payload)); } catch {}
  if (!_fbR) return;
  try { await db.collection(col).doc(String(id)).set(payload, { merge: true }); }
  catch (e) { console.warn(`[DB] set ${col}/${id}:`, e.message); }
}

// ── Delete ──
async function dbDelete(col, id) {
  try { localStorage.removeItem(`dlv_${col}_${id}`); } catch {}
  if (!_fbR) return;
  try { await db.collection(col).doc(String(id)).delete(); }
  catch (e) { console.warn(`[DB] del ${col}/${id}:`, e.message); }
}

// ── Read one ──
async function dbGet(col, id) {
  if (_fbR) {
    try {
      const s = await db.collection(col).doc(String(id)).get();
      if (s.exists) {
        const d = s.data();
        try { localStorage.setItem(`dlv_${col}_${id}`, JSON.stringify(d)); } catch {}
        return d;
      }
    } catch (e) { console.warn(`[DB] get ${col}/${id}:`, e.message); }
  }
  try { const r = localStorage.getItem(`dlv_${col}_${id}`); return r ? JSON.parse(r) : null; }
  catch { return null; }
}

// ── Query ──
async function dbQuery(col, field, op, value) {
  if (_fbR) {
    try {
      const snap = await db.collection(col).where(field, op, value).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] query ${col}:`, e.message); }
  }
  return [];
}

// ── Ordered query ──
async function dbQueryOrdered(col, field, op, value, orderBy, dir = 'desc', lim = 100) {
  if (_fbR) {
    try {
      let q = db.collection(col).where(field, op, value).orderBy(orderBy, dir);
      if (lim) q = q.limit(lim);
      const snap = await q.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] qOrdered ${col}:`, e.message); }
  }
  return [];
}

// ── Get all docs ──
async function dbGetAll(col, orderBy = null, dir = 'desc', lim = 200) {
  if (_fbR) {
    try {
      let q = db.collection(col);
      if (orderBy) q = q.orderBy(orderBy, dir);
      if (lim) q = q.limit(lim);
      const snap = await q.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] getAll ${col}:`, e.message); }
  }
  return [];
}

// ── Real-time doc listener ──
function onDocSnap(col, id, cb) {
  if (_fbR) {
    try {
      return db.collection(col).doc(String(id)).onSnapshot(
        s => cb(s.exists ? { id: s.id, ...s.data() } : null),
        e => console.warn('[DB] docSnap:', e.message)
      );
    } catch {}
  }
  let last = null;
  const t = setInterval(async () => {
    const d = await dbGet(col, id);
    const j = JSON.stringify(d);
    if (j !== last) { last = j; cb(d); }
  }, 2000);
  return () => clearInterval(t);
}

// ── Real-time query listener ──
function onQuerySnap(col, field, op, value, cb) {
  if (_fbR) {
    try {
      return db.collection(col).where(field, op, value).onSnapshot(
        s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
        e => console.warn('[DB] qSnap:', e.message)
      );
    } catch {}
  }
  const t = setInterval(async () => cb(await dbQuery(col, field, op, value)), 2000);
  return () => clearInterval(t);
}

// ── Real-time collection listener ──
function onColSnap(col, cb, orderBy = null, dir = 'desc') {
  if (_fbR) {
    try {
      let q = db.collection(col);
      if (orderBy) q = q.orderBy(orderBy, dir);
      return q.onSnapshot(
        s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))),
        e => console.warn('[DB] colSnap:', e.message)
      );
    } catch {}
  }
  const t = setInterval(async () => cb(await dbGetAll(col, orderBy, dir)), 3000);
  return () => clearInterval(t);
}

// ── Generate order ID ──
function genOrderId() {
  return Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}

// ─────────────────────── Sound ───────────────────────
let _audioCtx = null;
function _getCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function _tone(freq = 800, dur = 0.18, vol = 0.3) {
  try {
    const ctx = _getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch {}
}
function playBeep()    { _tone(700, .18, .4); setTimeout(() => _tone(900, .14, .3), 220); }
function playSuccess() { _tone(600, .1); setTimeout(() => _tone(800, .1), 150); setTimeout(() => _tone(1000, .22), 300); }
function playAlert()   { for (let i = 0; i < 3; i++) setTimeout(() => _tone(550, .1, .5), i * 200); }
function playNewOrder(){ _tone(800, .1,.5);setTimeout(()=>_tone(800,.1,.5),150);setTimeout(()=>_tone(1000,.2,.5),350); }

// ─────────────────────── Format helpers ───────────────────────
function fmtPrice(n)  { return Number(n || 0).toLocaleString('ru-RU') + ' ₸'; }
function fmtDate(ts)  {
  if (!ts) return '';
  const d = (ts?.toDate ? ts.toDate() : new Date(ts));
  return d.toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' }) + ' ' +
         d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}
function fmtTime(ts) {
  if (!ts) return '';
  const d = (ts?.toDate ? ts.toDate() : new Date(ts));
  return d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}
function fmtCountdown(ms) {
  if (ms <= 0) return '00:00';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function statusLabel(st) {
  return { pending:'Ожидает', accepted:'Принят', cooking:'Готовится', delivering:'Доставляется', delivered:'Доставлен', cancelled:'Отменён' }[st] || st;
}
function statusBadgeClass(st) {
  return `badge badge-${st === 'accepted' || st === 'cooking' ? 'accepted' : st}`;
}

// ─────────────────────── Telegram WebApp ───────────────────────
const tg = window.Telegram?.WebApp || null;
function tgReady()   { try { tg?.ready(); tg?.expand(); } catch {} }
function tgHaptic(t='light') { try { tg?.HapticFeedback?.impactOccurred(t); } catch {} }

// ─────────────────────── State helpers ───────────────────────
// Each app defines its own STATE and uses these helpers
function readUidFromUrl() {
  const p = new URLSearchParams(location.search);
  const uid = p.get('uid');
  if (uid && uid.length === 64) {
    history.replaceState(null, '', location.pathname);
    return uid;
  }
  return null;
}

// ─────────────────────── Heartbeat ───────────────────────
function startHeartbeat(uid) {
  const send = () => {
    if (uid && _fbR) dbSet('users', uid, { webAppLastSeen: new Date().toISOString() });
  };
  send();
  setInterval(send, 5000);
}

// ─────────────────────── Screen helper ───────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

// ─────────────────────── Toast ───────────────────────
function showToast(msg, type = 'info', dur = 3000) {
  let t = document.getElementById('_toast');
  if (!t) {
    t = document.createElement('div');
    t.id = '_toast';
    t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;width:calc(100% - 40px);max-width:360px;';
    document.body.appendChild(t);
  }
  const item = document.createElement('div');
  const colors = { info:'#3b82f6', success:'#22c55e', warning:'#f59e0b', error:'#ef4444' };
  item.style.cssText = `background:rgba(26,26,36,.98);border:1px solid ${colors[type]||colors.info}40;border-left:3px solid ${colors[type]||colors.info};border-radius:10px;padding:12px 16px;font-size:13px;font-weight:500;color:#f0f0f5;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:toastIn .25s ease;`;
  item.textContent = msg;
  t.appendChild(item);
  setTimeout(() => { item.style.opacity='0'; item.style.transform='translateY(-8px)'; item.style.transition='all .25s'; setTimeout(()=>item.remove(),250); }, dur);
}
// inject toast animation once
const _toastStyle = document.createElement('style');
_toastStyle.textContent = '@keyframes toastIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}';
document.head.appendChild(_toastStyle);
