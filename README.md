# 🛍️ V Shop — Diskon UMKM di Sekitarmu

Platform voucher & promo berbasis web untuk UMKM Indonesia. Dibangun sesuai
dokumen **PRD, BRD, FRD, TRD** dan wireframe `vshop-mobile-mockup`:
pilih peran → daftar → paket → QRIS → voucher → redeem.

> 📄 **Dokumentasi lengkap** (set-up Supabase lokal, arsitektur, skema DB,
> RLS, uji sandbox Midtrans, riwayat keputusan): **[docs/README-LENGKAP.md](docs/README-LENGKAP.md)** ·
> 🚀 **Deploy ke Vercel + Supabase cloud** (env vars wajib): **[docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)**

## ✨ Fitur inti

- **Pelanggan** — daftar/masuk via **OTP WhatsApp** (fallback password),
  paket langganan, klaim & redeem voucher, top up saldo, keranjang &
  checkout, QRIS (QR + countdown), riwayat pembayaran
- **Merchant** — dashboard, buat promo & voucher, redeem (validasi kode),
  laporan
- **Admin** — statistik, verifikasi merchant, merchandise, pesanan,
  log notifikasi WhatsApp, order kadaluarsa + retry massal, menu
  **Configurasi** (koneksi PostgreSQL / Midtrans / WhatsApp / AI via UI,
  rahasia terenkripsi)
- **Pembayaran** — **Midtrans Snap** (sandbox/produksi), verifikasi webhook
  SHA-512, Status API, alasan gagal spesifik (ditolak bank / saldo kurang /
  waktu habis), auto-expire 24 jam, tombol **Coba Lagi tanpa keluar halaman**
- **Notifikasi WhatsApp** — sukses/gagal/kadaluarsa + template message
  Meta, antrian & retry dengan backoff

## 🧰 Teknologi

Next.js 14 (App Router) · TypeScript strict · Tailwind CSS · Zod ·
Supabase (Auth / PostgreSQL / RLS / Storage) · Midtrans Snap ·
WhatsApp Cloud API · Vitest

## 🚀 Mulai cepat

```bash
npm install
npm run dev        # http://localhost:3000
```

Tanpa konfigurasi tambahan aplikasi berjalan dalam **mode demo** (data
`data/db.json`, pembayaran disimulasikan). Untuk Supabase lokal + Midtrans
sandbox + autentikasi OTP WhatsApp, lihat
[dokumentasi lengkap](docs/README-LENGKAP.md). Untuk produksi, ikuti
[panduan deploy Vercel + Supabase cloud](docs/DEPLOY-VERCEL.md).

## ✅ Uji

```bash
npm test             # unit + integrasi (Vitest, 380+ test)
npm run db:setup     # Supabase lokal sekali perintah (Docker → start → seed)
npm run db:rls       # e2e RLS + Storage + Auth phone vs Supabase lokal
npm run db:webhook   # e2e webhook Midtrans signed (deny / settlement / expire)
npm run db:snap-error  # e2e popup Snap onError + "Coba Lagi" (stub lokal)
```

**CI-friendly:** `npm run build` + `npm test` + `npm run typecheck` lolos dari
state bersih **tanpa `.env.local`** (aplikasi otomatis masuk mode demo saat env
tidak tersedia), jadi pipeline CI cukup menyediakan env rahasia saja.
