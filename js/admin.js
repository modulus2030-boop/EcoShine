class AdminDashboard {
  constructor() {
    this.currentUser = null;
    this.workers = [];
    this.bookings = [];
    this.init();
  }

  init() {
    this.checkAuth();
    this.bindEvents();
  }

  async checkAuth() {
    try {
      await window.firebaseService.initializeSystem();
    } catch (error) {
      console.error('System initialization error:', error);
    }

    const result = await window.authService.getCurrentUser();
    if (!result.success || result.role !== 'admin') {
      window.location.href = 'auth.html';
      return;
    }
    
    this.currentUser = result.user;
    document.getElementById('login-gate').classList.add('hidden');
    document.getElementById('admin-dashboard').classList.remove('hidden');
    const nameDisplay = document.getElementById('admin-display-name');
    if (nameDisplay) nameDisplay.textContent = window.authService.displayName(result.user);
    const greetingEl = document.getElementById('admin-greeting');
    if (greetingEl) {
      const displayName = window.authService.displayName(result.user);
      const firstName = displayName.split(' ')[0] || displayName;
      greetingEl.textContent = 'Welcome Admin ' + firstName + '!';
    }
    document.getElementById('live-ops-section')?.classList.remove('hidden');
    this.loadWorkers();
    this.loadBookings();
    this.loadActivityFeed();
    this.initLiveMap();
  }

  bindEvents() {
    // Admin login
    document.getElementById('admin-login-btn')?.addEventListener('click', () => this.adminLogin());

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    document.getElementById('mobile-logout-btn')?.addEventListener('click', () => this.logout());

    // Recruitment form
    document.getElementById('recruit-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addWorker();
    });

    // Export buttons
    document.getElementById('export-csv-btn')?.addEventListener('click', () => this.exportCSV());
    document.getElementById('export-pdf-btn')?.addEventListener('click', () => this.exportPDF());
    
    // Quick actions
    document.getElementById('refresh-data-btn')?.addEventListener('click', () => {
      this.loadWorkers();
      this.loadBookings();
      this.showNotification('Data refreshed', 'success');
    });

    document.getElementById('broadcast-message-btn')?.addEventListener('click', () => {
      const message = prompt('Enter broadcast message:');
      if (message) {
        this.showNotification('Message broadcasted to all workers', 'success');
      }
    });

    document.getElementById('view-map-btn')?.addEventListener('click', () => {
      window.open('booking.html', '_blank');
    });

    // Change password
    document.getElementById('change-password-btn')?.addEventListener('click', () => this.showChangePasswordModal());
    document.getElementById('close-modal-btn')?.addEventListener('click', () => this.hideChangePasswordModal());
    document.getElementById('confirm-change-password-btn')?.addEventListener('click', () => this.changePassword());
  }

  async adminLogin() {
    const email = document.getElementById('admin-email').value;
    const password = document.getElementById('admin-password').value;
    const errorEl = document.getElementById('admin-login-error');
    const btn = document.getElementById('admin-login-btn');

    if (!email || !password) {
      errorEl.textContent = 'Please enter both email and password.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Authenticating...';

    const result = await window.authService.loginUser(email, password);
    
    if (result.success && result.role === 'admin') {
      errorEl.style.display = 'none';
      this.currentUser = result.user;
      document.getElementById('login-gate').classList.add('hidden');
      document.getElementById('admin-dashboard').classList.remove('hidden');
      const displayName = window.authService.displayName(result.user);
      const nameDisplay = document.getElementById('admin-display-name');
      if (nameDisplay) nameDisplay.textContent = displayName;
      const greetingEl = document.getElementById('admin-greeting');
      if (greetingEl) {
        const firstName = displayName.split(' ')[0] || displayName;
        greetingEl.textContent = 'Welcome Admin ' + firstName + '!';
      }
      this.loadWorkers();
      this.loadBookings();
      this.loadActivityFeed();
      btn.disabled = false;
      btn.innerHTML = '<span class="relative z-10 flex items-center justify-center gap-2"><i class="fas fa-unlock"></i> Access Dashboard</span>';
    } else {
      errorEl.textContent = result.error || 'Access denied. Admin credentials required.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<span class="relative z-10 flex items-center justify-center gap-2"><i class="fas fa-unlock"></i> Access Dashboard</span>';
    }
  }

  showChangePasswordModal() {
    document.getElementById('change-password-modal').classList.remove('hidden');
  }

  hideChangePasswordModal() {
    document.getElementById('change-password-modal').classList.add('hidden');
  }

  async changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-new-password').value;
    const errorEl = document.getElementById('change-password-error');
    const successEl = document.getElementById('change-password-success');

    errorEl.style.display = 'none';
    successEl.style.display = 'none';

    if (!currentPassword || !newPassword || !confirmPassword) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.style.display = 'block';
      return;
    }

    if (newPassword !== confirmPassword) {
      errorEl.textContent = 'New passwords do not match.';
      errorEl.style.display = 'block';
      return;
    }

    if (newPassword.length < 6) {
      errorEl.textContent = 'Password must be at least 6 characters.';
      errorEl.style.display = 'block';
      return;
    }

    const result = await window.authService.changePassword(currentPassword, newPassword);
    
    if (result.success) {
      successEl.textContent = result.message;
      successEl.style.display = 'block';
      document.getElementById('current-password').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('confirm-new-password').value = '';
      setTimeout(() => this.hideChangePasswordModal(), 2000);
    } else {
      errorEl.textContent = result.error;
      errorEl.style.display = 'block';
    }
  }

  async addWorker() {
    const name = document.getElementById('worker-name').value;
    const email = document.getElementById('worker-email').value;
    const phone = document.getElementById('worker-phone').value;
    const role = document.getElementById('worker-role').value;

    if (!name || !email || !phone) {
      this.showNotification('Please fill all fields', 'error');
      return;
    }

    // Generate secure random password
    const password = window.authService.generateSecurePassword(12);

    const result = await window.authService.registerUser(email, password, role || 'worker', {
      name: name,
      phone: phone,
      status: 'offline',
      earnings: 0,
      jobsCompleted: 0,
      rating: 0
    });

    if (result.success) {
      this.showNotification(`Worker ${name} added successfully!`, 'success');
      document.getElementById('recruit-form').reset();
      this.loadWorkers();

      if (result.reused) {
        this.showNotification(
          `An account with ${email} already existed and was linked as a worker. They can sign in with their existing password (or use "Forgot password").`,
          'info'
        );
      } else {
        // Show credentials modal (new account only)
        this.showCredentialsModal(email, password, name);
      }
    } else {
      this.showNotification(`Failed to add worker: ${result.error}`, 'error');
    }
  }

  showCredentialsModal(email, password, name) {
    const modal = document.createElement('div');
    modal.id = 'credentials-modal';
    modal.className = 'fixed inset-0 z-[70] bg-slate-950/95 backdrop-blur-xl flex items-center justify-center';
    modal.innerHTML = `
      <div class="max-w-md w-full mx-4">
        <div class="glass-strong rounded-3xl p-8 border border-white/10 text-center">
          <div class="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-700/10 flex items-center justify-center mb-6">
            <i class="fas fa-user-check text-emerald-400 text-2xl"></i>
          </div>
          <h3 class="text-2xl font-bold text-white mb-2">Worker Added Successfully</h3>
          <p class="text-gray-400 text-sm mb-6">Share these credentials with ${name} so they can log in.</p>
          
          <div class="glass rounded-xl p-4 mb-4 text-left space-y-2">
            <div class="flex justify-between items-center">
              <span class="text-gray-400 text-sm">Email:</span>
              <span class="text-white text-sm font-mono">${email}</span>
            </div>
            <div class="flex justify-between items-center">
              <span class="text-gray-400 text-sm">Password:</span>
              <span class="text-white text-sm font-mono">${password}</span>
            </div>
          </div>

          <div class="flex gap-3">
            <button onclick="adminDashboard.copyCredentials('${email}', '${password}')" class="flex-1 px-4 py-3 rounded-xl glass hover:bg-emerald-500/10 hover:border-emerald-500/30 text-emerald-400 hover:text-emerald-300 transition-all text-sm font-medium">
              <i class="fas fa-copy mr-2"></i>Copy
            </button>
            <a href="mailto:${email}?subject=EcoShine Worker Login Credentials&body=Hello ${name},%0A%0AYour EcoShine worker account has been created.%0A%0AEmail: ${email}%0APassword: ${password}%0A%0APlease log in and change your password immediately." class="flex-1 px-4 py-3 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all text-sm font-medium text-center">
              <i class="fas fa-envelope mr-2"></i>Email
            </a>
          </div>

          <button onclick="document.getElementById('credentials-modal').remove()" class="w-full mt-3 px-4 py-3 rounded-xl glass hover:bg-white/10 text-gray-300 hover:text-white transition-all text-sm font-medium">
            Close
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  copyCredentials(email, password) {
    const text = `Email: ${email}\nPassword: ${password}`;
    navigator.clipboard.writeText(text).then(() => {
      this.showNotification('Credentials copied to clipboard', 'success');
    }).catch(() => {
      this.showNotification('Failed to copy credentials', 'error');
    });
  }

  async loadWorkers() {
    const result = await window.authService.getAllUsers();
    if (result.success) {
      this.workers = result.users.filter(u => u.role === 'worker' || u.role === 'admin' || u.role === 'manager');
      this.renderWorkers();
      this.updateStats();
    }
  }

  renderWorkers() {
    const container = document.getElementById('workers-list');
    if (!container) return;

    if (this.workers.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-users text-4xl mb-4 opacity-30"></i>
          <p>No workers registered yet</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.workers.map(worker => {
      const statusClass = worker.status === 'online' ? 'status-online' : 
                          worker.status === 'busy' ? 'status-busy' : 'status-offline';
      const statusText = worker.status ? worker.status.charAt(0).toUpperCase() + worker.status.slice(1) : 'Offline';
      
      return `
        <div class="worker-card glass rounded-xl p-4 flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-700/10 flex items-center justify-center">
              <i class="fas fa-user text-emerald-400 text-lg"></i>
            </div>
            <div>
              <h4 class="text-white font-semibold">${worker.name || 'Unknown'}</h4>
              <p class="text-gray-500 text-xs">${worker.email || ''}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="px-3 py-1 rounded-full text-xs font-medium ${statusClass}">${statusText}</span>
            <select onchange="adminDashboard.updateWorkerStatus('${worker.uid}', this.value)" class="bg-white/5 border border-white/10 text-white text-xs rounded-lg px-2 py-1 focus:border-emerald-500/50">
              <option value="online" ${worker.status === 'online' ? 'selected' : ''}>Online</option>
              <option value="busy" ${worker.status === 'busy' ? 'selected' : ''}>Busy</option>
              <option value="offline" ${worker.status === 'offline' ? 'selected' : ''}>Offline</option>
            </select>
            <button onclick="adminDashboard.deleteWorker('${worker.uid}')" class="text-red-400 hover:text-red-300 transition-colors">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  async updateWorkerStatus(uid, status) {
    try {
      await window.firebaseService.db.collection('users').doc(uid).update({ status: status });
      this.showNotification('Worker status updated', 'success');
      this.loadWorkers();
    } catch (error) {
      this.showNotification('Failed to update status', 'error');
    }
  }

  async deleteWorker(uid) {
    if (!confirm('Are you sure you want to remove this worker?')) return;
    
    const result = await window.authService.deleteUser(uid);
    if (result.success) {
      this.showNotification('Worker removed', 'success');
      this.loadWorkers();
    } else {
      this.showNotification('Failed to remove worker', 'error');
    }
  }

  async loadBookings() {
    try {
      const snapshot = await window.firebaseService.db.collection('bookings').get();
      this.bookings = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      this.renderPayments();
      this.updateStats();
    } catch (error) {
      console.error('Error loading bookings:', error);
    }
  }

  // Live nationwide map: plots online washers (liveLocations) and
  // active bookings via Firestore onSnapshot listeners. 100% free
  // Leaflet + OpenStreetMap stack (no Google Maps / credit card).
  initLiveMap() {
    const el = document.getElementById('live-ops-map');
    if (!el || typeof L === 'undefined' || this._liveMap) return;

    const cfg = window.ECOWASH_CONFIG || { countryCenter: { lat: -22.56, lng: 17.47 }, countryZoom: 6 };
    this._liveMap = L.map('live-ops-map', { zoomControl: true, attributionControl: true });
    this._liveMap.setView([cfg.countryCenter.lat, cfg.countryCenter.lng], cfg.countryZoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this._liveMap);

    // Center on the admin's live position when available.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => this._liveMap.setView([pos.coords.latitude, pos.coords.longitude], 11),
        () => {}, { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
      );
    }

    this._washerMarkers = {};
    this._bookingMarkers = {};

    const washerIcon = L.divIcon({
      className: '',
      html: '<div style="width:16px;height:16px;background:#6dbb6d;border:2px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(109,187,109,0.9);"></div>',
      iconSize: [16, 16], iconAnchor: [8, 8]
    });
    const bookingIcon = L.divIcon({
      className: '',
      html: '<div style="width:16px;height:16px;background:#23799c;border:2px solid #fff;border-radius:50%;box-shadow:0 0 12px rgba(35,121,156,0.9);"></div>',
      iconSize: [16, 16], iconAnchor: [8, 8]
    });

    // Live washers.
    window.firebaseService.db.collection('liveLocations').onSnapshot((snap) => {
      snap.docChanges().forEach((change) => {
        const id = change.doc.id;
        const w = change.doc.data();
        if (change.type === 'removed' || !w.online) {
          if (this._washerMarkers[id]) { this._liveMap.removeLayer(this._washerMarkers[id]); delete this._washerMarkers[id]; }
          return;
        }
        const latlng = [w.lat, w.lng];
        if (this._washerMarkers[id]) this._washerMarkers[id].setLatLng(latlng);
        else this._washerMarkers[id] = L.marker(latlng, { icon: washerIcon }).addTo(this._liveMap);
      });
    }, (e) => console.error('liveLocations listener error:', e));

    // Active bookings.
    const STATUS = (window.EcoWash && window.EcoWash.STATUS) || {};
    window.firebaseService.db.collection('bookings')
      .where('status', 'in', [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING])
      .onSnapshot((snap) => {
        snap.docChanges().forEach((change) => {
          const id = change.doc.id;
          const b = change.doc.data();
          if (change.type === 'removed' || !b.customerLocation) {
            if (this._bookingMarkers[id]) { this._liveMap.removeLayer(this._bookingMarkers[id]); delete this._bookingMarkers[id]; }
            return;
          }
          const latlng = [b.customerLocation.latitude, b.customerLocation.longitude];
          if (this._bookingMarkers[id]) this._bookingMarkers[id].setLatLng(latlng);
          else this._bookingMarkers[id] = L.marker(latlng, { icon: bookingIcon }).addTo(this._liveMap);
        });
      }, (e) => console.error('bookings map listener error:', e));

    setTimeout(() => this._liveMap.invalidateSize(), 200);
  }

  renderPayments() {
    const tbody = document.getElementById('payments-table');
    if (!tbody) return;

    const payments = this.bookings.slice(0, 10);
    tbody.innerHTML = payments.map(booking => `
      <tr>
        <td>${booking.date || 'N/A'}</td>
        <td>${booking.address || 'N/A'}</td>
        <td>${booking.service || 'N/A'}</td>
        <td class="text-emerald-400 font-medium">N$ ${(booking.price || 0).toLocaleString()}</td>
        <td>
          <span class="px-2 py-1 rounded-full text-xs ${booking.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-green-500/20 text-green-400'}">
            ${booking.status || 'pending'}
          </span>
        </td>
      </tr>
    `).join('');
  }

  updateStats() {
    const totalWorkers = this.workers.length;
    const onlineWorkers = this.workers.filter(w => w.status === 'online').length;
    const busyWorkers = this.workers.filter(w => w.status === 'busy').length;
    const totalRevenue = this.bookings.reduce((sum, b) => sum + (b.price || 0), 0);

    document.getElementById('total-workers').textContent = totalWorkers;
    document.getElementById('online-workers').textContent = onlineWorkers;
    document.getElementById('busy-workers').textContent = busyWorkers;
    document.getElementById('total-revenue').textContent = `N$ ${totalRevenue.toLocaleString()}`;
    document.getElementById('active-jobs-count').textContent = this.bookings.filter(b => b.status === 'pending' || b.status === 'accepted').length;
  }

  async loadActivityFeed() {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;

    const activities = [
      { icon: 'fa-user-plus', color: 'text-emerald-400', text: 'New worker registered', time: '2 min ago' },
      { icon: 'fa-check-circle', color: 'text-green-400', text: 'Job #1234 completed', time: '15 min ago' },
      { icon: 'fa-spinner', color: 'text-yellow-400', text: 'Worker assigned to job', time: '1 hour ago' },
      { icon: 'fa-dollar-sign', color: 'text-teal-400', text: 'Payment received: N$ 350', time: '2 hours ago' },
      { icon: 'fa-star', color: 'text-yellow-400', text: 'New 5-star review', time: '3 hours ago' }
    ];

    feed.innerHTML = activities.map(activity => `
      <div class="flex items-start gap-3 p-3 rounded-lg bg-white/5">
        <div class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
          <i class="fas ${activity.icon} ${activity.color} text-sm"></i>
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-white text-sm">${activity.text}</p>
          <p class="text-gray-500 text-xs">${activity.time}</p>
        </div>
      </div>
    `).join('');
  }

  exportCSV() {
    const headers = ['Date', 'Client', 'Service', 'Amount', 'Status'];
    const rows = this.bookings.map(b => [
      b.date || '',
      b.address || '',
      b.service || '',
      b.price || 0,
      b.status || 'pending'
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecoshine-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    this.showNotification('CSV exported successfully', 'success');
  }

  exportPDF() {
    this.showNotification('PDF export initiated. Check your downloads.', 'success');
  }

  showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    const bgColor = type === 'success' ? 'bg-green-500/20 border-green-500/30 text-green-400' :
                    type === 'error' ? 'bg-red-500/20 border-red-500/30 text-red-400' :
                    'bg-emerald-500/20 border-emerald-500/30 text-emerald-400';
    
    notification.className = `fixed top-24 right-4 px-6 py-3 rounded-xl border ${bgColor} text-sm font-medium z-50 animate-slide-up`;
    notification.innerHTML = `
      <div class="flex items-center gap-3">
        <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
      </div>
    `;
    
    document.body.appendChild(notification);
    setTimeout(() => {
      notification.remove();
    }, 3000);
  }

  async logout() {
    const result = await window.authService.logoutUser();
    if (result.success) {
      window.location.href = 'auth.html';
    }
  }
}

// Global function for forgot password from admin login gate
async function showAdminForgotPassword() {
  const email = prompt('Enter your admin email to receive a password reset link:');
  if (email) {
    const result = await window.firebaseService.sendPasswordResetEmail(email);
    if (result.success) {
      alert(result.message);
    } else {
      alert(result.error || 'Failed to send reset email.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});
