# 📦 Panduan Lengkap Instalasi — V Shop (Voucher UMKM)

V Shop adalah aplikasi platform voucher & promo UMKM berbasis **Next.js 14 (App Router) + TypeScript + Tailwind**, dengan backend **Supabase** (Auth phone/OTP, PostgreSQL + RLS, Storage), pembayaran **Midtrans Snap**, dan notifikasi **WhatsApp Cloud API**.

Dokumen ini memandu instalasi di tiga platform hosting:

1. [cPanel (shared hosting + Node.js)](#1-instalasi-di-cpanel)
2. [Easypanel (VPS + Docker)](#2-instalasi-di-easypanel)
3. [aaPanel (VPS + Nginx + PM2)](#3-instalasi-di-aapanel)

> Semua platform memakai **backend yang sama di luar aplikasi** (Supabase cloud + Midtrans + Meta WhatsApp), jadi persiapan di bagian [Persiapan Backend](#bagian-a-persiapan-backend--layanan-eksternal) hanya dilakukan **sekali**.

---

## Daftar Isi

- [Bagian A — Persiapan Backend & Layanan Eksternal](#bagian-a-persiapan-backend--layanan-eksternal)
  - [A.1 Supabase (wajib)](#a1-supabase-wajib)
  - [A.2 Midtrans (wajib untuk pembayaran asli)](#a2-midtrans-wajib-untuk-pembayaran-asli)
  - [A.3 WhatsApp Cloud API (opsional, direkomendasikan)](#a3-whatsapp-cloud-api-opsional-direkomendasikan)
  - [A.4 Variabel Lingkungan Lengkap](#a4-variabel-lingkungan-lengkap)
- [Bagian B — Persiapan di Mesin Lokal (sekali)](#bagian-b-persiapan-di-mesin-lokal-sekali)
- [1. Instalasi di cPanel](#1-instalasi-di-cpanel)
- [2. Instalasi di Easypanel](#2-instalasi-di-easypanel)
- [3. Instalasi di aaPanel](#3-instalasi-di-aapanel)
- [Bagian C — Setelah Deploy (verifikasi, cron, pemantauan)](#bagian-c-setelah-deploy)
- [Troubleshooting](#troubleshooting)
- [Keamanan & Checklist Go-Live](#keamanan--checklist-go-live)

---

## Bagian A — Persiapan Backend & Layanan Eksternal

Aplikasi **tidak menyimpan database sendiri** — semua data tinggal di **Supabase cloud**. Lakukan bagian ini sekali sebelum deploy.

### A.1 Supabase (wajib)

1. Daftar di **https://supabase.com** → **New project** (nama bebas, mis. `vshop`). Pilih region terdekat (mis. Jakarta `ap-southeast-1`) dan password database (simpan baik-baik).
2. Buka project → **SQL Editor** → jalankan **12 file migration secara urut**. Isi setiap file ada di folder `supabase/migrations/` di repo ini, urut dari `0001_init.sql` sampai `0012_storage_owner.sql`:
   - `0001_init.sql` — skema 12 tabel + RLS + bucket storage `vshop-assets` + seed paket
   - `0002_sessions_refresh.sql` — tabel `sessions` (refresh token terenkripsi lintas perangkat)
   - `0003_grants.sql` — privilege grants (least-privilege ala CLI lokal)
   - `0004_claims_expiry_notify.sql` — kolom `expiring_notified_at` (pengingat 48 jam)
   - `0005_notification_logs.sql` — tabel log notifikasi WhatsApp
   - `0006_claims_expiry_24h_notify.sql` — kolom `expiring_24h_notified_at` (pengingat H-1)
   - `0007_cron_runs.sql` — telemetri run job terjadwal
   - `0008_orders_insert_own.sql` — policy insert order milik sendiri
   - `0009_app_settings.sql` — pengaturan koneksi admin (Configurasi)
   - `0010_payment_status_cancelled.sql` — status pembayaran `cancelled`
   - `0011_notification_retry.sql` — kolom retry log notifikasi
   - `0012_storage_owner.sql` — perketat storage (folder per user)
3. **Aktifkan login phone/OTP**: Dashboard → **Authentication → Sign In / Providers** → aktifkan **Phone**. Di **Authentication → Settings → SMS Provider** pilih **Twilio** (atau WhatsApp/SMS lain) dan isi kredensialnya — ini yang mengirim kode OTP saat pelanggan daftar/masuk via WhatsApp.
4. **Buat bucket storage**: Dashboard → **Storage** → pastikan bucket `vshop-assets` ada (dibuat migration 0001). Jika tidak muncul, buat manual: name `vshop-assets`, **Public bucket = ON** (foto usaha/produk dibaca publik).
5. **Ambil kredensial** (dipakai di variabel env):
   - **Project URL** → `Settings → API → Project URL`
   - **anon public key** → `Settings → API → anon public`
   - **service_role key** → `Settings → API → service_role` — ⚠️ rahasia, hanya di server, JANGAN pernah dibocorkan ke browser.

### A.2 Midtrans (wajib untuk pembayaran asli)

1. Daftar di **https://dashboard.sandbox.midtrans.com** (mode uji) → **Settings → Access Keys**. Salin:
   - **Server Key** (format `SB-Mid-server-…`) → env `MIDTRANS_SERVER_KEY`
   - **Client Key** (format `SB-Mid-client-…`) → env `MIDTRANS_CLIENT_KEY`
2. **Webhook**: di dashboard Midtrans → **Settings → Configuration**, isi **Payment Notification URL** dengan alamat publik aplikasi:
   ```
   https://DOMAIN_ANDA/api/midtrans/notification
   ```
   (dan **Finish/Unfinish/Error Redirect URL** mengarah ke halaman beranda/detail order bila ingin).
3. Untuk **produksi**: daftar di https://dashboard.midtrans.com, verifikasi usaha, lalu ganti key ke format `Mid-server-…` dan set `MIDTRANS_IS_PRODUCTION=true`.
4. Kartu uji sandbox: VISA `4911 1111 1111 1113`, CVV `123`, OTP `112233`. QRIS/GoPay/OVO bisa disimulasikan lewat **QRIS Simulator** / method di halaman bayar.

### A.3 WhatsApp Cloud API (opsional, direkomendasikan)

1. Buka **https://developers.facebook.com** → buat aplikasi → tambahkan produk **WhatsApp** → **API Setup**.
2. Ambil **Access Token** (system user / permanent token) → env `WHATSAPP_TOKEN`.
3. Ambil **Phone Number ID** dari nomor bisnis yang terverifikasi → env `WHATSAPP_PHONE_NUMBER_ID`.
4. (Disarankan) Siapkan **template pesan** di **WhatsApp Manager → Message Templates** dan isi nama template per jenis notifikasi di env (`WHATSAPP_TEMPLATE_PAID`, `_FAILED`, `_ORDER`, `_REDEEMED`, `_EXPIRING`, `_RETRIED`, `_DAILY_SUMMARY`, bahasa `WHATSAPP_TEMPLATE_LANG=id`). Tanpa template, aplikasi otomatis fallback ke **teks bebas** (bisa dipakai untuk uji sandbox / 24-jam window pelanggan).
5. Nomor tujuan memakai format **E.164 tanpa "+"** (mis. `6281234567890`) — diambil dari field `phone` akun pelanggan / `noWAUsaha` merchant.

### A.4 Variabel Lingkungan Lengkap

| Variabel | Wajib? | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Project URL Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | anon public key (publik) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | service_role key (RAHASIA, server only) |
| `SESSION_ENCRYPTION_KEY` | ✅ (disarankan) | kunci AES-256-GCM untuk refresh token. Generate: `openssl rand -base64 32` |
| `APP_URL` | ✅ | URL publik aplikasi (dipakai link notifikasi WhatsApp), mis. `https://vshop.anda.com` |
| `CRON_SECRET` | ✅ (disarankan) | proteksi endpoint `/api/cron/*`. Generate: `openssl rand -hex 24` |
| `MIDTRANS_SERVER_KEY` | ⚠️ untuk bayar asli | `SB-Mid-server-…` / `Mid-server-…` (RAHASIA, server only) |
| `MIDTRANS_CLIENT_KEY` | ⚠️ | `SB-Mid-client-…` / `Mid-client-…` (dipakai Snap.js) |
| `MIDTRANS_IS_PRODUCTION` | opsional | `false` (default) / `true` HANYA untuk transaksi nyata |
| `WHATSAPP_TOKEN` | opsional | token system user Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | opsional | Phone Number ID |
| `WHATSAPP_BUSINESS_TO` | opsional | nomor tujuan pesanan baru (fallback `noWAUsaha`) |
| `WHATSAPP_SUPPORT_NUMBER` | opsional | nomor support tombol "Lacak Pesanan" |
| `WA_LINK_BASE` | opsional | domain publik untuk link di pesan WA (terpisah dari APP_URL) |
| `WHATSAPP_MESSAGE_MODE` | opsional | `auto` (default) / `text` |
| `WHATSAPP_TEMPLATE_*` | opsional | nama template Meta per jenis notifikasi + `_BUTTONS` |
| `VOUCHER_EXPIRY_NOTIFY_HOURS` | opsional | pengingat 48 jam (default `48`) |
| `VOUCHER_EXPIRY_24H_NOTIFY_HOURS` | opsional | pengingat H-1 (default `24`) |
| `ORDER_EXPIRY_HOURS` | opsional | auto-expire order pending (default `24`) |
| `MAX_ORDER_RETRIES` | opsional | batas "Coba Lagi" per order (default `3`) |
| `NEXT_TELEMETRY_DISABLED` | opsional | `1` untuk mematikan telemetri |
| `PORT` | opsional | port aplikasi (default `3000`) |

> Template lengkap dengan komentar ada di `.env.example`. Tanpa semua kredensial, aplikasi tetap jalan dalam **mode demo** (pembayaran disimulasikan, data di `data/db.json`) — berguna untuk uji tampilan, tapi untuk produksi isi minimal Supabase + Midtrans.

---

## Bagian B — Persiapan di Mesin Lokal (sekali)

Untuk cPanel/aaPanel kamu bisa build di server, tapi **disarankan** build lokal lalu unggah hasilnya (lebih cepat & bisa diverifikasi).

```bash
# 1. Clone repo
git clone https://github.com/appsheetindonesia/VShop_UMKM.git
cd VShop_UMKM

# 2. Install dependensi
npm ci

# 3. (Opsional) isi .env.local dari template
cp .env.example .env.local

# 4. Build & uji
npm run build        # produksi — menghasilkan .next/
npm test             # 585+ unit/e2e test (vitest)
```

Hasil build: folder `.next/`. Untuk server Node biasa, jalankan `npm run start` (Next.js `next start`, port 3000).

---

## 1. Instalasi di cPanel

### 1.1 Persyaratan

- cPanel dengan fitur **Setup Node.js App** (Node.js Selector / Application Manager) — kebanyakan shared hosting modern (cPanel ≥ 92) punya ini.
- **Node.js 20 LTS** (atau 18.17+).
- Domain/subdomain (mis. `vshop.anda.com`) + SSL.
- Supabase cloud + kredensial (Bagian A).

### 1.2 Langkah

1. **Unggah kode**: masuk cPanel → **File Manager** → folder `public_html` (atau subfolder `vshop`). Unggah isi repo (tanpa `node_modules`, `.env.local`, `.next`, `coverage`). Bisa via **Git Version Control** cPanel (clone repo) atau upload ZIP lalu ekstrak.
2. **Buat Node.js App**:
   - cPanel → **Setup Node.js App** → **Create Application**.
   - **Node.js version**: pilih `20.x.x`.
   - **Application root**: mis. `/vshop` (atau `public_html/vshop`).
   - **Application URL**: pilih domain/subdomain.
   - **Application startup file**: `server.js` (buat file ini — lihat langkah 4).
   - Klik **Create**.
3. **Install dependensi**: di bagian aplikasi yang baru dibuat, buka **Run JS script** / terminal, jalankan:
   ```bash
   npm ci
   npm run build
   ```
4. **Buat `server.js`** di application root (custom server Next.js agar Passenger cPanel bisa menjalankannya):
   ```js
   // server.js — custom server untuk Next.js 14 di cPanel (Passenger)
   const { createServer } = require("http");
   const { parse } = require("url");
   const next = require("next");

   const dev = process.env.NODE_ENV !== "production";
   const hostname = "127.0.0.1";
   const port = Number(process.env.PORT) || 3000;
   const app = next({ dev, hostname, port });
   const handle = app.getRequestHandler();

   app.prepare().then(() => {
     createServer((req, res) => {
       const parsedUrl = parse(req.url, true);
       handle(req, res, parsedUrl);
     }).listen(port, hostname, () => {
       console.log(`> Ready on http://${hostname}:${port}`);
     });
   });
   ```
5. **Isi environment variables**: di halaman aplikasi Node.js → bagian **Environment variables**, tambahkan SEMUA variabel dari tabel [A.4](#a4-variabel-lingkungan-lengkap) (mis. `NODE_ENV=production`, `PORT=3000`, `NEXT_PUBLIC_SUPABASE_URL=…`, dst.).
6. **Restart & verifikasi**: klik **Restart**. Buka `https://vshop.anda.com/api/health` — harus mengembalikan JSON dengan `"ok": true` dan `storeMode: "supabase"`.
7. **Cron (opsional — disarankan)**: aplikasi punya **scheduler internal** (setiap jam otomatis di `next start`), tapi untuk redundansi tambahkan di cPanel → **Cron Jobs**:
   ```bash
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/expire-orders
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/voucher-expiring-24h
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/retry-notifications
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/daily-summary
   ```
   Set jadwal: menit ke-0, ke-15, ke-30 tiap jam, dan 06:00 untuk daily-summary (menyesuaikan [vercel.json](vercel.json)).
8. **Webhook Midtrans**: pastikan Payment Notification URL di dashboard Midtrans menunjuk `https://vshop.anda.com/api/midtrans/notification`.

> Catatan: jika hosting tidak menyediakan Node.js App, gunakan **VPS + aaPanel** (bagian 3) — shared hosting tanpa Node tidak bisa menjalankan Next.js.

---

## 2. Instalasi di Easypanel

### 2.1 Persyaratan

- VPS (Ubuntu 22.04/24.04 disarankan) dengan **Easypanel** terpasang (`curl -sSL https://get.easypanel.io | sh`).
- Domain/subdomain + SSL (Easypanel mengurus sertifikat Let's Encrypt otomatis).
- Repo GitHub: `https://github.com/appsheetindonesia/VShop_UMKM`.

### 2.2 Cara kerja

Repo ini menyertakan **`Dockerfile`** (multi-stage, Next.js **standalone** — build kecil ~50–80 MB) dan **`.dockerignore`**, jadi Easypanel tinggal build dari source. Database **tetap Supabase cloud** — tidak perlu service database di Easypanel.

### 2.3 Langkah

1. Buka dashboard Easypanel → **Projects** → **New Project** (mis. `vshop`).
2. **New Service** → pilih **GitHub** → sambungkan repo `appsheetindonesia/VShop_UMKM` (branch `main`).
3. Easypanel otomatis mendeteksi `Dockerfile`. Pastikan:
   - **Build**: default (Dockerfile).
   - **Port**: `3000`.
   - **Domain**: masukkan `vshop.anda.com` → SSL otomatis.
4. **Environment Variables**: tambahkan SEMUA variabel tabel [A.4](#a4-variabel-lingkungan-lengkap). Yang penting minimal: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_ENCRYPTION_KEY`, `APP_URL`, `CRON_SECRET` (dan `MIDTRANS_*`/`WHATSAPP_*` bila dipakai).
5. **Deploy**: klik **Deploy**. Pantau log build (bisa 2–5 menit pertama).
6. **Verifikasi**: buka `https://vshop.anda.com/api/health` → `{"ok": true, "storeMode": "supabase", …}`.
7. **Cron**: scheduler internal berjalan otomatis di dalam container (always-on). Opsional: tambahkan **Easypanel → Cron** (atau crontab VPS) memanggil endpoint dengan header `Authorization: Bearer <CRON_SECRET>` — sama seperti contoh curl di [bagian cPanel 1.2 langkah 7](#12-langkah).
8. **Webhook Midtrans**: Payment Notification URL → `https://vshop.anda.com/api/midtrans/notification`.

### 2.4 Update aplikasi

Setiap push ke `main` → di Easypanel cukup **Deploy** lagi (pull + rebuild). Data tetap aman di Supabase.

---

## 3. Instalasi di aaPanel

### 3.1 Persyaratan

- VPS dengan **aaPanel** terpasang (panel Bêta/versi terbaru mendukung Node.js project manager).
- **Node.js 20 LTS** terpasang lewat aaPanel → **App Store → Node.js version manager** (install versi 20.x).
- Nginx terpasang di aaPanel.
- Domain/subdomain + SSL (aaPanel → Website → SSL).

### 3.2 Langkah

1. **Unggah kode**: aaPanel → **File** → buat folder proyek, mis. `/www/wwwroot/vshop`. Clone repo:
   ```bash
   cd /www/wwwroot/vshop
   git clone https://github.com/appsheetindonesia/VShop_UMKM.git .
   ```
2. **Install dependensi & build** (via aaPanel → Terminal, pastikan `node -v` = 20.x):
   ```bash
   cd /www/wwwroot/vshop
   npm ci
   npm run build
   ```
3. **Buat file environment** — simpan variabel tabel [A.4](#a4-variabel-lingkungan-lengkap) ke `/www/wwwroot/vshop/.env` (aaPanel → File → edit):
   ```bash
   NODE_ENV=production
   PORT=3000
   APP_URL=https://vshop.anda.com
   NEXT_PUBLIC_SUPABASE_URL=…
   NEXT_PUBLIC_SUPABASE_ANON_KEY=…
   SUPABASE_SERVICE_ROLE_KEY=…
   SESSION_ENCRYPTION_KEY=…
   CRON_SECRET=…
   MIDTRANS_SERVER_KEY=…
   MIDTRANS_CLIENT_KEY=…
   # …dan lainnya sesuai kebutuhan
   ```
   > ⚠️ Jangan pernah menaruh `.env` berisi rahasia di direktori publik web (mis. `public_html`). Simpan di folder proyek yang tidak diekspos.
4. **Buat Node project (PM2)**: aaPanel → **Website → Node project** → **Add Node Project**:
   - **Project path**: `/www/wwwroot/vshop`
   - **Startup file**: `node_modules/next/dist/bin/next` dengan argumen `start` — atau lebih aman pakai **`ecosystem.config.cjs`** berikut (simpan di root proyek):
   ```js
   // ecosystem.config.cjs
   module.exports = {
     apps: [{
       name: "vshop",
       script: "node_modules/next/dist/bin/next",
       args: "start -p 3000",
       cwd: __dirname,
       env: { NODE_ENV: "production", PORT: "3000" },
       instances: 1,
       autorestart: true,
       max_memory_restart: "512M",
     }],
   };
   ```
   Lalu di aaPanel pilih startup file `ecosystem.config.cjs`.
   - **Port**: `3000`.
5. **Reverse proxy / bind domain**: di aaPanel **Website → domain Anda → Reverse proxy** (atau `Proxy → Add`): target `http://127.0.0.1:3000`. Atau buat site baru dengan proxy ke `127.0.0.1:3000`. Aktifkan SSL.
6. **Restart & verifikasi**: di Node project klik **Restart**. Buka `https://vshop.anda.com/api/health`.
7. **Cron (opsional — disarankan)**: aaPanel → **Cron → Add Cron Task** (jenis: **Shell script**, jadwal per jam):
   ```bash
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/expire-orders
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/voucher-expiring-24h
   curl -s -H "Authorization: Bearer KODE_CRON_SECRET_ANDA" https://vshop.anda.com/api/cron/retry-notifications
   ```
   dan jadwal harian 06:00 untuk `daily-summary`.
8. **Webhook Midtrans**: Payment Notification URL → `https://vshop.anda.com/api/midtrans/notification`.

### 3.3 Update aplikasi

```bash
cd /www/wwwroot/vshop
git pull
npm ci
npm run build
# lalu restart di panel Node project (PM2 reload)
```

---

## Bagian C — Setelah Deploy

1. **Cek health endpoint**:
   ```bash
   curl -s https://vshop.anda.com/api/health
   ```
   Harus `ok: true`, `storeMode: "supabase"`, `supabase.postgres.ok: true`, `migrations.count: 12`.

2. **Uji alur pembayaran** (sandbox):
   - Buka `https://vshop.anda.com` → daftar/masuk (OTP WhatsApp atau password).
   - Pilih paket → bayar → Snap Midtrans muncul (mode sandbox bila key `SB-Mid-…`).
   - Bayar QRIS (simulator) / kartu uji VISA `4911 1111 1111 1113` (CVV `123`, OTP `112233`) → harus redirect ke halaman sukses.
   - Cek detail transaksi di `/transaksi/[orderId]` — timeline status (created → paid) + invoice PDF.

3. **Verifikasi webhook** (tanpa tunnel): setelah order pertama, buka dashboard Midtrans → cek notifikasi terkirim ke `https://vshop.anda.com/api/midtrans/notification` (log aplikasi / `metadata.paymentAudit` di halaman detail transaksi).

4. **Pantau**: halaman admin `/admin` (dashboard: ringkasan status pembayaran, cron runs), `/admin/notifikasi` (log WhatsApp), `/admin/kadaluarsa` (order expired + retry massal), `/admin/cron` (jadwal + jalankan manual), `/admin/configurasi` (ubah koneksi tanpa restart — database, payment gateway, WhatsApp, AI).

5. **Log aplikasi**: lihat log runtime di panel masing-masing (cPanel: error log; Easypanel: Service → Logs; aaPanel: PM2 → log). Prefix penting: `[db]`, `[wa]`, `[cron]`, `[notif-log]`.

---

## Troubleshooting

| Gejala | Penyebab & Solusi |
|---|---|
| `/api/health` `storeMode: "json"` | Supabase tidak terdeteksi → cek `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` sudah terisi & app di-restart. |
| Build gagal `Error: Could not find a production build` | `npm run build` belum dijalankan, atau `.next` tidak ikut terunggah (cPanel) → jalankan `npm run build` di server. |
| Webhook Midtrans balas 403 "Invalid signature" | `MIDTRANS_SERVER_KEY` salah/tidak terbaca, atau Payment Notification URL salah. Cek juga `MIDTRANS_IS_PRODUCTION` sesuai mode key. |
| OTP WhatsApp tidak terkirim | Provider phone/SMS di Supabase belum diaktifkan / kredensial SMS salah; atau nomor bukan E.164 (`628…`). Cek tab Password sebagai fallback. |
| Notifikasi WhatsApp `[wa] (demo)` | `WHATSAPP_TOKEN` kosong → mode demo (tidak benar-benar dikirim). Isi token + Phone Number ID. |
| Halaman bayar menampilkan "mode demo" | `MIDTRANS_SERVER_KEY` kosong → token Snap tiruan. Isi key sandbox/produksi + client key. |
| Order tidak auto-expire | Scheduler internal butuh proses selalu jalan (jangan matikan). Atau tambahkan cron eksternal (curl) dengan `CRON_SECRET`. |
| Error 401 pada `/api/cron/*` | Header `Authorization: Bearer <CRON_SECRET>` salah / `CRON_SECRET` tidak sama dengan yang diset. |
| 503 di cPanel Passenger | Aplikasi belum selesai `npm run build`, atau `server.js` tidak ada di application root, atau port tidak sesuai. Restart app & cek error log. |
| Build OOM di VPS kecil | Tambah swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
| Env tidak terbaca setelah diubah | Selalu **restart** aplikasi (Passenger/PM2/container) setelah ubah environment. |

---

## Keamanan & Checklist Go-Live

- [ ] `SUPABASE_SERVICE_ROLE_KEY` hanya di server (tidak pernah di `NEXT_PUBLIC_*`).
- [ ] `SESSION_ENCRYPTION_KEY` & `CRON_SECRET` diisi (generate acak 32 byte / 24 hex).
- [ ] `MIDTRANS_IS_PRODUCTION=false` saat masih uji; ganti `true` hanya untuk transaksi nyata (dengan key produksi).
- [ ] `.env` / `.env.local` tidak pernah ikut ter-commit / ter-upload publik (sudah di `.gitignore`).
- [ ] RLS aktif di semua tabel (verifikasi: `npm run db:rls` — 76 cek, atau lihat migration 0001–0012).
- [ ] Storage bucket `vshop-assets` publik hanya untuk **SELECT**; tulis/ubah/hapus owner-check per folder user (migration 0012).
- [ ] Webhook Midtrans menggunakan HTTPS (domain + SSL aktif).
- [ ] Backup: Supabase cloud otomatis (PITR sesuai plan); pastikan password database disimpan aman.
