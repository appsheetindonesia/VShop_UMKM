# CONTEXT — V Shop (Voucher UMKM)

File ini dipakai oleh review arsitektur (dan siapa pun yang menjelajah kode)
sebagai **glossary domain** dan **catatan keputusan arsitektur yang sudah
dimuat**. Bagian "Keputusan arsitektur" berisi keputusan yang **load-bearing**:
jangan disarankan ulang / jangan dibatalkan tanpa alasan baru yang kuat.
Bila sebuah ide bertentangan dengan keputusan di bawah, catat konfliknya
dengan jelas alih-alih diam-diam membaliknya.

---

## Glossary domain

- **Voucher** — diskon/cashback/gratis-ongkir milik merchant; bisa diklaim
  pengguna (`claimed_vouchers`) menjadi voucher terklaim dengan `kode` dan
  `kode_konfirmasi` unik.
- **Promo** — kampanye voucher milik merchant (payung dari beberapa voucher).
- **Merchant** — UMKM; profil usaha publik (nama usaha, kategori, WA, foto).
- **Paket langganan** — paket 7/14/30 hari (`packages`); pembeliannya membuat
  **keanggotaan** (`memberships`).
- **Order** — transaksi paket/topup/merchandise; `payment_status` berjalan
  pending → paid/failed/expired; dibayar via Midtrans.
- **Dompet** — saldo pengguna (`wallets`, PK = `user_id`).
- **Keranjang** — `carts` (PK = `user_id`).
- **Sesi aplikasi** — `sessions` (PK = `token`); menyimpan refresh token
  Supabase **terenkripsi** (`sb_refresh_enc`, `sb_user_id`) untuk pemulihan
  lintas perangkat. Bukan sesi Auth Supabase itu sendiri.
- **Profil** — perluasan `auth.users` (`profiles`, PK = `id`); `role`:
  customer / merchant / admin. Login utama berbasis **nomor WhatsApp** (E.164).

---

## Keputusan arsitektur — Supabase lokal (jangan disarankan ulang)

### 1. Mode data ganda: Supabase saat env terisi, JSON demo sebagai fallback
`src/lib/db.ts` memilih mode saat boot: **supabase** bila
`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` ada, selain itu
**demo** (file JSON lokal). Antarmuka `src/lib/service.ts` TIDAK berubah
antara kedua mode — ini seam yang disengaja. Semua operasi DATA aplikasi
(PostgREST CRUD) memakai service-role key (`getSupabaseAdmin`), bukan anon
key. Pengecualian hanya untuk Auth API: `session-renew.ts` memakai
`getSupabaseAnon()` untuk `auth.refreshSession()` (refresh token wajib
lewat anon key, bukan service_role) — bukan operasi data.

### 2. Supabase lokal WAJIB Docker Desktop; reboot pertama di Windows
Stack lokal dijalankan `supabase start` (CLI memanggil binary `docker` yang
tidak ada di PATH Windows — `scripts/setup-local.mjs` menambahkannya).
**Di Windows, pertama kali (atau setelah restart OS) biasanya perlu
`wsl --shutdown` + restart Docker Desktop** karena bug bind-mount WSL2 di
drive non-C (mis. `D:`). Edge runtime (`supabase/config.toml`) **dinonaktifkan**
karena bug bind-mount yang sama — aplikasi tidak memakai Edge Functions.
Ini masalah lingkungan, bukan desain aplikasi; jangan "perbaiki" dengan
menyalakan edge_runtime.

### 3. Setup satu perintah: `npm run db:setup` (`scripts/setup-local.mjs`)
Cek Docker → `supabase start` (pull image + seluruh migration 0001–0008 +
seed.sql) → baca kredensial `supabase status -o env` → tulis `.env.local`
(**merge**, tidak menimpa kunci Midtrans/WhatsApp; `SESSION_ENCRYPTION_KEY`
digenerate) → seed demo (idempotent: delete-then-insert). Jangan mengganti
alur ini dengan instruksi manual berantai.

### 4. Persistensi db.ts: write-through per koleksi (dirty tracking) + koalesensi
(ADR-0002 — konteks & alternatif ditolak di `docs/adr/`.)
Bukan tulis seluruh koleksi per mutasi, bukan juga tulis-per-baris.
`mutate()` membandingkan snapshot JSON per koleksi (`captureCollections`),
mengantre hanya koleksi yang **berubah** (`writeDirty`), lalu
`enqueueWrite` **menggabungkan batch** lewat `persistChain`: koleksi yang
sama menunggu hanya ditulis sekali dengan snapshot **terbaru** (upsert
idempotent per PK). Urutan antar batch tetap terjaga (rantai promise).
Unit test `src/lib/db.test.ts` menutup dirty tracking + mapping
koleksi↔tabel (round-trip hydrate→mutate→hydrate).

