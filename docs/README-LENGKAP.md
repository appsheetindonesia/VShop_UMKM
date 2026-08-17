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
| **Admin** | Dashboard statistik, review pendaftaran merchant (setujui/tolak), CRUD merchandise, daftar pesanan, log notifikasi WhatsApp, order kadaluarsa (riwayat auto-expire + retry massal) |
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
    admin/                  # Dashboard admin (review merchant, produk, pesanan, log notifikasi,
                            #   order kadaluarsa + retry massal, configurasi koneksi)
    api/                    # Route handlers (auth, cart, checkout, pay, upload, midtrans, health)
  components/               # Komponen UI (kartu, form, tombol, nav, ImageField)
  lib/
    db.ts                   # Store hibrida: Supabase (hydrate/persist) + fallback JSON demo (tulis debounce)
    db-demo.test.ts         # Unit test mode demo: debounce tulis JSON (max 1 tulis/tick)
    service.ts              # Modul bisnis inti — antarmuka tidak berubah (seam)
    auth.ts                 # Sesi, cookie, guard role
    supabase/server.ts      # Factory client Supabase (service-role & anon)
    supabase-auth.ts        # Adapter Auth Supabase (signUp/signIn/OTP/reset password)
    otp.ts                  # OTP WhatsApp: sendOtp/verifyOtp (Supabase atau demo)
    validation.ts           # Skema Zod (SEC-03)
    midtrans.ts             # Adapter Midtrans (demo / sandbox / produksi + signature)
    settings.ts             # Pengaturan koneksi (Configurasi): registry + env fallback + enkripsi
    notif-log.ts            # Log notifikasi (append-only, untuk halaman admin)
    types.ts                # Tipe data (sesuai skema database TRD)
    format.ts               # Format Rupiah & tanggal
  *.test.ts                 # Unit test per modul (36 file, 585 test — lihat Coverage)
  components/Badge.test.ts  # Mapping status→label→warna (paymentBadge/claimBadge/statusColor)
vitest.config.mts          # Coverage v8 (src/lib) + ambang gate ≥ 80%
.github/workflows/ci.yml         # CI: typecheck + npm run test:coverage (gate ambang)
.github/workflows/supabase-e2e.yml # CI: supabase start → db:rls + e2e-auth (Supabase lokal di runner)
supabase/
  migrations/0001_init.sql  # Skema + RLS + Storage + seed paket
  migrations/0005_notification_logs.sql  # Tabel log notifikasi (RLS default deny)
  migrations/0007_cron_runs.sql          # Riwayat run job terjadwal (laporan admin)
  migrations/0008_orders_insert_own.sql  # Policy INSERT orders: pemilik (auth.uid) boleh buat order
  migrations/0009_app_settings.sql  # Pengaturan koneksi (Configurasi) — rahasia terenkripsi, service-role only
  migrations/0010_payment_status_cancelled.sql  # CHECK payment_status + 'cancelled' (pembatalan eksplisit)
  migrations/0012_storage_owner.sql             # Perketat Storage: owner check folder per user ({uid}/…)
scripts/
  seed-supabase.mjs         # Seed data demo ke Supabase (Auth + PostgreSQL)
  midtrans-simulator.ts     # Fixture: simulator HTTP Midtrans sandbox (tolak duplikat 406 + Status API + settleQris/denyGopay)
  persist-chain.test.ts     # Regresi persistChain (mock PostgREST HTTP) — otomatis di npm test
  measure-writes.test.ts    # Pengukuran tulis Supabase sebelum/sesudah koalesensi — otomatis di npm test
  e2e-retry.test.ts         # E2E retry pembayaran vs simulator Midtrans — otomatis di npm test
  e2e-sim-flows.test.ts     # E2E sukses QRIS & gagal GoPay vs simulator — otomatis di npm test
