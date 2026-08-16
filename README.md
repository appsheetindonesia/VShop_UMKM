# V Shop — Diskon UMKM di Sekitarmu

Platform voucher & promo berbasis web untuk UMKM dan developer Indonesia.
Dibangun sesuai **PRD, BRD, FRD, TRD**, desain UI terlampir, dan wireframe
artifact `vshop-mobile-mockup` (pilih peran → daftar → paket → QRIS → voucher →
redeem) yang sudah diimplementasikan sepenuhnya.

## ✨ Fitur (sesuai dokumen)

| Area | Fitur |
|------|-------|
| **Onboarding** | Selamat datang, pilih jenis akun (Pelanggan / Merchant), lanjut sebagai tamu |
| **Autentikasi** | Masuk/daftar Pelanggan via **OTP WhatsApp** (`sendOtp`/`verifyOtp` Supabase Auth; demo: kode di layar) dengan **fallback password**, login email/WhatsApp untuk Merchant, lupa password, role-based access (customer / merchant / admin); sesi tahan lama (30 hari rolling + pemulihan dari refresh token Supabase) |
| **Paket Langganan** | Paket 7 hari (Rp7.000), 14 hari (Rp13.000), 30 hari (Rp25.000) — sesuai wireframe |
| **Pelanggan** | Splash pilih peran, beranda (status member, promo, voucher, merchandise), daftar UMKM partner, klaim voucher (kode + kode konfirmasi), voucher saya, status member, top up saldo, keranjang & checkout, QRIS (QR + countdown + cek status), **riwayat pembayaran di halaman akun** (sukses/gagal/kadaluarsa + tombol Coba Lagi untuk yang gagal) |
| **Merchant** | Dashboard (menu tiles: Buat Promo, Voucher, Redeem, Laporan), buat promo & voucher, redeem voucher (validasi kode + konfirmasi), laporan, pengelolaan, status verifikasi admin |
| **Admin** | Dashboard statistik, review pendaftaran merchant (setujui/tolak), CRUD merchandise, daftar pesanan |
| **Pembayaran** | Midtrans Snap (sandbox asli saat `MIDTRANS_SERVER_KEY` terisi; demo disimulasikan tanpa key),   verifikasi signature webhook SHA-512, cek status via Status API, idempotent, harga 100% server-side; layar **Pembayaran Gagal / kadaluarsa** (Coba Lagi → snap token + **nomor order baru**, Kembali ke Beranda) dengan **alasan spesifik** dari Midtrans (ditolak bank, saldo tidak cukup, waktu habis, dibatalkan, dsb. — dipetakan dari `status_code`, tersimpan di `metadata.failureReason`) |

## 🧰 Teknologi (sesuai TRD)

- **Next.js 14** (App Router, Server Components, Route Handlers)
- **TypeScript strict**
- **Tailwind CSS** (mobile-first)
- **Zod** — validasi input di boundary server (SEC-03)
- **Supabase** (Auth / PostgreSQL / RLS / Storage) — *aktif saat env diisi; mode demo default*
- **Midtrans** (Snap sandbox/produksi) — *aktif saat server key diisi; demo default*

## 🚀 Menjalankan Lokal

```bash
npm install
npm run dev
# buka http://localhost:3000
```

Tanpa konfigurasi tambahan, aplikasi berjalan dalam **mode demo**:

- Data disimpan di `data/db.json` (di-seed otomatis saat pertama kali dijalankan).
- Pembayaran disimulasikan (tidak ada uang asli).
- Tanpa perlu akun Supabase / Midtrans.

### Akun demo

| Role | Email / WhatsApp | Password |
|------|------------------|----------|
| Pelanggan | `customer@vshop.id` | `customer123` |
| Merchant (disetujui) | `merchant@vshop.id` | `merchant123` |
| Merchant (disetujui) | `kopi@vshop.id` | `kopi123` |
| Admin | `admin@vshop.id` | `admin123` |

## 🗂️ Struktur Proyek

