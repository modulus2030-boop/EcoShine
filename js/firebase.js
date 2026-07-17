const firebaseConfig = {
  apiKey: "AIzaSyAr_6AAW6MDBGhdwuUETMd7_pHsIyKTt2k",
  authDomain: "modulus-5c539.firebaseapp.com",
  projectId: "modulus-5c539",
  storageBucket: "modulus-5c539.firebasestorage.app",
  messagingSenderId: "479940924716",
  appId: "1:479940924716:web:6a6b94abaa305dc7a30889"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- EcoWash runtime configuration ---
// 100% free, cardless stack: Leaflet.js + OpenStreetMap (Nominatim +
// OSM tiles) + Firestore. No Google Maps / Distance Matrix dependency.
// Distance & ETA are computed locally with the Haversine formula.
const ECOWASH_CONFIG = {
  // Geographic center + default zoom used as the nationwide fallback view.
  countryCenter: { lat: -22.56, lng: 17.47 }, // rough centroid of Namibia
  countryZoom: 6,
  // Fixed average city driving speed (km/h) used for ETA estimates.
  avgCitySpeedKmh: 40
};
window.ECOWASH_CONFIG = ECOWASH_CONFIG;

async function initializeSystem() {
  try {
    await ensureCollectionsExists();
    const authInstance = firebase.auth();
    if (authInstance && typeof authInstance.setPersistence === 'function') {
      await authInstance.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    }
    console.log('EcoShine system initialized successfully');
  } catch (error) {
    console.error('System initialization error:', error);
  }
}

const ADMIN_EMAIL = 'admin@ecoshine.na';
const ADMIN_DEFAULT_PASSWORD = 'EcoShine#2024';

async function ensureAdminUserExists() {
  const previousUser = auth.currentUser;
  let userCredential = null;

  const signInWithDefault = async () => {
    return await auth.signInWithEmailAndPassword(ADMIN_EMAIL, ADMIN_DEFAULT_PASSWORD);
  };

  const createWithDefault = async () => {
    return await auth.createUserWithEmailAndPassword(ADMIN_EMAIL, ADMIN_DEFAULT_PASSWORD);
  };

  const writeAdminDoc = async (uid) => {
    await db.collection('users').doc(uid).set({
      email: ADMIN_EMAIL,
      role: 'admin',
      name: 'EcoShine Admin',
      status: 'active',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  };

  const restorePreviousUser = async () => {
    await auth.signOut();
  };

  try {
    userCredential = await signInWithDefault();
    console.log('Signed in to existing admin account (' + ADMIN_EMAIL + ').');
  } catch (error) {
    if (error.code === 'auth/invalid-login-credentials' || error.code === 'auth/user-not-found') {
      try {
        userCredential = await createWithDefault();
        console.log('Created admin Firebase Auth account for ' + ADMIN_EMAIL + ' (password: ' + ADMIN_DEFAULT_PASSWORD + ').');
      } catch (createError) {
        if (createError.code === 'auth/email-already-in-use') {
          console.warn(
            'Admin account "' + ADMIN_EMAIL + '" already exists but the default password does not match. ' +
            'Reset its password in the Firebase Console (Authentication > Users) or delete the account so it can be recreated.'
          );
          await restorePreviousUser();
          return;
        }
        if (createError.code === 'auth/operation-not-allowed') {
          console.error(
            'Firebase Auth: Email/Password sign-up is disabled. Enable it in the Firebase Console ' +
            '(Authentication > Sign-in method > Email/Password) so the admin account can be created.'
          );
          await restorePreviousUser();
          return;
        }
        console.error('Failed to create admin auth account:', createError);
        await restorePreviousUser();
        return;
      }
    } else if (error.code === 'auth/operation-not-allowed') {
      console.error(
        'Firebase Auth: Email/Password sign-in is disabled. Enable it in the Firebase Console ' +
        '(Authentication > Sign-in method > Email/Password).'
      );
      await restorePreviousUser();
      return;
    } else {
      console.error('Unexpected error while provisioning admin account:', error);
      await restorePreviousUser();
      return;
    }
  }

  if (!userCredential || !userCredential.user) {
    await restorePreviousUser();
    return;
  }

  const uid = userCredential.user.uid;
  try {
    await writeAdminDoc(uid);
    console.log('Provisioned admin user document with role "admin".');
  } catch (error) {
    console.error('Failed to write admin Firestore document (check Firestore rules are deployed):', error);
  }

  await restorePreviousUser();
}

async function ensureCollectionsExists() {
  const collections = ['users', 'washers', 'liveLocations', 'bookings'];
  for (const collectionName of collections) {
    const snapshot = await db.collection(collectionName).limit(1).get();
    if (snapshot.empty) {
      console.log(`Collection '${collectionName}' initialized`);
    }
  }
}

async function submitBooking(bookingData, userId) {
  try {
    const docRef = await db.collection('bookings').add({
      address: bookingData.address || '',
      area: bookingData.area || '',
      notes: bookingData.notes || '',
      vehicle: bookingData.vehicle || '',
      service: bookingData.service || '',
      price: bookingData.price || 0,
      date: bookingData.date || '',
      time: bookingData.time || '',
      payment: bookingData.payment || '',
      status: 'Waiting',
      offerStatus: 'pending',
      skipList: [],
      userId: userId || null,
      customerId: userId || null,
      customerLoc: bookingData.customerLoc || null,
      customerLocation: bookingData.customerLocation || null,
      customerLocationName: bookingData.customerLocationName || '',
      customerLocationLabel: bookingData.customerLocationLabel || '',
      customerLocationDetail: bookingData.customerLocationDetail || '',
      metrics: { distance: 0, eta: 0, basePrice: 0, totalPaid: 0, discount: 0 },
      trackingHistory: [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error submitting booking:', error);
    return { success: false, error: error.message };
  }
}

async function sendPasswordResetEmail(email) {
  try {
    await auth.sendPasswordResetEmail(email);
    return { success: true, message: 'Password reset email sent. Please check your inbox.' };
  } catch (error) {
    console.error('Password reset error:', error);
    return { success: false, error: error.message };
  }
}

async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, error: 'No user is currently signed in.' };
  }

  try {
    const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
    await user.reauthenticateWithCredential(credential);
    await user.updatePassword(newPassword);
    return { success: true, message: 'Password updated successfully.' };
  } catch (error) {
    console.error('Change password error:', error);
    return { success: false, error: error.message };
  }
}

window.firebaseService = {
  submitBooking,
  sendPasswordResetEmail,
  changePassword,
  db,
  auth,
  initializeSystem,
  adminEmail: ADMIN_EMAIL
};
