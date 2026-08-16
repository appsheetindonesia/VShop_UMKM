-- ============================================================
-- V Shop — Privilege grants (anon / authenticated / service_role)
--
-- Supabase CLI 2.114+ (lokal) menerapkan model LEAST-PRIVILEGE:
-- tabel yang dibuat migration TIDAK otomatis mendapat SELECT/INSERT/
-- UPDATE/DELETE untuk anon/authenticated/service_role (hanya menyisakan
-- TRIGGER/REFERENCES/TRUNCATE). Di produksi, Supabase memberikan hak
-- penuh ke ketiga role tersebut dan mengandalkan RLS untuk membatasi
-- baris. Migration ini mengembalikan perilaku produksi tersebut:
--   1. GRANT ALL di semua tabel/sequence/function skema public.
--   2. Default privileges untuk tabel yang dibuat SETELAH migration ini
--      (mis. lewat SQL Editor / tooling lain).
--   3. PENGECUALIAN tabel `sessions`: kolom refresh token hanya boleh
--      dibaca service_role (aplikasi memakainya untuk pemulihan sesi
--      lintas perangkat). CATATAN Postgres 17: `revoke select (kolom)`
--      TIDAK efektif bila grant berasal dari table-level (attacl kolom
--      tidak ter-materialisasi), jadi kolom sensitif harus TIDAK pernah
--      di-grant — table-level grant sessions dilepas dulu, lalu hanya
--      kolom aman yang diberi hak per-kolom.
-- ============================================================

grant usage on schema public to anon, authenticated, service_role;

-- Semua tabel/sequence/function skema public kecuali yang dikecualikan di
-- bawah: grant penuh (RLS membatasi baris; aplikasi memakai service_role).
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

-- sessions: kolom `sb_refresh_enc` / `sb_user_id` (refresh token terenkripsi)
-- TIDAK boleh dibaca anon/authenticated. Hanya kolom aman yang di-grant.
revoke all on public.sessions from anon, authenticated;
grant select (token, user_id, created_at, expires_at) on public.sessions to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
