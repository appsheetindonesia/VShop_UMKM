-- ============================================================
-- V Shop — Seed SQL (dijalankan otomatis saat `supabase db reset`
-- via [db.seed] di supabase/config.toml).
--
-- Paket langganan sudah di-seed di migration 0001_init.sql
-- (idempotent `on conflict do nothing`), jadi di sini cukup
-- memastikan idempotensi saat reset penuh.
-- Data demo lengkap (akun, merchant, promo, voucher, merchandise)
-- dibuat lewat:  node scripts/seed-supabase.mjs
-- ============================================================

insert into public.packages (id, name, days, price, features, badge) values
  ('pkg_7hari',  'Paket 7 Hari',  7,  7000,  '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, null),
  ('pkg_14hari', 'Paket 14 Hari', 14, 13000, '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, 'TERPOPULER'),
  ('pkg_30hari', 'Paket 30 Hari', 30, 25000, '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, 'PALING HEMAT')
on conflict (id) do update set
  name = excluded.name,
  days = excluded.days,
  price = excluded.price,
  features = excluded.features,
  badge = excluded.badge;