### 5. Login utama = nomor WhatsApp via Supabase Auth phone (bukan email sintetis)
Daftar/masuk via OTP (`sendOTP`/`verifyOTP`) dengan **fallback password**
(phone + password). Nomor dinormalisasi ke E.164. Untuk uji lokal:
`[auth.sms.test_otp]` di `config.toml` memetakan nomor demo → kode tetap,
namun **provider SMS placeholder WAJIB diaktifkan** (GoTrue mengecek
provider SEBELUM test_otp; tanpa provider, phone login mati total).

### 6. Refresh token Supabase terenkripsi di tabel `sessions` + renewal di middleware
Refresh token Supabase disimpan terenkripsi (`SESSION_ENCRYPTION_KEY`) di
`sessions.sb_refresh_enc` (migration 0002) agar sesi bisa dipulihkan lintas
perangkat, bukan hanya di cookie. **Renewal sesi terjadi di middleware
Next.js (server-side, sebelum render)** — bukan di client bootstrap —
dan root layout menyinkronkan sesi baru ke cache via **header respons
`x-vshop-new-session`** (mutasi cookie request tidak andal antar-pass
render di dev). Token refresh di-rotasi setiap renew tetapi bertahan untuk
renew berikutnya.

### 7. RLS = pertahanan berlapis + grants eksplisit (migration 0003)
(ADR-0001 — termasuk mengapa TIDAK dimatikan walau runtime memakai
service_role, dan catatan `orders_insert_own` bahwa policy bukan pengganti
validasi aplikasi.)
Aplikasi memakai service_role (bypass RLS); RLS tetap diaktifkan di semua
tabel untuk akses langsung (anon key / SQL editor). **CLI supabase 2.114+
lokal menerapkan least-privilege** (tabel migration tidak mendapat hak DML
apa pun) sehingga `0003_grants.sql` wajib ada (grant eksplisit ala
produksi). Kolom sensitif `sessions.sb_refresh_enc`/`sb_user_id` **hanya
service_role** — dicapai dengan grant **per-kolom** (REVOKE kolom adalah
no-op di PostgreSQL 17 bila grant datang dari table-level; grant per-kolom
hanya berfungsi setelah table-level grant dilepas). Verifikasi: `npm run
db:rls` (`scripts/e2e-rls.mjs`, **62 cek**: RLS 12 tabel
anon/authenticated/service × publik vs pemilik + Storage `vshop-assets` per
role + Auth phone OTP/password).

### 8. postgrest-js v2: alias query memakai `Alias:column`, BUKAN `col as "alias"`
postgrest-js v2 menormalkan string select dan **membuang spasi**, sehingga
`col as "alias"` dikirim sebagai `colas"alias"` yang **ditolak PostgREST
asli** (aplikasi diam-diam jatuh ke mode demo!). Sintaks `Alias:column`
dipertahankan apa adanya dan valid di PostgREST. Berlaku untuk SEMUA query
via supabase-js (termasuk mock di `db.test.ts` dan `e2e-auth.mjs` yang
parser-nya whitespace-agnostic seperti PostgREST asli).

### 9. State cache db.ts dibagikan via `globalThis`
Next.js dev membuat **satu instance modul per bundle**, sehingga tanpa
penyatuan, route handler dan halaman punya cache terpisah (halaman bisa
jatuh ke mode demo dan tak melihat sesi yang dibuat route). State
`cache` + `storeMode` + `hydrationPromise` disimpan di holder
`globalThis` (pola yang sama seperti store OTP & guard cron). Konsekuensi
uji: `freshDb()` di `db.test.ts` harus menghapus holder `globalThis` agar
modul yang di-import ulang benar-benar fresh.

### 10. Log notifikasi = tabel append-only `notification_logs` (migration 0005)
Setiap percobaan kirim WhatsApp dicatat ke `notification_logs` via
service-role (`src/lib/notif-log.ts`, fire-and-forget, tidak pernah
melempar). Tabel di-grant untuk anon/authenticated (default privileges
0003) tetapi RLS aktif **tanpa policy** → akses hanya service_role.
Log **tidak** ikut cache/write-through `db.ts` (telemetri murni, dibaca
langsung dari Postgres di `/admin/notifikasi`); mode demo memakai array
in-memory. Jangan diubah menjadi readable anon/authenticated tanpa alasan
kuat, dan jangan pindahkan ke write-through `db.ts` (menambah beban cache
untuk data yang tidak dipakai alur bisnis).

