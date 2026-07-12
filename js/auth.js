const authService = {
  async registerUser(email, password, role, additionalData = {}) {
    try {
      const userCredential = await firebase.auth().createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;

      await firebase.firestore().collection('users').doc(user.uid).set({
        email: email,
        role: role,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        status: 'active',
        ...additionalData
      });

      return { success: true, user: user, uid: user.uid, reused: false, displayName: getUserDisplayName(user) };
    } catch (error) {
      if (error.code === 'auth/email-already-in-use') {
        // A Firebase Auth account with this email already exists.
        // If a Firestore profile already exists, simply (re)assign the requested role.
        try {
          const snapshot = await firebase.firestore().collection('users').where('email', '==', email).limit(1).get();
          if (!snapshot.empty) {
            const doc = snapshot.docs[0];
            await doc.ref.set({
              role: role,
              status: additionalData.status || 'offline',
              ...additionalData
            }, { merge: true });
            return { success: true, uid: doc.id, reused: true, message: 'Existing account linked as ' + role + '.' };
          }
          return {
            success: false,
            error: 'An account with this email already exists in Firebase Authentication but has no profile. Delete it in the Firebase Console (Authentication > Users) or ask the user to sign in so a profile can be created.'
          };
        } catch (linkError) {
          return { success: false, error: linkError.message };
        }
      }
      console.error('Registration error:', error);
      return { success: false, error: error.message };
    }
  },

  async loginUser(email, password) {
    try {
      const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
      const user = userCredential.user;
      let userDoc = await firebase.firestore().collection('users').doc(user.uid).get();
      let userData = userDoc.exists ? userDoc.data() : null;

      if (!userData) {
        const role = (email === window.firebaseService.adminEmail) ? 'admin' : 'client';
        await firebase.firestore().collection('users').doc(user.uid).set({
          email: email,
          role: role,
          status: 'active',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        userData = { role: role };
      }
      
      return { 
        success: true, 
        user: user, 
        role: userData.role || 'client',
        uid: user.uid,
        displayName: getUserDisplayName(user),
        data: userData
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: error.message };
    }
  },

  async logoutUser() {
    try {
      await firebase.auth().signOut();
      return { success: true };
    } catch (error) {
      console.error('Logout error:', error);
      return { success: false, error: error.message };
    }
  },

  async getCurrentUser() {
    return new Promise((resolve) => {
      const unsubscribe = firebase.auth().onAuthStateChanged(async (user) => {
        unsubscribe();
        if (user) {
          const userDoc = await firebase.firestore().collection('users').doc(user.uid).get();
          const userData = userDoc.exists ? userDoc.data() : { role: 'client' };
          resolve({ 
            success: true, 
            user: user, 
            role: userData.role || 'client',
            uid: user.uid,
            displayName: getUserDisplayName(user),
            data: userData
          });
        } else {
          resolve({ success: false, user: null });
        }
      });
    });
  },

  async updateUserRole(uid, role) {
    try {
      await firebase.firestore().collection('users').doc(uid).update({ role: role });
      return { success: true };
    } catch (error) {
      console.error('Update role error:', error);
      return { success: false, error: error.message };
    }
  },

  async getAllUsers() {
    try {
      const snapshot = await firebase.firestore().collection('users').get();
      const users = [];
      snapshot.forEach(doc => {
        users.push({ uid: doc.id, ...doc.data() });
      });
      return { success: true, users: users };
    } catch (error) {
      console.error('Get users error:', error);
      return { success: false, error: error.message };
    }
  },

  async deleteUser(uid) {
    try {
      await firebase.firestore().collection('users').doc(uid).delete();
      return { success: true };
    } catch (error) {
      console.error('Delete user error:', error);
      return { success: false, error: error.message };
    }
  },

  async sendPasswordResetEmail(email) {
    try {
      await firebase.auth().sendPasswordResetEmail(email);
      return { success: true, message: 'Password reset email sent. Please check your inbox.' };
    } catch (error) {
      console.error('Password reset error:', error);
      return { success: false, error: error.message };
    }
  },

  async changePassword(currentPassword, newPassword) {
    const user = firebase.auth().currentUser;
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
  },

  generateSecurePassword(length = 12) {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    const cryptoValues = new Uint32Array(length);
    window.crypto.getRandomValues(cryptoValues);
    for (let i = 0; i < length; i++) {
      password += charset[cryptoValues[i] % charset.length];
    }
    return password;
  },
  displayName(user) {
    if (!user) return 'Eco User';
    const name = (user.displayName && user.displayName.trim()) ? user.displayName.trim() : '';
    if (name) return name;
    if (user.email) {
      return user.email.split('@')[0];
    }
    return 'Eco User';
  }
};

function getUserDisplayName(user) {
  if (!user) return 'Eco User';
  const name = (user.displayName && user.displayName.trim()) ? user.displayName.trim() : '';
  if (name) return name;
  if (user.email) {
    return user.email.split('@')[0];
  }
  return 'Eco User';
}

window.authService = authService;
