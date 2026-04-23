/* ============================================================
   STATE — Global application state + persistence
   ============================================================ */

let STATE = {
  // Identity
  uid: null,          // HMAC-SHA256 hash of phone — permanent account ID

  // Registration
  registered: false,
  role: 'passenger',
  user: null,

  // Onboarding
  obRole: '',

  // Active order (passenger)
  activeOrderId: null,

  // Active order (driver)
  driverActiveOrderId: null,

  // Address targets
  addrTarget: '',

  // Ride preferences
  fromAddr: null,
  toAddr: null,
  icFromAddr: null,
  icToAddr: null,
  pax: 1,
  childSeat: false,
  payMethod: 'cash',

  // Geo
  geoEnabled: false,

  // Driver
  driverMode: 'city',        // 'city' | 'intercity'
  shiftActive: false,
  shiftUntil: null,
  shiftTrips: 0,
  paidToday: null,           // Date string for paid shift tracking

  // Bonus system
  bonusSystemEnabled: false,

  // Rating
  ratingFor: null,
  ratingOrderId: null,
  currentRating: 0,

  // Offer modal
  currentOfferOrderId: null,

  // Intercity
  icDate: null,
  icTime: null,
  icType: 0,

  // Chat
  supportChatFrom: null,

  // Intercity contact
  icContactOrderId: null,
};

function saveState() {
  try { localStorage.setItem('tt_state', JSON.stringify(STATE)); } catch (e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem('tt_state');
    if (raw) STATE = { ...STATE, ...JSON.parse(raw) };
  } catch (e) {}
}
