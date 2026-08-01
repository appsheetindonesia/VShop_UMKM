/* ========================================
   LIGAT Fiber ISP - Main JavaScript
   ======================================== */
(function() {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);

    // ========================================
    // NAVBAR SCROLL EFFECT
    // ========================================
    function initNavbar() {
        const navbar = $('#navbar');
        const navToggle = $('#navToggle');
        const navLinks = $('#navLinks');

        if (!navbar) return;

        let lastScroll = 0;
        window.addEventListener('scroll', () => {
            const currentScroll = window.pageYOffset;
            if (currentScroll > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
            lastScroll = currentScroll;
        });

        if (navToggle && navLinks) {
            navToggle.addEventListener('click', () => {
                navToggle.classList.toggle('active');
                navLinks.classList.toggle('open');
            });

            // Close on link click
            $$('.nav-link').forEach(link => {
                link.addEventListener('click', () => {
                    navToggle.classList.remove('active');
                    navLinks.classList.remove('open');
                });
            });
        }
    }

    // ========================================
    // HERO PARTICLES
    // ========================================
    function initParticles() {
        const container = $('#heroParticles');
        if (!container) return;

        const count = window.innerWidth < 768 ? 20 : 50;
        for (let i = 0; i < count; i++) {
            const particle = document.createElement('div');
            particle.className = 'hero-particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.animationDelay = Math.random() * 8 + 's';
            particle.style.animationDuration = (6 + Math.random() * 6) + 's';
            particle.style.width = (1 + Math.random() * 2) + 'px';
            particle.style.height = particle.style.width;
            container.appendChild(particle);
        }
    }

    // ========================================
    // COUNTER ANIMATION
    // ========================================
    function animateCounter(el, target, duration) {
        const start = 0;
        const startTime = performance.now();
        const isFloat = target < 100;

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = Math.floor(start + (target - start) * eased);

            if (isFloat) {
                el.textContent = current.toFixed(target % 1 === 0 ? 0 : 1);
            } else {
                el.textContent = current.toLocaleString('id-ID');
            }

            if (progress < 1) requestAnimationFrame(update);
        }

        requestAnimationFrame(update);
    }

    function initCounters() {
        const counters = $$('.stat-number');
        if (!counters.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !entry.target.dataset.animated) {
                    entry.target.dataset.animated = 'true';
                    const target = parseFloat(entry.target.dataset.target);
                    animateCounter(entry.target, target, 2000);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(c => observer.observe(c));
    }

    // ========================================
    // PACKAGE TOGGLE
    // ========================================
    function initPackageToggle() {
        const toggle = $('#packageToggle');
        if (!toggle) return;

        const labels = $$('.toggle-label');

        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            const isYearly = toggle.classList.contains('active');

            labels.forEach(label => {
                if ((isYearly && label.dataset.period === 'yearly') ||
                    (!isYearly && label.dataset.period === 'monthly')) {
                    label.classList.add('active');
                } else {
                    label.classList.remove('active');
                }
            });

            // Update prices
            const prices = $$('.price-amount');
            prices.forEach(price => {
                const target = price.dataset[isYearly ? 'yearly' : 'monthly'];
                if (target) {
                    const formatted = parseInt(target).toLocaleString('id-ID');
                    price.style.opacity = '0';
                    setTimeout(() => {
                        price.textContent = formatted;
                        price.style.opacity = '1';
                    }, 150);
                }
            });
        });
    }

    // ========================================
    // SPEED TEST
    // ========================================
    function initSpeedtest() {
        const btn = $('#speedtestBtn');
        const gauge = $('#gaugeArc');
        const gaugeValue = $('#gaugeValue');
        const speedDownload = $('#speedDownload');
        const speedUpload = $('#speedUpload');
        const speedLatency = $('#speedLatency');

        if (!btn) return;

        const totalArc = 251.3;

        btn.addEventListener('click', () => {
            if (btn.classList.contains('running')) return;

            btn.classList.add('running');
            btn.querySelector('.btn-text').textContent = 'Testing...';

            const targetSpeed = 250; // Simulated peak Mbps
            const targetLatency = 5;
            const duration = 3000;
            const startTime = performance.now();

            function animate(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);

                const currentSpeed = Math.floor(targetSpeed * eased);
                const currentLatency = Math.floor(targetLatency + (15 - targetLatency) * (1 - eased));
                const arcLength = totalArc * eased;

                gaugeValue.textContent = currentSpeed;
                gauge.setAttribute('stroke-dasharray', `${arcLength} ${totalArc}`);
                speedDownload.textContent = currentSpeed + ' Mbps';
                speedUpload.textContent = Math.floor(currentSpeed * 0.8) + ' Mbps';
                speedLatency.textContent = currentLatency + ' ms';

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    btn.classList.remove('running');
                    btn.querySelector('.btn-text').textContent = 'Test Ulang';
                    showToast('Selesai! LIGAT Fiber siap melayani Anda');
                }
            }

            // Reset
            gaugeValue.textContent = '0';
            gauge.setAttribute('stroke-dasharray', `0 ${totalArc}`);
            speedDownload.textContent = '...';
            speedUpload.textContent = '...';
            speedLatency.textContent = '...';

            requestAnimationFrame(animate);
        });
    }

    // ========================================
    // TESTIMONIAL CAROUSEL
    // ========================================
    function initTestimonialCarousel() {
        const track = $('#testimonialTrack');
        const prevBtn = $('#testimonialPrev');
        const nextBtn = $('#testimonialNext');
        const dotsContainer = $('#carouselDots');

        if (!track) return;

        const cards = $$('.testimonial-card');
        let currentIndex = 0;
        let cardsPerView = 3;

        function updateCardsPerView() {
            if (window.innerWidth <= 768) {
                cardsPerView = 1;
            } else if (window.innerWidth <= 1024) {
                cardsPerView = 2;
            } else {
                cardsPerView = 3;
            }
        }

        function getMaxIndex() {
            return Math.max(0, cards.length - cardsPerView);
        }

        function createDots() {
            if (!dotsContainer) return;
            dotsContainer.innerHTML = '';
            const totalDots = getMaxIndex() + 1;
            for (let i = 0; i < totalDots; i++) {
                const dot = document.createElement('div');
                dot.className = 'carousel-dot' + (i === currentIndex ? ' active' : '');
                dot.addEventListener('click', () => goTo(i));
                dotsContainer.appendChild(dot);
            }
        }

        function updateDots() {
            if (!dotsContainer) return;
            const dots = dotsContainer.querySelectorAll('.carousel-dot');
            dots.forEach((dot, i) => {
                dot.classList.toggle('active', i === currentIndex);
            });
        }

        function goTo(index) {
            const max = getMaxIndex();
            currentIndex = Math.max(0, Math.min(index, max));
            const cardWidth = cards[0].offsetWidth + 24;
            track.style.transform = `translateX(-${currentIndex * cardWidth}px)`;
            updateDots();
        }

        if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentIndex - 1));
        if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentIndex + 1));

        function init() {
            updateCardsPerView();
            createDots();
        }

        init();
        window.addEventListener('resize', () => {
            updateCardsPerView();
            createDots();
            goTo(currentIndex);
        });
    }

    // ========================================
    // FORM VALIDATION & SUBMIT
    // ========================================
    function validatePhone(phone) {
        const cleaned = phone.replace(/\D/g, '');
        return cleaned.length >= 10 && cleaned.length <= 13 && cleaned.startsWith('08');
    }

    function validateEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function showError(fieldId, message) {
        const field = $('#' + fieldId);
        const error = $('#' + fieldId + 'Error');
        if (field) field.classList.add('error');
        if (error) error.textContent = message;
    }

    function clearError(fieldId) {
        const field = $('#' + fieldId);
        const error = $('#' + fieldId + 'Error');
        if (field) field.classList.remove('error');
        if (error) error.textContent = '';
    }

    function initContactForm() {
        const form = $('#contactForm');
        if (!form) return;

        const fields = ['name', 'phone', 'address'];

        fields.forEach(field => {
            const el = $('#' + field);
            if (el) {
                el.addEventListener('input', () => clearError(field));
            }
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            let isValid = true;

            const name = $('#name').value.trim();
            const phone = $('#phone').value.trim();
            const email = $('#email').value.trim();
            const address = $('#address').value.trim();

            // Clear all errors
            fields.forEach(f => clearError(f));
            clearError('email');

            if (name.length < 3) {
                showError('name', 'Nama minimal 3 karakter');
                isValid = false;
            }

            if (!validatePhone(phone)) {
                showError('phone', 'Nomor WhatsApp tidak valid (contoh: 081234567890)');
                isValid = false;
            }

            if (email && !validateEmail(email)) {
                showError('email', 'Format email tidak valid');
                isValid = false;
            }

            if (address.length < 10) {
                showError('address', 'Mohon isi alamat lengkap');
                isValid = false;
            }

            if (isValid) {
                const btn = $('#submitBtn');
                const btnText = btn.querySelector('.btn-text');
                const btnLoading = btn.querySelector('.btn-loading');

                btnText.style.display = 'none';
                btnLoading.style.display = 'inline-flex';

                // Simulate submission
                setTimeout(() => {
                    btnText.style.display = 'inline';
                    btnLoading.style.display = 'none';
                    btnText.textContent = 'Terkirim!';
                    btn.style.background = 'var(--success)';

                    showToast('Pendaftaran berhasil! Tim kami akan menghubungi Anda segera.');

                    setTimeout(() => {
                        form.reset();
                        btnText.textContent = 'Kirim Pendaftaran';
                        btn.style.background = '';
                    }, 2500);
                }, 1500);
            }
        });
    }

    // ========================================
    // SCROLL ANIMATIONS
    // ========================================
    function initScrollAnimations() {
        const elements = $$('[data-aos]');
        if (!elements.length) return;

        const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry, i) => {
                if (entry.isIntersecting) {
                    setTimeout(() => {
                        entry.target.classList.add('aos-animate');
                    }, i * 80);
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        elements.forEach(el => observer.observe(el));
    }

    // ========================================
    // BACK TO TOP
    // ========================================
    function initBackToTop() {
        const btn = $('#backToTop');
        if (!btn) return;

        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 500) {
                btn.classList.add('visible');
            } else {
                btn.classList.remove('visible');
            }
        });

        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ========================================
    // TOAST
    // ========================================
    function showToast(message) {
        const toast = $('#toast');
        const msg = $('#toastMessage');
        if (!toast || !msg) return;

        msg.textContent = message;
        toast.classList.add('show');
        setTimeout(() => {
            toast.classList.remove('show');
        }, 4000);
    }

    // ========================================
    // SMOOTH SCROLL FOR ANCHORS
    // ========================================
    function initSmoothScroll() {
        $$('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function(e) {
                const href = this.getAttribute('href');
                if (href === '#' || href.length < 2) return;

                const target = document.querySelector(href);
                if (target) {
                    e.preventDefault();
                    const offset = 80;
                    const targetPos = target.offsetTop - offset;
                    window.scrollTo({
                        top: targetPos,
                        behavior: 'smooth'
                    });
                }
            });
        });
    }

    // ========================================
    // FAQ ACCORDION - SMOOTH HEIGHT ANIMATION
    // ========================================
    function initFaqAccordion() {
        const faqItems = $$('.faq-item button.faq-question');
        if (!faqItems.length) return;

        faqItems.forEach(btn => {
            btn.addEventListener('click', () => {
                const item = btn.parentElement;
                const answer = item.querySelector('.faq-answer');
                const icon = btn.querySelector('.faq-icon');
                const isOpen = item.classList.contains('open');

                // Close all others first
                const allItems = $$('.faq-item.open');
                allItems.forEach(openItem => {
                    if (openItem !== item) {
                        openItem.classList.remove('open');
                        const openAnswer = openItem.querySelector('.faq-answer');
                        if (openAnswer) openAnswer.style.maxHeight = '0';
                        const openIcon = openItem.querySelector('.faq-icon');
                        if (openIcon) openIcon.style.transform = 'rotate(0deg)';
                    }
                });

                if (isOpen) {
                    item.classList.remove('open');
                    answer.style.maxHeight = '0';
                    icon.style.transform = 'rotate(0deg)';
                } else {
                    item.classList.add('open');
                    answer.style.maxHeight = answer.scrollHeight + 'px';
                    icon.style.transform = 'rotate(180deg)';
                }
            });
        });
    }

    // ========================================
    // BILLING FORM - MOCK RESULT CARD
    // ========================================
    function initBillingForm() {
        const form = $('#billingForm');
        const result = $('#billingResult');
        if (!form || !result) return;

        // Mock data lookup
        const mockData = {
            'LGT12345': { name: 'Rudi Santoso', package: 'Premium 100 Mbps', due: '15 Agustus 2026', total: 'Rp 350.000' },
            'LGT67890': { name: 'Dewi Wulandari', package: 'Ultimate 300 Mbps', due: '20 Agustus 2026', total: 'Rp 550.000' },
            'LGT11111': { name: 'Andi Hakim', package: 'Standard 50 Mbps', due: '10 Agustus 2026', total: 'Rp 250.000' },
            'LGT22222': { name: 'Citra Lestari', package: 'Basic 20 Mbps', due: '25 Agustus 2026', total: 'Rp 150.000' },
            'LGT33333': { name: 'Budi Pratama', package: 'Premium 100 Mbps', due: '5 September 2026', total: 'Rp 350.000' }
        };

        const billingError = $('#billingError');
        const customerInput = $('#customerId');

        if (customerInput) {
            customerInput.addEventListener('input', () => {
                if (billingError) billingError.textContent = '';
                result.style.display = 'none';
            });
        }

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = customerInput.value.trim().toUpperCase();

            if (billingError) billingError.textContent = '';

            if (!id) {
                if (billingError) billingError.textContent = 'Masukkan ID Pelanggan';
                return;
            }

            if (id.length < 6) {
                if (billingError) billingError.textContent = 'ID Pelanggan minimal 6 karakter';
                return;
            }

            // Simulate network delay
            const btn = form.querySelector('button');
            const origText = btn.textContent;
            btn.textContent = 'Mencari...';
            btn.disabled = true;

            setTimeout(() => {
                btn.textContent = origText;
                btn.disabled = false;

                const data = mockData[id] || null;

                if (data) {
                    $('#billName').textContent = data.name;
                    $('#billPackage').textContent = data.package;
                    $('#billDue').textContent = data.due;
                    $('#billTotal').textContent = data.total;
                    result.style.display = 'block';
                    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                } else {
                    if (billingError) billingError.textContent = 'ID Pelanggan tidak ditemukan. Gunakan contoh: LGT12345';
                    result.style.display = 'none';
                }
            }, 800);
        });
    }

    // ========================================
    // SOCIAL PROOF - RANDOM POPUP
    // ========================================
    function initSocialProof() {
        const popup = $('#socialProof');
        if (!popup) return;

        const names = ['Andi', 'Budi', 'Citra', 'Dewi', 'Eko'];
        const packages = ['20 Mbps', '50 Mbps', '100 Mbps', '300 Mbps'];
        const avatarColors = [
            'linear-gradient(135deg, #667eea, #764ba2)',
            'linear-gradient(135deg, #f093fb, #f5576c)',
            'linear-gradient(135deg, #4facfe, #00f2fe)',
            'linear-gradient(135deg, #43e97b, #38f9d7)',
            'linear-gradient(135deg, #fa709a, #fee140)'
        ];

        const spName = $('#spName');
        const spPackage = $('#spPackage');
        const spAvatar = $('#spAvatar');

        let timer = null;

        function showPopup() {
            if (popup.classList.contains('visible')) return;

            const idx = Math.floor(Math.random() * names.length);
            const pkIdx = Math.floor(Math.random() * packages.length);
            const name = names[idx];
            const pkg = packages[pkIdx];

            spName.textContent = name;
            spPackage.textContent = 'Paket ' + pkg;
            spAvatar.style.background = avatarColors[idx];
            spAvatar.textContent = name.charAt(0);

            popup.classList.add('visible');

            setTimeout(() => {
                popup.classList.remove('visible');
            }, 4000);
        }

        function scheduleNext() {
            const delay = 15000 + Math.random() * 10000; // 15-25 seconds
            timer = setTimeout(() => {
                showPopup();
                scheduleNext();
            }, delay);
        }

        // Start only when page is visible
        function handleVisibility() {
            if (document.hidden) {
                clearTimeout(timer);
            } else {
                scheduleNext();
            }
        }

        document.addEventListener('visibilitychange', handleVisibility);

        // Initial schedule
        scheduleNext();
    }

    // ========================================
    // WHATSAPP FLOATING BUTTON - SHOW AFTER 400px
    // ========================================
    function initWhatsappFloat() {
        const waBtn = $('#waFloat');
        if (!waBtn) return;

        let visible = false;

        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 400) {
                if (!visible) {
                    visible = true;
                    waBtn.classList.add('visible');
                }
            } else {
                if (visible) {
                    visible = false;
                    waBtn.classList.remove('visible');
                }
            }
        });
    }

    // ========================================
    // INIT
    // ========================================
    document.addEventListener('DOMContentLoaded', () => {
        initNavbar();
        initParticles();
        initCounters();
        initPackageToggle();
        initSpeedtest();
        initTestimonialCarousel();
        initContactForm();
        initScrollAnimations();
        initBackToTop();
        initSmoothScroll();
        initFaqAccordion();
        initBillingForm();
        initSocialProof();
        initWhatsappFloat();
    });

})();