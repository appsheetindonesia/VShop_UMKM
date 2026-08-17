-- ============================================================
-- V Shop — Policy INSERT orders untuk pemilik (auth.uid)
--
-- Sebelumnya orders hanya punya policy SELECT (orders_select_own) dan
-- aplikasi membuat order lewat service_role. Policy ini memungkinkan
-- authenticated membuat order MILIKNYA SENDIRI langsung via client
-- (defense-in-depth untuk alur checkout sisi browser):
--
--   with check (user_id = auth.uid()::text)
--
-- Baris dengan user_id selain auth.uid() DITOLAK oleh RLS (0 baris
-- di-insert) walau role authenticated punya hak INSERT table-level
-- (0003_grants.sql). anon tetap tanpa policy → insert ditolak.
-- Idempotent: aman di-reapply / dijalankan berulang.
-- ============================================================

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own" on public.orders
  for insert to authenticated with check (user_id = auth.uid()::text);
