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
antara kedua mode — ini seam yang disengaja. Semua operasi data aplikasi
memakai service-role key (`getSupabaseAdmin`), bukan anon key.

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
Cek Docker → `supabase start` (pull image + migration 0001/0002/0003 +
seed.sql) → baca kredensial `supabase status -o env` → tulis `.env.local`
(**merge**, tidak menimpa kunci Midtrans/WhatsApp; `SESSION_ENCRYPTION_KEY`
digenerate) → seed demo (idempotent: delete-then-insert). Jangan mengganti
alur ini dengan instruksi manual berantai.

### 4. Persistensi db.ts: write-through per koleksi (dirty tracking) + koalesensi
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
Aplikasi memakai service_role (bypass RLS); RLS tetap diaktifkan di semua
tabel untuk akses langsung (anon key / SQL editor). **CLI supabase 2.114+
lokal menerapkan least-privilege** (tabel migration tidak mendapat hak DML
apa pun) sehingga `0003_grants.sql` wajib ada (grant eksplisit ala
produksi). Kolom sensitif `sessions.sb_refresh_enc`/`sb_user_id` **hanya
service_role** — dicapai dengan grant **per-kolom** (REVOKE kolom adalah
no-op di PostgreSQL 17 bila grant datang dari table-level; grant per-kolom
hanya berfungsi setelah table-level grant dilepas). Verifikasi: `npm run
db:rls` (`scripts/e2e-rls.mjs`, 35 cek: anon/authenticated/service ×
publik vs pemilik).

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

---

## Referensi

- Detail operasional & gotcha Windows/Docker: `README.md` (seksi "Mode
  Supabase", "Uji E2E", "db:rls").
- Skema + policy RLS + Storage: `supabase/migrations/0001_init.sql`,
  `0002_sessions_refresh.sql`, `0003_grants.sql`.
- Script: `scripts/setup-local.mjs`, `scripts/seed-supabase.mjs`,
  `scripts/e2e-rls.mjs`, `scripts/e2e-auth.mjs`.
