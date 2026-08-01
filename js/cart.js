/* ========================================
   Shopping Cart (localStorage)
   ======================================== */
(function() {
    'use strict';

    const CART_KEY = 'luxebag-cart';

    window.Cart = {
        getItems() {
            try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
            catch { return []; }
        },

        saveItems(items) {
            localStorage.setItem(CART_KEY, JSON.stringify(items));
            this.updateCount();
        },

        addItem(product, size) {
            const items = this.getItems();
            const existing = items.find(i => i.id === product.id && i.size === size);
            if (existing) {
                existing.qty++;
            } else {
                items.push({ id: product.id, name: product.name, price: product.price, color: product.color, size, qty: 1 });
            }
            this.saveItems(items);
            showToast(`${product.name} ditambahkan ke keranjang`);
        },

        removeItem(id, size) {
            const items = this.getItems().filter(i => !(i.id === id && i.size === size));
            this.saveItems(items);
            this.renderSidebar();
        },

        updateQty(id, size, delta) {
            const items = this.getItems();
            const item = items.find(i => i.id === id && i.size === size);
            if (item) {
                item.qty += delta;
                if (item.qty <= 0) return this.removeItem(id, size);
            }
            this.saveItems(items);
            this.renderSidebar();
        },

        getTotal() {
            return this.getItems().reduce((sum, i) => sum + i.price * i.qty, 0);
        },

        getCount() {
            return this.getItems().reduce((sum, i) => sum + i.qty, 0);
        },

        updateCount() {
            const count = this.getCount();
            document.querySelectorAll('#cartCount, #cartCountSidebar').forEach(el => {
                if (el) el.textContent = count;
            });
        },

        renderSidebar() {
            const itemsEl = document.getElementById('cartItems');
            const footerEl = document.getElementById('cartFooter');
            if (!itemsEl) return;

            const items = this.getItems();
            if (items.length === 0) {
                itemsEl.innerHTML = '<div class="cart-empty"><p>Keranjang kosong</p></div>';
                footerEl.style.display = 'none';
            } else {
                footerEl.style.display = 'block';
                itemsEl.innerHTML = items.map(item => `
                    <div class="cart-item">
                        <div class="cart-item-img" style="background:${item.color}"></div>
                        <div class="cart-item-info">
                            <h4>${item.name}</h4>
                            <p class="cart-item-size">Ukuran: ${item.size}</p>
                            <p class="cart-item-price">Rp ${item.price.toLocaleString('id-ID')}</p>
                            <div class="cart-item-qty">
                                <button onclick="Cart.updateQty(${item.id},'${item.size}',-1)" aria-label="Kurangi">−</button>
                                <span>${item.qty}</span>
                                <button onclick="Cart.updateQty(${item.id},'${item.size}',1)" aria-label="Tambah">+</button>
                            </div>
                        </div>
                        <button class="cart-item-remove" onclick="Cart.removeItem(${item.id},'${item.size}')" aria-label="Hapus">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                `).join('');
                document.getElementById('cartTotal').textContent = 'Rp ' + this.getTotal().toLocaleString('id-ID');
            }
            this.updateCount();
        },

        init() {
            this.updateCount();
            this.renderSidebar();

            const sidebar = document.getElementById('cartSidebar');
            const overlay = document.getElementById('cartOverlay');
            const openBtn = document.getElementById('cartBtn');
            const closeBtn = document.getElementById('cartClose');

            if (openBtn && sidebar) {
                openBtn.addEventListener('click', () => {
                    this.renderSidebar();
                    sidebar.classList.add('open');
                    overlay.classList.add('open');
                    document.body.style.overflow = 'hidden';
                });
            }

            const closeFn = () => {
                if (sidebar) sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('open');
                document.body.style.overflow = '';
            };

            if (closeBtn) closeBtn.addEventListener('click', closeFn);
            if (overlay) overlay.addEventListener('click', closeFn);
        }
    };

    function showToast(msg) {
        const toast = document.getElementById('toast');
        const msgEl = document.getElementById('toastMessage');
        if (!toast || !msgEl) return;
        msgEl.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Cart.init());
    } else {
        Cart.init();
    }
})();
