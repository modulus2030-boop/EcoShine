class DataCounters {
  constructor() {
    this.counters = {};
    this.animated = new Set();
    this.init();
  }

  init() {
    this.setupCounters();
    this.setupObserver();
  }

  setupCounters() {
    this.counterConfigs = {
      water: { target: 45000, suffix: '', prefix: '', format: true },
      carbon: { target: 1250, suffix: '', prefix: '', format: true },
      customers: { target: 2800, suffix: '', prefix: '', format: true },
      chemicals: { target: 350, suffix: '', prefix: '', format: true },
      trees: { target: 180, suffix: '', prefix: '', format: true },
      waste: { target: 1200, suffix: '', prefix: '', format: true }
    };
  }

  setupObserver() {
    const counterSection = document.getElementById('eco-counters');
    if (!counterSection) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.animated.has('eco-counters')) {
          this.animated.add('eco-counters');
          this.animateAllCounters();
        }
      });
    }, { threshold: 0.3 });

    observer.observe(counterSection);
  }

  animateAllCounters() {
    const counterElements = document.querySelectorAll('[data-counter]');
    
    counterElements.forEach(el => {
      const counterType = el.dataset.counter;
      const target = parseInt(el.dataset.target) || 0;
      const config = this.counterConfigs[counterType] || {};
      
      this.animateCounter(el, target, config);
    });
  }

  animateCounter(element, target, config = {}) {
    const duration = 2000;
    const startTime = performance.now();
    const startValue = 0;

    const updateCounter = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOutQuart = 1 - Math.pow(1 - progress, 4);
      const current = Math.floor(startValue + (target - startValue) * easeOutQuart);
      
      const formatted = this.formatNumber(current);
      element.textContent = formatted;
      
      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      } else {
        element.textContent = this.formatNumber(target);
        element.classList.add('animate-counter');
        setTimeout(() => element.classList.remove('animate-counter'), 500);
      }
    };

    requestAnimationFrame(updateCounter);
  }

  formatNumber(num) {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    } else if (num >= 1000) {
      return num.toLocaleString();
    }
    return num.toString();
  }

  // Public API for external updates
  updateCounter(counterType, newTarget) {
    const element = document.querySelector(`[data-counter="${counterType}"]`);
    if (!element) return;
    
    const target = parseInt(newTarget) || 0;
    this.animateCounter(element, target, this.counterConfigs[counterType] || {});
  }

  resetCounters() {
    this.animated.clear();
    const counterElements = document.querySelectorAll('[data-counter]');
    counterElements.forEach(el => {
      el.textContent = '0';
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.dataCounters = new DataCounters();
});
