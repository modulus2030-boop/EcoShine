class BookingWizard {
  constructor() {
    this.currentStep = 1;
    this.totalSteps = 6;
    this.bookingData = {
      address: '',
      area: '',
      notes: '',
      vehicle: '',
      service: '',
      price: 0,
      date: '',
      time: '',
      payment: ''
    };
    this.map = null;
    this.marker = null;
    this.suburbCoords = {
      'ongwediva-central': { lat: -17.9167, lng: 15.9667, name: 'Ongwediva Central' },
      'uupindi': { lat: -17.9000, lng: 15.9800, name: 'Uupindi' },
      'okapuka': { lat: -17.9300, lng: 15.9500, name: 'Okapuka' },
      'onayena': { lat: -17.8800, lng: 15.9400, name: 'Onayena' },
      'okupeke': { lat: -17.9400, lng: 15.9900, name: 'Okupeke' },
      'omulondo': { lat: -17.8500, lng: 16.0000, name: 'Omulondo' },
      'okakwa': { lat: -17.9600, lng: 15.9600, name: 'Okakwa' },
      'onamutai': { lat: -17.8900, lng: 16.0200, name: 'Onamutai' },
      'okambebe': { lat: -17.9200, lng: 15.9300, name: 'Okambebe' },
      'okatyali': { lat: -17.8700, lng: 15.9700, name: 'Okatyali' },
      'uukwaluudhi': { lat: -17.9500, lng: 16.0100, name: 'Uukwaluudhi' },
      'okathitu': { lat: -17.9100, lng: 16.0300, name: 'Okathitu' },
      'onamungundo': { lat: -17.8600, lng: 15.9900, name: 'Onamungundo' },
      'okuokamwandi': { lat: -17.9400, lng: 15.9400, name: 'Okuokamwandi' },
      'other': { lat: -17.9167, lng: 15.9667, name: 'Other Area' }
    };
    this.init();
  }

  init() {
    this.bindNavigation();
    this.bindStepInputs();
    this.initMap();
    this.showStep(1);
  }

  initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer || typeof L === 'undefined') return;

    // Nationwide fallback view (used until GPS resolves or if denied).
    const country = (window.ECOWASH_CONFIG && window.ECOWASH_CONFIG.countryCenter) || { lat: -22.56, lng: 17.47 };
    const countryZoom = (window.ECOWASH_CONFIG && window.ECOWASH_CONFIG.countryZoom) || 6;

    // Initialize map centered on the country by default (not Windhoek).
    // minZoom keeps the view focused on Namibia and prevents zooming out
    // to the wider world scale.
    this.map = L.map('map', {
      center: [country.lat, country.lng],
      zoom: countryZoom,
      minZoom: 5,
      zoomControl: true,
      attributionControl: true
    });

    setTimeout(() => { this.map.invalidateSize(); }, 200);

    // OpenStreetMap tiles (100% free, no API key / credit card).
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    // Custom marker icon
    const customIcon = L.divIcon({
      className: 'custom-marker',
      html: '<div style="width:20px;height:20px;background:rgba(109,187,109,0.9);border:3px solid #fff;border-radius:50%;box-shadow:0 0 20px rgba(109,187,109,0.6);"></div>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    // Add marker (initially placed at the national center until the user
    // drops a pin or GPS centers the map on them).
    this.marker = L.marker([country.lat, country.lng], { icon: customIcon, draggable: true }).addTo(this.map);
    this.marker.bindPopup('<b>Your current location</b>');
    this.selectedLocation = { lat: country.lat, lng: country.lng };

    // Try to get the user's current GPS location immediately.
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          this.map.setView([lat, lng], 15);
          this.marker.setLatLng([lat, lng]);
          this.selectedLocation = { lat, lng };
          this.marker.bindPopup('<b>Your current location</b>').openPopup();

          // Reverse geocode to get the address.
          this.reverseGeocode(lat, lng);
        },
        (error) => {
          // Permission denied / unavailable: keep the national view.
          console.log('Geolocation unavailable or denied. Using nationwide view.', error && error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000
        }
      );
    }

    // Update address when marker is dragged
    this.marker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      this.selectedLocation = { lat: pos.lat, lng: pos.lng };
      this.reverseGeocode(pos.lat, pos.lng);
    });

    // Update marker on map click
    this.map.on('click', (e) => {
      this.marker.setLatLng(e.latlng);
      this.selectedLocation = { lat: e.latlng.lat, lng: e.latlng.lng };
      this.reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    // Bind search
    this.bindMapSearch();

    // Bind suburb dropdown
    this.bindSuburbDropdown();
  }

  bindMapSearch() {
    const searchInput = document.getElementById('map-search');
    const resultsContainer = document.getElementById('search-results');
    if (!searchInput || !resultsContainer) return;

    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();
      if (query.length < 3) {
        resultsContainer.classList.add('hidden');
        return;
      }
      debounceTimer = setTimeout(() => this.searchLocation(query), 300);
    });

    searchInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();
        if (query.length >= 3) this.searchLocation(query);
      }
    });

    // Close results when clicking outside
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !resultsContainer.contains(e.target)) {
        resultsContainer.classList.add('hidden');
      }
    });
  }

  async searchLocation(query) {
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Namibia')}&limit=5&addressdetails=1`);
      const data = await response.json();
      
      if (data.length === 0) {
        resultsContainer.innerHTML = '<div class="search-result-item text-gray-400 text-sm">No results found</div>';
        resultsContainer.classList.remove('hidden');
        return;
      }

      resultsContainer.innerHTML = data.map(item => `
        <div class="search-result-item" data-lat="${item.lat}" data-lon="${item.lon}" data-display="${item.display_name}">
          <p class="text-white text-sm font-medium">${item.display_name.split(',')[0]}</p>
          <p class="text-gray-400 text-xs">${item.display_name.split(',').slice(1, 3).join(',')}</p>
        </div>
      `).join('');
      resultsContainer.classList.remove('hidden');

      // Bind click events to results
      resultsContainer.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          const lat = parseFloat(item.dataset.lat);
          const lon = parseFloat(item.dataset.lon);
          const display = item.dataset.display;
          
          this.map.setView([lat, lon], 15);
          this.marker.setLatLng([lat, lon]);
          this.selectedLocation = { lat, lng: lon };
          
          const addressInput = document.getElementById('booking-address');
          if (addressInput) addressInput.value = display.split(',')[0];
          
          resultsContainer.classList.add('hidden');
          document.getElementById('map-search').value = display.split(',')[0];
        });
      });
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  reverseGeocode(lat, lng) {
    const addressInput = document.getElementById('booking-address');
    if (!addressInput) return;

    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`)
      .then(response => response.json())
      .then(data => {
        if (data && data.display_name) {
          addressInput.value = data.display_name.split(',')[0];
        }
      })
      .catch(err => console.error('Reverse geocode error:', err));
  }

  bindSuburbDropdown() {
    const areaSelect = document.getElementById('booking-area');
    if (!areaSelect || !this.map) return;

    areaSelect.addEventListener('change', (e) => {
      const suburbKey = e.target.value;
      if (suburbKey && this.suburbCoords[suburbKey]) {
        const coords = this.suburbCoords[suburbKey];
        this.map.setView([coords.lat, coords.lng], 14);
        this.marker.setLatLng([coords.lat, coords.lng]);
        
        const addressInput = document.getElementById('booking-address');
        if (addressInput && !addressInput.value) {
          addressInput.value = coords.name + ', Windhoek';
        }
      }
    });
  }

  bindNavigation() {
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.prevStep());
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.nextStep());
    }
  }

  bindStepInputs() {
    // Vehicle selection
    const vehicleOptions = document.querySelectorAll('.vehicle-option');
    vehicleOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        vehicleOptions.forEach(o => o.classList.remove('border-emerald-500/50', 'bg-emerald-500/10'));
        opt.classList.add('border-emerald-500/50', 'bg-emerald-500/10');
        this.bookingData.vehicle = opt.dataset.vehicle;
      });
    });

    // Service selection
    const serviceOptions = document.querySelectorAll('.service-option');
    serviceOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        serviceOptions.forEach(o => o.classList.remove('border-emerald-500/50', 'bg-emerald-500/10'));
        opt.classList.add('border-emerald-500/50', 'bg-emerald-500/10');
        this.bookingData.service = opt.dataset.service;
        this.bookingData.price = parseInt(opt.dataset.price) || 0;
      });
    });

    // Time slots
    const timeSlots = document.querySelectorAll('.time-slot');
    timeSlots.forEach(slot => {
      slot.addEventListener('click', () => {
        timeSlots.forEach(s => {
          s.classList.remove('bg-emerald-500/20', 'border-emerald-500/50', 'text-emerald-400');
          s.classList.add('text-gray-300');
        });
        slot.classList.remove('text-gray-300');
        slot.classList.add('bg-emerald-500/20', 'border-emerald-500/50', 'text-emerald-400');
        this.bookingData.time = slot.dataset.time;
        const timeSelect = document.getElementById('booking-time');
        if (timeSelect) timeSelect.value = slot.dataset.time;
      });
    });

    // Payment selection
    const paymentOptions = document.querySelectorAll('.payment-option');
    paymentOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        paymentOptions.forEach(o => o.classList.remove('border-emerald-500/50', 'bg-emerald-500/10'));
        opt.classList.add('border-emerald-500/50', 'bg-emerald-500/10');
        this.bookingData.payment = opt.dataset.payment;
      });
    });

    // Date input
    const dateInput = document.getElementById('booking-date');
    if (dateInput) {
      dateInput.addEventListener('change', (e) => {
        this.bookingData.date = e.target.value;
      });
    }
  }

  showStep(step) {
    const steps = document.querySelectorAll('.wizard-step');
    steps.forEach(s => s.classList.add('hidden'));
    
    const currentStepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
    if (currentStepEl) {
      currentStepEl.classList.remove('hidden');
      currentStepEl.classList.add('animate-fade-in');
    }

    // Update step indicators
    document.querySelectorAll('[data-step-indicator]').forEach(indicator => {
      const indicatorStep = parseInt(indicator.dataset.stepIndicator);
      const circle = indicator.querySelector('.step-indicator');
      const text = indicator.querySelector('span:last-child');
      
      if (indicatorStep <= step) {
        circle.classList.remove('text-gray-500', 'border-transparent');
        circle.classList.add('text-emerald-400', 'border-emerald-500');
        if (text) text.classList.remove('text-gray-400');
        if (text) text.classList.add('text-emerald-400');
      } else {
        circle.classList.add('text-gray-500', 'border-transparent');
        circle.classList.remove('text-emerald-400', 'border-emerald-500');
        if (text) text.classList.add('text-gray-400');
        if (text) text.classList.remove('text-emerald-400');
      }
    });

    // Update progress bar
    const progress = ((step - 1) / (this.totalSteps - 1)) * 100;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) progressBar.style.width = `${progress}%`;

    // Show/hide navigation buttons
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    
    if (prevBtn) prevBtn.disabled = step === 1;
    
    if (nextBtn) {
      if (step === this.totalSteps) {
        nextBtn.innerHTML = '<span class="relative z-10 flex items-center gap-2"><i class="fas fa-check"></i> Confirm Booking</span>';
      } else {
        nextBtn.innerHTML = '<span class="relative z-10 flex items-center gap-2">Next <i class="fas fa-arrow-right"></i></span>';
      }
    }

    // Invalidate map size when step 1 becomes visible
    if (step === 1 && this.map) {
      setTimeout(() => this.map.invalidateSize(), 100);
    }
  }

  validateStep(step) {
    switch(step) {
      case 1:
        const address = document.getElementById('booking-address');
        const area = document.getElementById('booking-area');
        if (!address || !address.value.trim()) {
          this.highlightField(address);
          return false;
        }
        if (!area || !area.value) {
          this.highlightField(area);
          return false;
        }
        this.bookingData.address = address.value;
        this.bookingData.area = area.value;
        const notes = document.getElementById('booking-notes');
        this.bookingData.notes = notes ? notes.value : '';
        return true;
      
      case 2:
        if (!this.bookingData.vehicle) {
          alert('Please select a vehicle type');
          return false;
        }
        return true;
      
      case 3:
        if (!this.bookingData.service) {
          alert('Please select a service package');
          return false;
        }
        return true;
      
      case 4:
        const date = document.getElementById('booking-date');
        const time = document.getElementById('booking-time');
        if (!date || !date.value) {
          this.highlightField(date);
          return false;
        }
        if (!this.bookingData.time && (!time || !time.value)) {
          alert('Please select a time slot');
          return false;
        }
        this.bookingData.date = date.value;
        this.bookingData.time = time ? time.value : this.bookingData.time;
        return true;
      
      case 5:
        if (!this.bookingData.payment) {
          alert('Please select a payment method');
          return false;
        }
        this.updateSummary();
        return true;
      
      default:
        return true;
    }
  }

  highlightField(field) {
    if (!field) return;
    field.classList.add('ring-2', 'ring-red-500/50', 'border-red-500/50');
    setTimeout(() => {
      field.classList.remove('ring-2', 'ring-red-500/50', 'border-red-500/50');
    }, 2000);
    field.focus();
  }

  nextStep() {
    if (this.currentStep >= this.totalSteps) {
      this.confirmBooking();
      return;
    }

    if (this.validateStep(this.currentStep)) {
      this.currentStep++;
      this.showStep(this.currentStep);
      
      // Booking is created on the final "Confirm" (see confirmBooking),
      // which then subscribes to live tracking itself.
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.showStep(this.currentStep);
    }
  }

  updateSummary() {
    const summaryEl = document.getElementById('booking-summary');
    if (!summaryEl) return;
    
    const serviceNames = {
      express: 'Express Wash',
      premium: 'Premium Wash',
      interior: 'Interior Clean',
      detailing: 'Full Detailing',
      suv: 'SUV / Large Vehicle',
      fleet: 'Fleet & Corporate'
    };
    
    const paymentNames = {
      cash: 'Cash (on-site)',
      card: 'Card Machine',
      bank: 'Bank Transfer / PayPal'
    };

    const vehicleNames = {
      sedan: 'Sedan',
      suv: 'SUV / Bakkie',
      van: 'Van / Minibus',
      motorcycle: 'Motorcycle',
      fleet: 'Fleet',
      other: 'Other'
    };

    summaryEl.innerHTML = `
      <p><span class="text-gray-500">Vehicle:</span> <span class="text-white">${vehicleNames[this.bookingData.vehicle] || 'N/A'}</span></p>
      <p><span class="text-gray-500">Service:</span> <span class="text-white">${serviceNames[this.bookingData.service] || 'N/A'}</span></p>
      <p><span class="text-gray-500">Date:</span> <span class="text-white">${this.bookingData.date || 'N/A'}</span></p>
      <p><span class="text-gray-500">Time:</span> <span class="text-white">${this.bookingData.time || 'N/A'}</span></p>
      <p><span class="text-gray-500">Payment:</span> <span class="text-white">${paymentNames[this.bookingData.payment] || 'N/A'}</span></p>
      <p><span class="text-gray-500">Total:</span> <span class="text-emerald-400 font-bold text-lg">N$ ${this.bookingData.price.toLocaleString()}</span></p>
    `;
  }

  startRealTracking(bookingId) {
    if (!window.EcoWash || !window.EcoWash.startCustomerTracking) {
      this.startTrackingSimulation();
      return;
    }

    const techName = document.getElementById('tech-name');
    const techStatus = document.getElementById('tech-status');
    const techBadge = document.getElementById('tech-badge');
    const techEta = document.getElementById('tech-eta');
    const techVehicle = document.getElementById('tech-vehicle');
    const trackingProgress = document.getElementById('tracking-progress');

    if (techName) techName.textContent = 'Searching for washer...';

    // Map marker for the washer (added once we know their position).
    let washerMarker = null;

    const statusMeta = {
      Waiting:   { step: 0, label: 'Pending',            badge: 'Pending',   color: 'bg-yellow-500/20 text-yellow-400' },
      Searching: { step: 0, label: 'Searching for washer', badge: 'Searching', color: 'bg-yellow-500/20 text-yellow-400' },
      Assigned:  { step: 1, label: 'Technician Assigned',  badge: 'Assigned',  color: 'bg-blue-500/20 text-blue-400' },
      EnRoute:   { step: 2, label: 'En Route to Location', badge: 'En-Route', color: 'bg-purple-500/20 text-purple-400' },
      Arrived:   { step: 3, label: 'Technician Arrived',   badge: 'Arrived',   color: 'bg-emerald-500/20 text-emerald-400' },
      Washing:   { step: 3, label: 'Washing your vehicle', badge: 'Washing',  color: 'bg-emerald-500/20 text-emerald-400' },
      Completed: { step: 4, label: 'Wash Completed',       badge: 'Completed', color: 'bg-emerald-500/20 text-emerald-400' }
    };

    const paint = (status, eta, vehicle) => {
      const meta = statusMeta[status] || statusMeta['Waiting'];
      const step = meta.step;

      if (trackingProgress) trackingProgress.style.width = `${(step / 3) * 100}%`;

      for (let i = 1; i <= 4; i++) {
        const stepEl = document.getElementById(`track-step-${i}`);
        if (!stepEl) continue;
        const circle = stepEl.querySelector('div');
        const text = stepEl.querySelector('span');
        if (i <= step) {
          circle.classList.remove('glass-strong', 'text-gray-500', 'border-transparent');
          circle.classList.add('bg-emerald-500/20', 'border-emerald-500', 'text-emerald-400');
          if (text) { text.classList.remove('text-gray-500'); text.classList.add('text-emerald-400'); }
        }
      }

      if (techStatus) techStatus.textContent = `Status: ${meta.label}`;
      if (techBadge) {
        techBadge.textContent = meta.badge;
        techBadge.className = `px-3 py-1 rounded-full text-xs font-medium ${meta.color}`;
      }
      if (techEta && eta != null) techEta.textContent = eta === 0 ? 'Arriving now' : `Washer arriving in ${eta} min`;
    };

    this._unsubTracking = window.EcoWash.startCustomerTracking(bookingId, {
      onUpdate: (data) => {
        if (techName && data.washerId) techName.textContent = 'Technician #' + data.washerId.slice(-4).toUpperCase();
        paint(data.status, data.etaMinutes, data.vehicle);
        if (data.status === 'Completed' && !this.ratingPromptedForBooking) {
          this.ratingPromptedForBooking = true;
          const user = auth && auth.currentUser ? auth.currentUser : null;
          window.EcoWash.promptRating({ bookingId, reviewerId: user ? user.uid : null, reviewerRole: 'customer' });
        }
      },
      onWasherMove: (w) => {
        if (!this.map) return;
        const latlng = [w.lat, w.lng];
        if (!washerMarker) {
          washerMarker = L.marker(latlng, {
            icon: L.divIcon({
              className: '',
              html: '<div style="width:22px;height:22px;background:#23799c;border:3px solid #fff;border-radius:50%;box-shadow:0 0 20px rgba(35,121,156,0.8);"></div>',
              iconSize: [22, 22], iconAnchor: [11, 11]
            })
          }).addTo(this.map);
        } else {
          washerMarker.setLatLng(latlng);
        }
        if (this.selectedLocation) {
          this.map.setView(latlng, Math.max(this.map.getZoom(), 14));
        }
      },
      onError: (err) => console.error('Tracking error:', err)
    });
  }

  startTrackingSimulation() {
    const steps = [
      { delay: 1000, step: 1, status: 'Pending', badge: 'Pending', badgeColor: 'bg-yellow-500/20 text-yellow-400', eta: 'Awaiting technician', vehicle: 'N/A' },
      { delay: 3000, step: 2, status: 'Technician Assigned', badge: 'Assigned', badgeColor: 'bg-blue-500/20 text-blue-400', eta: 'Calculating...', vehicle: 'Toyota Hilux - WH 12345' },
      { delay: 5000, step: 3, status: 'En Route to Location', badge: 'En-Route', badgeColor: 'bg-purple-500/20 text-purple-400', eta: '~15 mins', vehicle: 'Toyota Hilux - WH 12345' },
      { delay: 8000, step: 4, status: 'Technician Arrived', badge: 'Arrived', badgeColor: 'bg-emerald-500/20 text-emerald-400', eta: 'On site', vehicle: 'Toyota Hilux - WH 12345' }
    ];

    const techName = document.getElementById('tech-name');
    const techStatus = document.getElementById('tech-status');
    const techBadge = document.getElementById('tech-badge');
    const techEta = document.getElementById('tech-eta');
    const techVehicle = document.getElementById('tech-vehicle');
    const trackingProgress = document.getElementById('tracking-progress');

    steps.forEach(({ delay, step, status, badge, badgeColor, eta, vehicle }) => {
      setTimeout(() => {
        // Update progress bar
        if (trackingProgress) {
          trackingProgress.style.width = `${((step - 1) / 3) * 100}%`;
        }

        // Update step indicators
        for (let i = 1; i <= 4; i++) {
          const stepEl = document.getElementById(`track-step-${i}`);
          if (!stepEl) continue;
          const circle = stepEl.querySelector('div');
          const text = stepEl.querySelector('span');
          
          if (i <= step) {
            circle.classList.remove('glass-strong', 'text-gray-500', 'border-transparent');
            circle.classList.add('bg-emerald-500/20', 'border-emerald-500', 'text-emerald-400');
            if (text) {
              text.classList.remove('text-gray-500');
              text.classList.add('text-emerald-400');
            }
          }
        }

        // Update tech info
        if (techStatus) techStatus.textContent = `Status: ${status}`;
        if (techBadge) {
          techBadge.textContent = badge;
          techBadge.className = `px-3 py-1 rounded-full text-xs font-medium ${badgeColor}`;
        }
        if (techEta) techEta.textContent = eta;
        if (techVehicle) techVehicle.textContent = vehicle;

      }, delay);
    });

    // Set initial tech name
    if (techName) techName.textContent = 'Eco Technician';
    setTimeout(() => {
      if (techName) techName.textContent = 'Eco Technician';
    }, 2500);
  }

  confirmBooking() {
    const bookingIdEl = document.getElementById('booking-id');
    const nextBtn = document.getElementById('next-btn');

    if (nextBtn) {
      nextBtn.innerHTML = '<span class="relative z-10 flex items-center gap-2"><i class="fas fa-spinner fa-spin"></i> Finding washer...</span>';
      nextBtn.disabled = true;
      nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }

    const user = (window.authService && auth && auth.currentUser) ? auth.currentUser : null;
    const loc = this.selectedLocation || { lat: -22.56, lng: 17.47 };

    // Persist the chosen coordinates onto the booking data too.
    this.bookingData.lat = loc.lat;
    this.bookingData.lng = loc.lng;

    if (window.EcoWash && window.EcoWash.createBooking) {
      window.EcoWash.createBooking({
        customerId: user ? user.uid : null,
        customerLocation: loc,
        service: this.bookingData.service,
        vehicle: this.bookingData.vehicle,
        address: this.bookingData.address,
        area: this.bookingData.area,
        notes: this.bookingData.notes,
        date: this.bookingData.date,
        time: this.bookingData.time,
        payment: this.bookingData.payment,
        price: this.bookingData.price
      }).then((result) => {
        if (!result.success) {
          if (nextBtn) {
            nextBtn.innerHTML = '<span class="relative z-10 flex items-center gap-2"><i class="fas fa-exclamation-triangle"></i> Try Again</span>';
            nextBtn.disabled = false;
            nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
          }
          alert('Could not create booking: ' + (result.error || 'unknown error'));
          return;
        }

        const id = result.id;
        if (bookingIdEl) bookingIdEl.textContent = '#' + id.slice(-6).toUpperCase();
        this.currentBookingId = id;

        // Subscribe to live tracking (Step 5 & 6) instead of a fake simulation.
        this.startRealTracking(id);
      });
    } else {
      if (bookingIdEl) bookingIdEl.textContent = '#ESH-' + Date.now().toString().slice(-6);
      this.startTrackingSimulation();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // This wizard is a legacy/standalone implementation.
  // The real customer booking wizard lives in dashboard.html and uses
  // a different Leaflet container (#booking-wizard-map-instance).
  // Guard against double-initialization/conflicting DOM assumptions.
  if (document.getElementById('booking-wizard-map-instance')) return;
  window.bookingWizard = new BookingWizard();
});
