/* ========================================
   Contact Page - Form Handling
   ======================================== */
(function() {
    'use strict';

    const form = document.getElementById('contactForm');
    if (!form) return;

    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const name = document.getElementById('contactName')?.value.trim();
        const email = document.getElementById('contactEmail')?.value.trim();
        const subject = document.getElementById('contactSubject')?.value;
        const message = document.getElementById('contactMessage')?.value.trim();

        if (!name || !email || !subject || !message) {
            window.showToast('Mohon lengkapi semua field yang wajib diisi.');
            return;
        }

        // Simulate send
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"/></svg> Mengirim...';

        setTimeout(() => {
            window.showToast('Pesan berhasil dikirim! Kami akan segera menghubungi Anda.');
            form.reset();
            btn.disabled = false;
            btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Kirim Pesan';
        }, 1500);
    });

})();