```

## 🔌 Mode Supabase (PostgreSQL + Auth + RLS + Storage)

`src/lib/db.ts` adalah **store hibrida**: saat env Supabase terisi, seluruh data
di-hydrate dari PostgreSQL pada request pertama (`ensureHydrated()` — di-await
oleh root layout & seluruh API route, memoized per proses) dan setiap mutasi
di-persist kembali ke Supabase — **antarmuka `src/lib/service.ts` tidak berubah
sama sekali** (seam tetap). Tanpa env, aplikasi otomatis kembali ke mode demo
(JSON).

**Mode demo (JSON) — tulis file di-debounce**: banyak `mutate()` berurutan
mendapat **maksimal SATU tulis `data/db.json` per tick** (pola batch+flush yang
sama dengan koalesensi Supabase — snapshot terbaru menang, tulis yang masih
menunggu dilewati), sehingga beban I/O turun drastis saat alur memuat banyak
mutasi beruntun (checkout, klaim, retry). `flushNow()` / drain shutdown
(SIGTERM/SIGINT) menuntaskan tulis yang masih terjadwal sebelum proses keluar;
`persist()` tetap tulis langsung (sinkronisasi eksplisit). Lokasi file bisa
di-override dengan env `VSHOP_DATA_DIR` (default `<cwd>/data`).

**Mode Supabase — `persist()` (full flush) di-debounce**: beberapa panggilan
`persist()` yang memicu bersamaan (mis. beberapa job cron hampir serentak,
masing-masing request punya event-loop turn sendiri sehingga tidak tergabung
lewat `pendingWrite`) digabung jadi **SATU full flush** dengan snapshot
TERBARU (diambil saat flush berjalan, bukan saat permintaan) — bukan N full
flush yang menumpuk 12 koleksi × N request. Urutan tetap terjaga via
`persistChain` (flush selalu berjalan setelah batch mutate yang mengantre) dan
`await persist()` tetap menunggu tulis selesai (kontrak sinkronisasi). Writer
melewati tabel kosong (`writeTable` skip `rows.length === 0`), jadi full flush
hanya menulis koleksi yang benar-benar terisi. Panggilan berurutan (setelah
flush selesai) tetap menulis setiap kali.

**Endpoint `GET /api/health`** — status operasional satu panggilan (tanpa
auth, `force-dynamic`):

- `supabase.postgres` — **ping Postgres** lewat round-trip PostgREST sungguhan
  (`SELECT key … LIMIT 1` ke `app_settings`, migration 0009): `ok`, `latencyMs`,
  `error` — memvalidasi Kong → PostgREST → PostgreSQL, bukan sekadar port.
- `migrations` — versi **migration terakhir** + jumlah file dari
  `supabase/migrations/` (fallback `error` bila folder tak ada di runtime).
- `persist` — **antrean tulis yang belum ter-flush** (`getPersistQueueInfo()`
  di `db.ts`): `storeMode`, `hydrated`, `pendingBatches`,
  `pendingCollections` (koleksi yang menunggu), `drainRegistered` (apakah
  drain SIGTERM/SIGINT terdaftar), `lastFlushAt`/`lastFlushDurationMs`
  (flush terakhir selesai kapan & berapa lama — untuk memantau drain saat
  shutdown agar snapshot tidak hilang), serta **`jsonWriteCount`** (jumlah
  tulis file `data/db.json` seumur proses; 0 di mode Supabase).
- **`demo`** — ringkasan mode demo: `{ file: "data/db.json", jsonWrites: N }`
  → *"demo JSON — N tulis sejak start"*. Hanya ada saat `storeMode:
  "json"`.
- HTTP **200** saat sehat / mode demo (tanpa env Supabase, `status: "demo"`);
  **503** (`status: "degraded"`) bila Supabase dikonfigurasi tapi ping gagal.

Mode penyimpanan juga diumumkan di **log startup**: `[db] mode: DEMO (JSON)
— … (tulis sejak start: N)` (atau `Supabase tidak dikonfigurasi` / `fallback`)
— jadi mode + beban tulis langsung terlihat tanpa mengetik curl.

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
   paket langganan. `0002_sessions_refresh.sql` menambahkan (a) kolom
   `sb_refresh_enc`/`sb_user_id` di `sessions` (refresh token Supabase
   terenkripsi — lihat seksi "Sesi lintas perangkat" di bawah) dan (b) kolom
   `original_order_number`/`previous_order_numbers` di `orders` — riwayat
   penggantian order_id hasil retry tersimpan di PostgreSQL, bukan hanya di
   `metadata` jsonb (writer `db.ts` menyalinnya dari metadata ke kolom;
   hydrate menggabungkannya kembali — kolom menang bila ada).
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
6. **Verifikasi keamanan otomatis** (`node scripts/e2e-rls.mjs`) — RLS di
   semua tabel (anon/authenticated/service), Storage (isolasi antar user),
   dan Auth phone (OTP + password) diuji otomatis SETIAP setup; bila ada
   policy yang melanggar ekspektasi, setup berhenti dengan exit 1.

Opsional: `npm run db:setup -- --reset` (jalankan `supabase db reset` dulu
— migration + seed dari nol), `--no-seed` (lewati seed + verifikasi
keamanan), `--no-rls` (hanya lewati verifikasi keamanan), `--skip-start`
(hanya baca kredensial + tulis .env.local). Detail kredensial & langkah
manual tetap bisa diakses via `npm run db:status` dan perintah-perintah di
bawah.

```bash
npm run db:status    # lihat kredensial lokal (API URL, anon, service_role)
npm run db:reset     # migration + seed.sql dari nol
npm run db:seed      # seed data demo saja
npm run db:stop      # matikan stack (data tetap ada)
npm run dev          # jalankan aplikasi — mode Supabase aktif otomatis
npm run stop:dev     # HENTIKAN dev server GRACEFUL (drain terakhir dijalankan)
```

**`npm run stop:dev`** (`scripts/stop-dev.mjs`) — mematikan dev server secara
normal sehingga drain terakhir `registerShutdownFlush` (flush snapshot yang
masih mengantre sebelum proses keluar) benar-benar diuji, bukan `taskkill
/F`/`Stop-Process -Force` yang mematikan tanpa drain. Script menemukan
proses next-server asli + port-nya dari daftar proses, lalu:

- **POSIX** — kirim **SIGTERM** → handler `registerShutdownFlush` menjalankan
  `flushNow` lalu `process.exit(0)`;
- **Windows** — SIGTERM tidak bisa ditangkap proses Node yang detached (libuv
  = TerminateProcess; diverifikasi eksperimen) → script memanggil **`POST
  /api/dev/shutdown`** (endpoint **dev-only**, 403 di produksi) yang
  mengeksekusi jalur drain yang SAMA (`drainAndExit` → `flushNow` → exit),
  lalu menunggu proses keluar (grace 15 s; paksa pohon proses hanya bila
  masih hidup). Verifikasi drain: cari `[db] shutdown: drain terakhir` di log
  server.

Saat server dijalankan dari terminal (bukan detached), Ctrl+C juga memicu
drain yang sama (SIGINT → `registerShutdownFlush`).

`supabase start` otomatis menjalankan migration `supabase/migrations/`
(`0001_init.sql` → 12 tabel + RLS + bucket Storage `vshop-assets`;
`0002_sessions_refresh.sql` → kolom refresh token terenkripsi (sessions) +
  kolom riwayat retry order (`original_order_number`/`previous_order_numbers`);
`0003_grants.sql` → privilege anon/authenticated/service_role;
`0004_claims_expiry_notify.sql` → dedupe notifikasi voucher hampir
kadaluarsa; `0005_notification_logs.sql` → log pengiriman WhatsApp) + seed
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

- **Satu perintah, semua keamanan** — `npm run db:rls`
  (`scripts/e2e-rls.mjs`) terhadap Supabase lokal (prasyarat:
  `npm run db:setup`) memverifikasi **RLS di 12 tabel + Storage bucket
  `vshop-assets` + Auth phone (OTP & password)** sekaligus:

  1. **anon** — tabel publik (paket/merchant/promo/voucher/merchandise)
     terbaca; tabel privat (profil/order/dompet/keanggotaan/voucher
     terklaim/sesi/keranjang) tersembunyi RLS (0 baris); insert tanpa
     policy ditolak; kolom `sessions.sb_refresh_enc` diblokir hak kolom;
  2. **authenticated (customer)** — melihat baris miliknya sendiri
     (order/dompet/keanggotaan/voucher terklaim/sesi), bukan milik user
     lain; update profil sendiri boleh; insert order MILIK SENDIRI boleh
     (policy `orders_insert_own`, migration 0008: `with check
     (user_id = auth.uid()::text)`) — order atas nama user lain ditolak RLS;
     insert promo/update merchant milik orang lain DITOLAK; kolom sensitif
     tetap tertutup;
  3. **authenticated (merchant)** — melihat & mengupdate merchant miliknya
     sendiri; tidak melihat order customer;
  4. **service_role** — bypass RLS (semua order + kolom sensitif boleh);
  5. **Storage `vshop-assets`** — SELECT publik (anon boleh download), tapi
     INSERT/UPDATE/DELETE khusus `to authenticated` **dengan owner check
     folder per user** (migration 0012): objek hanya boleh dibuat/diubah/
     dihapus di folder milik sendiri (`{auth.uid()}/…`, segment path
     pertama = uid). Yang diuji: anon ditolak upload & update (403) dan
     hapus tanpa dampak (objek tetap ada — storage DELETE yang ditolak RLS
     tidak mengembalikan error, PostgREST menghapus 0 baris); authenticated
     boleh upload/update/hapus di folder sendiri; **isolasi antar user** —
     upload customer ke folder merchant ditolak, update objek merchant
     tanpa dampak (isi asli utuh), delete objek customer oleh merchant
     tanpa dampak (objek tetap ada); service_role bypass;
     path upload aplikasi selaras: `{uid}/{folder}-{ts}-{rand}.{ext}`
     (`/api/upload`);
  6. **Auth phone** — `signInWithOtp` untuk nomor ter-map `test_otp`
     (6281298765432 → `654321`) sukses; token salah ditolak; token benar
     menghasilkan sesi yang bisa SELECT profil sendiri (RLS owner);
     `signInWithPassword` phone+password tetap berfungsi (salah ditolak,
     benar → sesi).
  7. **Tabel migration 0004–0007** — `notification_logs` (0005) &
     `cron_runs` (0007) DEFAULT DENY untuk anon/authenticated: SELECT 0
     baris, INSERT ditolak, UPDATE 0 baris, DELETE tanpa dampak (baris
     service tetap ada — 0003 memberi GRANT ALL, jadi RLS satu-satunya
     gerbang; satu-satunya penulis/pembaca = service_role); kolom
     `expiring_notified_at`/`expiring_24h_notified_at` pada
     `claimed_vouchers` (0004/0006) terlihat oleh pemilik (customer SELECT
     klaim sendiri membacanya) dan tersembunyi dari user lain (merchant
     SELECT klaim customer → 0 baris).

  Keluar dengan exit code 1 bila ada policy yang melanggar ekspektasi, dan
  membersihkan semua data uji yang dibuatnya (tabel + objek storage).

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
npm run db:setup    # setup LENGKAP sekali perintah (Docker → start → .env.local → seed → verifikasi keamanan)
npm run db:start    # supabase start   — nyalakan stack lokal
npm run db:stop     # supabase stop    — matikan (data tetap ada)
npm run db:reset    # supabase db reset — migration + seed dari nol
npm run db:seed     # node scripts/seed-supabase.mjs — data demo (idempotent)
npm run db:status   # supabase status  — URL & kunci lokal
npm run db:webhook  # e2e webhook Midtrans signed vs Supabase lokal (deny/settlement/expire)
npm run db:snap-error  # e2e popup/embed Snap onError (stub lokal) — overlay + metadata
npm run webhook:ngrok  # tunnel ngrok ke dev server → URL publik utk Payment Notification URL Midtrans
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
- Tombol **Cek Status Pembayaran** memanggil `GET
  /api/pay/[orderId]/status?reconcile=1` (baca store dulu — hasil webhook —
  baru Status API bila masih pending); order ditandai lunas otomatis bila
  transaksi capture/settlement. Saat halaman dimuat, reconcile yang sama
  dijalankan otomatis sekali (lihat "Alur sinkronisasi status pembayaran").
- **Coba Lagi (retry)** — order dikembalikan ke `pending`, dibuatkan **snap
  token baru** DAN **nomor order baru** (`nextRetryOrderNumber`): order_id
  lama berstatus terminal (expired/denied) bisa ditolak Midtrans bila
  dipakai ulang. Nomor lama disimpan di metadata
  (`originalOrderNumber` + `previousOrderNumbers`) untuk audit.
- **Guard retry di sisi API** — `retryOrderPayment` MENOLAK order yang sudah
  lunas (`Order sudah lunas — tidak bisa di-retry` → HTTP 400 di
  `/api/pay/[orderId]/retry`), sebagai pertahanan selain penyembunyian tombol
  di UI: membuat transaksi baru untuk order yang sudah dibayar berisiko
  charge ganda. `/api/admin/retry-expired` juga hanya menerima order
  `failed`/`expired` (lainnya di-skip dengan alasan).
- **Batas percobaan retry** — order yang gagal terus-menerus tidak bisa
  di-retry tanpa batas: maks **`MAX_ORDER_RETRIES`** (default **3x**, env
  opsional). Hitungan berasal dari log audit (`event: "retry"` di
  `paymentAudit`), jadi konsisten dengan metrik retry admin & riwayat nomor
  order. Saat batas tercapai: `retryOrderPayment` melempar
  `Batas percobaan pembayaran ulang tercapai (maks Nx)` (HTTP 400 di kedua
  endpoint retry — pelanggan & admin), dan layar `/bayar/gagal` mengganti
  tombol "Coba Lagi" dengan pesan hubungi admin.
- `MIDTRANS_API_BASE` (opsional) — override base URL Snap v1 & Status v2
  untuk pengujian lokal (mis. simulator sandbox) / proxy.
- `MIDTRANS_SNAP_SCRIPT_URL` (opsional) — override URL Snap.js yang dimuat
  browser (default: sandbox/produksi sesuai `MIDTRANS_IS_PRODUCTION`);
  dipakai untuk menguji jalur embed dengan stub lokal.
- Webhook **`POST /api/midtrans/notification`** diverifikasi signature
  `SHA512(order_id + status_code + gross_amount + serverKey)` dan idempotent
  (SEC-06). Diuji unit di `src/app/api/midtrans/notification/route.test.ts`
  (8 test, signature ASLI dihitung ulang terhadap server key test): signature
  palsu → 403 tanpa efek; signature **terbentuk baik tapi berkunci lain**
  (pemalsuan realistis) → 403; payload **ditamper** (order_id diganti) dengan
  signature valid utk payload lain → 403; settlement → pending→paid SEKALI +
  `notifyOrderPayment` TEPAT 1×; webhook duplikat → idempoten (notify tetap
  1×); deny → failed + notify 1× (duplikat tetap 1×); expire → expired;
  order tak ditemukan → 200 tanpa efek. `verifyMidtransSignature` sendiri
  diuji unit (6 test di `src/lib/midtrans.test.ts`): signature benar → true;
  komponen mana pun diganti (order_id / status_code / gross_amount) → false;
  `gross_amount` di-hash MENTAH (`7000.00` ≠ `7000`); hex case-sensitive
  (uppercase ditolak); kosong/non-hex → false; tanpa server key → false.
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

### 🧪 Uji Sandbox — alur e2e Snap (QRIS / VA / GoPay / kartu)

Semua data di bawah bersumber dari dokumentasi resmi Midtrans
(https://docs.midtrans.com/docs/testing-payment-on-sandbox). Sandbox
**tidak memindahkan uang asli** — JANGAN pernah membayar transaksi sandbox
menggunakan rekening/e-wallet sungguhan.

**Prasyarat** — `.env.local` berisi `MIDTRANS_SERVER_KEY` +
`MIDTRANS_CLIENT_KEY` (sandbox), dev server berjalan, dan `supabase start`
(opsional — mode demo JSON juga cukup untuk uji alur).

**Alur e2e Snap:**

1. Login sebagai pelanggan demo (lihat "Akun demo" di atas).
2. Tambah paket voucher ke keranjang → checkout → halaman bayar
   `/bayar/[orderId]`.
3. Dengan `MIDTRANS_CLIENT_KEY`, halaman memuat `snap.embed` — form
   pembayaran muncul **inline** (QRIS/VA/e-wallet langsung di halaman).
4. Pilih metode → selesaikan di simulator sandbox (tabel di bawah).
5. `onSuccess` → aplikasi verifikasi ulang via Status API → redirect ke
   halaman sukses (`/sukses`); `onError` → popup "Pembayaran Gagal" dengan
   alasan spesifik + tombol **Coba Lagi** (retry tanpa keluar halaman, lihat
   di bawah); `onPending` → order tetap `pending` sampai webhook/Status API
   mengkonfirmasi.
6. Cek hasilnya (lihat "Cara membaca hasil" di bawah).

**Popup `onError` — "Coba Lagi" langsung**: popup menampilkan alasan
spesifik + kode, lalu tiga aksi: **Coba Lagi** (memanggil retry API di
background → `snap.embed` ulang dengan token baru di halaman yang sama,
tanpa redirect), **Lihat Detail** (ke `/bayar/gagal`), dan **Tutup**.
Retry API (`/api/pay/[orderId]/retry`) mengembalikan `snapToken` baru
sehingga popup bisa re-embed in-place; nomor order baru tercatat di
`previousOrderNumbers` + event `retry` di `paymentAudit` (diverifikasi oleh
`npm run db:snap-error`). Setiap order dibatasi maks `MAX_ORDER_RETRIES`
percobaan (default 3x) — lihat "Batas percobaan retry" di atas.

### ⚠️ E2E otomatis `onError` Snap (stub lokal) — `npm run db:snap-error`

Menguji jalur `onError` Snap **tanpa sandbox interaktif**: stub lokal
(`scripts/snap-error-stub.mjs`) menggantikan API Midtrans **dan** snap.js,
memicu `onError({ status_code: "216", … })` ~400 ms setelah `snap.embed`.

```bash
npm run db:snap-error
```

Yang diverifikasi (31 cek, stabil berulang):

1. **Browser nyata** (Chrome via CDP langsung, tanpa agent-browser) — login
   UI pelanggan demo → buka `/bayar/[orderId]` → stub snap.js memicu `onError`.
2. **Overlay** `role="dialog"` muncul sebelum redirect: judul *"Pembayaran
   Gagal"*, alasan spesifik *"Saldo tidak mencukupi (QRIS)"* (dari tabel
   kode 216), dan *"Kode 216"* — screenshot otomatis disimpan ke
   `.freebuff/snap-error-overlay.png`.
3. **Metadata order di PostgreSQL**: `payment_status=failed`,
   `metadata.failureReason` spesifik, `metadata.snapCallbacks` (event
   `error` + `status_code` mentah), dan `metadata.paymentAudit` berisi event
   `failed` (source `client-fail`, dari `/api/pay/[orderId]/fail`) + event
   `error` terakhir (source `snap`, dari `/snap-callback`).
4. **"Coba Lagi" DI POPUP (tanpa keluar halaman)**: tombol memanggil
   `/api/pay/[orderId]/retry` (kini mengembalikan `snapToken` baru) → popup
   tertutup → `snap.embed` dijalankan ulang dengan token baru → stub memicu
   `onError` kedua → popup muncul lagi. Diverifikasi: token embed berubah,
   nomor order baru (`previousOrderNumbers` terisi), event `retry` di
   `paymentAudit`, dan order kembali `failed` di Postgres.
5. **Bersih otomatis**: order uji, notification log, dan proses uji diakhiri;
   port/profil Chrome unik per run (tidak ada cookie sisa antar-run).

Catatan mesin: `agent-browser connect` intermitten hang di beberapa setup
Windows — script memakai CDP mentah (WebSocket Node) agar deterministik;
port 55952/54400 harus kosong sebelum menjalankan (script menolak bila
terpakai).

**Metode yang bisa disimulasikan:**

| Metode | Cara simulasi di sandbox |
|---|---|
| **QRIS** | Copy URL gambar QR dari halaman Snap → buka
  [QRIS Simulator](https://simulator.sandbox.midtrans.com/qris/scan-qr) →
  tempel URL → Scan → Bayar |
| **GoPay / ShopeePay** | Di mobile otomatis redirect ke simulator; di desktop
  muncul gambar QR → gunakan QRIS Simulator yang sama |
| **VA / Bank Transfer** (BCA/BNI/BRI/Permata/Mandiri billpay/CIMB/BSI/dll.) |
  Midtrans membangkitkan nomor VA → gunakan simulator VA bank
  bersangkutan di halaman yang sama |
| **OVO** | Nomor acak apa pun = sukses; nomor khusus memicu error: e.g.
  `+628249134000` nomor belum terdaftar (RC 14),
  `+628215023424` pending/timeout (RC 68) |
| **Indomaret / Alfamart** | Payment code dibangkitkan → Indomaret/Alfamart
  Simulator |
| **Kartu kredit/debit** | Nomor uji di bawah → OTP/3DS `112233` |

Semua simulator ada di https://simulator.sandbox.midtrans.com/.

**Nomor kartu uji** (CVV `123`, expiry bulan apa pun + tahun masa depan,
OTP/3DS `112233`):

| Skenario | VISA | MASTERCARD |
|---|---|---|
| ✅ Sukses (3DS) | `4811 1111 1111 1114` | `5211 1111 1111 1117` |
| ❌ Ditolak bank | `4911 1111 1111 1113` | `5111 1111 1111 1118` |
| ✅ Sukses (tanpa 3DS) | `4411 1111 1111 1118` | `5410 1111 1111 1116` |
| ❌ Ditolak FDS (fraud) | `4611 1111 1111 1116` | `5411 1111 1111 1115` |

**Cara membaca hasil:**

- **Webhook log** — setiap notifikasi `POST /api/midtrans/notification` yang
  signature-nya valid direkam ke `metadata.paymentAudit` order
  (status_code, status_message, transaction_status, payment_type,
  transaction_id) dan ditampilkan sebagai **timeline** di
  `/transaksi/[orderId]`. Kirim terkirim/diterima juga dicatat di tabel
  `notification_logs` (halaman admin `/admin/notifikasi`).
- **Status API (fallback)** — tombol **"Cek Status Pembayaran"** dan
  reconcile saat page load memanggil `GET /api/pay/[orderId]/status?reconcile=1`:
  status terminal yang sudah diterapkan **webhook** langsung di-return
  (tanpa Midtrans); hanya order yang masih `pending` yang ditanya ke
  Midtrans Status API (`/v2/:orderId/status`) → memantulkan
  `transaction_status` terkini (pending/settlement/deny/expire) dan
  merekam observasinya ke `paymentAudit` (source `status-api`). Polling
  interval di halaman bayar memakai mode **tanpa** param (lokal, tanpa
  Midtrans) — observasinya direkam dengan source `poll` (label
  "Polling"), jadi timeline `/transaksi/[orderId]` memuat ketiganya:
  webhook, Status API, dan polling.
- **Audit callback Snap** — setiap callback `success`/`pending`/`error`/
  `close` disimpan ke `metadata.snapCallbacks` (panel "Riwayat callback
  Snap" di halaman akun) — berguna untuk melihat apa yang dikirim browser
  vs apa yang dikonfirmasi server.
- **Kronologi gagal** — alasan spesifik (mis. `202` ditolak bank, `216`
  saldo tidak cukup QRIS, `203` waktu habis, `201` dibatalkan) muncul di
  badge layar gagal, riwayat pembayaran, dan timeline detail transaksi.
  Untuk GoPay/OVO/VA, `channel_response_code` dari webhook/Status API
  dipetakan ke alasan yang lebih presisi (mis. OVO `68` → "OVO tidak
  merespons") dan ditampilkan sebagai baris **"🔌 kanal …"** di timeline.
- **Error konfigurasi pembayaran (401/402/403/410) → alert merchant** —
  saat Status API menolak karena masalah setting (bukan kegagalan
  pelanggan), route `/api/pay/[orderId]/status` **tidak mengubah
  payment_status** (order tetap pending) tapi: (1) mencatat event
  **`config-error`** ke `metadata.paymentAudit` (source `status-api` +
  status_code + alasan spesifik — tampil di timeline sebagai
  "Konfigurasi Bermasalah"), dan (2) mengirim **notifikasi WhatsApp ke
  merchant** (`notifyMerchantPaymentConfigIssue`, tipe log `config_alert`)
  berisi kode + alasan + link `/admin/configurasi` untuk perbaiki kunci/
  akun. `getMidtransStatus` kini melempar `MidtransApiError` yang membawa
  `statusCode`, dan `midtrans_api_base` (Configurasi) benar-benar dipakai
  untuk Snap & Status API — bisa diarahkan ke simulator lokal untuk uji.

> Catatan: webhook Midtrans **tidak bisa menjangkau localhost** — untuk
> menerima notifikasi saat dev lokal, expose server dengan **tunnel ngrok**
> lewat `npm run webhook:ngrok` (`scripts/ngrok-webhook.mjs`): script
> mendeteksi port dev server yang berjalan, menjalankan `ngrok http <port>`,
> mencetak URL publik + **langkah menempelkannya ke Payment Notification
> URL** di dashboard Midtrans (Settings → Configuration), dan memverifikasi
> tunnel menjangkau aplikasi (`GET /api/health`). Prasyarat: ngrok
> ter-install & sudah login (`ngrok config add-authtoken <TOKEN>`); biner
> bisa di-override via `NGROK_BIN`. Tanpa webhook, alur tetap jalan lewat
> **reconcile** (`?reconcile=1` di bawah) — `scripts/e2e-snap.mjs`
> memakainya untuk deteksi settlement.

### ✅ Runbook Verifikasi Sandbox — validasi 4 alur inti

Runbook langkah-demi-langkah untuk memvalidasi **seluruh alur pembayaran**
terhadap Midtrans sandbox asli, memakai data uji resmi yang sudah
didokumentasikan di atas. Setiap skenario mandiri (order baru); kerjakan
urut dari A.

**Prasyarat (sekali saja):**

| # | Persiapan | Perintah / lokasi |
|---|---|---|
| 1 | Kunci sandbox | `.env.local`: `MIDTRANS_SERVER_KEY=SB-Mid-server-…`, `MIDTRANS_CLIENT_KEY=SB-Mid-client-…`, `MIDTRANS_IS_PRODUCTION=false` |
| 2 | Stack lokal | `npm run db:setup` (atau `supabase start` + `npm run db:seed`; mode demo JSON cukup untuk alur UI) |
| 3 | Dev server | `npm run dev` (bila pakai preview: `next dev -p 55951`) |
| 4 | Webhook (settlement langsung) | `npm run webhook:ngrok` → tempel URL ke dashboard sandbox → Settings → Configuration → **Payment Notification URL** (`…/api/midtrans/notification`). Tanpa tunnel, settlement tetap terdeteksi lewat reconcile (`?reconcile=1`) — hanya lebih lambat |
| 5 | Login pelanggan demo | `customer@vshop.id` / `customer123` (login OTP WhatsApp: kode `123456`) |

**Matriks skenario:**

| Skenario | Data uji | Status akhir diharapkan |
|---|---|---|
| **A. Sukses QRIS** | QRIS Simulator → Scan → Bayar | `paid` → redirect `/sukses` |
| **B. Gagal kartu** (ditolak bank) | VISA `4911 1111 1111 1113`, CVV `123`, OTP `112233` | `failed` → layar gagal, alasan *"Pembayaran ditolak oleh bank"* (kode `202`) |
| **C. Kadaluarsa** (expire cepat) | Order dibiarkan pending; `ORDER_EXPIRY_HOURS=0.01` (±36 dtk) | `expired` → alasan *"Waktu pembayaran habis"* |
| **D. Coba Lagi** (retry) | Lanjut dari B/C → Coba Lagi → bayar QRIS sukses | `paid` + **nomor order baru** (`previousOrderNumbers`) |

#### Skenario A — Sukses QRIS (alur bahagia)

1. Login pelanggan → tambah paket voucher ke keranjang → checkout →
   `/bayar/[orderId]` (Snap embed: form pembayaran inline di halaman).
2. Pilih **QRIS** → salin URL gambar QR → buka
   [QRIS Simulator](https://simulator.sandbox.midtrans.com/qris/scan-qr) →
   Scan → Bayar.
3. **Harapan**: `onSuccess` Snap → redirect **`/sukses`** (Lihat Voucher);
   order `payment_status=paid`, `payment_method=qris`.
4. **Verifikasi**: halaman `/sukses`; halaman akun → riwayat pembayaran
   (badge ✅ Berhasil); `/transaksi/[orderId]` — timeline memuat event
   `settlement` (source `webhook` atau `status-api`) + callback Snap
   `success`. Log server: `[wa] … terkirim` (notifikasi paid pelanggan —
   mode demo WhatsApp bila tanpa token).

#### Skenario B — Gagal kartu (ditolak bank)

1. Order baru → pilih **Kartu Kredit** → isi VISA `4911 1111 1111 1113`,
   CVV `123`, expiry bulan apa pun + tahun masa depan, OTP/3DS `112233`.
2. **Harapan**: Snap `onError` → popup "Pembayaran Gagal" dengan alasan
   spesifik **"Pembayaran ditolak oleh bank"** + kode `202` + tombol
   **Coba Lagi** / **Lihat Detail**.
3. **Verifikasi**: layar `/bayar/gagal?order=…&reason=failed` — badge merah,
   alasan spesifik dari `metadata.failureReason`, tombol Coba Lagi & Kembali
   ke Beranda; DB `payment_status=failed`; `paymentAudit` berisi event
   `failed` (source `webhook`/`status-api`) dengan `status_message` mentah;
   riwayat pembayaran akun tab **Gagal**; log notifikasi WhatsApp gagal
   (`[wa]` + `/admin/notifikasi`).

#### Skenario C — Kadaluarsa (expire cepat)

1. Set `ORDER_EXPIRY_HOURS=0.01` (±36 detik) di `.env.local`, lalu restart
   dev server (nilai dibaca per-request, tapi env proses tetap dari
   `.env.local` saat start).
2. Buat order baru → **jangan bayar** → biarkan 1–2 menit (cron interval +
   jitter; lihat "Cron Jobs" di admin untuk run manual).
3. **Harapan**: order `payment_status=expired`; membuka ulang
   `/bayar/[orderId]` → redirect `/bayar/gagal` dengan alasan
   **"Waktu pembayaran habis"**.
4. **Verifikasi**: admin → **Order Kadaluarsa** (riwayat auto-expire +
   tombol retry massal); admin → **Cron Jobs** (run job expire tercatat di
   `cron_runs`); DB `metadata.lastExpiryRun` terisi; notifikasi WhatsApp
   `expired` terkirim. Setelah selesai, kembalikan `ORDER_EXPIRY_HOURS`
   kosong (default 24 jam).

#### Skenario D — Coba Lagi (retry): dari gagal ke sukses

1. Ambil order gagal/kadaluarsa dari skenario B atau C (atau buat baru lalu
   ditolak kartu).
2. Klik **Coba Lagi** (di popup `onError` — tanpa keluar halaman — atau di
   layar `/bayar/gagal`).
3. **Harapan**: order kembali `pending`, **nomor order BARU**
   (`VS-YYYYMMDD-NNNN`), Snap re-embed dengan token baru; nomor lama
   tersimpan di `metadata.previousOrderNumbers` (+ `originalOrderNumber`).
4. Bayar QRIS (simulator) → sukses → `/sukses`.
5. **Verifikasi**: `/transaksi/[orderId]` — baris *"Nomor lama:
   VS-… → VS-…"*; DB `payment_status=paid`, `previousOrderNumbers` berisi
   nomor lama, `paymentAudit` event `retry` + settlement; riwayat pembayaran
   & metrik retry admin bertambah. **Batas 3×**: pada percobaan ke-4 tombol
   Coba Lagi diganti pesan hubungi admin (guard API `MAX_ORDER_RETRIES` →
   HTTP 400).

**Tabel verifikasi terpusat (di mana melihat hasil):**

| Aspek | Lokasi | Cara cek |
|---|---|---|
| Status pembayaran | `orders.payment_status` | UI riwayat pembayaran / SQL (`docker exec supabase_db_Vshop-umkm psql -U postgres -d postgres -c "SELECT order_number, payment_status, payment_method FROM orders ORDER BY created_at DESC LIMIT 5;"`) |
| Alasan gagal spesifik | `metadata.failureReason` | layar `/bayar/gagal`, badge riwayat, timeline |
| Kronologi pembayaran | `metadata.paymentAudit` | `/transaksi/[orderId]` timeline (webhook + status-api + snap) |
| Callback Snap | `metadata.snapCallbacks` | halaman akun panel "Riwayat callback Snap" |
| Riwayat nomor order | `metadata.previousOrderNumbers` | detail transaksi ("Nomor lama: …") |
| Notifikasi WhatsApp | `notification_logs` | admin `/admin/notifikasi` + log server `[wa]` |
| Cron / auto-expire | `cron_runs` | admin **Cron Jobs** + dashboard alert |
| Webhook diterima | server log + audit | `POST /api/midtrans/notification` → event source `webhook` di timeline |

**Membersihkan data uji antar skenario (opsional):**

- Supabase: hapus order uji
  (`DELETE FROM orders WHERE order_number LIKE 'VS-2026%' AND payment_status IN ('pending','failed','expired');`) — atau `npm run db:reset` untuk
  kembali dari nol (migration + seed).
- Mode demo JSON: hapus `data/db.json` lalu restart dev (atau biarkan saja
  — order uji tidak mengganggu).

### 🔄 Alur sinkronisasi status pembayaran (webhook utama, polling fallback)

Sumber kebenaran status order adalah **webhook `POST
/api/midtrans/notification`** — Midtrans mengirim notifikasi settlement/
penolakan, aplikasi menerapkannya ke store (write-through) + audit +
notifikasi WhatsApp. Jalur lain hanya FALLBACK:

```
  Midtrans
     │
     ├─(1) WEBHOOK ──────────────► POST /api/midtrans/notification
     │      (sumber UTAMA)            signature SHA-512 → store (paid/failed/expired)
     │                               + paymentAudit + WhatsApp
     │
     └─(2) RECONCILE (?reconcile=1)  GET /api/pay/[orderId]/status
            saat page load / aksi user / callback Snap onSuccess-onError
              a. baca store DULU — status terminal webhook → return (tanpa Midtrans)
              b. masih pending? → Status API Midtrans SEKALI (fallback webhook telat)

     (3) POLLING LOKAL (tanpa param)  GET /api/pay/[orderId]/status
            interval 5 detik di halaman /bayar — HANYA baca store
            (hasil webhook), TIDAK PERNAH memanggil Midtrans
              → webhook tiba? redirect sukses/gagal otomatis
              → ±30 detik tanpa webhook? eskalasi ke reconcile (Status API)
              → ±2 menit lagi? berhenti, serahkan ke tombol "Cek Status"