### 11. Pengiriman WhatsApp = antrian in-memory + retry backoff (di whatsapp.ts)
(ADR-0003 — risiko "tidak durable" diterima untuk MVP, migrasi ke job
broker ditunda bukan ditolak.)
Semua kiriman lewat antrian latar belakang di `globalThis.__vshopWaQueue`
(pola yang sama dengan cache db.ts — instance modul per bundle di Next.js
dev), konkurrensi terbatas (`WA_QUEUE_CONCURRENCY`, default 3), retry
otomatis utk kegagalan sementara (network/5xx/429/no message id) dengan
exponential backoff + jitter (`WA_RETRY_BASE_MS`/`WA_RETRY_MAX_ATTEMPTS`).
Request pembayaran TIDAK menunggu kiriman (`enqueueLogged` fire-and-forget);
cron expiry tetap `await` hasil job agar dedupe `expiring_notified_at` akurat.
Konsekuensi: antrian tidak durable — pada serverless yang membekukan proses
setelah response, kiriman mengantre bisa hilang (dokumentasi di README;
sebaiknya pindah ke job broker bila deployment murni serverless). Jangan
ganti dengan kirim sinkron langsung di jalur pembayaran (membebani request)
maupun pindahkan antrian ke write-through `db.ts` (bukan data domain).

### 12. Pengaturan koneksi (Configurasi) = tabel app_settings terenkripsi + env fallback
Menu admin `/admin/configurasi` mengelola koneksi data keluar (PostgreSQL/
Supabase, Midtrans, WhatsApp, AI, lainnya) lewat `src/lib/settings.ts`:
registry `SETTING_DEFS` (key → kategori → env fallback), cache globalThis
(pola db.ts), di-hydrate di root layout. Nilai tersimpan di `app_settings`
(migration 0009) MENANG atas env var; runtime (midtrans.ts/whatsapp.ts)
membaca via `getSetting` sehingga perubahan berlaku tanpa restart. Rahasia
dienkripsi AES-256-GCM (`value_enc`, kunci `SESSION_ENCRYPTION_KEY` yang
sama dengan refresh token) dan TIDAK pernah dikirim utuh ke browser (mask
`••••abcd`); tabel RLS tanpa policy + revoke anon/authenticated (hanya
service_role); halaman & API dibatasi admin. Jangan pindahkan ke env-only
(kehilangan edit runtime) maupun kirim nilai rahasia utuh ke client.

---

## Keputusan arsitektur — Pembayaran Midtrans (jangan disarankan ulang)

### 1. Pembayaran memakai Snap **embed** (inline), bukan popup / VT-web redirect
Halaman `/bayar/[orderId]` merender form pembayaran **inline** di halaman
(`window.snap.embed(snapToken, …)` ke `#snap-container` di `PayForm.tsx`)
saat `MIDTRANS_CLIENT_KEY` tersedia — bukan popup Snap maupun redirect ke
halaman VT-web. Alasan: embed menjaga konteks aplikasi (ringkasan order
tetap terlihat), menghindari tab baru yang membingungkan, dan membuat
handler `onSuccess`/`onPending`/`onError`/`onClose` menangkap hasil langsung
di halaman. Sukses selalu diverifikasi ulang via Midtrans **Status API**
sebelum redirect ke halaman sukses; `onError` (dengan `status_code` asli)
mengarahkan ke layar Pembayaran Gagal. Tanpa `MIDTRANS_CLIENT_KEY` (atau
Snap.js gagal dimuat) fallback otomatis ke halaman VT-web (`redirectUrl`).
`snap.embed` dipanggil sekali per order (guard anti-StrictMode). Jangan
ganti ke popup/redirect sebagai mode utama — embed adalah keputusan UX yang
disengaja.

### 2. Callback Snap & audit status pembayaran disimpan di `metadata` order (bukan tabel terpisah)
Semua jejak pembayaran disimpan sebagai JSONB di kolom `metadata` order,
bukan tabel relasional terpisah: `snapCallbacks` (callback
`success`/`pending`/`error`/`close` + hasil transaksi dari Snap.js, maks 20
entri terakhir, ditulis fire-and-forget via
`POST /api/pay/[orderId]/snap-callback` yang hanya menerima pemilik order)
dan `paymentAudit` (kronologi `status_code`/`status_message`/
`transaction_status`/`payment_type`/`transaction_id` dari webhook, Status
API, dan alur retry; maks 50, terbaru di akhir — sumber timeline di
`/transaksi/[orderId]` dan badge di riwayat pembayaran). Alasan gagal
spesifik (`midtransFailureReason` → Bahasa Indonesia) disimpan di
`metadata.failureReason`; riwayat penggantian nomor order
(`originalOrderNumber`/`previousOrderNumbers`) juga di metadata DAN
**di-cerminkan ke kolom PostgreSQL** (migration 0002) agar telusur lintas
sumber. Metadata mengikuti write-through `db.ts` sehingga audit ikut
ter-cache/ter-persist seperti data domain. Jangan pindahkan ke tabel
tersendiri tanpa alasan kuat — data ini hanya dibaca per-order, dan
write-through menangani konsistensinya.

