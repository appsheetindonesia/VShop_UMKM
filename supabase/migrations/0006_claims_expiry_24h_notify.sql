-- ============================================================
-- V Shop — Notifikasi "voucher kadaluarsa BESOK" (H-1, 24 jam)
--
-- Tier pengingat kedua (independen dari 48 jam): klaim yang masa
-- berlakunya habis dalam 24 jam ke depan diingatkan sekali lewat
-- cron /api/cron/voucher-expiring-24h (vercel.json + interval lokal).
-- Kolom `expiring_24h_notified_at` = dedupe PER TIER, terpisah dari
-- `expiring_notified_at` (48 jam) sehingga kedua pengingat bisa
-- mengirim tanpa saling memblokir.
-- ============================================================

alter table public.claimed_vouchers
  add column if not exists expiring_24h_notified_at timestamptz;

comment on column public.claimed_vouchers.expiring_24h_notified_at is
  'Waktu notifikasi H-1 (24 jam sebelum masa berlaku) terkirim — dedupe tier 24 jam.';