```

`GET /api/pay/[orderId]/status` punya dua mode (lihat route test
`src/app/api/pay/[orderId]/status/route.test.ts`):

- **Tanpa param (polling lokal)** — cukup baca status dari store; kalau
  webhook sudah menerapkan paid/failed/expired → langsung return + redirect,
  tanpa memanggil Midtrans. Murah & aman dipanggil tiap 5 detik. Setiap
  observasi polling direkam ke `metadata.paymentAudit` (event `pending`,
  source `poll` — label "Polling" di timeline) **sekali per perubahan**
  status: entri identik beruntun dilewati, jadi loop 5 detik tidak
  menumpuk dan tidak menulis apa pun saat tidak ada yang berubah —
  riwayat polling bisa ditelusuri kronologinya bersama webhook & callback
  Snap.
- **`?reconcile=1` (sinkronisasi penuh)** — baca store dulu (terminal →
  return tanpa Midtrans); hanya order yang masih `pending` yang ditanya ke
  Status API Midtrans SEKALI sebagai fallback (webhook telat / tak bisa
  menjangkau aplikasi, mis. dev lokal tanpa tunnel). Dipakai saat **page
  load**, tombol **"Cek Status Pembayaran"**, dan callback Snap
  (`onSuccess`/`onError`).

Halaman `/bayar/[orderId]` (komponen `PayForm`): saat dimuat langsung
melakukan **satu reconcile** (webhook sudah terlanjur tiba → redirect
instan; belum → Status API sekali), lalu **polling lokal** selama order
masih pending — webhook yang tiba saat halaman terbuka langsung
menggiring ke sukses/gagal tanpa interaksi. Polling di-eskalasi ke
reconcile bila webhook tak kunjung datang (±30 detik), berhenti setelah
±2 menit, dan menyerahkan ke tombol manual "Cek Status" (reconcile penuh).
Mode demo (snap token tiruan) tetap simulasional dan tidak pernah
memanggil Midtrans.

### 📡 Simulasi webhook Midtrans end-to-end (`npm run db:webhook`)

Tanpa kredensial sandbox asli, `scripts/e2e-webhook.mjs` menguji jalur
webhook **persis seperti notifikasi asli Midtrans** terhadap Supabase lokal:

1. **Checkout pelanggan demo** → 4 order pending (mode demo: tanpa key,
   tanpa panggilan HTTP keluar).
2. **Simpan test key** via `/api/admin/settings` (jalur Configurasi — cache
   server ter-update live, tanpa restart).
3. **Signature salah** → HTTP 403 & order tetap pending (kontrol negatif).
4. **Tiga notifikasi signed** (SHA-512 `order_id + status_code +
   gross_amount + key`):

| Skenario | status_code | transaction_status | payment_type | Hasil di PostgreSQL |
|---|---|---|---|---|
| deny | `202` | `deny` | qris | `failed` + failureReason "Pembayaran ditolak oleh bank" |
| settlement | `200` | `settlement` | bank_transfer | `paid` + paid_at + metode "Virtual Account" + membership aktif |
| expire | `203` | `expire` | qris | `expired` + failureReason "Waktu pembayaran habis" |
| deny OVO (channel) | `202` + `channel_response_code: 68` | `deny` | ovo | `failed` + failureReason spesifik-kanal "OVO tidak merespons…" + `channelResponseCode`/`channelResponseMessage` di paymentAudit |

5. **Verifikasi `metadata.paymentAudit`** di Postgres per order: kronologi
   dimulai `created` (source `create`) dan berakhir event webhook
   (`source: "webhook"` + `statusCode`/`transactionStatus`/`paymentType`
   mentah Midtrans) — data yang sama yang dirender timeline
   `/transaksi/[orderId]` & `/admin/orders`. Untuk event gagal, diuji juga
   bahwa **`detail` (alasan terpetakan) DAN `statusMessage` (pesan mentah)
   tersimpan terpisah** — mis. deny qris 202: `detail` = "Pembayaran ditolak
   oleh bank" + `statusMessage` = "Transaction is denied"; deny OVO:
   `detail` dimulai "OVO tidak merespons…" + `statusMessage` mentah tetap
   utuh.
6. **Bersihkan otomatis (try/finally — selalu jalan walau error)**: order,
   notification_logs, membership uji, dan test key dari `app_settings`.

> **Penting**: script menolak berjalan bila server masih memegang test key
> dari run sebelumnya (cache `globalThis`) — restart dev server dulu, lalu
> jalankan ulang. Inilah juga alasan urutan checkout (sebelum key disimpan)
> dipilih: dengan key tersimpan, checkout akan memanggil Midtrans API asli.
>
> **Guard order sisa**: `order_number` bersifat **UNIQUE** di tabel `orders`.
> Bila ada order sisa run sebelumnya (pending/failed/expired) yang masih di
> Postgres *atau* di cache server, checkout baru bisa dapat nomor yang sama →
> batch write-through gagal diam-diam (cek stderr server: `duplicate key
> value violates unique constraint "orders_order_number_key"`). Script
> menolak jalan dengan instruksi: hapus order sisa + restart dev server.

### 🧾 Riwayat pembayaran di halaman akun — filter, pencarian & daftar lengkap

Seksi **Riwayat Pembayaran** di halaman akun kini punya kontrol filter
(komponen bersama `src/components/PaymentHistoryList.tsx`, dipakai di dua
halaman):

- **Tab status** — Semua / Berhasil (`paid`) / Gagal (`failed` + `expired`);
  filter lewat `searchParams` (server-side, tautan biasa, bukan state
  client).
- **Tab jenis transaksi** — Semua Jenis / Paket (`package`) / Top Up
  (`topup`) / Merchandise (`merchandise`) — baris tab kedua di
  `PaymentHistoryControls`, diterapkan ke `filterPaymentOrders` (AND dengan
  status & pencarian) dan dipertahankan di URL (`?type=…`) di kedua halaman
  (`/akun` pratinjau & `/akun/riwayat-pembayaran`), termasuk href pagination
  dan tombol "Lihat Semua".
- **Pencarian nomor order** — form GET yang juga mencocokkan nomor order
  lama (`originalOrderNumber` / `previousOrderNumbers`) untuk order yang
  pernah di-retry.
- **Tombol "Lihat Semua (N)"** — selalu tampil saat ada order dan mengarah ke
  halaman **`/akun/riwayat-pembayaran`** yang menampilkan daftar lengkap
  dengan kontrol filter yang sama (tab + pencarian dipertahankan lewat URL).
- **Paginasi nyata** — daftar dibagi 20 per halaman (`DEFAULT_PAGE_SIZE` di
  `src/lib/pagination.ts`) lewat `?page=N` (server component, tanpa state
  client): tombol **"← Sebelumnya / Berikutnya →"** muncul saat total
  melebihi satu halaman, header menampilkan rentang "menampilkan 1–20 dari
  N", dan halaman di-clamp ke rentang valid (`?page=99` → halaman
  terakhir). Filter (status/q) dipertahankan di URL halaman — ganti tab atau
  cari kembali ke halaman 1. Helper `parsePageNumber`/`buildListHref`
  diuji unit.
- **Unduh CSV** — tombol "⬇️ Unduh CSV" mengekspor **semua order
  TERFILTER** (status/type/q dari URL) via `GET /api/akun/riwayat-csv`
  (hanya pemilik akun; 401 tanpa sesi). Kolom: nomor order, jenis, status
  (label `paymentBadge` — alasan kegagalan ikut), nominal (angka mentah),
  tanggal. File `riwayat-pembayaran-YYYY-MM-DD.csv`, BOM UTF-8 + CRLF agar
  Excel membaca dengan benar; escaping nilai (kutip digandakan). Serialisasi
  murni `paymentHistoryToCsv` diuji unit.
- Per order: badge status berwarna, kronologi status (audit), riwayat
  callback Snap, dan aksi sesuai status (Lihat Detail untuk lunas, **Coba
  Lagi** untuk gagal/kadaluarsa, Lanjut Bayar untuk pending).
- **Unduh CSV admin** — di dashboard admin (seksi Riwayat Pembayaran),
  tombol "⬇️ Unduh CSV" mengekspor **SEMUA order platform terfilter**
  (status/type/q dari URL, pencarian juga mencocokkan nomor retry lama)
  via `GET /api/admin/riwayat-csv` (khusus admin; 403 tanpa sesi). Kolom
  tambahan **Pelanggan** otomatis ikut (header 6 kolom; baris tanpa nama →
  "—"), lalu jenis, status (label `paymentBadge`), nominal, tanggal.
  File `riwayat-pembayaran-admin-YYYY-MM-DD.csv`, BOM UTF-8 + CRLF.
  Sumber data `getAllAdminPaymentRows` (semua order + join nama pelanggan)
  dipakai juga oleh ringkasan dashboard; serialisasi `paymentHistoryRowsToCsv`
  diuji unit.

### 🧾 Detail Transaksi & Unduh Invoice (`/transaksi/[orderId]`)

Halaman detail per order (akses: pemilik order **atau admin**), ditautkan
"Lihat Detail" di riwayat pembayaran, link "Detail transaksi" per baris,
dan "Lihat Detail Transaksi & Unduh Invoice" dari halaman sukses:

- **Nomor invoice STABIL** — kartu invoice & halaman detail menampilkan
  `VS-INV-YYYYMMDD-XXXX` (dibuat SEKALI saat order dibuat di
  `metadata.invoiceNumber`, tidak pernah berubah), berbeda dari **nomor
  order** (yang diganti saat Coba Lagi / retry) yang tetap ditampilkan di
  bawahnya sebagai "No. Order". Generator `nextInvoiceNumber` memakai
  suffix maks + 1 (tahan gap); order lama tanpa field → tampilan fallback ke
  nomor order (helper murni `getInvoiceNumber` di `payment-history.ts`, diuji
  unit). Nomor invoice ikut tercetak di PDF `#invoice-print`.
