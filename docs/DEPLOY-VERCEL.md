# 🚀 Deploy ke Vercel + Supabase Cloud

Panduan men-deploy **V Shop** ke Vercel dengan database **Supabase cloud**,
termasuk daftar **variabel env yang wajib diisi**.

> Prasyarat: akun [Vercel](https://vercel.com) dan proyek
> [Supabase](https://supabase.com) (cloud). Versi lokal (tanpa akun apa pun)
> ada di `docs/README-LENGKAP.md` → "Supabase CLI Lokal".

---

## 1. Siapkan Supabase Cloud

### 1.1 Buat proyek

1. [supabase.com](https://supabase.com) → **New project**.
2. Nama bebas (mis. `vshop`), password database simpan aman, region
   terdekat (mis. Singapore `ap-southeast-1`).
3. Tunggu provisioning (~2 menit).

### 1.2 Jalankan migration (wajib, urut)

Buka **SQL Editor** → tempel isi tiap file → Run, **sesuai urutan**:

```
supabase/migrations/0001_init.sql                        # skema + RLS + bucket storage vshop-assets + seed
supabase/migrations/0002_sessions_refresh.sql            # refresh token terenkripsi (sesi lintas perangkat)
supabase/migrations/0003_grants.sql
supabase/migrations/0004_claims_expiry_notify.sql
supabase/migrations/0005_notification_logs.sql
supabase/migrations/0006_claims_expiry_24h_notify.sql
supabase/migrations/0007_cron_runs.sql
supabase/migrations/0008_orders_insert_own.sql           # RLS: authenticated boleh membuat order sendiri
supabase/migrations/0009_app_settings.sql                # tabel configurasi (hanya service_role)
supabase/migrations/0010_payment_status_cancelled.sql    # CHECK constraint + 'cancelled'
```

> `0001` membuat **bucket storage `vshop-assets`** + policy-nya. Bila mau
> memakai Storage untuk upload merchandise, tidak perlu setup manual.

### 1.3 Aktifkan Auth (email + OTP WhatsApp)

**Authentication → Providers → Sign In / Up:**

- **Email**: aktifkan (login email+password untuk pelanggan/merchant/admin).
- **Phone**: aktifkan → kanal **SMS/WhatsApp** untuk OTP login pelanggan.
  - Cloud Supabase mengirim OTP via **Twilio** (atau WhatsApp integration).
    Bila belum dikonfigurasi, OTP tidak terkirim — pelanggan tetap bisa masuk
    lewat tab **Password** (fallback bawaan aplikasi).
- **Email templates** (opsional): ubah teks sesuai merek.

> Akun **admin** dibuat dari seed — setelah deploy, jalankan seed sekali
> terhadap cloud (lihat §4) atau buat manual di Authentication → Users
> dengan role `admin` di tabel `profiles`.

### 1.4 Ambil kredensial

**Project Settings → API**:

| Kredensial | Lokasi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (mis. `https://xxxx.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key ⚠️ **rahasia, hanya di server** |

---

## 2. Deploy ke Vercel

### Opsi A — Dashboard (Git)

1. [vercel.com](https://vercel.com) → **Add New → Project** → import repo
   (`appsheetindonesia/VShop_UMKM`).
2. Framework terdeteksi otomatis (**Next.js**). Build command default
   (`next build`) — **jangan diubah**.
3. Isi Environment Variables (§3) → **Deploy**.

### Opsi B — CLI

```bash
npm i -g vercel
vercel            # tautkan proyek, isi env saat diminta
vercel --prod
```

`vercel.json` sudah menyertakan `framework: nextjs` dan **cron jobs**
(`/api/cron/expire-orders` tiap jam, `/api/cron/voucher-expiring-24h`
tiap 30 menit, `/api/cron/retry-notifications` tiap 15 menit lewat jam).

---

## 3. 🌍 Variabel Environment (wajib & opsional)

Isi di **Vercel → Project → Settings → Environment Variables**.
Awalan `NEXT_PUBLIC_` **bisa dibaca browser** — sisanya rahasia (server).

### Wajib untuk mode produksi (Supabase)

| Variabel | Nilai contoh | Keterangan |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxx.supabase.co` | Publik. Tanpa ini app **mode demo** (JANGAN di produksi). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOi…` | Publik. anon key dari Project Settings → API. |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOi…` (role `service_role`) | ⚠️ Rahasia. Dipakai seluruh baca/tulis data + Auth. |
| `SESSION_ENCRYPTION_KEY` | `openssl rand -base64 32` | ⚠️ Rahasia. Kunci enkripsi refresh token. **Simpan sekali, jangan regenerate** — sesi lama tidak terbaca dengan kunci baru. |
| `APP_URL` | `https://vshop.vercel.app` | Domain produksi — dipakai untuk **link di notifikasi WhatsApp**. |
| `CRON_SECRET` | string acak (min. 16 karakter) | Proteksi `/api/cron/*`. Vercel Cron mengirimnya otomatis sebagai `Authorization: Bearer …`. **Wajib di produksi**. |

### Pembayaran Midtrans (sandbox dulu, lalu produksi)

| Variabel | Nilai contoh | Keterangan |
|---|---|---|
| `MIDTRANS_SERVER_KEY` | `SB-Mid-server-…` / `Mid-server-…` | ⚠️ Rahasia. Akses key dari dashboard Midtrans → Settings → Access Keys. |
| `MIDTRANS_CLIENT_KEY` | `SB-Mid-client-…` / `Mid-client-…` | Publik — dipakai Snap.js embed di halaman bayar. |
| `MIDTRANS_IS_PRODUCTION` | `false` (sandbox) / `true` (produksi) | Wajib konsisten dengan key. |
| — | — | **Jangan set** `MIDTRANS_API_BASE` / `MIDTRANS_SNAP_SCRIPT_URL` di produksi (hanya untuk uji lokal/proxy). |

> **Webhook Midtrans**: dashboard Midtrans (sandbox & produksi terpisah) →
> Settings → Configuration → **Payment Notification URL** =
> `https://<domain>/api/midtrans/notification`. Signature SHA-512 diverifikasi
> otomatis oleh aplikasi.

### Notifikasi WhatsApp (opsional tapi direkomendasikan)

| Variabel | Keterangan |
|---|---|
| `WHATSAPP_TOKEN` | Token permanen system user (Meta for Developers → WhatsApp → API Setup). |
| `WHATSAPP_PHONE_NUMBER_ID` | Dari nomor bisnis terverifikasi. |
| `WHATSAPP_MESSAGE_MODE` | `auto` (template Meta, utama) atau `text` (teks bebas, sandbox). |
| `WHATSAPP_TEMPLATE_PAID` / `_FAILED` / `_ORDER` / `_REDEEMED` / `_EXPIRING` / `_RETRIED` / `_DAILY_SUMMARY` + `WHATSAPP_TEMPLATE_LANG` | Nama template yang **sudah disetujui Meta** + bahasa (`id`). `_RETRIED` dipakai saat admin retry massal order (pelanggan diingatkan order siap dibayar ulang); `_DAILY_SUMMARY` dipakai cron harian (ringkasan ke merchant). Body `_ORDER` berakhir placeholder `{{5}}` = link **detail transaksi** (`/transaksi/[orderId]`) — penjual langsung melihat pesanan masuk. |
| `WHATSAPP_TEMPLATE_PAID_BUTTONS` / `_FAILED_BUTTONS` / `_EXPIRING_BUTTONS` | Tombol template (opsional): daftar peran dipisah koma, urut indeks — `detail` (url → `<APP_URL>/transaksi/{{1}}`), `retry` (url → `<APP_URL>/bayar/{{1}}`), `vouchers` (url tetap → `<APP_URL>/voucher-saya`, dipakai CTA "Gunakan Sekarang" di template expiring). URL + `{{1}}` dibuat di dashboard Meta; aplikasi mengirim suffix `order.id`. Kosong = body-only. |
| `WHATSAPP_BUSINESS_TO` | (opsional) tujuan pesanan baru, default `noWAUsaha` merchant. |
| `WHATSAPP_SUPPORT_NUMBER` | (opsional) nomor support — tombol **Lacak Pesanan** (`wa.me`) di halaman detail transaksi saat status gagal/kadaluarsa. |
| `WA_LINK_BASE` | (opsional) domain **publik** untuk semua link di pesan WhatsApp — terpisah dari `APP_URL` (mis. aplikasi internal di `admin.vshop.id`, link WA di `wa.vshop.id`). Kosong → fallback `APP_URL`. Bisa diubah live dari Configurasi → WhatsApp Gateway ("Link Base"). |

### Opsional lain (ada default aman)

| Variabel | Default | Keterangan |
|---|---|---|
| `ORDER_EXPIRY_HOURS` | `24` | Auto-expire order pending (konsisten dgn expiry Midtrans). |
| `MAX_ORDER_RETRIES` | `3` | Batas percobaan "Coba Lagi" per order (guard service + UI). |
| `VOUCHER_EXPIRY_NOTIFY_HOURS` | `48` | Pengingat voucher hampir kadaluarsa (tier 1). |
| `VOUCHER_EXPIRY_24H_NOTIFY_HOURS` | `24` | Pengingat H-1 (tier 2, cron terpisah). |
| `WA_QUEUE_CONCURRENCY` / `WA_RETRY_MAX_ATTEMPTS` / `WA_RETRY_BASE_MS` | `3` / `3` / `800` | Antrian + retry backoff WhatsApp. |
| `CRON_SCHEDULER_JITTER` / `CRON_FAILURE_BACKOFF_MS` | `0.2` / `300000` | Jitter & backoff scheduler lokal (tidak dipakai Vercel Cron). |
| `DB_FLUSH_MAX_WAIT_MS` | `5000` | Drain tulis saat shutdown. |
| `DB_COALESCE` | *(kosong)* | ⛔ **Jangan diisi di produksi.** `DB_COALESCE=0` mematikan koalesensi tulis (tiap `mutate()` = flush sendiri) — hanya untuk observability lokal / `test:measure-writes`. |

> **Env tidak terisi** → fitur turun ke mode demo otomatis: tanpa Supabase =
> data JSON lokal (ephemeral di serverless), tanpa Midtrans = pembayaran
> simulasi, tanpa WhatsApp = log `[wa] (demo)`. Di produksi wajib isi semua
> variabel **wajib** di atas.

---

## 4. Seed data demo (opsional, sekali)

Terhadap Supabase cloud (butuh `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` di env lokal atau export):

```bash
npm run db:seed
```

Membuat akun demo (`customer@vshop.id` / `customer123`, merchant, admin),
paket, promo & voucher contoh. **Hapus/ubah akun admin demo setelah dipakai.**

---

## 5. ⏰ Cron jobs

Papan kontrol **`/admin/cron`** menampilkan jadwal, run terakhir, dan
**tombol "Jalankan Sekarang"** per job (POST `/api/admin/cron/run`,
guard admin). Jadwal di halaman bersumber dari `CRON_JOB_SPECS`
(`src/lib/cron.ts`) — jaga sinkron dengan tabel di bawah.

`vercel.json` mendefinisikan:

| Path | Jadwal | Fungsi |
|---|---|---|
| `/api/cron/expire-orders` | `0 * * * *` | Auto-expire order pending > `ORDER_EXPIRY_HOURS` + pengingat voucher 48 jam. |
| `/api/cron/voucher-expiring-24h` | `30 * * * *` | Pengingat voucher H-1 (24 jam). |
| `/api/cron/retry-notifications` | `15 * * * *` | Kirim ulang notifikasi WhatsApp gagal (backoff terbatas, migration 0011). |
| `/api/cron/daily-summary` | `0 6 * * *` | Ringkasan harian merchant (klaim/pendapatan/order pending; dedupe per hari). |

- Keempatnya menolak permintaan tanpa `CRON_SECRET` yang benar.
- Env retry (opsional): `NOTIF_RETRY_MAX_ATTEMPTS` (3), `NOTIF_RETRY_BACKOFF_MS` (30 mnt), `NOTIF_RETRY_MIN_AGE_MS` (5 mnt), `NOTIF_RETRY_BATCH` (10).
- **Catatan plan**: di Vercel **Hobby**, cron berjalan maks ±2×/hari —
  order tidak auto-expire tepat waktu. **Upgrade Pro** untuk jadwal tiap jam.
  Tanpa cron, job bisa dipicu manual: `curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/expire-orders`.
- Route cron sudah mengekspor `maxDuration = 60`.

---

## 6. ⚠️ Catatan arsitektur serverless

- **JANGAN gunakan mode demo di produksi** — `data/db.json` bersifat
  ephemeral (file tidak persisten antar function/instance).
- State aplikasi hidup di **Supabase** (source of truth). Setiap instance
  Vercel me-hydrate dari Supabase saat dimulai (`ensureHydrated`); tulis
  memakai service role. Multi-instance aman selama semua env benar.
- `SESSION_ENCRYPTION_KEY` **tidak boleh berubah** antar deploy (rolling).
- `APP_URL` harus domain produksi, bukan `localhost` — kalau tidak, link
  WhatsApp mengarah ke mesin Anda.
- Middleware renewal sesi memakai **Web Crypto API** (edge-safe) — sudah
  diuji agar tidak meledak di runtime Edge Vercel.

---

## 7. Troubleshooting singkat

| Gejala | Kemungkinan penyebab |
|---|---|
| Build sukses tapi data kosong / mode demo | `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` tidak ter-set, atau migration belum dijalankan. |
| Login OTP WhatsApp tidak terkirim | Provider **Phone** belum diaktifkan / kanal SMS (Twilio) belum dikonfigurasi di Supabase. Pakai tab **Password** sebagai fallback. |
| Pembayaran 401 di Snap | Key sandbox vs produksi tidak konsisten dengan `MIDTRANS_IS_PRODUCTION`. |
| Webhook Midtrans tidak diproses | URL webhook belum diisi di dashboard Midtrans, atau domain berbeda dari `APP_URL`. |
| Cron tidak jalan | `CRON_SECRET` tidak di-set, atau limit plan Hobby (≤2×/hari). |
| Sesi hilang setelah redeploy | `SESSION_ENCRYPTION_KEY` berubah antar deploy. |
