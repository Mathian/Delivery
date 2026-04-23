/* ============================================================
   GEO — Geolocation transmit & arrival sound
   ============================================================ */

let geoWatchId = null;
let arrivalSoundInterval = null;

// ---- Geo toggle ----
function toggleGeo() {
  STATE.geoEnabled = !STATE.geoEnabled;
  const el = document.getElementById('geo-toggle');
  if (el) el.classList.toggle('on', STATE.geoEnabled);
  saveState();
  showToast(STATE.geoEnabled ? '📍 Геолокация включена' : 'Геолокация выключена');
}

// ---- Start transmitting passenger location to order doc ----
function startGeoTransmit(orderId) {
  if (!STATE.geoEnabled || !orderId || geoWatchId !== null || !navigator.geolocation) return;
  geoWatchId = navigator.geolocation.watchPosition(
    pos => {
      dbSet('orders', orderId, {
        passengerGeo: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        geoUpdatedAt: new Date().toISOString()
      });
    },
    err => console.warn('[GEO] error:', err.message),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
  );
}

function stopGeoTransmit() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

// ---- Arrival sound (Web Audio API beep every 2s) ----
function startArrivalSound() {
  stopArrivalSound();
  playBeep();
  arrivalSoundInterval = setInterval(playBeep, 2000);
}

function stopArrivalSound() {
  if (arrivalSoundInterval) {
    clearInterval(arrivalSoundInterval);
    arrivalSoundInterval = null;
  }
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.45);
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1000);
  } catch (e) {}
}

// ---- New order sound (single chime for driver) ----
function playNewOrderBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [660, 880, 1100].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const t = ctx.currentTime + i * 0.12;
      gain.gain.setValueAtTime(0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      osc.start(t); osc.stop(t + 0.25);
    });
    setTimeout(() => { try { ctx.close(); } catch (e) {} }, 1500);
  } catch (e) {}
}