- **Ringkasan invoice** — nomor invoice + nomor order, badge status (dengan
  alasan gagal spesifik), tanggal dibuat/dibayar, jenis transaksi, metode
  pembayaran, ID transaksi Midtrans (dari log audit), dan total.
- **Timeline status pembayaran** — dari `metadata.paymentAudit` (helper
  murni `buildPaymentTimeline` di `src/lib/payment-history.ts`): langkah
  kronologis (Dibuat → Menunggu → Berhasil/Gagal/Kadaluarsa/Coba Lagi) dengan
  status_code/status_message/payment_type asli Midtrans + nomor order saat
  kejadian; entri terakhir ditandai sebagai status saat ini.
- **Riwayat Nomor Order** — untuk order yang pernah di-retry, ditampilkan
  tiap penggantian order_id sebagai **"Nomor lama: VS-…0004 → VS-…0005"**
  (helper murni `buildOrderNumberHistory` di `src/lib/payment-history.ts`;
  rantai multi-retry ditampilkan per transisi) — pelanggan/admin bisa
  melacak order_id yang diganti agar tidak bingung dengan nomor di notifikasi
  WhatsApp/webhook lama. Sumbernya dibaca dari kolom PostgreSQL
  `original_order_number`/`previous_order_numbers` (migration 0002) yang
  digabungkan ke metadata saat hydrate — bukan hanya `metadata` jsonb.
- **Rincian item** (nama × qty + subtotal + total) dan **alamat
  pengiriman** bila order memilikinya.
- **Kode QR verifikasi** — kartu invoice menampilkan QR (PNG data URL,
  dibuat server-side dengan paket `qrcode` — tanpa dependensi client)
  berisi payload JSON kompak: `inv` (nomor invoice stabil), `order`, `total`
  (angka mentah), `tid` (transaction_id Midtrans bila sudah ada), `date`.
  Payload ditampilkan juga sebagai teks kecil di bawah QR untuk verifikasi
  manual; QR ikut tercetak di PDF. Helper murni `buildInvoiceQrPayload`/
  `invoiceQrDataUrl` di `src/lib/invoice-qr.ts` diuji unit.
