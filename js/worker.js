class WorkerPortal {
  constructor() {
    this.currentUser = null;
    this.availableJobs = [];
    this.activeJobs = [];
    this.jobHistory = [];
    this.isOnline = true;
    this.workerMap = null;
    this.workerMapReady = false;
    this.workerMapJobId = null;
    this.workerMapLiveLocation = null;
    this.workerMapWorkerMarker = null;
    this.workerMapCustomerMarker = null;
    this.workerMapRouteLayer = null;
    this.workerMapWorkerUnsub = null;
    this.workerMapJobUnsub = null;
    this.init();
  }

  init() {
    this.checkAuth();
    this.bindEvents();
  }

  async checkAuth() {
    const result = await window.authService.getCurrentUser();
    if (!result.success || result.role !== 'worker') {
      window.location.href = 'auth.html';
      return;
    }
    
    this.currentUser = result.user;
    const loginGate = document.getElementById('worker-login-gate');
    const portal = document.getElementById('worker-portal');
    if (loginGate) loginGate.classList.add('hidden');
    if (portal) portal.classList.remove('hidden');
    const nameDisplay = document.getElementById('worker-display-name');
    if (nameDisplay) nameDisplay.textContent = window.authService.displayName(result.user);
    const greetingEl = document.getElementById('worker-greeting');
    if (greetingEl) {
      const displayName = window.authService.displayName(result.user);
      const firstName = displayName.split(' ')[0] || displayName;
      greetingEl.textContent = 'Welcome ' + firstName + '!';
    }
    this.loadWorkerData();
    this.setupRealtimeListeners();
    this.startWasherSession();
    this.initWorkerMap();
    this.syncWorkerMap();
  }

  bindEvents() {
    // Worker login
    document.getElementById('worker-login-btn')?.addEventListener('click', () => this.workerLogin());

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
    document.getElementById('mobile-logout-btn')?.addEventListener('click', () => this.logout());

    // Toggle online status
    document.getElementById('toggle-status-btn')?.addEventListener('click', () => this.toggleStatus());
    document.getElementById('worker-map-navigate-btn')?.addEventListener('click', () => this.navigateCurrentJob());

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });
  }

  async workerLogin() {
    const email = document.getElementById('worker-email').value;
    const password = document.getElementById('worker-password').value;
    const errorEl = document.getElementById('worker-login-error');
    const btn = document.getElementById('worker-login-btn');

    if (!email || !password) {
      errorEl.textContent = 'Please enter both email and password.';
      errorEl.style.display = 'block';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';

    const result = await window.authService.loginUser(email, password);
    
    if (result.success && result.role === 'worker') {
      errorEl.style.display = 'none';
      this.currentUser = result.user;
      document.getElementById('worker-login-gate').classList.add('hidden');
      document.getElementById('worker-portal').classList.remove('hidden');
      const displayName = window.authService.displayName(result.user);
      const nameDisplay = document.getElementById('worker-display-name');
      if (nameDisplay) nameDisplay.textContent = displayName;
      const greetingEl = document.getElementById('worker-greeting');
      if (greetingEl) {
        const firstName = displayName.split(' ')[0] || displayName;
        greetingEl.textContent = 'Welcome ' + firstName + '!';
      }
      this.loadWorkerData();
      this.setupRealtimeListeners();
      this.startWasherSession();
      this.initWorkerMap();
      this.syncWorkerMap();
      btn.disabled = false;
      btn.innerHTML = '<span class="relative z-10 flex items-center justify-center gap-2"><i class="fas fa-sign-in-alt"></i> Access Portal</span>';
    } else {
      errorEl.textContent = result.error || 'Access denied. Worker credentials required.';
      errorEl.style.display = 'block';
      btn.disabled = false;
      btn.innerHTML = '<span class="relative z-10 flex items-center justify-center gap-2"><i class="fas fa-sign-in-alt"></i> Access Portal</span>';
    }
  }

  setupRealtimeListeners() {
    // Only attach once the worker is authenticated (avoids permission-denied on load).
    if (this.listenersSetup) return;
    if (!window.firebaseService || !window.firebaseService.db || !this.currentUser) return;
    this.listenersSetup = true;

    const STATUS = (window.EcoWash && window.EcoWash.STATUS) || {};
    const openStatuses = [STATUS.SEARCHING || 'Searching', STATUS.WAITING || 'Waiting'];

    // Listen for open jobs (unassigned) the washer can claim.
    window.firebaseService.db.collection('bookings')
      .where('status', 'in', openStatuses)
      .where('washerId', '==', null)
      .onSnapshot(snapshot => {
        this.availableJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.renderAvailableJobs();
      }, error => {
        console.error('Bookings listener error:', error);
      });

    // Listen for this washer's active assignments.
    window.firebaseService.db.collection('bookings')
      .where('washerId', '==', this.currentUser.uid)
      .where('status', 'in', [
        STATUS.ASSIGNED || 'Assigned',
        STATUS.EN_ROUTE || 'EnRoute',
        STATUS.ARRIVED || 'Arrived',
        STATUS.WASHING || 'Washing',
        STATUS.COMPLETED || 'Completed'
      ])
      .onSnapshot(snapshot => {
        this.activeJobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        this.renderActiveJobs();
      }, error => {
        console.error('Active jobs listener error:', error);
      });
  }

  async loadWorkerData() {
    if (!this.currentUser) return;

    try {
      const doc = await window.firebaseService.db.collection('users').doc(this.currentUser.uid).get();
      if (doc.exists) {
        const data = doc.data();
        document.getElementById('worker-earnings').textContent = (data.earnings || 0).toLocaleString();
        this.isOnline = data.status === 'online';
        this.updateStatusButton();
      }
    } catch (error) {
      console.error('Error loading worker data:', error);
    }
  }

  initWorkerMap() {
    if (this.workerMapReady || !window.L || !this.currentUser) return;

    const container = document.getElementById('worker-live-map');
    if (!container) return;

    this.workerMapReady = true;
    const defaultCenter = (window.EcoWash && window.EcoWash.cfg && window.EcoWash.cfg.countryCenter) || { lat: -22.56, lng: 17.47 };

    this.workerMap = L.map('worker-live-map', {
      center: [defaultCenter.lat, defaultCenter.lng],
      zoom: 7,
      minZoom: 4,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: ''
    }).addTo(this.workerMap);

    setTimeout(() => {
      if (this.workerMap) this.workerMap.invalidateSize();
    }, 200);

    this.attachWorkerMapListeners();
    this.syncWorkerMap();
  }

  attachWorkerMapListeners() {
    if (!window.firebaseService || !window.firebaseService.db || !this.currentUser) return;
    if (this.workerMapWorkerUnsub) return;

    this.workerMapWorkerUnsub = window.firebaseService.db.collection('liveLocations').doc(this.currentUser.uid)
      .onSnapshot((doc) => {
        if (!doc.exists) return;
        this.workerMapLiveLocation = doc.data();
        this.syncWorkerMap();
      }, (error) => console.error('Worker live location listener error:', error));
  }

  detachWorkerMapListeners() {
    if (this.workerMapWorkerUnsub) {
      this.workerMapWorkerUnsub();
      this.workerMapWorkerUnsub = null;
    }
    if (this.workerMapJobUnsub) {
      this.workerMapJobUnsub();
      this.workerMapJobUnsub = null;
    }
  }

  getCoordsFromLocation(location) {
    if (!location) return null;
    const lat = location.latitude != null ? location.latitude : location.lat;
    const lng = location.longitude != null ? location.longitude : location.lng;
    if (lat == null || lng == null) return null;
    return { lat, lng };
  }

  getPrimaryActiveJob() {
    if (!this.activeJobs || this.activeJobs.length === 0) return null;
    const STATUS = (window.EcoWash && window.EcoWash.STATUS) || {};
    const priority = [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING, STATUS.COMPLETED];
    return this.activeJobs.find(job => priority.includes(job.status)) || this.activeJobs[0];
  }

  clearWorkerMapShapes() {
    if (!this.workerMap) return;
    if (this.workerMapRouteLayer) {
      try { this.workerMap.removeLayer(this.workerMapRouteLayer); } catch (e) {}
      this.workerMapRouteLayer = null;
    }
    if (this.workerMapCustomerMarker) {
      try { this.workerMap.removeLayer(this.workerMapCustomerMarker); } catch (e) {}
      this.workerMapCustomerMarker = null;
    }
  }

  syncWorkerMap() {
    if (!this.workerMapReady || !this.workerMap) return;

    const mapStatus = document.getElementById('worker-map-status');
    const navigateBtn = document.getElementById('worker-map-navigate-btn');
    const job = this.getPrimaryActiveJob();

    if (!job) {
      if (mapStatus) mapStatus.textContent = 'Waiting for an active job assignment.';
      if (navigateBtn) navigateBtn.disabled = true;
      this.clearWorkerMapShapes();
      const workerCoords = this.getCoordsFromLocation(this.workerMapLiveLocation);
      if (workerCoords) {
        this.updateWorkerMarker(workerCoords);
        this.workerMap.setView([workerCoords.lat, workerCoords.lng], 14, { animate: true, duration: 0.8 });
      }
      return;
    }

    if (navigateBtn) navigateBtn.disabled = false;
    this.workerMapJobId = job.id;
    const jobLabel = job.service || 'Car Wash Service';
    const statusLabel = job.status || 'Assigned';
    if (mapStatus) {
      mapStatus.textContent = `${jobLabel} · ${statusLabel}`;
    }

    const customerCoords = this.getCoordsFromLocation(job.customerLocation || job.customerLoc);
    const workerCoords = this.getCoordsFromLocation(this.workerMapLiveLocation);

    if (customerCoords) {
      this.updateCustomerMarker(customerCoords, job);
    }
    if (workerCoords) {
      this.updateWorkerMarker(workerCoords);
    }

    this.drawWorkerRoute(workerCoords, customerCoords);

    if (workerCoords && customerCoords) {
      this.workerMap.fitBounds([[workerCoords.lat, workerCoords.lng], [customerCoords.lat, customerCoords.lng]], {
        padding: [50, 50],
        maxZoom: 15,
        animate: true,
        duration: 0.8
      });
    } else if (customerCoords) {
      this.workerMap.setView([customerCoords.lat, customerCoords.lng], 15, { animate: true, duration: 0.8 });
    } else if (workerCoords) {
      this.workerMap.setView([workerCoords.lat, workerCoords.lng], 14, { animate: true, duration: 0.8 });
    }
  }

  updateWorkerMarker(coords) {
    if (!this.workerMap) return;
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:22px;height:22px;background:#23799c;border:3px solid #fff;border-radius:50%;box-shadow:0 0 18px rgba(35,121,156,0.8);"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    if (!this.workerMapWorkerMarker) {
      this.workerMapWorkerMarker = L.marker([coords.lat, coords.lng], { icon }).addTo(this.workerMap);
      this.workerMapWorkerMarker.bindPopup('<b>Your live location</b>');
    } else {
      this.workerMapWorkerMarker.setLatLng([coords.lat, coords.lng]);
    }
  }

  updateCustomerMarker(coords, job) {
    if (!this.workerMap) return;
    const icon = L.divIcon({
      className: '',
      html: '<div style="width:22px;height:22px;background:#6dbb6d;border:3px solid #fff;border-radius:50%;box-shadow:0 0 18px rgba(109,187,109,0.85);"></div>',
      iconSize: [22, 22],
      iconAnchor: [11, 11]
    });

    if (!this.workerMapCustomerMarker) {
      this.workerMapCustomerMarker = L.marker([coords.lat, coords.lng], { icon }).addTo(this.workerMap);
    } else {
      this.workerMapCustomerMarker.setLatLng([coords.lat, coords.lng]);
    }
    const label = job && (job.address || job.clientName || job.service) ? `${job.address || job.clientName || job.service}` : 'Customer location';
    this.workerMapCustomerMarker.bindPopup(`<b>Customer location</b><br>${label}`);
  }

  drawWorkerRoute(workerCoords, customerCoords) {
    if (!this.workerMap) return;
    if (this.workerMapRouteLayer) {
      try { this.workerMap.removeLayer(this.workerMapRouteLayer); } catch (e) {}
      this.workerMapRouteLayer = null;
    }

    if (!workerCoords || !customerCoords) return;

    this.workerMapRouteLayer = L.polyline(
      [[workerCoords.lat, workerCoords.lng], [customerCoords.lat, customerCoords.lng]],
      {
        color: '#6dbb6d',
        weight: 4,
        opacity: 0.85,
        dashArray: '7 7'
      }
    ).addTo(this.workerMap);
  }

  navigateCurrentJob() {
    const job = this.getPrimaryActiveJob();
    if (!job) {
      this.showNotification('No active job to navigate to yet.', 'info');
      return;
    }

    const customerCoords = this.getCoordsFromLocation(job.customerLocation || job.customerLoc);
    if (customerCoords) {
      window.EcoWash.openNavigation(customerCoords.lat, customerCoords.lng, job.address || job.clientName || '');
      return;
    }

    this.showNotification('Customer location is not available for this job.', 'error');
  }

  // Start streaming this washer's live GPS + FCM + retry any pending dispatch.
  startWasherSession() {
    if (!this.currentUser) return;
    const uid = this.currentUser.uid;

    if (window.EcoWash) {
      // Mark available so the matching engine can dispatch to us.
      window.firebaseService.db.collection('liveLocations').doc(uid).set(
        { available: true, online: true, timestamp: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      ).catch(() => {});
      window.firebaseService.db.collection('washers').doc(uid).set({
        status: 'available',
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});

      this._gpsWatch = window.EcoWash.startWasherLocationStream(uid, { available: true });
      window.EcoWash.initFCM(uid, 'washers').catch(() => {});
      window.EcoWash.retryPendingDispatch().catch(() => {});
    }
  }

  stopWasherSession() {
    if (window.EcoWash && this.currentUser) {
      window.EcoWash.stopWasherLocationStream(this._gpsWatch, this.currentUser.uid);
    }
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.classList.add('active', 'bg-emerald-500/20', 'border-emerald-500/30', 'text-emerald-400');
        btn.classList.remove('glass', 'border-white/10', 'text-gray-400');
      } else {
        btn.classList.remove('active', 'bg-emerald-500/20', 'border-emerald-500/30', 'text-emerald-400');
        btn.classList.add('glass', 'border-white/10', 'text-gray-400');
      }
    });

    // Show/hide tab content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');

    // Load data for specific tab
    if (tabName === 'history') {
      this.loadJobHistory();
    }
  }

  renderAvailableJobs() {
    const container = document.getElementById('available-jobs');
    if (!container) return;

    if (this.availableJobs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-search text-4xl mb-4 opacity-30"></i>
          <p>No available jobs at the moment</p>
        </div>
      `;
      return;
    }

    container.innerHTML = this.availableJobs.map(job => `
      <div class="job-card glass rounded-2xl p-6 border border-white/10 hover:border-emerald-500/30">
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div class="flex-1">
            <div class="flex items-center gap-2 mb-2">
              <span class="px-2 py-1 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-medium">NEW</span>
              <span class="text-gray-500 text-xs">#${job.id.slice(-6).toUpperCase()}</span>
            </div>
            <h3 class="text-white font-semibold text-lg mb-1">${job.service || 'Car Wash Service'}</h3>
            <p class="text-gray-400 text-sm mb-2">
              <i class="fas fa-map-marker-alt text-emerald-400 mr-2"></i>${job.address || 'Location not specified'}
            </p>
            <div class="flex flex-wrap gap-4 text-xs text-gray-500">
              <span><i class="fas fa-calendar mr-1"></i>${job.date || 'TBD'}</span>
              <span><i class="fas fa-clock mr-1"></i>${job.time || 'TBD'}</span>
              <span><i class="fas fa-car mr-1"></i>${job.vehicle || 'Standard'}</span>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-emerald-400 font-bold text-xl">N$ ${(job.price || 0).toLocaleString()}</span>
            <button onclick="workerPortal.acceptJob('${job.id}')" class="px-6 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all text-sm font-medium">
              <i class="fas fa-check mr-2"></i>Accept
            </button>
          </div>
        </div>
      </div>
    `).join('');
  }

  renderActiveJobs() {
    const container = document.getElementById('active-jobs');
    if (!container) return;

    if (this.activeJobs.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <i class="fas fa-clipboard-list text-4xl mb-4 opacity-30"></i>
          <p>No active jobs</p>
        </div>
      `;
      return;
    }

    const STATUS = (window.EcoWash && window.EcoWash.STATUS) || {};
    const idx = (s) => [STATUS.ASSIGNED, STATUS.EN_ROUTE, STATUS.ARRIVED, STATUS.WASHING, STATUS.COMPLETED].indexOf(s);

    container.innerHTML = this.activeJobs.map(job => {
      const statusLabel = {
        [STATUS.ASSIGNED]: 'Assigned',
        [STATUS.EN_ROUTE]: 'En Route',
        [STATUS.ARRIVED]: 'Arrived',
        [STATUS.WASHING]: 'Washing',
        [STATUS.COMPLETED]: 'Completed'
      }[job.status] || job.status;

      // Status-aware action buttons (Step 7, 8, 9).
      let actions = '';
      if (job.status === STATUS.ASSIGNED) {
        actions = `<button onclick="workerPortal.startEnRoute('${job.id}')" class="px-6 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 transition-all text-sm font-medium">
          <i class="fas fa-directions mr-2"></i>Navigate & Start
        </button>`;
      } else if (job.status === STATUS.EN_ROUTE) {
        actions = `<button onclick="workerPortal.markArrived('${job.id}')" class="px-6 py-2.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-400 hover:bg-purple-500/30 transition-all text-sm font-medium">
          <i class="fas fa-map-pin mr-2"></i>I've Arrived
        </button>`;
      } else if (job.status === STATUS.ARRIVED) {
        actions = `<button onclick="workerPortal.startWash('${job.id}')" class="px-6 py-2.5 rounded-xl bg-teal-500/20 border border-teal-500/30 text-teal-400 hover:bg-teal-500/30 transition-all text-sm font-medium">
          <i class="fas fa-spray-can mr-2"></i>Start Wash
        </button>`;
      } else if (job.status === STATUS.WASHING) {
        actions = `<button onclick="workerPortal.completeJob('${job.id}')" class="px-6 py-2.5 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 transition-all text-sm font-medium">
          <i class="fas fa-check mr-2"></i>Complete
        </button>`;
      }

      const progressPct = Math.max(33, (idx(job.status) + 1) / 5 * 100);

      return `
        <div class="job-card glass rounded-2xl p-6 border border-emerald-500/30">
          <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium">${statusLabel}</span>
                <span class="text-gray-500 text-xs">#${job.id.slice(-6).toUpperCase()}</span>
                ${job.etaMinutes != null ? `<span class="text-gray-500 text-xs"><i class="fas fa-clock mr-1"></i>ETA ${job.etaMinutes} min</span>` : ''}
              </div>
              <h3 class="text-white font-semibold text-lg mb-1">${job.service || 'Car Wash Service'}</h3>
              <p class="text-gray-400 text-sm mb-2">
                <i class="fas fa-map-marker-alt text-emerald-400 mr-2"></i>${job.address || 'Location not specified'}
              </p>
              <div class="flex items-center gap-4 text-xs text-gray-500">
                <span><i class="fas fa-user mr-1"></i>${job.clientName || 'Client'}</span>
                <span><i class="fas fa-phone mr-1"></i>${job.clientPhone || 'N/A'}</span>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span class="text-emerald-400 font-bold text-xl">N$ ${(job.price || 0).toLocaleString()}</span>
              ${actions}
            </div>
          </div>

          <!-- Progress Tracker -->
          <div class="mt-4 pt-4 border-t border-white/5">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <i class="fas fa-check text-emerald-400 text-xs"></i>
                </div>
                <span class="text-xs text-emerald-400">Assigned</span>
              </div>
              <div class="flex-1 h-0.5 bg-white/10 mx-2">
                <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style="width: ${progressPct >= 66 ? '66%' : '33%'}"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full ${job.status === STATUS.EN_ROUTE || idx(job.status) >= 2 ? 'bg-emerald-500/20' : 'bg-white/5'} flex items-center justify-center">
                  <i class="fas fa-truck text-xs ${job.status === STATUS.EN_ROUTE || idx(job.status) >= 2 ? 'text-emerald-400' : 'text-gray-500'}"></i>
                </div>
                <span class="text-xs ${job.status === STATUS.EN_ROUTE || idx(job.status) >= 2 ? 'text-emerald-400' : 'text-gray-500'}">En Route</span>
              </div>
              <div class="flex-1 h-0.5 bg-white/10 mx-2">
                <div class="h-full bg-gradient-to-r from-emerald-500 to-teal-500" style="width: ${idx(job.status) >= 3 ? '100%' : '0%'}"></div>
              </div>
              <div class="flex items-center gap-2">
                <div class="w-8 h-8 rounded-full ${job.status === STATUS.COMPLETED ? 'bg-emerald-500/20' : 'bg-white/5'} flex items-center justify-center">
                  <i class="fas fa-flag-checkered text-xs ${job.status === STATUS.COMPLETED ? 'text-emerald-400' : 'text-gray-500'}"></i>
                </div>
                <span class="text-xs ${job.status === STATUS.COMPLETED ? 'text-emerald-400' : 'text-gray-500'}">Done</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (this.activeJobs.some(job => job.status === (window.EcoWash && window.EcoWash.STATUS && window.EcoWash.STATUS.COMPLETED))) {
      this.promptCompletedJobRating();
    }

    this.syncWorkerMap();
  }

  async loadJobHistory() {
    const tbody = document.getElementById('job-history');
    if (!tbody) return;

    if (this.jobHistory.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" class="text-center py-8 text-gray-500">No job history yet</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = this.jobHistory.map(job => `
      <tr>
        <td>${job.date || 'N/A'}</td>
        <td>${job.clientName || 'N/A'}</td>
        <td>${job.service || 'N/A'}</td>
        <td class="text-emerald-400 font-medium">N$ ${(job.price || 0).toLocaleString()}</td>
        <td>
          <span class="flex items-center gap-1">
            ${'★'.repeat(Math.floor(job.rating || 0))}
            ${'☆'.repeat(5 - Math.floor(job.rating || 0))}
          </span>
        </td>
      </tr>
    `).join('');
  }

  async acceptJob(jobId) {
    if (!this.currentUser) return;

    try {
      await window.EcoWash.acceptBooking(jobId);
      this.showNotification('Job accepted! Navigate to client location.', 'success');
      this.renderAvailableJobs();
    } catch (error) {
      console.error('Error accepting job:', error);
      this.showNotification('Failed to accept job', 'error');
    }
  }

  // STEP 7 - Launch external Google Maps navigation + move to "En Route".
  async startEnRoute(jobId) {
    const jobDoc = await window.firebaseService.db.collection('bookings').doc(jobId).get();
    const job = jobDoc.exists ? jobDoc.data() : null;
    if (job && job.customerLocation) {
      const c = job.customerLocation;
      window.EcoWash.openNavigation(c.latitude, c.longitude, job.address || '');
    }
    await window.EcoWash.updateBookingStatus(jobId, window.EcoWash.STATUS.EN_ROUTE, {
      enRouteAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (this.currentUser) {
      await window.firebaseService.db.collection('washers').doc(this.currentUser.uid).set({
        status: 'en-route',
        activeBookingId: jobId,
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    this.showNotification('En route to customer.', 'success');
  }

  // STEP 8 - Washer has arrived on-site.
  async markArrived(jobId) {
    await window.EcoWash.updateBookingStatus(jobId, window.EcoWash.STATUS.ARRIVED, {
      arrivedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    this.showNotification('Marked as arrived.', 'success');
  }

  // STEP 8 - Begin the wash.
  async startWash(jobId) {
    await window.EcoWash.updateBookingStatus(jobId, window.EcoWash.STATUS.WASHING, {
      washStartedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    if (this.currentUser) {
      await window.firebaseService.db.collection('washers').doc(this.currentUser.uid).set({
        status: 'washing',
        activeBookingId: jobId,
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    this.showNotification('Wash started.', 'success');
  }

  async completeJob(jobId) {
    try {
      const result = await window.EcoWash.completeBooking(jobId);
      if (!result || !result.success) throw new Error(result && result.error ? result.error : 'Completion failed');

      const jobRef = window.firebaseService.db.collection('bookings').doc(jobId);
      const jobDoc = await jobRef.get();
      const job = jobDoc.exists ? jobDoc.data() : null;

      if (this.currentUser) {
        const userRef = window.firebaseService.db.collection('users').doc(this.currentUser.uid);
        const userDoc = await userRef.get();
        const userData = userDoc.exists ? userDoc.data() : {};
        await userRef.update({
          earnings: (userData.earnings || 0) + ((job && job.price) || 0),
          jobsCompleted: (userData.jobsCompleted || 0) + 1,
          status: 'online'
        });
      }

      if (job && job.customerId) {
        window.EcoWash.notifyUser(job.customerId, {
          title: 'Wash completed',
          body: 'Your EcoWash is done. Thank you!'
        }).catch(() => {});
      }

      this.showNotification('Job completed! Payment added to your earnings.', 'success');
      this.loadWorkerData();
    } catch (error) {
      console.error('Error completing job:', error);
      this.showNotification('Failed to complete job', 'error');
    }
  }

  async toggleStatus() {
    const goingOnline = !this.isOnline;
    const newStatus = goingOnline ? 'online' : 'offline';
    
    try {
      await window.firebaseService.db.collection('users').doc(this.currentUser.uid).update({
        status: newStatus
      });

      // Reflect availability in the live-location doc so the matching
      // engine includes/excludes this washer.
      await window.firebaseService.db.collection('liveLocations').doc(this.currentUser.uid).set(
        { online: goingOnline, available: goingOnline, timestamp: firebase.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
      await window.firebaseService.db.collection('washers').doc(this.currentUser.uid).set({
        status: goingOnline ? 'available' : 'offline',
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      if (goingOnline) {
        this.startWasherSession();
        // Re-run dispatch for any bookings waiting on a washer.
        if (window.EcoWash) window.EcoWash.retryPendingDispatch().catch(() => {});
      } else {
        this.stopWasherSession();
      }

      this.isOnline = goingOnline;
      this.updateStatusButton();
      this.syncWorkerMap();
      this.showNotification(`You are now ${newStatus}`, 'success');
    } catch (error) {
      console.error('Error updating status:', error);
    }
  }

  promptCompletedJobRating() {
    if (!this.currentUser || this.hasPromptedRating) return;
    const completedJob = this.activeJobs.find(job => job.status === (window.EcoWash && window.EcoWash.STATUS && window.EcoWash.STATUS.COMPLETED));
    if (!completedJob) return;
    this.hasPromptedRating = true;
    window.EcoWash.promptRating({
      bookingId: completedJob.id,
      reviewerId: this.currentUser.uid,
      reviewerRole: 'worker'
    });
  }

  updateStatusButton() {
    const btn = document.getElementById('toggle-status-btn');
    const badge = document.getElementById('worker-status-badge');
    
    if (this.isOnline) {
      btn.innerHTML = '<i class="fas fa-circle text-xs mr-2"></i>Go Offline';
      btn.className = 'px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-all text-sm font-medium';
      if (badge) {
        badge.className = 'px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-medium border border-green-500/30';
        badge.textContent = 'ONLINE';
      }
    } else {
      btn.innerHTML = '<i class="fas fa-circle text-xs mr-2"></i>Go Online';
      btn.className = 'px-4 py-2 rounded-xl bg-green-500/20 border border-green-500/30 text-green-400 hover:bg-green-500/30 transition-all text-sm font-medium';
      if (badge) {
        badge.className = 'px-3 py-1 rounded-full bg-red-500/20 text-red-400 text-xs font-medium border border-red-500/30';
        badge.textContent = 'OFFLINE';
      }
    }
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
    this.detachWorkerMapListeners();
    const result = await window.authService.logoutUser();
    if (result.success) {
      window.location.href = 'auth.html';
    }
  }
}

// Global function for worker forgot password
async function showWorkerForgotPassword() {
  const email = prompt('Enter your worker email to receive a password reset link:');
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
  window.workerPortal = new WorkerPortal();
});
