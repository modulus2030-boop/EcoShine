/*
 * EcoWash - Real-time Matching & Tracking Engine
 * -------------------------------------------------
 * Implements a Yango-style ride-hailing workflow for mobile car washes:
 *   Customer books  -> live washer GPS streams -> nearest-washer dispatch
 *   -> status pipeline -> real-time customer tracking (onSnapshot) + ETA.
 *
 * Depends on: firebase.js (window.firebaseService => db, auth),
 *             window.ECOWASH_CONFIG.
 */
const EcoWash = (() => {
  const db = firebase.firestore();
  const auth = firebase.auth();
  const functions = (typeof firebase.functions === 'function') ? firebase.functions() : null;
  const FieldValue = firebase.firestore.FieldValue;
  const GeoPoint = firebase.firestore.GeoPoint;

  const cfg = window.ECOWASH_CONFIG || {
    functionsRegion: 'us-central1',
    countryCenter: { lat: -22.56, lng: 17.47 },
    countryZoom: 6
  };

  // --- Booking status pipeline (Step 3,4,7,8,9) ---
  const STATUS = {
    WAITING: 'Waiting',
    SEARCHING: 'Searching',
    ASSIGNED: 'Assigned',
    EN_ROUTE: 'EnRoute',
    ARRIVED: 'Arrived',
    WASHING: 'Washing',
    COMPLETED: 'Completed',
    CANCELLED: 'Cancelled'
  };

  const GEO = {
    EARTH_RADIUS_M: 6371000,
    AVG_CITY_SPEED_KMH: 40 // assumed average city driving speed for ETA estimates
  };

  /* ---------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------- */

  // Haversine great-circle distance in metres (Step 3/4 math fallback).
  function haversine(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return GEO.EARTH_RADIUS_M * c;
  }

  // Heading (degrees, 0=N, 90=E) from point A to point B.
  function bearing(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const y = Math.sin(toRad(lng2) - toRad(lng1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2) - toRad(lng1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Rough driving-time estimate from straight-line distance.
  // Uses a fixed average city driving speed (GEO.AVG_CITY_SPEED_KMH = 40 km/h).
  function estimateEtaMinutes(distanceMeters) {
    const avgSpeedMps = GEO.AVG_CITY_SPEED_KMH * 1000 / 3600; // km/h -> m/s
    return Math.max(1, Math.round(distanceMeters / avgSpeedMps / 60));
  }

  /* ---------------------------------------------------------------
   * STEP 1 - Customer request
   * ------------------------------------------------------------- */
  async function createBooking({
    customerId,
    customerLocation, // { lat, lng }
    customerLocationName = '',
    customerLocationLabel = '',
    customerLocationDetail = '',
    service,
    vehicle = '',
    address = '',
    area = '',
    notes = '',
    date = '',
    time = '',
    payment = '',
    price = 0
  }) {
    if (!customerId) {
      const user = auth.currentUser;
      customerId = user ? user.uid : null;
    }
    if (!customerId || !customerLocation) {
      return { success: false, error: 'Missing customerId or location.' };
    }

    try {
      const ref = await db.collection('bookings').add({
        customerId,
        customerLoc: { lat: customerLocation.lat, lng: customerLocation.lng },
        customerLocation: new GeoPoint(customerLocation.lat, customerLocation.lng),
        customerLocationName,
        customerLocationLabel,
        customerLocationDetail,
        washerLoc: null,
        washerLocation: null,
        washerId: null,
        service,
        vehicle,
        address,
        area,
        notes,
        date,
        time,
        payment,
        price: price || 0,
        status: STATUS.WAITING,
        offerStatus: 'pending',
        skipList: [],
        metrics: {
          distance: 0,
          eta: 0,
          basePrice: 0,
          totalPaid: 0
        },
        createdAt: FieldValue.serverTimestamp()
      });
      return { success: true, id: ref.id };
    } catch (error) {
      console.error('createBooking error:', error);
      return { success: false, error: error.message };
    }
  }

  /* ---------------------------------------------------------------
   * STEP 2 - Live washer GPS stream (called by the worker app)
   * ------------------------------------------------------------- */
  function startWasherLocationStream(washerId, { available = true } = {}) {
    if (!washerId || !navigator.geolocation) return null;

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        try {
          await db.collection('liveLocations').doc(washerId).set(
            {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              heading: pos.coords.heading || bearingToLast(washerId, pos.coords),
              speed: pos.coords.speed || 0,
              available,
              online: true,
              timestamp: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          await db.collection('washers').doc(washerId).set(
            {
              status: available ? 'available' : 'offline',
              lastLocation: { lat: pos.coords.latitude, lng: pos.coords.longitude },
              lastUpdatedAt: FieldValue.serverTimestamp()
            },
            { merge: true }
          );
        } catch (e) {
          console.error('liveLocation write error:', e);
        }
      },
      (err) => console.error('watchPosition error:', err),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );

    return watchId;
  }

  // Track last position per washer to derive heading when the device lacks it.
  const _lastPos = {};
  function bearingToLast(washerId, pos) {
    const prev = _lastPos[washerId];
    _lastPos[washerId] = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (!prev) return 0;
    return bearing(prev.lat, prev.lng, pos.coords.latitude, pos.coords.longitude);
  }

  function stopWasherLocationStream(watchId, washerId) {
    if (watchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    if (washerId) {
      db.collection('liveLocations').doc(washerId).update({
        online: false,
        available: false,
        timestamp: FieldValue.serverTimestamp()
      }).catch(() => {});
      db.collection('washers').doc(washerId).set({
        status: 'offline',
        lastUpdatedAt: FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
    }
  }

  /* ---------------------------------------------------------------
   * STEP 3 & 4 - Matching engine (Haversine / Distance Matrix)
   * ------------------------------------------------------------- */
  async function getAvailableWashers() {
    const snap = await db
      .collection('liveLocations')
      .where('available', '==', true)
      .where('online', '==', true)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  // ETA / distance using the Haversine formula only (no external APIs).
  // Returns straight-line distance in km + an approximate driving ETA at
  // the fixed average city speed.
  function getEta(originLat, originLng, destLat, destLng) {
    const meters = haversine(originLat, originLng, destLat, destLng);
    const km = meters / 1000;
    return {
      km: Math.round(km * 10) / 10,
      meters: Math.round(meters),
      minutes: estimateEtaMinutes(meters),
      source: 'haversine'
    };
  }

  // Pick the nearest available washer to the customer and assign the job.
  async function dispatchNearestWasher(bookingId) {
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) return { matched: false, reason: 'no-booking' };

    const booking = bookingDoc.data();
    if (booking.status === STATUS.COMPLETED || booking.status === STATUS.CANCELLED) {
      return { matched: false, reason: 'terminal' };
    }

    // Mark as searching so the UI shows the pipeline progressing.
    if (booking.status === STATUS.WAITING) {
      await bookingRef.update({ status: STATUS.SEARCHING, searchStartedAt: FieldValue.serverTimestamp() });
    }

    const washers = await getAvailableWashers();
    if (washers.length === 0) {
      // No washers online yet - leave in "Searching" and let a later
      // trigger (e.g. onWasherOnline) retry.
      return { matched: false, reason: 'no-washers' };
    }

    const c = booking.customerLocation; // GeoPoint
    const cLat = c.latitude, cLng = c.longitude;

    let nearest = null;
    let nearestDist = Infinity;
    washers.forEach((w) => {
      const d = haversine(cLat, cLng, w.lat, w.lng);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = w;
      }
    });

    if (!nearest) return { matched: false, reason: 'no-washers' };

    const eta = getEta(nearest.lat, nearest.lng, cLat, cLng);

    await bookingRef.update({
      status: STATUS.ASSIGNED,
      washerId: nearest.id,
      washerLocation: new GeoPoint(nearest.lat, nearest.lng),
      distance: eta.meters,
      distanceKm: eta.km,
      etaMinutes: eta.minutes,
      assignedAt: FieldValue.serverTimestamp()
    });

    // Notify the washer (FCM, routed through a Cloud Function).
    await notifyWasher(nearest.id, {
      bookingId,
      title: 'New job assigned',
      body: `${booking.service || 'Car wash'} - ETA ${eta.minutes} min`
    }).catch((e) => console.warn('notifyWasher failed:', e));

    return { matched: true, washerId: nearest.id, eta };
  }

  // Retry dispatch when a washer comes online (called from onWasherOnline).
  async function retryPendingDispatch() {
    const snap = await db
      .collection('bookings')
      .where('status', 'in', [STATUS.WAITING, STATUS.SEARCHING])
      .where('washerId', '==', null)
      .get();
    for (const doc of snap.docs) {
      dispatchNearestWasher(doc.id).catch(() => {});
    }
  }

  /* ---------------------------------------------------------------
   * STEP 5 & 6 - Real-time tracking (onSnapshot) + ETA refresh
   * ------------------------------------------------------------- */
  // Subscribes to the booking doc only. The backend owns the live location
  // and ETA fields, so the client just reacts to booking document changes.
  function startCustomerTracking(bookingId, callbacks = {}) {
    const bookingRef = db.collection('bookings').doc(bookingId);

    const bookingUnsub = bookingRef.onSnapshot((doc) => {
      const data = doc.data();
      if (!data) return;
      callbacks.onUpdate && callbacks.onUpdate(data);

      const washerLoc = data.washerLoc || data.washerLocation;
      if (washerLoc && [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING, STATUS.COMPLETED].includes(data.status)) {
        const move = {
          lat: washerLoc.latitude != null ? washerLoc.latitude : washerLoc.lat,
          lng: washerLoc.longitude != null ? washerLoc.longitude : washerLoc.lng
        };
        if (move.lat != null && move.lng != null) {
          callbacks.onWasherMove && callbacks.onWasherMove(move);
        }
      }
    }, (err) => {
      console.error('booking listener error:', err);
      callbacks.onError && callbacks.onError(err);
    });

    return () => {
      bookingUnsub && bookingUnsub();
    };
  }

  async function refreshEta(bookingRef, washer, customerLocation) {
    const c = customerLocation; // GeoPoint
    const eta = getEta(washer.lat, washer.lng, c.latitude, c.longitude);
    await bookingRef.update({
      washerLocation: new GeoPoint(washer.lat, washer.lng),
      washerLoc: { lat: washer.lat, lng: washer.lng },
      'metrics.distance': eta.meters,
      'metrics.eta': eta.minutes,
      lastEtaAt: FieldValue.serverTimestamp()
    });
  }

  // Convenience: subscribe to all of a washer's active bookings (worker view).
  function trackWasherBookings(washerId, onSnapshot) {
    return db
      .collection('bookings')
      .where('washerId', '==', washerId)
      .where('status', 'in', [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING])
      .onSnapshot(onSnapshot, (e) => console.error('washer bookings listener:', e));
  }

  /* ---------------------------------------------------------------
   * STEP 7 - External navigation (Google Maps)
   * ------------------------------------------------------------- */
  function openNavigation(lat, lng, label = '') {
    const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving` +
      (label ? `&destination_place_id=${encodeURIComponent(label)}` : '');
    window.open(url, '_blank');
    return url;
  }

  /* ---------------------------------------------------------------
   * STEP 8 & 9 - Status transitions + FCM notifications
   * ------------------------------------------------------------- */
  async function updateBookingStatus(bookingId, status, extra = {}) {
    try {
      await db.collection('bookings').doc(bookingId).update({
        status,
        ...extra,
        lastStatusAt: FieldValue.serverTimestamp()
      });
      return { success: true };
    } catch (e) {
      console.error('updateBookingStatus error:', e);
      return { success: false, error: e.message };
    }
  }

  async function acceptBooking(bookingId) {
    try {
      if (!functions || typeof functions.httpsCallable !== 'function') {
        return { success: false, error: 'functions-unavailable' };
      }
      const callable = functions.httpsCallable('acceptBooking');
      const result = await callable({ bookingId });
      return result.data;
    } catch (e) {
      console.error('acceptBooking error:', e);
      return { success: false, error: e.message };
    }
  }

  async function completeBooking(bookingId) {
    try {
      if (!functions || typeof functions.httpsCallable !== 'function') {
        return { success: false, error: 'functions-unavailable' };
      }
      const callable = functions.httpsCallable('completeBooking');
      const result = await callable({ bookingId });
      return result.data;
    } catch (e) {
      console.error('completeBooking error:', e);
      return { success: false, error: e.message };
    }
  }

  async function submitRating({ bookingId, reviewerId, reviewerRole, rating, comment = '' }) {
    try {
      if (!bookingId || !reviewerId) return { success: false, error: 'missing-args' };
      if (functions && typeof functions.httpsCallable === 'function') {
        const callable = functions.httpsCallable('submitRating');
        const result = await callable({
          bookingId,
          reviewerId,
          reviewerRole,
          rating: Number(rating),
          comment
        });
        return { success: true, data: result.data };
      }
      return { success: false, error: 'rating-callable-unavailable' };
    } catch (e) {
      console.error('submitRating error:', e);
      return { success: false, error: e.message };
    }
  }

  function promptRating({ bookingId, reviewerId, reviewerRole = 'customer', bookingData = {} }) {
    if (!bookingId || !reviewerId) return null;
    const docRef = db.collection('bookings').doc(bookingId);
    const modalId = `rating-modal-${bookingId}`;
    if (document.getElementById(modalId)) return null;

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(2,6,23,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:1rem;';
    modal.innerHTML = `
      <div style="width:min(100%,420px);background:rgba(15,23,42,0.95);border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,0.35);">
        <h3 style="margin:0 0 0.5rem;font-size:1.15rem;color:white;">How was your EcoShine?</h3>
        <p style="margin:0 0 1rem;color:#94a3b8;font-size:0.95rem;">Leave a quick rating so we can keep the network reliable.</p>
        <div id="rating-stars-${bookingId}" style="display:flex;gap:0.35rem;font-size:2rem;color:#f59e0b;cursor:pointer;margin-bottom:1rem;"></div>
        <textarea id="rating-comment-${bookingId}" rows="3" style="width:100%;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.05);color:white;border-radius:12px;padding:0.75rem;resize:none;" placeholder="Optional feedback"></textarea>
        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1rem;">
          <button type="button" id="rating-cancel-${bookingId}" style="padding:0.7rem 1rem;border-radius:999px;border:1px solid rgba(255,255,255,0.1);color:#cbd5e1;background:transparent;">Skip</button>
          <button type="button" id="rating-submit-${bookingId}" style="padding:0.7rem 1rem;border-radius:999px;border:none;background:#10b981;color:white;">Submit</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const starsEl = modal.querySelector(`#rating-stars-${bookingId}`);
    let selected = 5;
    const renderStars = () => {
      starsEl.innerHTML = Array.from({ length: 5 }, (_, index) => `<span data-value="${index + 1}" style="opacity:${index + 1 <= selected ? 1 : 0.35}">★</span>`).join('');
    };
    renderStars();
    starsEl.addEventListener('click', (event) => {
      const value = Number(event.target.dataset.value || 0);
      if (value) {
        selected = value;
        renderStars();
      }
    });
    modal.querySelector(`#rating-cancel-${bookingId}`).addEventListener('click', () => {
      modal.remove();
      docRef.update({ ratingPromptShown: true }).catch(() => {});
    });
    modal.querySelector(`#rating-submit-${bookingId}`).addEventListener('click', async () => {
      const comment = modal.querySelector(`#rating-comment-${bookingId}`).value;
      await submitRating({ bookingId, reviewerId, reviewerRole, rating: selected, comment });
      modal.remove();
    });
    return modal;
  }

  // Send an FCM notification. In a browser a client cannot mint server
  // tokens, so this POSTs to a Cloud Function (see functions/index.js).
  async function notifyUser(targetUid, payload) {
    return notify(targetUid, payload, 'users');
  }
  async function notifyWasher(targetUid, payload) {
    return notify(targetUid, payload, 'washers');
  }
  async function notify(targetUid, payload, collection) {
    try {
      const res = await fetch(
        `https://${cfg.functionsRegion}-${firebase.app().options.projectId}.cloudfunctions.net/sendNotification`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetUid, collection, ...payload })
        }
      );
      return await res.json();
    } catch (e) {
      console.warn('notify failed (is the Cloud Function deployed?):', e);
      return { success: false, error: e.message };
    }
  }

  // Register this device for FCM and store the token on the user/washer doc.
  async function initFCM(uid, collection = 'users') {
    if (!firebase.messaging) return { success: false, error: 'messaging not available' };
    try {
      const messaging = firebase.messaging();
      await messaging.requestPermission();
      const token = await messaging.getToken();
      if (token) {
        await db.collection(collection).doc(uid).set({ fcmToken: token }, { merge: true });
      }
      messaging.onMessage((payload) => {
        console.log('FCM message received:', payload);
        if (payload.notification) {
          new Notification(payload.notification.title || 'EcoWash', {
            body: payload.notification.body || ''
          });
        }
      });
      return { success: true, token };
    } catch (e) {
      console.warn('FCM init failed:', e);
      return { success: false, error: e.message };
    }
  }

  return {
    STATUS,
    haversine,
    bearing,
    createBooking,
    startWasherLocationStream,
    stopWasherLocationStream,
    getAvailableWashers,
    getEta,
    dispatchNearestWasher,
    retryPendingDispatch,
    startCustomerTracking,
    trackWasherBookings,
    openNavigation,
    updateBookingStatus,
    acceptBooking,
    completeBooking,
    submitRating,
    promptRating,
    notifyUser,
    notifyWasher,
    initFCM
  };
})();

window.EcoWash = EcoWash;