```
src/
  app/
    page.tsx                # Onboarding / selamat datang
    (auth)/                 # Masuk, daftar pelanggan & merchant, lupa password
    (shop)/                 # Beranda, promo, merchandise, voucher saya, status member,
                            #   akun, topup, checkout, bayar, sukses
    merchant/               # Dashboard merchant (buat promo, getken, laporan, pengelolaan)
    admin/                  # Dashboard admin (review merchant, produk, pesanan)
    api/                    # Route handlers (auth, cart, checkout, pay, upload, midtrans)
  components/               # Komponen UI (kartu, form, tombol, nav, ImageField)
  lib/
    db.ts                   # Store hibrida: Supabase (hydrate/persist) + fallback JSON demo
    service.ts              # Modul bisnis inti — antarmuka tidak berubah (seam)
    auth.ts                 # Sesi, cookie, guard role
    supabase/server.ts      # Factory client Supabase (service-role & anon)
    supabase-auth.ts        # Adapter Auth Supabase (signUp/signIn/OTP/reset password)
    otp.ts                  # OTP WhatsApp: sendOtp/verifyOtp (Supabase atau demo)
    validation.ts           # Skema Zod (SEC-03)
    midtrans.ts             # Adapter Midtrans (demo / sandbox / produksi + signature)
    types.ts                # Tipe data (sesuai skema database TRD)
    format.ts               # Format Rupiah & tanggal
supabase/
  migrations/0001_init.sql  # Skema + RLS + Storage + seed paket
scripts/
  seed-supabase.mjs         # Seed data demo ke Supabase (Auth + PostgreSQL)
```

## 🔌 Mode Supabase (PostgreSQL + Auth + RLS + Storage)

`src/lib/db.ts` adalah **store hibrida**: saat env Supabase terisi, seluruh data
di-hydrate dari PostgreSQL pada request pertama (`ensureHydrated()` — di-await
oleh root layout & seluruh API route, memoized per proses) dan setiap mutasi
di-persist kembali ke Supabase — **antarmuka `src/lib/service.ts` tidak berubah
sama sekali** (seam tetap). Tanpa env, aplikasi otomatis kembali ke mode demo
(JSON).

Langkah mengaktifkan:

