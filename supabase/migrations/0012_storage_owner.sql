-- ============================================================
-- 0012 — PERKETAT POLICY STORAGE: owner check per folder user
-- ============================================================
-- Sebelumnya (0001): INSERT/UPDATE/DELETE bucket 'vshop-assets' bersifat
-- bucket-wide `to authenticated` — setiap user login bisa mengubah/menghapus
-- objek milik user lain (dan upload ke folder mana pun).
--
-- Sekarang: folder PER USER. Setiap objek ditulis di bawah
-- `{auth.uid()}/...` (segment pertama path = id user pemilik). Policy
-- insert/update/delete hanya mengizinkan operasi pada objek di folder
-- milik sendiri. SELECT tetap publik (bucket publik untuk foto usaha,
-- logo, produk — dibaca tanpa login).
--
-- Catatan: `storage.foldername(name)` mengembalikan segment path; `[1]`
-- adalah folder pertama. Objek di root (tanpa folder) otomatis ditolak
-- untuk tulis (foldername kosong → NULL ≠ uid).
-- Service role tetap bypass RLS (dipakai route /api/upload server-side).
-- ============================================================

drop policy if exists "vshop_assets_read_public" on storage.objects;
create policy "vshop_assets_read_public" on storage.objects
  for select using (bucket_id = 'vshop-assets');

drop policy if exists "vshop_assets_insert_authenticated" on storage.objects;
create policy "vshop_assets_insert_authenticated" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'vshop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vshop_assets_update_authenticated" on storage.objects;
create policy "vshop_assets_update_authenticated" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'vshop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "vshop_assets_delete_authenticated" on storage.objects;
create policy "vshop_assets_delete_authenticated" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'vshop-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
