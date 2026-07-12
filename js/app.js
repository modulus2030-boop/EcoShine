class App {
  constructor() {
    this.init();
  }

  init() {
    this.initNavbar();
    this.initMobileMenu();
    this.initDashboardLogin();
    this.initSmoothScroll();
    this.initAnimations();
  }

  initNavbar() {
    const navbar = document.getElementById('navbar');
    if (!navbar) return;

    let lastScroll = 0;
    
    window.addEventListener('scroll', () => {
      const currentScroll = window.pageYOffset;
      
      if (currentScroll > 50) {
        navbar.classList.add('glass-strong', 'shadow-lg');
        navbar.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
      } else {
        navbar.classList.remove('glass-strong', 'shadow-lg');
        navbar.style.borderBottom = 'none';
      }

      lastScroll = currentScroll;
    });
  }

  initMobileMenu() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    
    if (!menuBtn || !mobileMenu) return;

    menuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
      const icon = menuBtn.querySelector('i');
      if (icon) {
        icon.classList.toggle('fa-bars');
        icon.classList.toggle('fa-times');
      }
    });

    // Close menu when clicking a link
    const menuLinks = mobileMenu.querySelectorAll('a');
    menuLinks.forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        const icon = menuBtn.querySelector('i');
        if (icon) {
          icon.classList.add('fa-bars');
          icon.classList.remove('fa-times');
        }
      });
    });
  }

  initDashboardLogin() {
    const loginGate = document.getElementById('login-gate');
    const investorDashboard = document.getElementById('investor-dashboard');
    const ecoDashboard = document.getElementById('eco-dashboard');
    const loginBtn = document.getElementById('login-btn');
    const accessCodeInput = document.getElementById('access-code');
    const logoutBtn = document.getElementById('logout-btn');
    const viewEcoBtn = document.getElementById('view-eco-dashboard');

    if (!loginGate || !investorDashboard) return;

    const CORRECT_CODE = 'ecoshine2024';

    if (loginBtn && accessCodeInput) {
      loginBtn.addEventListener('click', () => {
        const code = accessCodeInput.value.trim().toLowerCase();
        
        if (code === CORRECT_CODE) {
          loginGate.style.opacity = '0';
          loginGate.style.pointerEvents = 'none';
          setTimeout(() => {
            loginGate.classList.add('hidden');
            investorDashboard.classList.remove('hidden');
            investorDashboard.classList.add('animate-fade-in');
          }, 300);
        } else {
          accessCodeInput.classList.add('ring-2', 'ring-red-500/50', 'border-red-500/50');
          accessCodeInput.style.animation = 'shake 0.5s ease-in-out';
          setTimeout(() => {
            accessCodeInput.classList.remove('ring-2', 'ring-red-500/50', 'border-red-500/50');
            accessCodeInput.style.animation = '';
          }, 2000);
        }
      });

      accessCodeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          loginBtn.click();
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        investorDashboard.classList.add('hidden');
        loginGate.classList.remove('hidden');
        loginGate.style.opacity = '1';
        loginGate.style.pointerEvents = 'auto';
        
        const accessCode = document.getElementById('access-code');
        if (accessCode) accessCode.value = '';
      });
    }

    if (viewEcoBtn && ecoDashboard && investorDashboard) {
      viewEcoBtn.addEventListener('click', () => {
        loginGate.classList.add('hidden');
        investorDashboard.classList.add('hidden');
        ecoDashboard.classList.remove('hidden');
      });
    }
  }

  initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const href = this.getAttribute('href');
        if (href === '#') return;
        
        e.preventDefault();
        const target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
          });
        }
      });
    });
  }

  initAnimations() {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-slide-up');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    document.querySelectorAll('.glass-card, .service-card, .vehicle-option, .service-option, .payment-option').forEach(el => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(20px)';
      observer.observe(el);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