```bash
cp .env.example .env
# isi: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

1. **Migration** — jalankan `supabase/migrations/` (Supabase Dashboard → SQL
   Editor, atau `supabase db push`). `0001_init.sql` berisi tabel lengkap
   (profiles, merchants, packages, memberships, promos, vouchers,
   claimed_vouchers, orders, merchandise, wallets, sessions, carts),
   Row Level Security di semua tabel, bucket Storage `vshop-assets`, dan seed
   paket langganan. `0002_sessions_refresh.sql` menambahkan kolom
   `sb_refresh_enc`/`sb_user_id` di `sessions` (refresh token Supabase
   terenkripsi — lihat seksi "Sesi lintas perangkat" di bawah).
2. **Seed data demo** — `node scripts/seed-supabase.mjs` membuat akun demo
   (via Supabase Auth) + data lengkap ke PostgreSQL. Akun yang sama dengan
   mode demo: `customer@vshop.id`, `merchant@vshop.id`, `kopi@vshop.id`,
   `elektronik@vshop.id`, `admin@vshop.id` (password di README bawah).
3. **Restart** — `npm run dev`. Log `[db] Supabase tidak tersedia…` berarti
   migration/key belum benar; log tanpa error = mode Supabase aktif.

Saat mode Supabase aktif:

- **Auth** — registrasi & login diverifikasi Supabase Auth (`auth.users`).
  Pelanggan memakai **nomor WhatsApp** (phone auth, E.164).

#### 📲 Masuk / Daftar via OTP WhatsApp

Alur utama pelanggan adalah **OTP WhatsApp** (bukan password):

1. `POST /api/auth/otp/send` `{ phone }` → Supabase `signInWithOtp` (SMS/WA)
   — untuk nomor baru, user Auth otomatis dibuat saat OTP diverifikasi.
2. `POST /api/auth/otp/verify` `{ phone, otp, purpose: "login" | "register", name? }`
   → Supabase `verifyOtp` (type `sms`); profil disinkronkan dari tabel
   `profiles`, sesi aplikasi dibuat, refresh token disimpan di cookie
   (sama seperti login password).

- **Persyaratan Supabase**: di dashboard aktifkan provider *Phone* + *SMS*
  (Authentication → Sign In / Up → Phone & SMS) dan kanal OTP *WhatsApp*/
  *SMS*; di lokal `supabase start`, OTP bisa diuji via
  `[auth.sms.test_otp]` di `config.toml` (kode apa pun diterima).
- **Mode demo** (tanpa Supabase): kode 6 digit dibuat lokal, sekali pakai,
  kedaluwarsa 5 menit, dan **ditampilkan di layar** (`demoCode`) agar alur
  tetap bisa diuji; dicatat juga di log server (`[otp]`).
- **Fallback password tetap ada** — tab "Password" di halaman masuk/daftar
  memakai `/api/auth/login` & `/api/auth/register` seperti sebelumnya
  (password dikelola Supabase Auth; demo: hash lokal).
- **Sesi tahan lama** — cookie `vshop_session` berlaku 30 hari dengan rolling
  renewal (diperpanjang otomatis selama aktif); refresh token Supabase
  disimpan di cookie httpOnly `vshop_sb_refresh` (1 tahun). Pemulihan sesi
  ditangani **middleware** (`src/middleware.ts`) — renewal terjadi di SISI
  SERVER sebelum halaman dirender, jadi tidak ada flash login (bootstrap
  client `SessionBootstrap`/`/api/auth/renew` sudah dihapus).

#### 🔐 Sesi lintas perangkat (refresh token terenkripsi, migration 0002)

- `createSession(userId, sb?)` menyimpan refresh token Supabase **terenkripsi**
  (AES-256-GCM, `src/lib/crypto.ts` — Web Crypto, format `v1:iv:tag:ct`) di
  kolom `sessions.sb_refresh_enc` + `sb_user_id` — bukan hanya di cookie.
  Kunci dari env `SESSION_ENCRYPTION_KEY` (`openssl rand -base64 32`); tanpa
  kunci, aplikasi tetap jalan (fallback cookie-only, dengan peringatan di
  log).
- **Renewal di middleware** (`src/middleware.ts` + `src/lib/session-renew.ts`,
  Edge-safe): sesi sehat (cookie sesi + refresh ada) → lewat tanpa kerja;
  sesi diragukan (cookie sesi hilang ATAU refresh cookie hilang) → urutan
  cookie `vshop_sb_refresh` → token tersimpan terenkripsi di baris sesi
  (`getStoredRefreshTokenFromDb`) → refresh Supabase → baris sesi baru
  (token hasil rotasi, terenkripsi) + cookie di-set pada respons. Middleware
  berjalan di runtime terpisah (Edge) sehingga baris sesi baru disinkronkan
  ke cache proses Node oleh root layout (`fetchSessionIntoCache`) sebelum
  render — halaman langsung login, tanpa flash. Renewal tidak pernah
  menggagalkan permintaan (opsional; mode demo dilewati).
- Keamanan: kolom `sb_refresh_enc`/`sb_user_id` di-revoke dari role
  `anon`/`authenticated` (defense-in-depth; hanya service role yang membaca),
  dan payload tidak pernah dikirim ke client — server tidak bisa
  mendekripsi tanpa `SESSION_ENCRYPTION_KEY`.
- **Storage** — form merchant & produk menampilkan upload gambar ke bucket
  `vshop-assets` (via `/api/upload`, service-role di server); tanpa Supabase
  tetap pakai placeholder emoji.
- **RLS** — diaktifkan di semua tabel sebagai pertahanan berlapis; aplikasi
  memakai service-role key sehingga operasi bisnis tidak terblokir RLS.

> Catatan: mode Supabase memakai **write-through per koleksi** — setiap
> `mutate()` melacak koleksi yang berubah (dirty tracking via snapshot JSON)
> dan hanya meng-*upsert* tabel yang tersentuh, bukan seluruh DB. Ditambah
> **koalesensi tulis di `persistChain`**: beberapa `mutate()` yang terjadi
> berurutan digabung jadi satu flush — koleksi yang sama hanya ditulis sekali
> dengan snapshot **terbaru** (tulis lama dilewati; upsert idempotent per PK),
> dan batch antar-flush tetap berurutan. `persist()` tetap tersedia sebagai
> full-flush bila diperlukan. Tetap cocok untuk single-instance; antarmuka
> `service.ts` tidak berubah.

## 🐳 Supabase CLI Lokal (tanpa akun cloud)

Seluruh fitur Supabase (migration, RLS, Storage, Auth phone/email, Studio)
bisa diuji **di mesin sendiri** tanpa akun cloud — cukup Docker + Supabase CLI.
Supabase CLI berjalan via `npx supabase` (otomatis mengunduh binary; tanpa
install global).

### Prasyarat

1. **Docker Desktop** (Windows/macOS) atau Docker Engine (Linux) — wajib;
   `supabase start` menjalankan Postgres + Auth + Storage + Studio dalam
   container. Cek: `docker version`. Di Windows, instalasi pertama Docker
   Desktop + WSL2 biasanya memerlukan **satu kali restart Windows** agar
   fitur virtualisasi aktif (gejala bila belum: engine gagal start dengan
   error timeout `Wsl/Service/CreateInstance/0x800705b4`). Setelah restart,
   buka Docker Desktop sekali (setujui lisensi) dan tunggu sampai indikator
   engine hijau sebelum `npm run db:start`.
2. Supabase CLI — otomatis tersedia via `npx supabase`; cek versi:
   `npx supabase --version`.

### Alur lengkap — SATU PERINTAH

```bash
npm run db:setup
```

`scripts/setup-local.mjs` melakukan semuanya otomatis (idempotent — aman
dijalankan ulang kapan saja):

1. **Cek Docker** (dan menambahkan bin Docker Desktop ke PATH bila belum
   ada — supabase CLI memanggil binary `docker`).
2. **`supabase start`** — pull image (pertama kali) + apply migration
   `0001`/`0002`/`0003` + seed `supabase/seed.sql`.
3. **Baca kredensial** dari `supabase status -o env`.
4. **Tulis `.env.local`** (MERGE — kunci lain seperti `MIDTRANS_*`/
   `WHATSAPP_*` yang sudah Anda isi tidak diubah; `SESSION_ENCRYPTION_KEY`
   digenerate bila belum ada).
5. **Seed data demo** (`node scripts/seed-supabase.mjs`) — akun demo,
   merchant, promo, voucher, merchandise. Idempotent: akun/paket di-upsert,
   data demo lama dihapus dulu sebelum ditulis ulang.

Opsional: `npm run db:setup -- --reset` (jalankan `supabase db reset` dulu
— migration + seed dari nol), `--no-seed`, `--skip-start` (hanya baca
kredensial + tulis .env.local). Detail kredensial & langkah manual tetap
bisa diakses via `npm run db:status` dan perintah-perintah di bawah.

```bash
npm run db:status    # lihat kredensial lokal (API URL, anon, service_role)
npm run db:reset     # migration + seed.sql dari nol
npm run db:seed      # seed data demo saja
npm run db:stop      # matikan stack (data tetap ada)
npm run dev          # jalankan aplikasi — mode Supabase aktif otomatis
```

`supabase start` otomatis menjalankan migration `supabase/migrations/`
(`0001_init.sql` → 12 tabel + RLS + bucket Storage `vshop-assets`;
`0002_sessions_refresh.sql` → kolom refresh token terenkripsi;
`0003_grants.sql` → privilege anon/authenticated/service_role) + seed
`supabase/seed.sql` saat pertama kali.

> **Catatan CLI 2.114+ (least-privilege):** tabel yang dibuat migration TIDAK
> otomatis mendapat hak DML untuk anon/authenticated/service_role di versi
> baru — migration `0003_grants.sql` mengembalikan grant standar Supabase
> (RLS tetap membatasi baris). Tanpa 0003, mode Supabase gagal dengan
> `permission denied for table ...` di semua operasi tulis/baca service role.
>
> **Gotcha postgrest-js v2:** client menormalkan `col as "alias"` menjadi
> `colas"alias"` (spasi dihapus) yang DITOLAK PostgREST asli. Semua query di
> `db.ts` memakai sintaks `Alias:column` (`userId:user_id`) yang dipertahankan
> apa adanya — jangan kembalikan ke `as "..."` di query PostgREST.

### Akses tools lokal

| Alat | URL | Catatan |
|------|-----|---------|
| **Supabase Studio** | http://127.0.0.1:54323 | Table Editor, SQL Editor, Auth, Storage |
| **Email testing** | http://127.0.0.1:54324 | Email reset password muncul di sini (tidak terkirim asli) |
| **Postgres** | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | koneksi langsung via psql/Prisma |

### Menguji RLS & Storage secara langsung

- **RLS otomatis** — `npm run db:rls` (`scripts/e2e-rls.mjs`) login sebagai
  3 role dan memverifikasi policy di **semua 12 tabel** terhadap Supabase
  lokal (prasyarat: `npm run db:setup`):

  1. **anon** — tabel publik (paket/merchant/promo/voucher/merchandise)
     terbaca; tabel privat (profil/order/dompet/keanggotaan/voucher
     terklaim/sesi/keranjang) tersembunyi RLS (0 baris); insert tanpa
     policy ditolak; kolom `sessions.sb_refresh_enc` diblokir hak kolom;
  2. **authenticated (customer)** — melihat baris miliknya sendiri
     (order/dompet/keanggotaan/voucher terklaim/sesi), bukan milik user
     lain; update profil sendiri boleh; insert promo/update merchant milik
     orang lain DITOLAK; kolom sensitif tetap tertutup;
  3. **authenticated (merchant)** — melihat & mengupdate merchant miliknya
     sendiri; tidak melihat order customer;
  4. **service_role** — bypass RLS (semua order + kolom sensitif boleh).

  Keluar dengan exit code 1 bila ada policy yang melanggar ekspektasi, dan
  membersihkan semua data uji yang dibuatnya.

- **RLS manual** — di Studio → SQL Editor, login sebagai role `authenticated`
  (`set role authenticated; set request.jwt.claim.sub = '<user-uuid>';`) lalu
  coba `select * from public.vouchers;` (boleh) vs `select * from
  public.orders;` (hanya punya sendiri).
- **Storage** — upload lewat form merchant/produk di aplikasi, atau lewat
  Studio → Storage; file publik bisa diakses
  `http://127.0.0.1:54321/storage/v1/object/public/vshop-assets/<nama-file>`.