- **Tombol "Unduh Bukti / Invoice (PDF)"** — `window.print()` tanpa
  dependensi library: area `#invoice-print` dicetak, seluruh halaman
  lain disembunyikan via `@media print` di `globals.css` (browser "Save as
  PDF").
- **Akses merchant pemilik** — selain pemilik order & admin, merchant yang
  ordernya punya `metadata.merchantId` sama dengan merchant miliknya (via
  `getMerchantByUserId`) bisa membuka halaman ini — notifikasi "pesanan
  baru" merchant menautkannya ke sini. Merchant lain / tanpa sesi → 404.
- **Tombol "💬 Lacak Pesanan (WhatsApp Support)"** — saat status order
  `failed`/`expired`, halaman menampilkan tombol chat **`wa.me`** ke nomor
  support dengan pesan terisi otomatis (sapaan + No. Order + No. Invoice +
  link detail transaksi). Nomor dikonfigurasi di admin **Configurasi →
  WhatsApp Gateway** (`wa_support_number`, fallback env
  `WHATSAPP_SUPPORT_NUMBER`) — tombol disembunyikan bila nomor belum
  diatur. Helper murni `buildWaSupportLink`/`getSupportAppUrl` di
  `src/lib/wa-support.ts` diuji unit (format E.164, encoding pesan, prioritas
  APP_URL).

### 📜 Format `metadata.paymentAudit` (kronologi pembayaran per order)

Setiap order menyimpan kronologi status pembayarannya di
`metadata.paymentAudit` (jsonb) — sumber timeline di `/transaksi/[orderId]`,
`/admin/orders`, dan riwayat pembayaran. **Data lama (sebelum fitur ini)
yang tidak punya `paymentAudit`** hanya menampilkan *"Belum ada catatan
status"* di timeline; kronologinya bisa di-backfill manual dengan format di
bawah (order contoh di `scripts/seed-supabase.mjs` & `data/db.json` sudah
memakai format ini).

**Aturan**: array kronologis (tertua di awal, terbaru di akhir), maks **50**
entri (yang terlama dibuang), dan entri identik beruntun (source + event +
statusCode + transactionStatus + paymentStatus sama) **dilewati** agar
polling Status API / webhook berulang tidak menumpuk.

```jsonc
// Satu entri = satu perubahan status / observasi Midtrans (PaymentAuditEvent)
{
  "at": "2026-08-11T11:37:03.549Z", // waktu kejadian (ISO)
  "source": "webhook",              // dari mana status diamati / diubah
  "event": "paid",                  // label peristiwa
  "paymentStatus": "paid",          // status aplikasi SETELAH kejadian
  "statusCode": "200",              // status_code Midtrans (opsional)
  "statusMessage": "Success, transaction is settled", // pesan MENTAH Midtrans
  "transactionStatus": "settlement", // transaction_status Midtrans
  "transactionId": "txn-seed-0001", // transaction_id Midtrans
  "paymentType": "qris",            // payment_type Midtrans
  "channelResponseCode": "68",      // channel_response_code (kode GoPay/OVO/VA) — opsional
  "channelResponseMessage": "OVO Wallet late to give response to OVO JPOS", // pesan mentah channel
  "orderNumber": "VS-20260811-0001", // nomor order saat kejadian (berubah saat retry)
  "detail": "Pembayaran via QRIS"   // ALASAN terpetakan yang ditampilkan (opsional)
}
```

**`statusMessage` vs `detail` — mentah vs alasan**: `statusMessage` selalu
menyimpan **`status_message` MENTAH dari Midtrans** (mis. *"Transaction is
denied"*) untuk audit; `detail` menyimpan **alasan terpetakan** (mis.
*"Pembayaran ditolak oleh bank"*). Tampilan timeline (komponen bersama
`PaymentTimeline` & `PaymentHistoryList`, via helper murni
`auditDisplayText` di `src/lib/payment-history.ts`) menampilkan **alasan
sebagai teks utama** dan pesan mentah sebagai baris sekunder berlabel
**"pesan mentah: …"** bila keduanya berbeda — data mentah tetap tersimpan
utuh untuk audit, sementara yang terbaca pengguna adalah alasan spesifiknya.
Bila tidak ada alasan terpetakan, fallback ke `transaction_status` lalu
`status_message` mentah.

**`source`** (siapa menulis): `create` (order dibuat) · `webhook`
(notifikasi Midtrans) · `status-api` (pemantauan Status API) · `snap`
(callback Snap.js) · `client-fail` (layar bayar) · `cron` (auto-expire) ·
`retry` (Coba Lagi) · `mock` (simulasi mode demo).

**`event`** (label peristiwa → tampilan timeline): `created` → *Dibuat* ·
`pending` → *Menunggu* · `paid` → *Berhasil* · `failed` → *Gagal* ·
`expired` → *Kadaluarsa* · `retry` → *Coba Lagi* · `success`/`error`/`close`
→ *Snap Berhasil / Snap Error / Snap Ditutup*.

**Alasan spesifik dari `channel_response_code`** — kode yang datang dari
penyedia channel (bukan status_code Midtrans) dipetakan ke alasan yang
lebih presisi, dan ditampilkan di timeline sebagai **"🔌 kanal {kode} —
{pesan}"**. **Sumber tunggal kedua tabel kode ada di file data murni
`src/lib/midtrans-codes.ts`** (`MIDTRANS_FAILURE_CODES` +
`CHANNEL_RESPONSE_CODES`), di-re-export oleh `src/lib/midtrans.ts` agar
import lama tetap bekerja, dan dipakai ulang sebagai referensi di halaman
admin **Configurasi** (seksi "📖 Referensi Kode Pembayaran Midtrans"):

| Channel | Contoh kode → alasan |
|---|---|
| GoPay | `201` saldo kurang · `112` dompet diblokir · `1604`/`1610` OTP tidak valid/kedaluwarsa · `1203` percobaan PIN berlebihan |
| OVO | `14` nomor belum terdaftar · `17` dibatalkan di aplikasi · `26` gagal push konfirmasi · `40` gagal diproses · `68` tidak merespons/waktu habis |
| VA / bank transfer | `05` ditolak bank (Do Not Honor) · `14` nomor rekening tidak valid · `51` saldo rekening kurang · `91` bank tidak merespons |

Kode channel **menang** atas status_code Midtrans generik (mis. 202 deny),
dan kode yang belum ada di tabel tetap memberi alasan spesifik-kanal
("Ditolak oleh GoPay (kode 50014)" + pesan mentah) — kode & pesan mentah
selalu terekam utuh di `channelResponseCode`/`channelResponseMessage`.
Sumber tabel: docs.midtrans.com (GoPay Response Codes, sandbox OVO RC,
ISO bank codes).

Contoh urutan order yang lunas (persis yang di-seed):
`created` → `pending` (status-api, 201) → `paid` (webhook, 200/settlement).
Urutan order gagal: `created` → `pending` → `failed` (webhook, 202/deny,
`failureReason` tersimpan terpisah di `metadata.failureReason`).

## 💬 Notifikasi WhatsApp (Cloud API)

Notifikasi pembayaran dikirim ke WhatsApp saat status order berubah, via
**WhatsApp Cloud API** (Meta Graph API) — atau mode demo (log `[wa]` di
console) tanpa kredensial:

```bash
WHATSAPP_TOKEN=EAAG...
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_TO=6281234567890   # nomor bisnis utk order merchandise (opsional)
WHATSAPP_SUPPORT_NUMBER=6281234567890 # nomor support — tombol 'Lacak Pesanan' (wa.me) di detail transaksi gagal
WA_LINK_BASE=https://wa.vshop.id      # opsional — domain PUBLIK utk link di pesan (terpisah dari APP_URL)
APP_URL=http://localhost:3000        # fallback link di pesan bila WA_LINK_BASE kosong
```

- **Pelanggan** selalu dapat notifikasi: pembayaran berhasil ✅, gagal, atau
  kadaluarsa (dengan alasan spesifik dari Midtrans, mis. "Saldo tidak
  mencukupi"). **Link di pesan menuju halaman detail transaksi
  (`/transaksi/[orderId]` — timeline status, item, alamat, tombol unduh
  bukti PDF)** agar notifikasi bisa langsung diklik; teks bebas gagal
  menyertakan dua link: **Coba Lagi** (`/bayar/[orderId]`) · **Detail
  transaksi**.
- **Domain link di pesan — `WA_LINK_BASE` terpisah dari `APP_URL`**:
  semua link di pesan WhatsApp (transaksi, bayar ulang, invoice, voucher,
  dashboard, configurasi) memakai `WA_LINK_BASE` (bisa diubah live dari
  admin **Configurasi → WhatsApp Gateway**, field "Link Base"); fallback
  `APP_URL` → `NEXT_PUBLIC_APP_URL` → `http://localhost:3000`. Gunakan ini
  bila domain publik (mis. `https://wa.vshop.id`) berbeda dari domain
  internal aplikasi — pesan tetap memuat link yang bisa dibuka pelanggan,
  sementara aplikasi berjalan di domain lain. Diterapkan konsisten di modul
  WhatsApp (`whatsapp.ts`) dan tombol "Lacak Pesanan" (`wa-support.ts`,
  diuji unit).
- **Merchant** dapat notifikasi pesanan baru untuk order **merchandise**
  (perlu diproses): ke `WHATSAPP_BUSINESS_TO`, atau ke `noWAUsaha` merchant
  bila order punya `metadata.merchantId`. **Link di pesan langsung menuju
  detail transaksi (`/transaksi/[orderId]`)** — penjual langsung melihat
  pesanan masuk (timeline, item, alamat, tombol unduh bukti); teks bebas
  juga menyertakan link dashboard (`/merchant/dashboard`). Merchant juga
  dapat konfirmasi **voucher diredeem** (alur getken) ke nomor usahanya.
- **Pelanggan** dapat peringatan **voucher hampir kadaluarsa** (default 48 jam
  sebelum `masaBerlaku`, atur via `VOUCHER_EXPIRY_NOTIFY_HOURS`); dikirim oleh
  cron yang sama dengan auto-expire, sekali per klaim (dedupe via kolom
  `expiring_notified_at`, migration 0004).
#### 📣 Log Notifikasi (halaman admin)

Setiap **percobaan kirim** dicatat append-only ke tabel `notification_logs`
(migration 0005) dan bisa dipantau di **`/admin/notifikasi`** (menu "Log
Notifikasi"): status (`Terkirim` / `Demo` / `Gagal`), penerima, nomor order,
jenis notifikasi (pembayaran berhasil/gagal, order siap dibayar ulang,
order baru, voucher diredeem, voucher hampir kadaluarsa), nama template
yang dipakai, error, dan waktu.

- **Metrik pengingat per tier** — seksi "Pengingat Voucher per Tier" di
  halaman yang sama menampilkan, untuk **30 hari terakhir**, berapa
  pelanggan diingatkan tiap tier (**48 Jam** `expiring` vs **H-1/24 Jam**
  `expiring_24h`) dan berapa dari mereka yang lalu **membuat klaim baru
  setelah pengingatnya** ("mengklaim ulang") + tingkat klaim ulang %.
  Sumber = marker dedupe di klaim (`expiringNotifiedAt` /
  `expiring24hNotifiedAt`, hanya diisi saat notifikasi benar-benar
  terkirim/dicatat) via `getTierDeliveryMetrics` (`src/lib/service.ts`).
- Ditulis fire-and-forget dari `src/lib/notif-log.ts` (`recordNotificationLog`)
  lewat service-role — kegagalan menulis log **tidak** mengganggu alur kirim.
- **Pelanggan juga melihat riwayatnya** — halaman akun (`/akun`, seksi
  "Notifikasi Order") menampilkan log per pesanan miliknya (dikelompokkan
  per nomor order dengan badge status + link "Detail transaksi"), difilter
  via `listNotificationLogs({ orderNumbers })` — hanya order milik pelanggan
  itu sendiri.
- Tabel di-grant untuk anon/authenticated (default privileges 0003) tapi RLS
  aktif **tanpa policy** → hanya `service_role` yang bisa menulis/membaca
  (terverifikasi `npm run db:rls`, 40/40).
- Mode demo (tanpa Supabase): log disimpan in-memory agar halaman admin tetap
  berfungsi.
- Nomor tujuan dinormalisasi ke E.164 (08xx → 628xx).
- **Anti-duplikat**: webhook Midtrans yang berulang tidak mengirim ulang —
  notifikasi hanya dipicu saat terjadi transisi status (`pending → paid`, dst.).
- Modul di `src/lib/whatsapp.ts` (`notifyOrderPayment`) bersifat fire-and-
  forget dan tidak pernah melempar error — kegagalan kirim tidak mengganggu
  alur pembayaran. `WHATSAPP_API_BASE` bisa di-override untuk pengujian
  lokal (mis. mock Graph API).
- **Invoice PDF otomatis setelah bayar** — notifikasi `paid` (template
  `WHATSAPP_TEMPLATE_PAID` / teks bebas) sudah membawa **link invoice**:
  teks bebas memuat **No. Invoice** (stabil `VS-INV-…`, fallback nomor
  order) + link `…/transaksi/[orderId]?print=1` yang membuka invoice dan
  memicu dialog cetak / "Save as PDF" (komponen client `AutoPrintInvoice`;
  area `#invoice-print` yang dicetak). Template Meta bisa memakai peran
  tombol `invoice` ("Lihat Invoice PDF" → `<APP_URL>/transaksi/{{1}}?print=1`)
  di `WHATSAPP_TEMPLATE_PAID_BUTTONS`.

**Unit test** (`src/lib/whatsapp.test.ts`, fetch global di-mock): payload
Graph API diverifikasi tanpa jaringan — mode template vs teks bebas + fallback,
retry backoff (transient vs permanen), konkurrensi antrian, dan **pemilihan
penerima** `notifyOrderPayment`. Lookup data lewat **seam `WaDeps`**
(`getOrder` / `getMerchantById` / `getUserById`) yang disuntik per panggilan
— **tanpa mocking modul** (`vi.mock` dihapus): produksi memakai
`defaultDeps` (service + db), test menyuntik stub yang baca fixture, jadi
modul `./db` dan `./service` di-import apa adanya. Kasus yang diuji: paid
paket → pelanggan saja; paid merchandise → pelanggan + merchant
(`WHATSAPP_BUSINESS_TO` atau `noWAUsaha` via `metadata.merchantId`);
failed/expired → pelanggan saja (alasan spesifik di param template); nomor
pelanggan tidak valid → dilewati tanpa kirim.

#### ⏳ Antrian kirim (in-memory) + retry backoff

Semua notifikasi masuk **antrian in-memory** dan diproses di latar belakang
dengan konkurrensi terbatas (`WA_QUEUE_CONCURRENCY`, default 3) — request
pembayaran tidak lagi menunggu pengiriman satu per satu, sehingga puluhan
notifikasi (mis. cron expiry) tidak membebani request. Setiap job:

- **Retry otomatis** untuk kegagalan sementara (network / HTTP **5xx** /
  **429** / respons tanpa message id) dengan **exponential backoff + jitter**
  (`WA_RETRY_BASE_MS` default 800ms, ×2 per percobaan, cap 8s;
  `WA_RETRY_MAX_ATTEMPTS` default 3).
- Kegagalan **permanen** (4xx, template ditolak → fallback teks juga ditolak)
  tidak diulang — hasil akhir (termasuk jumlah retry) dicatat ke
  `notification_logs` dan tampil di halaman admin.
- Jalur yang butuh hasil (cron `notifyClaimExpiringSoon` untuk dedupe
  `expiring_notified_at`) tetap `await` hasil job; jalur pembayaran
  fire-and-forget (`enqueueLogged`).

> **Catatan lingkungan serverless:** antrian diproses oleh proses yang sama
> dengan server (long-running). Di platform yang membekukan proses setelah
> response (mis. Vercel Functions tanpa streaming), kiriman yang masih
> mengantre saat response selesai bisa hilang. Untuk deployment serverless
> murni, pindahkan pengiriman ke job broker (BullMQ / db.schedule / webhook
> eksternal).

### Template message (mode kirim utama)

Sesuai kebijakan Meta, pesan di luar *24-hour session window* (pelanggan
belum pernah menghubungi bisnis) WAJIB memakai **template message** yang
sudah disetujui Meta. Aplikasi mengirim template sebagai mode **utama** dan
automatis **fallback ke teks bebas** (sandbox / masih dalam 24h window di
mana teks bebas diizinkan):

```bash
WHATSAPP_MESSAGE_MODE=auto        # auto (default) | text
WHATSAPP_TEMPLATE_PAID=vshop_payment_success
WHATSAPP_TEMPLATE_FAILED=vshop_payment_failed
WHATSAPP_TEMPLATE_ORDER=vshop_new_order
WHATSAPP_TEMPLATE_LANG=id
WHATSAPP_TEMPLATE_PAID_BUTTONS=invoice,detail # "Lihat Invoice PDF" + "Lihat detail pesanan"
WHATSAPP_TEMPLATE_FAILED_BUTTONS=retry,detail # "Bayar ulang" + "Lihat detail pesanan"
WHATSAPP_TEMPLATE_EXPIRING_BUTTONS=vouchers   # CTA "Gunakan Sekarang" → /voucher-saya
```

- `auto` — template dulu; bila Graph API menolak (mis. template belum
  disetujui / salah nama / sandbox), otomatis kirim teks bebas.
- `text` — selalu teks bebas (pengembangan / sandbox tanpa template).

Buat template di Meta Business Suite sesuai body di bawah ini
(placeholder `{{1}}..{{n}}` diisi **urut** oleh aplikasi):

| Env | Template body yang diharapkan |
|---|---|
| `WHATSAPP_TEMPLATE_PAID` | `Halo {{1}}, pembayaran order {{2}} sebesar {{3}} berhasil. Detail: {{4}}` — *{{1}} nama, {{2}} no. order, {{3}} jumlah, {{4}} link detail transaksi* |
| `WHATSAPP_TEMPLATE_FAILED` | `Halo {{1}}, pembayaran order {{2}} sebesar {{3}} belum berhasil: {{4}}. {{5}}` — *{{1}} nama, {{2}} no. order, {{3}} jumlah, {{4}} alasan, {{5}} link detail transaksi* |
| `WHATSAPP_TEMPLATE_ORDER` | `Halo {{1}}, ada pesanan baru {{2}} ({{3}}) sebesar {{4}}. {{5}}` — *{{1}} nama merchant, {{2}} no. order, {{3}} item, {{4}} jumlah, {{5}} link detail transaksi `/transaksi/[orderId]`* |
| `WHATSAPP_TEMPLATE_REDEEMED` | `Halo {{1}}, voucher {{2}} senilai {{3}} berhasil diredeem oleh {{4}} (kode {{5}}). Terima kasih!` — *{{1}} nama merchant, {{2}} nama voucher, {{3}} nilai, {{4}} nama pelanggan, {{5}} kode voucher* |
| `WHATSAPP_TEMPLATE_EXPIRING` | `Halo {{1}}, voucher {{2}} senilai {{3}} akan kadaluarsa pada {{4}}. Segera gunakan: {{5}}` — *{{1}} nama, {{2}} nama voucher, {{3}} nilai, {{4}} tanggal kadaluarsa, {{5}} link* |
| `WHATSAPP_TEMPLATE_RETRIED` | `Halo {{1}}, order {{2}} sebesar {{3}} siap dibayar ulang. Bayar di: {{4}}` — *{{1}} nama pelanggan, {{2}} no. order, {{3}} jumlah, {{4}} link /bayar/[orderId]* — dikirim saat **admin retry massal** order gagal/kadaluarsa |

Template hanya perlu komponen **body** (parameter teks) — aplikasi
mengirim komponen `body` dengan parameter urut; template ber-header/
tombol juga didukung lewat `WaTemplate.components` di `src/lib/whatsapp.ts`.

### Tombol template (component `button`: url / quick_reply)

Template yang disetujui Meta bisa memakai **tombol** untuk aksi langsung
(mis. "Lihat detail pesanan" dan "Bayar ulang"). Peran tombol per template
dikonfigurasi lewat `WHATSAPP_TEMPLATE_PAID_BUTTONS` /
`WHATSAPP_TEMPLATE_FAILED_BUTTONS` / `WHATSAPP_TEMPLATE_EXPIRING_BUTTONS` —
daftar peran dipisah koma, **urut sesuai indeks tombol di template Meta**
(0-based):

| Peran | sub_type | URL template (dibuat di Meta) | Parameter yang dikirim aplikasi |
|---|---|---|---|
| `detail` | `url` | `<APP_URL>/transaksi/{{1}}` | suffix = `order.id` |
| `invoice` | `url` | `<APP_URL>/transaksi/{{1}}?print=1` | suffix = `order.id` — klik langsung buka invoice & dialog cetak / "Save as PDF" |
| `retry`  | `url` | `<APP_URL>/bayar/{{1}}`     | suffix = `order.id` |
| `dashboard` | `url` | `<APP_URL>/merchant/dashboard` (tetap) | — (tanpa parameter) |
| `vouchers` | `url` | `<APP_URL>/voucher-saya` (tetap) | — (tanpa parameter) |

**Kontrak penting:** URL tombol (termasuk `{{1}}` di akhir) **dibuat sekali
di dashboard Meta** saat menyusun template — aplikasi hanya mengirim
**suffix-nya** (`order.id`) via `parameters[0].text`. Contoh template failed
dengan dua tombol: body seperti tabel di atas + tombol `url` "Bayar ulang"
(`https://vshop.id/bayar/{{1}}`) + tombol `url` "Lihat detail pesanan"
(`https://vshop.id/transaksi/{{1}}`); aplikasi mengirim
`WHATSAPP_TEMPLATE_FAILED_BUTTONS=retry,detail`. Bila template punya tombol
tapi env peran tidak diisi, Meta menolak → fallback teks bebas. Peran
`quick_reply` juga didukung (`WaButtonSpec.subType` di `src/lib/whatsapp.ts`)
untuk balasan cepat — payload dikirim di `parameters[0].text`.

**Template EXPIRING ("hampir kadaluarsa" 48 jam & H-1):** CTA **"Gunakan
Sekarang"** memakai peran `vouchers` (tombol `url` tetap →
`<APP_URL>/voucher-saya`, tanpa parameter — suffix tidak dikirim). Peran
ber-order (`detail`/`retry`) TIDAK berlaku untuk notifikasi voucher dan
otomatis diabaikan dengan peringatan.

## ⏰ Auto-Expire Order (cron / job terjadwal)

Order yang masih `pending` lebih dari **24 jam** (atau `ORDER_EXPIRY_HOURS`)
di-expire otomatis — konsisten dengan kadaluarsa transaksi Midtrans:

- **Satu sumber kebenaran**: `getOrderExpiryHours()` di
  `src/lib/midtrans.ts` dipakai untuk field `expiry` di payload Snap Midtrans
  DAN aturan expire lokal, jadi keduanya selalu sama. Nilai dibaca **per
  panggilan** (bukan konstanta module-load): setting admin "Order Expiry
  (jam)" di Configurasi menang (berlaku segera setelah simpan, tanpa
  restart), fallback env `ORDER_EXPIRY_HOURS`; nilai tidak valid (NaN/≤0)
  jatuh ke default 24.
- **Nomor order tahan gap** — `nextOrderNumber` memakai suffix maksimal + 1
  (bukan jumlah+1): bila nomor order dihapus / ada gap (mis. hanya tersisa
  `…-0002`), order baru tetap dapat nomor bebas (`…-0003`) alih-alih
  menghasilkan duplikat yang ditolak constraint unik `orders_order_number_key`.
- **Retry merestart jendela kadaluarsa** — anchor auto-expire adalah
  `metadata.lastRetryAt ?? createdAt` (`expireStaleOrders`). Tanpa ini,
  order yang di-retry (kembali `pending`, tapi `createdAt` lama) akan
  di-expire ulang pada run berikutnya. `retryOrderPayment` menyimpan
  `lastRetryAt` saat membuat ulang pembayaran, jadi order yang baru di-retry
  diberi jendela penuh `ORDER_EXPIRY_HOURS` (diuji di `cron.test.ts`: retry
  → nomor BARU + run berikutnya tidak menyentuh order).
- **Produksi (Vercel Cron)** — `vercel.json` memanggil `GET
  /api/cron/expire-orders` tiap jam (`0 * * * *`). Endpoint terlindungi
  `CRON_SECRET` (Vercel mengirim `Authorization: Bearer <CRON_SECRET>`
  otomatis bila env `CRON_SECRET` ada).
- **Lokal / self-host** — `startExpiryScheduler()` (di root layout)
  menyalakan interval tiap jam di dalam proses; guard `globalThis` mencegah
  timer ganda. Interval memakai **jitter ±20%** per tick (`setTimeout`
  bertingkat, bukan `setInterval` — `CRON_SCHEDULER_JITTER`) agar beberapa
  job/instance tidak memicu di menit yang sama; saat run **gagal beruntun**,
  tick berikutnya di-backoff lebih cepat (eksponensial ×2, cap interval
  normal; base `CRON_FAILURE_BACKOFF_MS`) dan sukses mereset hitungan.
  Jalankan manual kapan saja:
  `curl -X GET http://localhost:3000/api/cron/expire-orders` (dengan header
  Authorization bila `CRON_SECRET` diisi).
- **Menguji batas waktu dengan cepat** — set `ORDER_EXPIRY_HOURS` kecil
  (mis. `0.01` jam = 36 detik) atau ubah "Order Expiry (jam)" di
  Configurasi — karena dibaca per-request, perubahan langsung berlaku
  TANPA restart: order yang berumur > ambang akan di-expire pada cron
  berikutnya (tanpa menunggu 24 jam).
  Unit test memverifikasi cutoff ini di dua level: `src/lib/service.test.ts`
  (expireStaleOrders, order 60s vs 10s) dan `src/lib/cron.test.ts`
  (runExpiryJob end-to-end dengan whatsapp di-mock: order stale di-expire +
  notifikasi `expired` terkirim, order muda tidak tersentuh, dedupe
  notifikasi voucher 48 jam & H-1 di run berikutnya). `runExpiryJob` juga
  diuji **dengan fake timers** (`vi.useFakeTimers` + `setSystemTime`): dalam
  SATU run — order basi (60s > ambang 36s) di-expire, order muda (10s)
  tetap pending, notifikasi terkirim tepat 1× ke order yang di-expire, dan
  `cron_runs` tercatat (`expiredCount:1`, `ranAt` = waktu fiktif).
- **Voucher hangus otomatis** — job yang sama memanggil `expireStaleClaims`:
  klaim `active` yang masa berlakunya sudah lewat ditandai `expired`
  (idempoten, dijalankan SEBELUM window notifikasi "hampir kadaluarsa"
  agar hanya klaim aktif yang dihitung). Konsisten di semua tampilan:
  voucher-saya "Hangus" (merah), merchant laporan/dashboard "Kadaluarsa"
  (abu-abu), dan getken menolak redeem ("Voucher sudah kedaluwarsa").
- Order yang di-expire: `paymentStatus=expired`, `status=cancelled`, alasan
  "Waktu pembayaran habis" tersimpan, dan pelanggan mendapat notifikasi
  WhatsApp (bila aktif). Idempotent — order yang sudah terminal tidak
  disentuh, dan tombol **Coba Lagi** tetap bisa me-reset order.

### 🔔 Pengingat Voucher H-1 (24 jam) — job cron kedua

Pola cron yang sama diterapkan untuk job kedua: **pengingat WhatsApp ke
pelanggan yang vouchernya akan kadaluarsa dalam 24 jam** (H-1, selain
tier 48 jam yang sudah ada):

- **Dua tier pengingat independen**: 48 jam (`expiring_notified_at`) & H-1
  (`expiring_24h_notified_at`, migration 0006) — keduanya bisa mengirim
  tanpa saling memblokir; masing-masing dedupe per klaim (tidak mengirim
  ulang per jam).
- **Produksi (Vercel Cron)** — `vercel.json` menambah `GET
  /api/cron/voucher-expiring-24h` tiap jam (`30 * * * *`, offset dari
  job #1). Proteksi `CRON_SECRET` sama.
- **Lokal / self-host** — `startVoucher24hScheduler()` (root layout)
  menyalakan interval tiap jam (guard `globalThis` terpisah per job).
  Manual: `curl http://localhost:3000/api/cron/voucher-expiring-24h`.
- Window H-1 diatur `VOUCHER_EXPIRY_24H_NOTIFY_HOURS` (default 24);
  template memakai `WHATSAPP_TEMPLATE_EXPIRING` yang sama, teks fallback
  "KADALUARSA BESOK (…)". Log di `/admin/notifikasi` berlabel "Voucher
  Kadaluarsa Besok (H-1)" (`expiring_24h`).

### 🔁 Retry Notifikasi Gagal (cron /api/cron/retry-notifications)

Notifikasi WhatsApp yang GAGAL (status `failed` di `notification_logs`,
migration 0011 menambah `retry_count` + `last_retry_at`) dikirim ulang
otomatis dengan **backoff terbatas**:

- Setiap run mengambil entri layak (tertua dulu): `retry_count <
  NOTIF_RETRY_MAX_ATTEMPTS`, jarak antar percobaan ≥
  `NOTIF_RETRY_BACKOFF_MS` sejak `last_retry_at`, dan umur ≥
  `NOTIF_RETRY_MIN_AGE_MS` (antrian in-memory whatsapp.ts sudah mengelola
  retry cepat; cron ini untuk resilience lintas restart/proses).
- Kirim ulang memakai TEKS BEBAS dari `message` tersimpan (template asli
  mungkin gagal karena alasan permanen); hasil dicatat ke entri yang sama
  (`retry_count+1`, `last_retry_at`, status → `sent` bila sukses, tetap
  `failed` + error diperbarui bila gagal). Entri yang melewati batas
  percobaan tidak dicoba lagi.
- **Produksi (Vercel Cron)** — `vercel.json`: `GET
  /api/cron/retry-notifications` tiap jam (`15 * * * *`). Proteksi
  `CRON_SECRET` sama.
- **Lokal / self-host** — `startNotificationRetryScheduler()` (root
  layout), interval jitter yang sama. Manual:
  `curl http://localhost:3000/api/cron/retry-notifications`.
- Env: `NOTIF_RETRY_MAX_ATTEMPTS` (3), `NOTIF_RETRY_BACKOFF_MS`
  (30 mnt), `NOTIF_RETRY_MIN_AGE_MS` (5 mnt), `NOTIF_RETRY_BATCH` (10).

### 📊 Ringkasan Harian Merchant (cron /api/cron/daily-summary)

Setiap pagi, setiap merchant menerima **ringkasan hari kemarin/saat ini**
via WhatsApp — voucher terklaim hari ini, pendapatan (nilai voucher yang
**diredeem** hari ini), dan jumlah order pending miliknya:

- **Sumber data**: `getMerchantDailySummary(merchantId, now)` — batas hari
  = tengah malam zona server; klaim dihitung dari `claimedAt`, pendapatan
  dari `usedAt` klaim berstatus `used` (nilai voucher), order pending dari
  `metadata.merchantId` (order merchandise).
- **Template** `WHATSAPP_TEMPLATE_DAILY_SUMMARY` (utama) + teks bebas
  (fallback). Body yang diharapkan: `Halo {{1}}, ringkasan V Shop hari
  ini: {{2}} voucher terklaim, pendapatan {{3}}, {{4}} order pending.
  Lihat laporan: {{5}}` — `{{5}}` = `<APP_URL>/merchant/laporan`.
- **DEDUPE per hari**: sebelum mengirim, cron mengecek `notification_logs`
  (jenis `daily_summary`, penerima E.164 merchant, sejak tengah malam) —
  merchant hanya menerima **satu** ringkasan per hari, baik dipicu Vercel
  Cron (1×/hari) maupun scheduler lokal (tiap jam). Merchant tanpa nomor
  valid di-skip.
- **Catatan cache fetch Next.js**: query dedupe memakai URL yang KONSTAN
  (tanpa parameter berubah) — cache fetch Next.js (app router,
  `.next/cache/fetch-cache`) bisa menyajikan respons GET pertama yang
  basi (mis. `[]` saat tabel masih kosong) dan membuat dedupe gagal
  selamanya. Karena itu semua client Supabase server memakai
  `cache: "no-store"` (lihat `src/lib/supabase/server.ts`). Bila pernah
  terjangkit di dev: hapus `.next/cache/fetch-cache` lalu jalankan ulang
  `npm run dev`.
- **Produksi (Vercel Cron)** — `vercel.json`: `GET
  /api/cron/daily-summary` tiap hari pukul 06.00 (`0 6 * * *`). Proteksi
  `CRON_SECRET` sama.
- **Lokal / self-host** — `startDailySummaryScheduler()` (root layout),
  interval jitter yang sama; dedupe memastikan tidak ada spam.
  Manual: `curl http://localhost:3000/api/cron/daily-summary`.
- Log di `/admin/notifikasi` berlabel "Ringkasan Harian Merchant"
  (`daily_summary`).

### 🕰️ Admin — Order Kadaluarsa (`/admin/kadaluarsa`)

Riwayat auto-expire ditelusuri dari **log audit** (`metadata.paymentAudit`,
entri `source: "cron"` / `event: "expired"`). Halaman juga menampilkan
**laporan run job** dari tabel `cron_runs` (migration 0007): kapan job
auto-expire **terakhir berjalan** dan berapa order yang di-expire **per
periode** (riwayat 14 run terakhir). Setiap eksekusi `expireStaleOrders`
mencatat `{ job: "expire", ran_at, expired_count }` (termasuk run 0 agar
"job terakhir berjalan" akurat) via `src/lib/cron-log.ts` (append-only,
service-role; mode demo in-memory):

- Daftar semua order `paymentStatus=expired` dengan **waktu kadaluarsa**
  (dari entri audit), nomor order asal (bila pernah retry),
  pelanggan, total, dan **kronologi auto-expire** per order.
- **Retry massal** (API `POST /api/admin/retry-expired`, guard admin,
  maks 50 order): tiap order dipanggilkan `retryOrderPayment` → kembali ke
  `pending` dengan **snap token & nomor order baru** (order_id terminal bisa
  ditolak Midtrans bila dipakai ulang); nomor lama disimpan di
  `metadata.originalOrderNumber`/`previousOrderNumbers` dan riwayat "coba
  lagi" direkam ke audit. Hasil per-order (sukses/gagal + nomor baru)
  ditampilkan di tabel, lalu halaman di-refresh otomatis.
  API yang sama melayani **retry per-order dari dashboard admin** — kini
  menerima order `paymentStatus` `failed` maupun `expired` (sebelumnya
  hanya expired).
- **Ringkasan cron di dashboard admin** — seksi "⏰ Cron Auto-Expire" di
  `/admin` (statistik utama): kapan job expire **terakhir berjalan**, **total
  order di-expire 7 hari terakhir**, dan **pengingat voucher terkirim 7 hari**
  (dari `cron_runs` via `getExpiryRunSummary`). Laporan per periode
  **mencakup kedua job pengingat**: `notified_count` dijumlah dari job
  `expire` (tier 48 jam) **dan** `voucher-24h` (tier H-1) — run job H-1
  tercatat dengan `notified_count`-nya sendiri, dan run expire juga  mengisi
  kolom `notified_count` untuk pengingat 48 jamnya. Plus link ke halaman
  Cron Jobs.
- **Deteksi cron mati** — banner peringatan amber di atas statistik utama
  bila job auto-expire **tidak berjalan dalam 26 jam terakhir**
  (`expiryStaleInfo`, ambang `>26` jam dari `lastRunAt`; belum pernah
  tercatat juga dianggap stale). Teks menyebut berapa jam sejak run terakhir
  dan menautkan ke halaman Cron Jobs untuk eksekusi manual.

### ⏱️ Admin Cron Jobs (`/admin/cron`)

Halaman admin yang menampilkan **seluruh job terjadwal** dalam satu
papan: jadwal cron (sinkron manual dengan `vercel.json`), run **terakhir**
per job (dari tabel `cron_runs`, migration 0007), dan tombol **"▶
Jalankan Sekarang"** untuk eksekusi manual tiap job:

- **Sumber kebenaran**: registry `CRON_JOB_SPECS` di `src/lib/cron.ts`
  (key, label, deskripsi, jadwal, endpoint, catatan scheduler lokal).
  Setiap job juga kini **mencatat run-nya sendiri ke `cron_runs`**
  (`recordCronRun`) — manual maupun terjadwal tercatat identik, jadi
  "run terakhir" di halaman selalu mencerminkan eksekusi terakhir apa pun
  pemicunya. Pencatatan `expire` dipindah dari `service.expireStaleOrders`
  ke `runExpiryJob` agar satu baris per eksekusi lengkap (order + pengingat
  voucher).
- **Manual run** — tombol memanggil `POST /api/admin/cron/run` (guard
  admin) dengan `{ job }`; hasil ditampilkan inline lalu halaman di-refresh
  (last run terbarui). Job tak dikenal / error → pesan spesifik, tidak
  pernah menggagalkan halaman.
- **Status proteksi** — bila `CRON_SECRET` kosong, halaman menampilkan
  peringatan (endpoint Vercel Cron tidak terproteksi / Hobby terbatas;
  scheduler lokal tetap aktif).
- **Runtime scheduler (jitter & backoff) terlihat** — tiap kartu menampilkan
  status **scheduler lokal** (`getSchedulerStats()` di `src/lib/cron.ts`,
  dicatat ke `globalThis.__vshopSchedulerStats` oleh `startScheduler`):
  `● Aktif` (sejak kapan) vs `Tidak aktif (Vercel Cron)`, **Tick terakhir**
  (waktu tick selesai, sukses maupun gagal), dan **Kegagalan beruntun**
  (badge hijau 0 / merah N) + **delay tick berikutnya** — saat backoff aktif
  muncul badge `backoff` dan delay ditandai "lebih cepat" (eksponensial ×2
  dari `CRON_FAILURE_BACKOFF_MS`, cap interval normal). Di atas grid ada
  baris konfigurasi aktif: interval default, jitter ±%, dan base backoff.
  Catatan: status hanya tercatat untuk scheduler yang di-start pada proses
  ini (Vercel Cron di produksi tanpa scheduler lokal tetap menampilkan
  "Tidak aktif").

### ⚙️ Admin Configurasi — kelola koneksi data keluar (`/admin/configurasi`)

Menu admin untuk mengubah pengaturan **koneksi** tanpa edit env/restart:

- **Database PostgreSQL** — URL Supabase + service role key (uji koneksi =
  query nyata `packages`).
- **Payment Gateway** — Midtrans server/client key, mode produksi, base URL
  (uji koneksi = Status API: 401 = kunci ditolak, 404 = kunci valid).
- **WhatsApp Gateway** — token, phone number id, base URL, nomor merchant
  (uji koneksi = Graph API `/v21.0/{phone_id}`).
- **AI / Integrasi** — base URL + API key + model OpenAI-compatible (opsional;
  uji koneksi = `GET /v1/models`).
- **Lainnya** — `APP_URL` (link notifikasi) & `ORDER_EXPIRY_HOURS`.

Cara kerja:

- Disimpan di tabel **`app_settings`** (migration 0009): RLS tanpa policy +
  revoke anon/authenticated → **hanya service_role**; halaman & API
  (`/api/admin/settings`, `/api/admin/settings/test`) dibatasi **role
  admin** (403 untuk lainnya).
- Nilai **rahasia dienkripsi AES-256-GCM** (`value_enc` = `v1:iv:tag:ct`,
  memakai `SESSION_ENCRYPTION_KEY` yang sama dengan refresh token) dan
  **tidak pernah dikirim utuh ke browser** — `listSettings` mengembalikan
  mask (`••••abcd`); input rahasia yang dikosongkan = pertahankan nilai lama.
- **Sumber nilai**: setting tersimpan menang atas env var (fallback).
  `src/lib/settings.ts` (registry + cache globalThis) di-hydrate di root
  layout; `midtrans.ts`/`whatsapp.ts` membaca lewat `getSetting` sehingga
  perubahan berlaku untuk request berikutnya. Mode demo (tanpa Supabase):
  tersimpan di memori seumur proses.
- Tombol **Uji Koneksi** per kategori memanggil sistem luar yang sebenarnya
  dan menampilkan hasil (hijau/merah + detail).

### 💳 Dashboard admin — Riwayat Pembayaran

Seksi **Riwayat Pembayaran** di `/admin` (`getAdminPaymentSummary` di
`service.ts`, `force-dynamic`):

- **Filter rentang waktu lewat `?range=`** (tab server component, tanpa
  state client): **Hari Ini** (`today` — sejak awal hari zona server) /
  **7 Hari** (`7d`) / **30 Hari** (`30d`); nilai tak dikenal jatuh ke
  `today`. Rentang dihitung `paymentRangeStart` (`service.ts`, diuji unit).
- **Ringkasan per status dalam rentang terpilih** (zona server): kartu
  Berhasil / Gagal / Kadaluarsa / Menunggu + pendapatan rentang (hanya
  order `paid`); header menampilkan "Transaksi hari ini / 7 hari terakhir /
  30 hari terakhir (N) · pendapatan X".
- **Tabel N order terbaru DALAM rentang yang sama** (komponen client
  `src/components/admin/AdminPaymentHistory.tsx`): nomor order, pelanggan,
  tipe, total, badge status **dengan alasan gagal spesifik** (mis. "Ditolak
  bank"), waktu, dan tombol **Retry** per baris untuk order gagal/kadaluarsa
  — memakai endpoint admin yang sama dengan halaman Order Kadaluarsa
  (order lunas ditolak dengan alasan). Setelah retry, nomor order baru
  ditampilkan di baris dan halaman di-refresh.
- **Panel detail per order (klik baris)** — baris yang punya rincian bisa
  diklik dan membuka panel di bawahnya dengan tiga seksi: **Item Pesanan**
  (nama × qty, subtotal, total), **Riwayat Status Pembayaran** (kronologi
  `paymentAudit` via `buildAuditTimeline` — label, sumber, status_code /
  status_message mentah, nomor order saat kejadian, entri terakhir ditandai
  "saat ini"), dan **Callback Snap** (event + hasil transaksi). Data dibawa
  server di `AdminPaymentRow` (`mapPaymentRow` mengikutsertakan
  `items`/`paymentAudit`/`snapCallbacks` dari order penuh) — tanpa request
  tambahan; kolom Aksi tidak memicu toggle.
- **Unduh CSV ikut rentang**: tombol "⬇️ Unduh CSV" menautkan ke
  `/api/admin/riwayat-csv?range=…` — ekspor dibatasi ke order yang dibuat
  dalam rentang terpilih (tanpa `range` → semua order).

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
npm test            # unit test vitest — termasuk regresi persistChain & e2e-retry
npm run test:coverage       # unit test + laporan coverage v8 (GATE ambang ≥ 80%)
npm run test:persist-chain  # khusus koalesensi write-through (mock PostgREST HTTP)
npm run test:e2e-retry      # khusus e2e retry pembayaran vs simulator Midtrans
npm run test:e2e-sim        # khusus e2e sukses QRIS & gagal GoPay vs simulator Midtrans
npm run build       # production build
```

> **CI-friendly (terverifikasi dari state bersih):** `npm run build`,
> `npm test` (585 test), dan `npm run typecheck` semuanya lolos **tanpa
> `.env.local`** — saat env tidak tersedia aplikasi otomatis masuk mode demo
> (data `data/db.json`, pembayaran disimulasikan), sehingga CI tidak perlu
> menyediakan env untuk build/test. Env rahasia hanya wajib saat menjalankan
> e2e Supabase/Midtrans (`npm run db:*`) atau produksi.

### Coverage & gate CI (vitest v8, ambang ≥ 80%)

Konfigurasi di `vitest.config.mts`: provider `v8`, coverage dihitung hanya
untuk modul bisnis `src/lib/**` (test & scripts di-exclude dari perhitungan;
`scripts/*.test.ts` tetap ikut dijalankan `npm test` tapi tidak dihitung).
Empat metrik di-gate pada ambang **80%** — `npm run test:coverage` keluar
non-nol (CI merah) bila salah satu di bawah ambang:

| Metrik | Ambang | Saat ini |
|---|---|---|
| Statements | 80% | 90.48% |
| Branches   | 80% | 83.77% |
| Functions  | 80% | 86.72% |
| Lines      | 80% | 92.26% |

CI (`.github/workflows/ci.yml`): install → `npm run typecheck` →
`npm run test:coverage`. Karena gate ada di vitest, CI cukup menjalankan
perintah yang sama dengan lokal — tidak ada duplikasi logika ambang.
Selain job `test`, ada job **`persist-chain`** terpisah (berjalan paralel,
timeout 10 mnt): `npm run test:persist-chain` — regresi write-through
koalesen terdeteksi lebih cepat sebelum merge, dengan laporan `[ukur]`
(batas atas request per N mutasi) terlihat langsung di log job.

### E2E Supabase lokal di CI (`.github/workflows/supabase-e2e.yml`)

Workflow kedua menjalankan **Supabase lokal langsung di runner** (GitHub-
hosted runner sudah punya Docker) — terpisah dari ci.yml agar uji keamanan
end-to-end tidak memperlambat loop typecheck/coverage:

- **Job `supabase-e2e`** — `supabase/setup-cli@v1` (CLI ter-pin via PATH,
  dipakai juga oleh `npx supabase` di scripts) → `supabase start`
  (mengaplikasikan `supabase/migrations/` + `supabase/seed.sql`) →
  `npm run db:setup -- --skip-start` (baca `supabase status -o env` → tulis
  `.env.local` merge → seed akun auth demo) → `npm run db:rls` (62 cek:
  RLS 12 tabel + Storage + Auth phone).
- **Job `auth-e2e`** — `node scripts/e2e-auth.mjs` (self-contained: mock
  Supabase + Next.js dev; tanpa Docker) — berjalan paralel.

Sama seperti ci.yml: trigger push ke `main` & pull request, timeout 30 mnt
(job Docker; pull image pertama kali lambat) dan 20 mnt (auth).

### Regresi persistChain (scripts/persist-chain.test.ts)

Test permanen untuk **write-through koalesen** (`persistChain` di `db.ts`),
dijalankan otomatis oleh `npm test` (vitest include default mencakup
`scripts/*.test.ts`). Beda dari `src/lib/db.test.ts` (yang men-stub
`./supabase/server` dengan client in-memory): file ini menyalakan **mock
PostgREST HTTP sungguhan** (`node:http` di `127.0.0.1:0`), mengarahkan env
`NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` ke mock, lalu
mengimpor `db.ts` **asli** — yang diuji adalah perilaku HTTP nyata
supabase-js + antrean tulis:

- 3 mutasi `orders` berurutan dalam satu tick → **1 POST** dengan snapshot
  **terbaru** (koalesensi per koleksi, tulis lama dilewati);
- mutasi lintas koleksi → satu flush menulis semua tabel yang berubah,
  masing-masing sekali;
- batch antar flush tetap **berurutan** (flush A selesai → baru B);
- **lintas-flush tumpang-tindih**: tulis in-flight (respons mock ditahan via
  `postDelayMs`) saat mutasi baru masuk → batch B diantrekan **setelah**
  flush A (tidak digabung ke batch yang sedang berjalan), snapshot terbaru
  menang di dalam batch B, dan tidak ada tulis yang hilang — baik pada
  koleksi yang sama maupun lintas koleksi (orders + profiles tetap urut);
- round-trip: data yang ditulis ke mock bisa di-hydrate kembali;
- mutasi no-op tidak memicu request POST;
- `flushNow(maxWaitMs)` — flush paksa dengan **batas waktu**: batch pending
  di-flush segera, tapi tidak pernah menggantung melebihi `maxWait` (resolusi
  dengan peringatan bila mock lambat);
- `registerShutdownFlush()` — **drain terakhir saat SIGTERM/SIGINT**: snapshot
  terbaru yang masih mengantre ikut ter-flush SEBELUM proses keluar (ditest
  dengan emit SIGTERM asli + stub `process.exit`), guard `globalThis`
  mencegah pendaftaran ganda.
- **pengukuran jumlah request (batas atas regresi)** — describe tersendiri yang
  melaporkan total POST per koleksi lewat log `[ukur]` dan menegakkannya
  sebagai asersi: N=25 mutasi dalam satu tick → **tepat 1 POST** (rasio 25:1);
  N=24 mutasi tersebar T=4 tick → **≤ T POST** (batas atas = jumlah tick,
  bukan N) dengan batch terakhir memuat seluruh order (0 hilang); lintas 3
  koleksi × 10 mutasi satu tick → **≤ 3 POST** (1 per koleksi, masing-masing
  10 baris). Catatan: karena writer mengirim **snapshot koleksi penuh** per
  flush (upsert idempotent), total baris terkirim bersifat kumulatif
  (M × 1+2+…+T) — yang di-assert adalah jumlah *request*, bukan baris.

Tanpa Docker/Supabase — mock murni in-process, cocok untuk CI.

### Round-trip kolom nullable (db.test.ts)

Regresi khusus **simetri NULL ⇄ undefined** pada kolom nullable yang rawan
berubah bila skema dimigrasi (mis. migration 0002 menambah kolom nullable di
`sessions`): `paidAt` & `shippingAddress` (orders), `promoId` (vouchers),
`usedAt` (claimed_vouchers), dan `sb_refresh_enc`/`sb_user_id` (sessions):

- **NULL di DB → undefined di entity** → `persist()` menulis **null** (bukan
  `undefined` di row JSON) → re-hydrate tetap `undefined` (simetri kosong);
- **nilai terisi → round-trip penuh**: deep-equality state sebelum/sesudah
  re-hydrate (urutan key antar pemetaan sengaja tidak dibandingkan — yang
  disimulasikan adalah nilai).

### Fallback ke MODE DEMO saat Supabase gagal (db.test.ts)

Mock PostgREST di `db.test.ts` diperluas dengan **mode kegagalan hydration**
(`failHydration("error")` = select mengembalikan error PostgREST/HTTP 500;
`failHydration("timeout")` = promise select menolak — simulasi timeout
jaringan). Test memverifikasi `initDB` jatuh ke MODE DEMO dengan benar:

- **error (500)** → `getStoreMode() === "json"`, data demo ter-seed, satu
  peringatan `[db] Supabase tidak tersedia (…: relation does not exist (HTTP
  500)). Fallback ke MODE DEMO (JSON).` — pesan error PostgREST ikut; mode
  demo tetap berfungsi (mutate → `flushNow` → file `db.json` di temp
  `VSHOP_DATA_DIR` tertulis);
- **timeout (reject)** → fallback sama dengan pesan `request timed out`;
- **memoized** — `ensureHydrated` kedua tidak mencoba Supabase lagi walau
  mock sudah dipulihkan (hydration di-cache di globalThis, tidak ada retry).

### E2E vs simulator Midtrans (scripts/) — retry, sukses QRIS, gagal GoPay

`scripts/midtrans-simulator.ts` adalah **fixture permanen**: server HTTP yang
meng-emulasi endpoint Midtrans yang dipakai adapter (`POST /transactions`
atau `/snap/v1/transactions` → `{ token, redirect_url }`; `GET /:id/status`
atau `/v2/:id/status` → Status API) dengan perilaku sandbox penting:

- **TOLAK DUPLIKAT** — membuat transaksi dengan `order_id` yang sudah pernah
  dipakai (transaksi aktif atau `markUsed`) → **406** `"Nomor order sudah
  pernah dipakai"` (kode `406` di `MIDTRANS_FAILURE_CODES`);
- **STATUS** — transaksi dibuat `pending` (201); test mengubahnya ke terminal
  via `settle()` (settlement/200), `fail()` (deny/202, kode kustom mis. 216),
  `expire()` (expire/203); Status API memantulkan keadaan → diverifikasi
  `isMidtransPaid` / `midtransFailureReason` / `midtransTerminalFailure`.
  Auth Basic diverifikasi bila `serverKey` diberikan (401 bila beda).
- **SETTLEMENT QRIS** (`settleQris`) — alur SUKSES: settlement/200 +
  `payment_type: "qris"` (+ detail channel opsional);
- **DENY GOPAY** (`denyGopay`) — alur GAGAL e-wallet: deny/202 +
  `payment_type: "gopay"` + `channel_response_code`/message (default `201`
  "Saldo tidak mencukupi") — Status API membawa field channel sehingga
  `midtransFailureReason` memilih alasan SPESIFIK kanal (tabel "Saldo
  GoPay tidak mencukupi" + pesan mentah), bukan 202 umum.

`scripts/e2e-retry.test.ts` (otomatis di `npm test`; khusus
`npm run test:e2e-retry`) menjalankan modul ASLI (`midtrans.ts`, `service.ts`,
`db.ts` mode demo JSON di temp) dengan `MIDTRANS_SERVER_KEY` tiruan +
`MIDTRANS_API_BASE` → simulator, lalu menguji alur "Coba Lagi" penuh:

1. `createOrder` → transaksi dibuat di simulator (pending/201);
2. pelanggan gagal bayar → `fail()` deny/202 → Status API + adapter memetakan
   alasan spesifik "Pembayaran ditolak oleh bank";
3. order_id lama **tidak bisa dipakai ulang** → simulator menolak 406 —
   itulah alasan `retryOrderPayment` selalu memakai nomor order baru;
4. `retryOrderPayment` → nomor BARU diterima simulator; riwayat nomor di
   metadata (`previousOrderNumbers`), alasan gagal dibersihkan;
5. bayar sukses transaksi baru → `settle()` → order lunas + audit
   `failed → retry → paid`.

`scripts/e2e-sim-flows.test.ts` (otomatis di `npm test`; khusus
`npm run test:e2e-sim`) membuktikan **alur sukses & gagal end-to-end** lewat
modul asli yang sama:

- **Sukses QRIS** — `createOrder` → `settleQris()` → Status API
  settlement/200 + `payment_type: "qris"` → `isMidtransPaid` true →
  `markOrderPaid` → order `paid`, metode `QRIS`, `paidAt` terisi, tanpa
  alasan gagal (dan tetap settlement pada pembacaan berikutnya).
- **Gagal GoPay** — `denyGopay()` → deny/202 + `payment_type: "gopay"` +
  `channel_response_code: "201"` → `midtransTerminalFailure` `failed` →
  `midtransFailureReason` memilih alasan spesifik kanal (bukan 202 umum) →
  `markOrderFailed` → order `failed` dengan `metadata.failureReason` presisi
  ("Saldo GoPay tidak mencukupi — Saldo tidak mencukupi"). Kode kanal lain
  (mis. `1604` OTP salah) juga terpetakan; `channelResponseMessage: ""`
  memakai alasan tabel saja.

### 📊 Pengukuran tulis ke Supabase (sebelum/sesudah koalesensi)

`scripts/measure-writes.test.ts` mengukur **jumlah tulis nyata** ke Supabase
pada **8 alur** yang memuat banyak `mutate()` berurutan — klaim voucher,
redeem voucher (getken), daftar akun (pelanggan & merchant), checkout (buat
order), dan bayar sukses (paket / topup / merchandise). Pengukuran dilakukan
di level HTTP (mock PostgREST sungguhan menghitung request POST per tabel,
bukan estimasi), menjalankan fungsi service ASLI dalam dua mode:

- **SESUDAH koalesensi** (default): `mutate()` berurutan dalam satu tick
digabung jadi satu flush; tiap koleksi hanya ditulis sekali dengan snapshot
terbaru.
- **SEBELUM (per-mutate)**: `DB_COALESCE=0` — tiap `mutate()` me-flush
koleksi dirty-nya sendiri (batch dikunci), tulis lama tidak di-dedupe.

Hasil terukur (mock PostgREST HTTP):

| Alur | mutate | SESUDAH koalesensi | SEBELUM (per-mutate) |
|---|---|---|---|
| Klaim voucher | 1 (1 tick) | `claimed_vouchers×1` = **1 tulis** | `claimed_vouchers×1` = **1 tulis** |
| Redeem voucher (getken) | 1 (1 tick) | `claimed_vouchers×1` = **1 tulis** | `claimed_vouchers×1` = **1 tulis** |
| Daftar akun pelanggan | 1 (1 tick) | `profiles×1` = **1 tulis** | `profiles×1` = **1 tulis** |
| Daftar akun merchant | 1 (1 tick, 2 koleksi) | `profiles×1 + merchants×1` = **2 tulis** | `profiles×1 + merchants×1` = **2 tulis** |
| Checkout (buat order) | 1 (order + snapToken dalam satu mutate) | `orders×1` = **1 tulis** | `orders×1` = **1 tulis** |
| Bayar sukses (paket) | 2 (1 tick) | `orders×1 + memberships×1` = **2 tulis** | `orders×2 + memberships×1` = **3 tulis** |
| Top up (buat + bayar) | 3 (2 tick: createOrder, lalu paid+audit) | `orders×2 + wallets×1` = **3 tulis** | `orders×3 + wallets×1` = **4 tulis** |
| Merchandise (buat + bayar) | 3 (2 tick: createOrder, lalu paid+audit) | `orders×2 + merchandise×1 + carts×1` = **4 tulis** | `orders×3 + merchandise×1 + carts×1` = **5 tulis** |
| **Total 8 alur** | — | **17 tulis** | **20 tulis** |

Sebagai pembanding, perilaku **asli sebelum write-through** (tiap `mutate()`
menulis SELURUH 12 koleksi): untuk 3 alur dasar (klaim, checkout, bayar
paket) = 12 + 24 + 24 = 60 tulis; setelah write-through per koleksi = 5;
setelah koalesensi = **4**.

**Temuan**: (1) penghematan terbesar datang dari *write-through per koleksi*
(bukan koalesensi); (2) koalesensi hanya berperan saat beberapa `mutate()`
terjadi **dalam satu tick** — pola `markOrderPaid` (status + efek, lalu
audit) menurunkan tulis saat digabung: paket 3 → 2, topup 4 → 3,
merchandise 5 → 4; (3) `createOrder` kini **satu `mutate()`**: id & nomor
order dihitung dulu, transaksi Midtrans `await`-ed, lalu order + snapToken
ditulis bersama — checkout **1 tulis** di kedua mode (token tidak lagi
ditulis di mutate kedua). Jalur tabrakan nomor (konkurensi langka) tetap
aman: nomor divalidasi ulang ATOMIK di dalam mutate, transaksi dibuat ulang
dengan nomor final (2 tulis hanya pada kasus itu) — lihat
`create-order-collision.test.ts`; (4) alur 1-mutate (klaim, redeem, daftar
akun) sudah minimal — 1 tulis di kedua mode.

```bash
npm run test:measure-writes   # cetak tabel + 8 asersi kunci (otomatis di npm test)
```

### 📦 Pengukuran I/O debounce JSON (mode demo) — sebelum/sesudah

`scripts/measure-json-writes.test.ts` mengukur **penghematan I/O debounce
secara empiris** di mode demo: counter `getJsonWriteCount()` (tulis file
`data/db.json` seumur proses) menghitung tulis NYATA per alur, dijalankan
lewat fungsi service ASLI dalam dua mode — default (debounce: beberapa
`mutate()` dalam satu tick → maksimal 1 tulis) vs `JSON_DEBOUNCE=0` (tiap
`mutate()` menulis langsung). Hasil terukur (temp dir, tidak menyentuh
`data/` proyek):

| Alur | mutate | SESUDAH debounce | SEBELUM (per-mutate) |
|---|---|---|---|
| Klaim voucher | 1 (1 tick) | **1 tulis** | **1 tulis** |
| Checkout (buat order) | 1 (1 tick) | **1 tulis** | **1 tulis** |
| Bayar sukses (paket) | 2 (1 tick) | **1 tulis** | **2 tulis** |
| **Total (4 mutate)** | — | **3 tulis** | **4 tulis** |

**Temuan**: debounce menggabung `mutate()` yang terjadi **dalam satu tick**
— pola `markOrderPaid` (status + efek, lalu audit) turun 2 → 1 tulis.
Alur 1-mutate (klaim, checkout) sudah minimal di kedua mode. Penghematan
I/O paling terlihat pada alur yang memuat banyak `mutate()` beruntun (bayar
sukses, retry, webhook): N mutate satu tick → 1 tulis file. Kebalikan dari
koalesensi Supabase (yang menyimpan ke Postgres), di sini yang dihemat
adalah **tulis disk** (`fs.writeFileSync` full snapshot + rename atomik).

```bash
npm run test:measure-json-writes   # cetak tabel + asersi kunci (otomatis di npm test)
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

- `docs/DEPLOY-VERCEL.md` — deploy ke **Vercel + Supabase cloud** (env vars wajib, cron, troubleshooting)
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
