/*
 * EcoShine - Firebase Cloud Functions
 * ----------------------------------
 * Server-authoritative lifecycle for the nationwide mobile car wash platform.
 * The frontend stays presentation-only and streams location updates while the
 * backend performs dispatch, assignment, ETA updates, completion invoicing,
 * and rating submission.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;
const AVG_CITY_SPEED_KMH = 40;

const STATUS = {
  WAITING: 'Waiting',
  SEARCHING: 'Searching',
  ASSIGNED: 'Assigned',
  EN_ROUTE: 'EnRoute',
  ARRIVED: 'Arrived',
  WASHING: 'Washing',
  COMPLETED: 'Completed'
};

function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateEtaMinutes(distanceMeters) {
  const avgSpeedMps = (AVG_CITY_SPEED_KMH * 1000) / 3600;
  return Math.max(1, Math.round(distanceMeters / avgSpeedMps / 60));
}

function normalizeCoords(value) {
  if (!value) return null;
  const lat = value.lat != null ? value.lat : value.latitude;
  const lng = value.lng != null ? value.lng : value.longitude;
  if (lat == null || lng == null) return null;
  return { lat: Number(lat), lng: Number(lng) };
}

function getBookingCoords(booking) {
  return normalizeCoords(booking.customerLoc || booking.customerLocation);
}

function getWasherCoords(location) {
  return normalizeCoords(location);
}

function getActiveBookingStatuses() {
  return [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING];
}

function getVehicleBasePrice(booking) {
  const vehicle = (booking.vehicle || booking.vehicleType || '').toLowerCase();
  const baseMap = {
    hatchback: 160,
    sedan: 160,
    suv: 240,
    bakkie: 240,
    van: 300,
    motorcycle: 90,
    fleet: 360,
    other: 180
  };
  const service = (booking.service || booking.packageName || '').toLowerCase();
  const surchargeMap = {
    express: 0,
    premium: 50,
    interior: 70,
    detailing: 100,
    deluxe: 80
  };
  const base = baseMap[vehicle] || booking.basePrice || booking.price || 180;
  const surcharge = surchargeMap[service] || 0;
  return { basePrice: base + surcharge, surcharge };
}

async function sendNotificationToUid(targetUid, collection, title, body, data = {}) {
  try {
    const doc = await db.collection(collection).doc(targetUid).get();
    const token = doc.exists ? doc.data().fcmToken : null;
    if (!token) return { success: false, error: 'no token' };
    await admin.messaging().send({
      token,
      notification: { title, body },
      data,
      webpush: { fcmOptions: { link: 'https://ecowash.web.app/' } }
    });
    return { success: true };
  } catch (error) {
    console.warn('Notification error:', error);
    return { success: false, error: error.message };
  }
}

async function dispatchBooking(bookingId, options = {}) {
  const skipWasherId = options.skipWasherId || null;
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) return { success: false, reason: 'missing-booking' };

  const booking = bookingDoc.data();
  if (!booking || ['Assigned', 'Completed'].includes(booking.status)) {
    return { success: false, reason: 'terminal-status' };
  }

  if (booking.status !== STATUS.SEARCHING && booking.status !== STATUS.WAITING) {
    return { success: false, reason: 'unexpected-status' };
  }

  const skipSet = new Set((booking.skipList || []).filter(Boolean));
  if (skipWasherId) skipSet.add(skipWasherId);

  const washersSnap = await db.collection('washers')
    .where('status', '==', 'available')
    .get();

  const candidates = [];
  for (const washerDoc of washersSnap.docs) {
    if (skipSet.has(washerDoc.id)) continue;
    const washer = washerDoc.data() || {};
    const locationDoc = await db.collection('liveLocations').doc(washerDoc.id).get();
    const location = locationDoc.exists ? locationDoc.data() : null;
    if (!location || location.lat == null || location.lng == null) continue;
    const distance = haversine(
      booking.customerLoc?.lat || booking.customerLocation?.latitude || 0,
      booking.customerLoc?.lng || booking.customerLocation?.longitude || 0,
      location.lat,
      location.lng
    );
    candidates.push({ washerDoc, washer, location, distance });
  }

  if (!candidates.length) {
    await bookingRef.update({
      status: STATUS.SEARCHING,
      offerWasherId: null,
      offerStatus: 'pending',
      skipList: Array.from(skipSet),
      lastDispatchAttemptAt: FieldValue.serverTimestamp()
    });
    return { success: false, reason: 'no-available-washers' };
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const chosen = candidates[0];
  const distance = chosen.distance;
  const etaMinutes = estimateEtaMinutes(distance);
  const deadline = new Date(Date.now() + 30000);

  await bookingRef.update({
    status: STATUS.SEARCHING,
    offerWasherId: chosen.washerDoc.id,
    offerStatus: 'pending',
    offerDeadline: admin.firestore.Timestamp.fromDate(deadline),
    metrics: {
      ...(booking.metrics || {}),
      distance: Math.round(distance),
      eta: etaMinutes,
      basePrice: booking.metrics?.basePrice || booking.basePrice || booking.price || 0
    },
    skipList: Array.from(skipSet),
    lastDispatchAttemptAt: FieldValue.serverTimestamp()
  });

  await db.collection('washers').doc(chosen.washerDoc.id).set({
    currentOffer: {
      bookingId,
      customerId: booking.customerId || booking.userId || null,
      customerLoc: booking.customerLoc || {
        lat: booking.customerLocation?.latitude || booking.customerLocation?.lat || 0,
        lng: booking.customerLocation?.longitude || booking.customerLocation?.lng || 0
      },
      expiresAt: admin.firestore.Timestamp.fromDate(deadline)
    }
  }, { merge: true });

  await db.collection('liveLocations').doc(chosen.washerDoc.id).set({
    available: false,
    online: true,
    currentOffer: {
      bookingId,
      expiresAt: admin.firestore.Timestamp.fromDate(deadline)
    }
  }, { merge: true });

  await sendNotificationToUid(
    chosen.washerDoc.id,
    'washers',
    'New job offer',
    `${booking.service || 'EcoShine'} • ETA ${etaMinutes} min`,
    { bookingId, type: 'job-offer' }
  );

  setTimeout(() => {
    handleOfferTimeout(bookingId, chosen.washerDoc.id).catch((error) => {
      console.error('Offer timeout error:', error);
    });
  }, 30000);

  return { success: true, washerId: chosen.washerDoc.id, etaMinutes };
}

async function syncActiveBookingFromLiveLocation(washerId, location) {
  const coords = getWasherCoords(location);
  if (!washerId || !coords) return;

  const activeSnap = await db.collection('bookings')
    .where('washerId', '==', washerId)
    .where('status', 'in', getActiveBookingStatuses())
    .limit(1)
    .get();

  if (activeSnap.empty) return;

  const bookingRef = activeSnap.docs[0].ref;
  const booking = activeSnap.docs[0].data() || {};
  const customerCoords = getBookingCoords(booking);
  const metrics = { ...(booking.metrics || {}) };
  const historyEntry = {
    lat: coords.lat,
    lng: coords.lng,
    heading: location.heading || 0,
    speed: location.speed || 0,
    timestamp: admin.firestore.Timestamp.now()
  };

  if (customerCoords) {
    const distance = haversine(coords.lat, coords.lng, customerCoords.lat, customerCoords.lng);
    metrics.distance = Math.round(distance);
    metrics.eta = estimateEtaMinutes(distance);
  }

  const existingHistory = Array.isArray(booking.trackingHistory) ? booking.trackingHistory.slice(-24) : [];
  existingHistory.push(historyEntry);

  await bookingRef.update({
    washerLoc: coords,
    washerLocation: new admin.firestore.GeoPoint(coords.lat, coords.lng),
    metrics,
    trackingHistory: existingHistory,
    lastTrackingUpdateAt: FieldValue.serverTimestamp()
  });
}

async function updateWasherAvailability(washerId, status, extra = {}) {
  if (!washerId) return;
  await db.collection('washers').doc(washerId).set({
    status,
    lastUpdatedAt: FieldValue.serverTimestamp(),
    ...extra
  }, { merge: true });
}

async function handleOfferTimeout(bookingId, washerId) {
  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) return;

  const booking = bookingDoc.data() || {};
  if (!booking || booking.status !== STATUS.SEARCHING) return;
  if (booking.offerWasherId !== washerId) return;
  if (booking.offerStatus === 'accepted') return;

  await bookingRef.update({
    offerStatus: 'timed-out',
    offerWasherId: null,
    skipList: FieldValue.arrayUnion(washerId),
    lastOfferOutcome: 'timed-out'
  });

  await db.collection('washers').doc(washerId).set({ currentOffer: null }, { merge: true });
  await db.collection('liveLocations').doc(washerId).set({ available: true, currentOffer: null }, { merge: true }).catch(() => {});
  await dispatchBooking(bookingId, { skipWasherId: washerId });
}

exports.sendNotification = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { targetUid, collection = 'users', title, body, data } = req.body || {};
  if (!targetUid) return res.status(400).json({ success: false, error: 'targetUid required' });

  const result = await sendNotificationToUid(targetUid, collection, title || 'EcoShine', body || '', data || {});
  return res.status(result.success ? 200 : 500).json(result);
});

exports.onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snapshot, context) => {
    const booking = snapshot.data() || {};
    if (booking.status !== STATUS.WAITING) return null;
    await snapshot.ref.update({
      status: STATUS.SEARCHING,
      searchStartedAt: FieldValue.serverTimestamp(),
      offerStatus: 'pending'
    });
    return dispatchBooking(context.params.bookingId);
  });

exports.onBookingUpdated = functions.firestore
  .document('bookings/{bookingId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (before.offerStatus !== 'rejected' && after.offerStatus === 'rejected' && after.status === STATUS.SEARCHING) {
      return dispatchBooking(context.params.bookingId, { skipWasherId: after.offerWasherId || null });
    }
    return null;
  });

exports.onLiveLocationUpdated = functions.firestore
  .document('liveLocations/{washerId}')
  .onWrite(async (change, context) => {
    const washerId = context.params.washerId;
    if (!change.after.exists) return null;
    const after = change.after.data() || {};
    const coords = getWasherCoords(after);
    if (!coords) return null;

    await syncActiveBookingFromLiveLocation(washerId, { ...after, ...coords });
    return null;
  });

exports.acceptBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
  }

  const bookingId = data?.bookingId;
  const washerId = context.auth.uid;
  if (!bookingId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  }

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Booking not found.');
  }

  const booking = bookingDoc.data() || {};
  if (booking.offerWasherId && booking.offerWasherId !== washerId) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking is no longer offered to you.');
  }
  if (!['Waiting', 'Searching'].includes(booking.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking is already in progress.');
  }

  const washerRef = db.collection('washers').doc(washerId);
  const locationDoc = await db.collection('liveLocations').doc(washerId).get();
  const location = locationDoc.exists ? locationDoc.data() : null;

  await db.runTransaction(async (transaction) => {
    transaction.update(bookingRef, {
      status: STATUS.ASSIGNED,
      washerId,
      offerStatus: 'accepted',
      offerAcceptedAt: FieldValue.serverTimestamp(),
      washerLoc: location ? { lat: location.lat, lng: location.lng } : null,
      metrics: {
        ...(booking.metrics || {}),
        eta: booking.metrics?.eta || 0,
        distance: booking.metrics?.distance || 0
      },
      lastStatusAt: FieldValue.serverTimestamp()
    });
    transaction.update(washerRef, {
      status: 'assigned',
      currentOffer: null,
      activeBookingId: bookingId,
      lastUpdatedAt: FieldValue.serverTimestamp()
    });
    transaction.set(db.collection('liveLocations').doc(washerId), {
      available: false,
      online: true,
      activeBookingId: bookingId,
      timestamp: FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await sendNotificationToUid(
    booking.customerId || booking.userId,
    'users',
    'Washer assigned',
    'A washer has accepted your booking request.',
    { bookingId, type: 'booking-assigned' }
  );

  return { success: true, bookingId };
});

exports.rejectBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
  }

  const bookingId = data?.bookingId;
  const washerId = context.auth.uid;
  if (!bookingId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  }

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Booking not found.');
  }

  const booking = bookingDoc.data() || {};
  if (booking.offerWasherId && booking.offerWasherId !== washerId) {
    throw new functions.https.HttpsError('failed-precondition', 'This booking is already being handled by another washer.');
  }

  await bookingRef.update({
    offerStatus: 'rejected',
    offerRejectedBy: washerId,
    offerWasherId: null,
    lastOfferOutcome: 'rejected',
    lastStatusAt: FieldValue.serverTimestamp()
  });
  await db.collection('washers').doc(washerId).set({ currentOffer: null }, { merge: true });
  await db.collection('liveLocations').doc(washerId).set({ available: true, currentOffer: null }, { merge: true }).catch(() => {});
  return { success: true };
});

exports.submitRating = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
  }

  const bookingId = data?.bookingId;
  const reviewerId = context.auth.uid;
  const reviewerRole = data?.reviewerRole === 'worker' ? 'worker' : 'customer';
  const rating = Number(data?.rating);
  const comment = String(data?.comment || '');

  if (!bookingId || !Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId and rating (1-5) are required.');
  }

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Booking not found.');
  }

  const booking = bookingDoc.data() || {};
  const ratingRef = bookingRef.collection('ratings').doc(`${reviewerRole}-${reviewerId}`);
  const targetCollection = reviewerRole === 'worker' ? 'users' : 'washers';
  const targetId = reviewerRole === 'worker' ? booking.customerId : booking.washerId;
  if (!targetId) {
    throw new functions.https.HttpsError('failed-precondition', 'Target party not found for this booking.');
  }

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ratingRef);
    if (existing.exists) {
      throw new functions.https.HttpsError('already-exists', 'You already rated this booking.');
    }

    tx.set(ratingRef, {
      bookingId,
      reviewerId,
      reviewerRole,
      rating,
      comment,
      targetId,
      createdAt: FieldValue.serverTimestamp()
    });

    const targetRef = db.collection(targetCollection).doc(targetId);
    const targetDoc = await tx.get(targetRef);
    const targetData = targetDoc.exists ? targetDoc.data() || {} : {};
    const ratingCount = Number(targetData.ratingCount || 0);
    const ratingTotal = Number(targetData.ratingTotal || 0);
    tx.set(targetRef, {
      ratingCount: ratingCount + 1,
      ratingTotal: ratingTotal + rating,
      averageRating: (ratingTotal + rating) / (ratingCount + 1)
    }, { merge: true });
  });

  return { success: true };
});

exports.completeBooking = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication is required.');
  }

  const bookingId = data?.bookingId;
  const washerId = context.auth.uid;
  if (!bookingId) {
    throw new functions.https.HttpsError('invalid-argument', 'bookingId is required.');
  }

  const bookingRef = db.collection('bookings').doc(bookingId);
  const bookingDoc = await bookingRef.get();
  if (!bookingDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Booking not found.');
  }

  const booking = bookingDoc.data() || {};
  if (!booking.washerId || booking.washerId !== washerId) {
    throw new functions.https.HttpsError('failed-precondition', 'Only the assigned washer can complete this booking.');
  }

  const { basePrice, surcharge } = getVehicleBasePrice(booking);
  const discount = Number(booking.discount || booking.promoDiscount || booking.metrics?.discount || 0);
  const totalPaid = Math.max(0, Number(booking.totalPrice || booking.metrics?.totalPaid || (basePrice + surcharge - discount)));

  await bookingRef.update({
    status: STATUS.COMPLETED,
    'metrics.basePrice': basePrice,
    'metrics.totalPaid': totalPaid,
    'metrics.surcharge': surcharge,
    'metrics.discount': discount,
    completedAt: FieldValue.serverTimestamp(),
    lastStatusAt: FieldValue.serverTimestamp()
  });

  await updateWasherAvailability(washerId, 'available', {
    activeBookingId: null,
    currentOffer: null
  });

  await db.collection('liveLocations').doc(washerId).set({
    available: true,
    online: true,
    timestamp: FieldValue.serverTimestamp()
  }, { merge: true });

  return { success: true, totalPaid };
});
