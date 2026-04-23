/* ============================================================
   DB — Firebase helpers with localStorage fallback
   ============================================================ */

let db = null;
let isFirebaseReady = false;

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    // Enable offline persistence for better reliability
    db.enablePersistence({ synchronizeTabs: true }).catch(e => {
      if (e.code !== 'failed-precondition' && e.code !== 'unimplemented') {
        console.warn('Persistence:', e.code);
      }
    });
    isFirebaseReady = true;
    firebase.auth().signInAnonymously()
      .then(() => console.log('[DB] Firebase Auth: OK'))
      .catch(e => console.warn('[DB] Auth warn:', e.message));
  } catch (e) {
    console.error('[DB] Firebase init error:', e);
    isFirebaseReady = false;
  }
}

/* ---------- Write ---------- */
async function dbSet(col, docId, data) {
  const payload = { ...data, _updatedAt: new Date().toISOString() };
  // Always save to localStorage as fallback
  try { localStorage.setItem(`tt_${col}_${docId}`, JSON.stringify(payload)); } catch (e) {}
  if (!isFirebaseReady) return;
  try {
    await db.collection(col).doc(String(docId)).set(payload, { merge: true });
  } catch (e) {
    console.warn(`[DB] write error [${col}/${docId}]:`, e.message);
  }
}

/* ---------- Delete ---------- */
async function dbDelete(col, docId) {
  try { localStorage.removeItem(`tt_${col}_${docId}`); } catch (e) {}
  if (!isFirebaseReady) return;
  try {
    await db.collection(col).doc(String(docId)).delete();
  } catch (e) {
    console.warn(`[DB] delete error [${col}/${docId}]:`, e.message);
  }
}

/* ---------- Read one ---------- */
async function dbGet(col, docId) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).doc(String(docId)).get();
      if (snap.exists) {
        const data = snap.data();
        try { localStorage.setItem(`tt_${col}_${docId}`, JSON.stringify(data)); } catch (e) {}
        return data;
      }
    } catch (e) {
      console.warn(`[DB] read error [${col}/${docId}]:`, e.message);
    }
  }
  try {
    const raw = localStorage.getItem(`tt_${col}_${docId}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

/* ---------- Query ---------- */
async function dbQuery(col, field, op, value) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).where(field, op, value).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
      console.warn(`[DB] query error [${col}]:`, e.message);
    }
  }
  // localStorage fallback
  const results = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(`tt_${col}_`)) continue;
    try {
      const doc = JSON.parse(localStorage.getItem(key));
      if (doc && evalOp(doc[field], op, value)) {
        results.push({ id: key.replace(`tt_${col}_`, ''), ...doc });
      }
    } catch (e) {}
  }
  return results;
}

function evalOp(a, op, b) {
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  if (op === 'in') return Array.isArray(b) && b.includes(a);
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  return false;
}

/* ---------- Real-time query listener ---------- */
function onSnapshotQuery(col, field, op, value, cb) {
  if (isFirebaseReady) {
    try {
      return db.collection(col).where(field, op, value).onSnapshot(snap => {
        cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }, e => console.warn('[DB] snapshot error:', e));
    } catch (e) {}
  }
  // Polling fallback
  const poll = setInterval(async () => { cb(await dbQuery(col, field, op, value)); }, 3000);
  return () => clearInterval(poll);
}

/* ---------- Real-time doc listener ---------- */
function onDocSnapshot(col, docId, cb) {
  if (isFirebaseReady) {
    try {
      return db.collection(col).doc(String(docId)).onSnapshot(snap => {
        if (snap.exists) cb({ id: snap.id, ...snap.data() });
      }, e => console.warn('[DB] docSnapshot error:', e));
    } catch (e) {}
  }
  const poll = setInterval(async () => {
    const doc = await dbGet(col, docId);
    if (doc) cb({ id: docId, ...doc });
  }, 2000);
  return () => clearInterval(poll);
}

/* ---------- Atomic increment (server-side) ---------- */
async function dbIncrement(col, docId, field, delta = 1) {
  if (isFirebaseReady) {
    try {
      await db.collection(col).doc(String(docId)).update({
        [field]: firebase.firestore.FieldValue.increment(delta),
        _updatedAt: new Date().toISOString()
      });
      return;
    } catch (e) {
      console.warn(`[DB] increment error [${col}/${docId}.${field}]:`, e.message);
    }
  }
  // Fallback: get + set
  const doc = await dbGet(col, docId);
  if (doc) {
    await dbSet(col, docId, { [field]: (doc[field] || 0) + delta });
  }
}
