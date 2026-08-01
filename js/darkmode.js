/* ========================================
   Dark Mode Toggle
   ======================================== */
(function() {
    'use strict';

    const STORAGE_KEY = 'luxebag-darkmode';

    function initDarkMode() {
        const toggle = document.getElementById('darkModeToggle');
        if (!toggle) return;

        // Load saved preference or system preference
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'true' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
        }

        toggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            const isDark = document.documentElement.classList.contains('dark');
            localStorage.setItem(STORAGE_KEY, isDark);
        });

        // Listen for system changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (!localStorage.getItem(STORAGE_KEY)) {
                document.documentElement.classList.toggle('dark', e.matches);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDarkMode);
    } else {
        initDarkMode();
    }
})();
