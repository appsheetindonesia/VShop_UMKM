-- ============================================================
-- 0002 — Schema evolution: sessions refresh token terenkripsi +
--        riwayat retry order di kolom PostgreSQL
-- ============================================================
-- DUA bagian:
--
-- A. SESSIONS — sesi aplikasi bisa dipulihkan LINTAS PERANGKAT dan tanpa
--    bergantung pada cookie `vshop_sb_refresh`. Refresh token Supabase Auth
--    disimpan di kolom `sb_refresh_enc` dalam keadaan terenkripsi
--    (AES-256-GCM, key dari env `SESSION_ENCRYPTION_KEY` di server; format
--    "v1:<iv>:<tag>:<ciphertext>"). Hanya server (service role) yang bisa
--    membacanya — klien tidak pernah menerimanya.
--
-- B. ORDERS — riwayat penggantian nomor order (order_id Midtrans) akibat
--    retry disimpan di KOLOM PostgreSQL (`original_order_number` +
--    `previous_order_numbers`), bukan hanya di `metadata` jsonb — agar
--    bisa di-query/diindeks dan tetap ada walau jsonb diubah. Aplikasi
--    menulisnya dari `metadata.originalOrderNumber` /
--    `metadata.previousOrderNumbers` (writer db.ts) dan menggabungkannya
--    kembali ke metadata saat hydrate (kolom menang bila ada).

alter table public.sessions
  add column if not exists sb_refresh_enc text,
  add column if not exists sb_user_id text;

alter table public.orders
  add column if not exists original_order_number text,
  add column if not exists previous_order_numbers text[];

-- Indeks untuk pembersihan/rotasi berbasis user (Supabase Auth id).
create index if not exists sessions_user_id_idx
  on public.sessions (user_id);
create index if not exists sessions_sb_user_id_idx
  on public.sessions (sb_user_id);

comment on column public.sessions.sb_refresh_enc is
  'Refresh token Supabase Auth terenkripsi (AES-256-GCM, SESSION_ENCRYPTION_KEY) — pemulihan sesi lintas perangkat tanpa cookie.';
comment on column public.sessions.sb_user_id is
  'ID user Supabase Auth (auth.users) pemilik refresh token — untuk pencarian/rotasi lintas perangkat.';

comment on column public.orders.original_order_number is
  'Nomor order AWAAL sebelum retry (order_id Midtrans pertama) — riwayat retry tersimpan di kolom, bukan hanya metadata jsonb.';
comment on column public.orders.previous_order_numbers is
  'Rantai nomor order yang pernah dipakai sebelum nomor saat ini (setiap retry) — array text, urutan kronologis.';

-- Pertahanan berlapis: kolom refresh token tidak boleh dibaca klien
-- (anon/authenticated) bahkan bila RLS lolos — hanya service role.
-- (Kolom baru otomatis ikut RLS baris dari 0001; ini membatasi di level kolom.)
revoke select (sb_refresh_enc, sb_user_id) on public.sessions from anon, authenticated;

-- ============================================================
-- Catatan aplikasi (bukan SQL):
--   * `SESSION_ENCRYPTION_KEY` — generate: `openssl rand -base64 32`.
--   * Tanpa key, aplikasi tetap berjalan (fallback cookie-only); dengan key,
--     refresh token ikut tersimpan per baris sesi dan dipakai `renewAppSession`
--     sebagai fallback saat cookie hilang / perangkat baru.
--   * Token di-rotasi Supabase setiap refresh — baris sesi baru menyimpan
--     token hasil rotasi terbaru.
-- ============================================================