- **Auth phone (OTP)** — `supabase/config.toml` sudah dikonfigurasi untuk
  uji lokal: `[auth.sms] enable_signup = true`, provider SMS diaktifkan
  dengan **kredensial placeholder** (diperlukan agar phone login aktif —
  cek provider dilakukan GoTrue SEBELUM cek test_otp), dan
  `[auth.sms.test_otp]` memetakan nomor demo → kode tetap, sehingga OTP
  TIDAK dikirim sungguhan:

  ```toml
  [auth.sms.test_otp]
  6281234567890 = "123456"   # customer demo → OTP 123456
  6281298765432 = "654321"
  ```

  Nomor lain yang TIDAK ter-map akan gagal (provider placeholder tidak
  mengirim SMS) — daftarkan nomor ke map bila perlu. Uji cepat:
  `curl -X POST http://127.0.0.1:54321/auth/v1/otp -H "apikey: <anon>" -d '{"phone":"+6281234567890"}'`
  lalu verify dengan `123456`.

### Perintah yang tersedia

```bash
npm run db:setup    # setup LENGKAP sekali perintah (Docker → start → .env.local → seed)
npm run db:start    # supabase start   — nyalakan stack lokal
npm run db:stop     # supabase stop    — matikan (data tetap ada)
npm run db:reset    # supabase db reset — migration + seed dari nol
npm run db:seed     # node scripts/seed-supabase.mjs — data demo (idempotent)
npm run db:status   # supabase status  — URL & kunci lokal
```