### 3. Auto-expire 24 jam: satu sumber kebenaran `ORDER_EXPIRY_HOURS`
Order `pending` lebih dari `ORDER_EXPIRY_HOURS` jam (default **24**)
otomatis di-expire oleh job terjadwal (`runExpiryJob` di `src/lib/cron.ts`)
— dan NILAI YANG SAMA dikirim ke Midtrans saat membuat transaksi
(`expiry: { unit: "hours", duration: ORDER_EXPIRY_HOURS }` di
`src/lib/midtrans.ts`, dibaca saat module load). Jadi batas waktu aplikasi
dan kadaluarsa transaksi Midtrans SELALU konsisten — bukan dua konstanta
terpisah yang bisa melenceng. Cron lokal memakai `setTimeout` bertingkat +
jitter ±20% (lihat Referensi); **run terakhir & jumlah expire per run
dicatat di tabel `cron_runs`** (append-only via `recordCronRun`, dibaca
`getLastCronRun("expire")` di `/admin/kadaluarsa`) — bukan field JSON di
metadata; order yang ter-expire bisa di-retry ulang
dengan **nomor order baru** (menghindari penolakan `order_id` duplikat
Midtrans). Diverifikasi cepat dengan `ORDER_EXPIRY_HOURS` kecil (mis. 0.01
jam = 36 detik). Jangan ubah batas hanya di satu sisi (aplikasi ATAU
Midtrans) tanpa mengubah sisi lain.

---

## Referensi

- ADR (konteks lengkap + alternatif ditolak + konsekuensi): `docs/adr/`
  (`0001` RLS berlapis vs service_role, `0002` write-through per koleksi,
  `0003` antrian WhatsApp in-memory).
- Detail operasional & gotcha Windows/Docker: `README.md` (seksi "Mode
  Supabase", "Uji E2E", "db:rls").
- Skema + policy RLS + Storage: `supabase/migrations/0001_init.sql`,
  `0002_sessions_refresh.sql`, `0003_grants.sql`,
  `0004_claims_expiry_notify.sql`, `0005_notification_logs.sql`,
  `0006_claims_expiry_24h_notify.sql`, `0007_cron_runs.sql`,
  `0008_orders_insert_own.sql` (policy INSERT orders pemilik),
  `0009_app_settings.sql` (pengaturan koneksi — rahasia terenkripsi),
  `0010_payment_status_cancelled.sql` (CHECK payment_status + 'cancelled').
- Riwayat run job cron ada di tabel `cron_runs` (append-only, service-role,
  pola sama dengan `notification_logs`) — jangan disimpan sebagai field
  JSON di cache db.ts (telemetri, bukan data domain; cache bisa basi/restart
  dan tidak punya riwayat per periode).
- Scheduler lokal memakai `setTimeout` bertingkat dengan JITTER ±20% per
  tick + backoff cepat saat run gagal beruntun (`jitterInterval` /
  `failureBackoffDelay` di cron.ts) — sengaja, jangan diganti ke
  `setInterval` tetap (thundering herd antar-job/instance).
- Notifikasi voucher punya DUA tier cron independen (48 jam & H-1/24 jam)
  dengan dedupe terpisah (`expiring_notified_at` vs `expiring_24h_notified_at`)
  — jangan digabung jadi satu kolom/indow, dan jangan pindahkan ke
  write-through db.ts.
- Script: `scripts/setup-local.mjs`, `scripts/seed-supabase.mjs`,
  `scripts/e2e-rls.mjs`, `scripts/e2e-auth.mjs`.
- Uji pembayaran: `scripts/midtrans-simulator.ts` (fixture HTTP yang
  meng-emulasi Snap/Status API Midtrans: tolak duplikat, settle/fail/expire)
  + `scripts/e2e-retry.test.ts` (alur Coba Lagi dengan nomor order baru,
  dijalankan `npm run test:e2e-retry`).
