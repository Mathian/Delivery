let db = null;
let isFirebaseReady = false;

function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    isFirebaseReady = true;
    firebase.auth().signInAnonymously()
      .then(() => console.log('[DB] Auth OK'))
      .catch(e => console.warn('[DB] Auth:', e.message));
  } catch (e) {
    console.error('[DB] Init error:', e);
  }
}

async function dbSet(col, docId, data) {
  const payload = { ...data, _updatedAt: new Date().toISOString() };
  try { localStorage.setItem(`dl_${col}_${docId}`, JSON.stringify(payload)); } catch {}
  if (!isFirebaseReady) return;
  try { await db.collection(col).doc(String(docId)).set(payload, { merge: true }); }
  catch (e) { console.warn(`[DB] set error [${col}/${docId}]:`, e.message); }
}

async function dbGet(col, docId) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).doc(String(docId)).get();
      if (snap.exists) {
        const data = snap.data();
        try { localStorage.setItem(`dl_${col}_${docId}`, JSON.stringify(data)); } catch {}
        return data;
      }
    } catch (e) { console.warn(`[DB] get error:`, e.message); }
  }
  try {
    const raw = localStorage.getItem(`dl_${col}_${docId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function dbDelete(col, docId) {
  try { localStorage.removeItem(`dl_${col}_${docId}`); } catch {}
  if (!isFirebaseReady) return;
  try { await db.collection(col).doc(String(docId)).delete(); }
  catch (e) { console.warn(`[DB] delete error:`, e.message); }
}

async function dbQuery(col, field, op, value) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).where(field, op, value).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] query error:`, e.message); }
  }
  return [];
}

async function dbQueryAll(col) {
  if (isFirebaseReady) {
    try {
      const snap = await db.collection(col).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] queryAll error:`, e.message); }
  }
  return [];
}

async function dbQueryMulti(col, conditions) {
  if (isFirebaseReady) {
    try {
      let ref = db.collection(col);
      for (const [field, op, val] of conditions) ref = ref.where(field, op, val);
      const snap = await ref.get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { console.warn(`[DB] queryMulti error:`, e.message); }
  }
  return [];
}

function onSnapshotQuery(col, field, op, value, cb) {
  if (isFirebaseReady) {
    try {
      return db.collection(col).where(field, op, value).onSnapshot(
        snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        e => console.warn('[DB] snapshot error:', e)
      );
    } catch {}
  }
  const poll = setInterval(async () => cb(await dbQuery(col, field, op, value)), 3000);
  return () => clearInterval(poll);
}

function onDocSnapshot(col, docId, cb) {
  if (isFirebaseReady) {
    try {
      return db.collection(col).doc(String(docId)).onSnapshot(
        snap => { if (snap.exists) cb({ id: snap.id, ...snap.data() }); },
        e => console.warn('[DB] docSnapshot error:', e)
      );
    } catch {}
  }
  const poll = setInterval(async () => {
    const d = await dbGet(col, docId);
    if (d) cb({ id: docId, ...d });
  }, 2000);
  return () => clearInterval(poll);
}

async function dbAddTask(type, data) {
  const taskId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  await dbSet('bot_tasks', taskId, { taskId, type, status: 'pending', createdAt: new Date().toISOString(), ...data });
  return taskId;
}

function startHeartbeat(uid) {
  const send = () => { if (uid) dbSet('users', uid, { webAppLastSeen: new Date().toISOString() }); };
  send();
  return setInterval(send, 5000);
}