### Catatan khusus Windows / Docker Desktop

- **Bind-mount drive gagal** (`error while creating mount source path
  '/run/desktop/mnt/host/d/...': mkdir ... file exists`) — bug mount WSL2
  yang muncul setelah beberapa kali stop/start. Solusi: `wsl --shutdown`,
  lalu restart Docker Desktop, lalu `npm run db:start` lagi.
- **Edge runtime dinonaktifkan** di `config.toml` (`[edge_runtime] enabled =
  false`) — aplikasi tidak memakai Supabase Edge Functions, dan bind-mount
  file `.temp/start-secrets/...` ke edge runtime memicu bug mount di atas.
- **API keys baru di CLI 2.114+** (`sb_publishable_*`/`sb_secret_*`,
  kredensial S3 Storage ditampilkan di output `supabase start`) — kunci JWT
  (`eyJ...`) yang dibaca `setup-local.mjs` dari `supabase status -o env`
  tetap yang dipakai aplikasi.

> Tanpa Docker, aplikasi tetap berjalan penuh dalam mode demo JSON
> (`data/db.json`) — Supabase lokal hanya dibutuhkan saat ingin menguji
> RLS/Storage/Auth terhadap Postgres sungguhan.

## 💳 Mode Midtrans (sandbox asli)

Isi `MIDTRANS_SERVER_KEY` (dari https://dashboard.sandbox.midtrans.com →
Settings → Access Keys) untuk mengaktifkan pembayaran asli:

```bash
MIDTRANS_SERVER_KEY=SB-Mid-server-xxxx
MIDTRANS_CLIENT_KEY=SB-Mid-client-xxxx
MIDTRANS_IS_PRODUCTION=false          # sandbox default
APP_URL=http://localhost:3000
```

- `createPaymentTransaction` memanggil Snap API → snap token asli; halaman
  `/bayar/[orderId]` memakai **Snap embed** (`snap.embed` ke `#snap-container`)
  saat `MIDTRANS_CLIENT_KEY` tersedia — form pembayaran dirender **inline**
  (QRIS/VA/e-wallet langsung di halaman, tanpa popup), dengan handler
  `onSuccess` / `onPending` / `onError` / `onClose` — sukses diverifikasi ulang
  via Status API lalu redirect ke halaman sukses; error mengarahkan ke layar
  Pembayaran Gagal. Tanpa `MIDTRANS_CLIENT_KEY` (atau Snap.js gagal dimuat),
  otomatis fallback ke halaman Snap VT-web (`redirectUrl`). `snap.embed`
  dipanggil sekali per order (guard anti-StrictMode).
- Tombol **Cek Status Pembayaran** menanyakan Midtrans Status API; order
  ditandai lunas otomatis bila transaksi capture/settlement.
- **Coba Lagi (retry)** — order dikembalikan ke `pending`, dibuatkan **snap
  token baru** DAN **nomor order baru** (`nextRetryOrderNumber`): order_id
  lama berstatus terminal (expired/denied) bisa ditolak Midtrans bila
  dipakai ulang. Nomor lama disimpan di metadata
  (`originalOrderNumber` + `previousOrderNumbers`) untuk audit.
- `MIDTRANS_API_BASE` (opsional) — override base URL Snap v1 & Status v2
  untuk pengujian lokal (mis. simulator sandbox) / proxy.
- `MIDTRANS_SNAP_SCRIPT_URL` (opsional) — override URL Snap.js yang dimuat
  browser (default: sandbox/produksi sesuai `MIDTRANS_IS_PRODUCTION`);
  dipakai untuk menguji jalur embed dengan stub lokal.
