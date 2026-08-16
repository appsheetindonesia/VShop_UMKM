-- ============================================================
-- 0002 — Refresh token Supabase terenkripsi di tabel sessions
-- ============================================================
-- Tujuan: sesi aplikasi bisa dipulihkan LINTAS PERANGKAT dan tanpa
-- bergantung pada cookie `vshop_sb_refresh`. Refresh token Supabase Auth
-- disimpan di kolom `sb_refresh_enc` dalam keadaan terenkripsi
-- (AES-256-GCM, key dari env `SESSION_ENCRYPTION_KEY` di server; format
-- "v1:<iv>:<tag>:<ciphertext>"). Hanya server (service role) yang bisa
-- membacanya — klien tidak pernah menerimanya.

alter table public.sessions
  add column if not exists sb_refresh_enc text,
  add column if not exists sb_user_id text;

-- Indeks untuk pembersihan/rotasi berbasis user (Supabase Auth id).
create index if not exists sessions_user_id_idx
  on public.sessions (user_id);
create index if not exists sessions_sb_user_id_idx
  on public.sessions (sb_user_id);

comment on column public.sessions.sb_refresh_enc is
  'Refresh token Supabase Auth terenkripsi (AES-256-GCM, SESSION_ENCRYPTION_KEY) — pemulihan sesi lintas perangkat tanpa cookie.';
comment on column public.sessions.sb_user_id is
  'ID user Supabase Auth (auth.users) pemilik refresh token — untuk pencarian/rotasi lintas perangkat.';

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
