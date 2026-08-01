/* ========================================
   Katalog Page - Filters, Sort, Search
   ======================================== */
(function() {
    'use strict';

    const products = window.appProducts || [];
    let currentFilter = 'all';
    let currentSort = 'default';
    let searchQuery = '';

    const grid = document.getElementById('productsGrid');
    const countEl = document.getElementById('productCount');
    const emptyEl = document.getElementById('catalogEmpty');
    const resetBtn = document.getElementById('resetFilters');

    if (!grid) return;

    // Read URL params
    const params = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');
    const qParam = params.get('q');
    if (catParam) currentFilter = catParam;
    if (qParam) searchQuery = qParam;

    // Set active filter button
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.filter === currentFilter) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Set search input
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchQuery) searchInput.value = searchQuery;

    function getFilteredProducts() {
        let filtered = [...products];

        if (currentFilter !== 'all') {
            filtered = filtered.filter(p => p.category === currentFilter);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(p =>
                p.name.toLowerCase().includes(q) ||
                p.category.toLowerCase().includes(q) ||
                p.desc.toLowerCase().includes(q)
            );
        }

        switch (currentSort) {
            case 'price-low': filtered.sort((a, b) => a.price - b.price); break;
            case 'price-high': filtered.sort((a, b) => b.price - a.price); break;
            case 'name': filtered.sort((a, b) => a.name.localeCompare(b.name)); break;
            case 'rating': filtered.sort((a, b) => b.rating - a.rating); break;
            case 'newest': filtered.sort((a, b) => b.id - a.id); break;
        }

        return filtered;
    }

    function render() {
        const filtered = getFilteredProducts();

        if (filtered.length === 0) {
            grid.style.display = 'none';
            emptyEl.style.display = 'flex';
            countEl.textContent = '0 produk';
        } else {
            grid.style.display = '';
            emptyEl.style.display = 'none';
            countEl.textContent = `${filtered.length} produk`;

            grid.innerHTML = filtered.map(p => {
                const discount = p.oldPrice ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
                return `
                    <div class="product-card" data-id="${p.id}">
                        <div class="product-img" style="background:${p.color}">
                            ${p.badge ? `<span class="product-badge ${p.badge}">${p.badge === 'sale' ? discount + '%' : p.badge === 'new' ? 'Baru' : 'Hot'}</span>` : ''}
                        </div>
                        <div class="product-info">
                            <span class="product-category">${p.category}</span>
                            <h3 class="product-name">${p.name}</h3>
                            <div class="product-rating">
                                <span class="stars">${'★'.repeat(Math.floor(p.rating))}${'☆'.repeat(5 - Math.floor(p.rating))}</span>
                                <span class="rating-text">${p.rating} (${p.reviews})</span>
                            </div>
                            <div class="product-price">
                                <span class="current-price">Rp ${p.price.toLocaleString('id-ID')}</span>
                                ${p.oldPrice ? `<span class="old-price">Rp ${p.oldPrice.toLocaleString('id-ID')}</span>` : ''}
                            </div>
                            <button class="btn btn-outline btn-sm add-to-cart-btn" data-id="${p.id}">Tambah ke Keranjang</button>
                        </div>
                    </div>`;
            }).join('');

            // Attach events
            grid.querySelectorAll('.add-to-cart-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const id = +btn.dataset.id;
                    const p = products.find(x => x.id === id);
                    if (p) {
                        Cart.addItem(p, p.sizes[0]);
                    }
                });
            });

            grid.querySelectorAll('.product-card').forEach(card => {
                card.addEventListener('click', () => {
                    const id = +card.dataset.id;
                    const p = products.find(x => x.id === id);
                    if (p) openCatalogModal(p);
                });
            });
        }
    }

    function openCatalogModal(p) {
        const overlay = document.getElementById('modalOverlay');
        const body = document.getElementById('modalBody');
        if (!overlay || !body) return;

        body.innerHTML = `
            <div class="modal-product">
                <div class="modal-product-img" style="background:${p.color}">
                    ${p.badge ? `<span class="product-badge ${p.badge}">${p.badge}</span>` : ''}
                </div>
                <div class="modal-product-info">
                    <span class="product-category">${p.category}</span>
                    <h2>${p.name}</h2>
                    <div class="product-rating">
                        <span class="stars">${'★'.repeat(Math.floor(p.rating))}${'☆'.repeat(5 - Math.floor(p.rating))}</span>
                        <span class="rating-text">${p.rating} (${p.reviews} ulasan)</span>
                    </div>
                    <div class="product-price modal-price">
                        <span class="current-price">Rp ${p.price.toLocaleString('id-ID')}</span>
                        ${p.oldPrice ? `<span class="old-price">Rp ${p.oldPrice.toLocaleString('id-ID')}</span>` : ''}
                    </div>
                    <p class="modal-desc">${p.desc}</p>
                    <div class="modal-sizes">
                        <label>Ukuran:</label>
                        <div class="size-options">${p.sizes.map((s, i) =>
                            `<button class="size-btn ${i === 0 ? 'active' : ''}" data-size="${s}">${s}</button>`
                        ).join('')}</div>
                    </div>
                    <button class="btn btn-primary btn-full modal-add-btn" data-id="${p.id}">Tambah ke Keranjang</button>
                </div>
            </div>`;

        body.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                body.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        body.querySelector('.modal-add-btn').addEventListener('click', () => {
            const size = body.querySelector('.size-btn.active')?.dataset.size || p.sizes[0];
            Cart.addItem(p, size);
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        });

        overlay.classList.add('open');
        document.body.style.overflow = 'hidden';

        document.getElementById('modalClose')?.addEventListener('click', () => {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
        });
    }

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            render();
        });
    });

    // Sort
    const sortSelect = document.getElementById('sortSelect');
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            currentSort = sortSelect.value;
            render();
        });
    }

    // Search form
    const searchForm = document.getElementById('catalogSearchForm');
    if (searchForm) {
        searchForm.addEventListener('submit', (e) => {
            e.preventDefault();
            searchQuery = searchInput?.value.trim() || '';
            render();
        });
    }

    // Reset filters
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            currentFilter = 'all';
            currentSort = 'default';
            searchQuery = '';
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            document.querySelector('.filter-btn[data-filter="all"]')?.classList.add('active');
            if (sortSelect) sortSelect.value = 'default';
            if (searchInput) searchInput.value = '';
            render();
        });
    }

    // Initial render
    render();

})();