- Webhook **`POST /api/midtrans/notification`** diverifikasi signature
  `SHA512(order_id + status_code + gross_amount + serverKey)` dan idempotent
  (SEC-06).
- **Alasan gagal spesifik** — `status_code` Midtrans (mis. `202` ditolak
  bank, `216` saldo tidak cukup QRIS, `203` waktu habis, `201` dibatalkan)
  dipetakan ke pesan Bahasa Indonesia di `src/lib/midtrans.ts`
  (`midtransFailureReason`), disimpan di `metadata.failureReason`, dan
  ditampilkan di layar `/bayar/gagal` — dibaca dari order di server, bukan
  query string (anti-tamper). `onError` Snap.js mengirim `status_code` ke
  `POST /api/pay/[orderId]/fail`; Status API & webhook memakai pemetaan yang
  sama.
- **Audit callback Snap** — setiap callback Snap.js (`success` / `pending` /
  `error` / `close`) beserta hasil transaksinya (status_code,
  transaction_status, payment_type, transaction_id, …) dicatat
  fire-and-forget ke `metadata.snapCallbacks` order via
  `POST /api/pay/[orderId]/snap-callback` (hanya pemilik order; maks. 20
  entri terakhir) — tanpa mengubah status pembayaran. Riwayatnya tampil di
  halaman akun per order (panel "Riwayat callback Snap" dengan waktu +
  ringkasan hasil).
- Set `MIDTRANS_IS_PRODUCTION=true` hanya untuk transaksi nyata.

## 💬 Notifikasi WhatsApp (Cloud API)

Notifikasi pembayaran dikirim ke WhatsApp saat status order berubah, via
**WhatsApp Cloud API** (Meta Graph API) — atau mode demo (log `[wa]` di
console) tanpa kredensial:

```bash
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_TO=6281234567890   # nomor bisnis utk order merchandise (opsional)
APP_URL=http://localhost:3000        # link di pesan
```

