# ADR-0001 — RLS berlapis vs reliance penuh pada service_role

**Status**: Accepted
**Tanggal**: 2026-08-17
**Lingkup**: `supabase/migrations/0001_init.sql` (policy), `0003_grants.sql`
(privilege), `src/lib/supabase/server.ts` (`getSupabaseAdmin`),
`scripts/e2e-rls.mjs` (verifikasi)

## Context

Semua operasi data aplikasi memakai **service_role key** (`getSupabaseAdmin`,
bypass RLS) — alur checkout, klaim voucher, Midtrans webhook, cron, notifikasi.
Pertanyaan kontroversial yang muncul berulang: *kalau semua operasi lewat
service_role, untuk apa RLS + policy dipertahankan? Kenapa tidak dimatikan
saja / dibuang?*

Pemicu diskusi: (1) RLS menambah biaya perawatan (satu policy per tabel per
operasi); (2) policy bisa melenceng dari perilaku aplikasi; (3) CLI Supabase
2.114+ lokal menerapkan least-privilege sehingga grants eksplisit (0003)
wajib ada — dua mekanisme sekaligus (grants + RLS) terasa redundan.

## Alternatif yang dipertimbangkan

- **A1 — Matikan RLS, andalkan service_role saja.** Paling sederhana. Tapi
  anon key **ter-expose di browser** (Next.js public env) — tanpa RLS, siapa
  pun bisa `select * from orders` memakai anon key. Tidak ada safety net
  untuk akses langsung (SQL editor, client/mobile masa depan, key bocor).
- **A2 — Pakai anon key + RLS untuk SEMUA akses (tanpa service_role).** Pola
  ideal Supabase, tapi memaksa seluruh bisnis logic (harga, stok, klaim,
  retry, Midtrans) diekspresikan sebagai policy SQL; alur server-side
  (webhook Midtrans, cron, WhatsApp) **tidak punya sesi user** sehingga
  butuh hak khusus; refactor besar tanpa keuntungan untuk MVP monolitik.
- **A3 — DIPILIH: service_role untuk alur aplikasi + RLS sebagai pertahanan
  berlapis untuk akses langsung**, dengan grants eksplisit (0003) dan kolom
  sensitif `sessions` yang hanya service_role (grant per-kolom, karena
  REVOKE kolom no-op di Postgres 17 bila grant datang dari table-level).

## Decision

Pertahankan **dua lapis**:

1. **Runtime aplikasi** = service_role (bypass RLS), dengan validasi bisnis
   di sisi aplikasi (`src/lib/service.ts`).
2. **RLS aktif di semua tabel** dengan policy pemilik/publik (mis.
   `orders_select_own`, `orders_insert_own` 0008, `merchants_select_public`)
   sebagai **safety net** untuk akses langsung memakai anon key / SQL editor /
   client masa depan. Grants eksplisit (0003) menormalkan least-privilege
   CLI 2.114+; kolom `sessions.sb_refresh_enc`/`sb_user_id` **hanya
   service_role**.

Verifikasi wajib: `npm run db:rls` (62 cek — anon/authenticated/service ×
publik vs pemilik + Storage + Auth phone) harus hijau di CI
(`.github/workflows/supabase-e2e.yml`). **Setiap policy baru wajib diikuti
cek di `e2e-rls.mjs`** (jangan menambah policy tanpa ekspektasi teruji).

## Consequences

**Positif**
- Anon key aman di browser: tidak bisa membaca order/dompet/sesi/refresh
  token; akses langsung ke Postgres terbatas baris per user.
- Peta hak akses eksplisit (policy + grants) yang bisa diuji end-to-end;
  regresi keamanan ketahuan di CI, bukan di produksi.

**Negatif / risiko**
- Biaya perawatan: satu policy per tabel per operasi di migration.
- Policy **bukan** pengganti validasi aplikasi — contoh nyata: `orders_insert_own`
  (0008) mengizinkan authenticated membuat order miliknya via API langsung;
  validasi bisnis (`total_amount`, `items`, harga) **hanya ada di
  `service.ts`**, tidak di policy. User yang menulis langsung ke PostgREST
  bisa menyalahgunakan celah itu. Diterima karena jalur resmi (checkout)
  memakai service_role; dicatat agar tidak dianggap policy = aman.
- Bug policy tidak terdeteksi runtime (jalur utama bypass) — hanya lewat
  e2e-rls.

**Bila ditinjau ulang**: perkuat A2 hanya bila ada klien non-server (mobile
app) yang butuh akses langsung; tambahkan policy `check` bisnis saat itu.
