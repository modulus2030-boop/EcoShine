class PricingEngine {
  constructor() {
    this.selectedService = null;
    this.selectedAddons = new Set();
    this.servicePrices = {
      express: 150,
      premium: 280,
      interior: 350,
      detailing: 750,
      suv: 450,
      fleet: 0
    };
    this.addonPrices = {
      engine: 120,
      seat: 150,
      headlight: 80,
      wax: 100,
      odor: 60
    };
    this.init();
  }

  init() {
    this.bindServiceCards();
    this.bindAddonCheckboxes();
    this.updateTotal();
  }

  bindServiceCards() {
    const cards = document.querySelectorAll('.service-card');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('input')) return;
        const service = card.dataset.service;
        const price = parseInt(card.dataset.price);
        
        cards.forEach(c => c.classList.remove('service-card-active', 'border-emerald-500/50', 'bg-emerald-500/10'));
        card.classList.add('service-card-active', 'border-emerald-500/50', 'bg-emerald-500/10');
        
        this.selectedService = { name: service, price: price };
        this.updateTotal();
      });
    });
  }

  bindAddonCheckboxes() {
    const checkboxes = document.querySelectorAll('.addon-checkbox');
    checkboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const addon = checkbox.dataset.addon;
        const price = parseInt(checkbox.dataset.price);
        
        if (checkbox.checked) {
          this.selectedAddons.add({ name: addon, price: price });
          checkbox.closest('.addon-item').classList.add('border-emerald-500/30', 'bg-emerald-500/5');
        } else {
          this.selectedAddons.forEach(a => {
            if (a.name === addon) this.selectedAddons.delete(a);
          });
          checkbox.closest('.addon-item').classList.remove('border-emerald-500/30', 'bg-emerald-500/5');
        }
        this.updateTotal();
      });
    });
  }

  updateTotal() {
    const serviceNameEl = document.getElementById('total-service-name');
    const totalPriceEl = document.getElementById('total-price');
    const totalAddonsEl = document.getElementById('total-addons');
    const addonsBreakdownEl = document.getElementById('addons-breakdown');
    const bookNowBtn = document.getElementById('book-now-btn');

    let total = 0;
    let serviceName = 'None';
    
    if (this.selectedService) {
      total += this.selectedService.price;
      const serviceNames = {
        express: 'Express Wash',
        premium: 'Premium Wash',
        interior: 'Interior Clean',
        detailing: 'Full Detailing',
        suv: 'SUV / Large Vehicle',
        fleet: 'Fleet & Corporate'
      };
      serviceName = serviceNames[this.selectedService.name] || this.selectedService.name;
    }

    let addonsTotal = 0;
    if (this.selectedAddons.size > 0) {
      addonsBreakdownEl.classList.remove('hidden');
      this.selectedAddons.forEach(addon => {
        addonsTotal += addon.price;
      });
      totalAddonsEl.textContent = `N$ ${addonsTotal.toLocaleString()}`;
    } else {
      addonsBreakdownEl.classList.add('hidden');
    }

    serviceNameEl.textContent = serviceName;
    totalPriceEl.textContent = `N$ ${total.toLocaleString()}`;

    if (this.selectedService && this.selectedService.name !== 'fleet') {
      bookNowBtn.disabled = false;
    } else if (this.selectedService && this.selectedService.name === 'fleet') {
      bookNowBtn.disabled = false;
      bookNowBtn.querySelector('span').innerHTML = '<i class="fas fa-envelope"></i> Contact for Quote';
    } else {
      bookNowBtn.disabled = true;
    }
  }

  getSelectedService() {
    return this.selectedService;
  }

  getSelectedAddons() {
    return Array.from(this.selectedAddons);
  }

  getTotalPrice() {
    let total = this.selectedService ? this.selectedService.price : 0;
    this.selectedAddons.forEach(addon => total += addon.price);
    return total;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.pricingEngine = new PricingEngine();
});