- **Pelanggan** selalu dapat notifikasi: pembayaran berhasil ✅, gagal, atau
  kadaluarsa (dengan alasan spesifik dari Midtrans, mis. "Saldo tidak
  mencukupi").
- **Merchant** dapat notifikasi pesanan baru untuk order **merchandise**
  (perlu diproses): ke `WHATSAPP_BUSINESS_TO`, atau ke `noWAUsaha` merchant
  bila order punya `metadata.merchantId`.
- Nomor tujuan dinormalisasi ke E.164 (08xx → 628xx).
- **Anti-duplikat**: webhook Midtrans yang berulang tidak mengirim ulang —
  notifikasi hanya dipicu saat terjadi transisi status (`pending → paid`, dst.).
- Modul di `src/lib/whatsapp.ts` (`notifyOrderPayment`) bersifat fire-and-
  forget dan tidak pernah melempar error — kegagalan kirim tidak mengganggu
  alur pembayaran. `WHATSAPP_API_BASE` bisa di-override untuk pengujian
  lokal (mis. mock Graph API).

> Catatan: pesan teks bebas hanya terkirim dalam *24-hour session window*
> (pelanggan pernah menghubungi bisnis) atau ke nomor whitelist sandbox.
> Untuk produksi berskala, gunakan **template message** yang disetujui Meta
> (ada di dashboard WhatsApp).

## ⏰ Auto-Expire Order (cron / job terjadwal)

Order yang masih `pending` lebih dari **24 jam** (atau `ORDER_EXPIRY_HOURS`)
di-expire otomatis — konsisten dengan kadaluarsa transaksi Midtrans:

- **Satu sumber kebenaran**: `ORDER_EXPIRY_HOURS` di `src/lib/midtrans.ts`
  dipakai untuk field `expiry` di payload Snap Midtrans DAN aturan expire
  lokal, jadi keduanya selalu sama.
- **Produksi (Vercel Cron)** — `vercel.json` memanggil
  `GET /api/cron/expire-orders` tiap jam. Endpoint terlindungi
  `CRON_SECRET` (Vercel mengirim `Authorization: Bearer <CRON_SECRET>`
  otomatis bila env `CRON_SECRET` ada).
- **Lokal / self-host** — `startExpiryScheduler()` (di root layout)
  menyalakan interval tiap jam di dalam proses; guard `globalThis` mencegah
  timer ganda. Jalankan manual kapan saja:
  `curl -X GET http://localhost:3000/api/cron/expire-orders` (dengan header
  Authorization bila `CRON_SECRET` diisi).
- Order yang di-expire: `paymentStatus=expired`, `status=cancelled`, alasan
  "Waktu pembayaran habis" tersimpan, dan pelanggan mendapat notifikasi
  WhatsApp (bila aktif). Idempotent — order yang sudah terminal tidak
  disentuh, dan tombol **Coba Lagi** tetap bisa me-reset order.

## 🛡️ Keamanan (sesuai PRD/TRD)

- **SEC-03** — seluruh input divalidasi Zod di route handler (server).
- **SEC-04** — harga, stok, dan total checkout dihitung ulang server-side;
  client tidak pernah dipercaya.
- **SEC-05** — rahasia (Supabase service role, Midtrans server key) hanya
  dibaca di server; tidak ada prefix `NEXT_PUBLIC_`.
- **SEC-06** — pembayaran idempotent (`markOrderPaid` tidak memproses ulang
  order yang sudah `paid`); siap dipanggil dari webhook terverifikasi.
- **SEC-07** — pesan login aman (tidak membocorkan apakah akun terdaftar).
- Role-based access: guard `/merchant/*` dan `/admin/*` di layout (setara
  RLS + middleware).

## 🧪 Verifikasi

```bash
npm run typecheck   # tsc --noEmit
npm test            # unit test vitest (dirty tracking, mapping koleksi↔tabel,
                    #   round-trip hydrate→mutate→hydrate di src/lib/db.test.ts)
npm run build       # production build
```

### Uji E2E alur login WhatsApp (tanpa akun cloud)

`scripts/e2e-auth.mjs` adalah uji end-to-end **self-contained** untuk alur auth
WhatsApp: ia menyalakan MOCK Supabase (Auth + PostgREST) lokal + aplikasi Next.js
(dalam mode Supabase), lalu memverifikasi:

1. **Daftar** dengan nomor E.164 (`+6281…`) → sesi + cookie refresh dibuat;
2. **Login** phone + password (format lokal `08xx` dinormalisasi ke E.164);
3. **Renewal via middleware**: cookie sesi dihapus, cookie refresh dipertahankan
   → middleware memperbarui sesi SEBELUM render (tanpa flash login), refresh
   token di-rotasi tapi BERTAHAN untuk renew berikutnya, dan token lama jadi
   invalid (cookie dibersihkan).

```bash
node scripts/e2e-auth.mjs            # jalankan semua tes, server dibersihkan
node scripts/e2e-auth.mjs --keep     # biarkan mock + aplikasi hidup (debug)
```

Mock-nya meniru PostgREST (termasuk normalisasi select `as "alias"` ala
postgrest-js v2, filter `eq.`, `maybeSingle`) dan Supabase Auth (createUser,
`token` grant password/refresh_token, rotasi refresh token). Tidak butuh Docker
atau kredensial apa pun — cocok untuk CI.

## 📄 Dokumentasi Terkait

- `2026-08-15-vshop-prd.md` — Product Requirements
- `2026-08-15-vshop-brd.md` — Business Requirements
- `2026-08-15-vshop-frd.md` — Functional Requirements
- `2026-08-15-vshop-trd.md` — Technical Requirements

## 📝 Catatan MVP

- Mode demo menyimpan data ke `data/db.json` (gitignored). Hapus file tersebut
  untuk mengembalikan seed awal.
- Mode Supabase: hapus isi tabel lalu jalankan ulang `node
  scripts/seed-supabase.mjs` untuk mengembalikan data demo.
- Notifikasi email/WhatsApp, wishlist, dan multi-vendor adalah fase lanjutan
  (lihat PRD Non-Goals).
