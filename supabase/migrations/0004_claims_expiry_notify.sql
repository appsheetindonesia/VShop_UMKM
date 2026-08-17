-- ============================================================
-- V Shop — Notifikasi voucher hampir kadaluarsa
--
-- Kolom `expiring_notified_at` pada claimed_vouchers mencatat kapan
-- notifikasi "voucher hampir kadaluarsa" terakhir dikirim ke pelanggan,
-- agar job terjadwal (cron /api/cron/expire-orders) TIDAK mengirim ulang
-- setiap jam untuk klaim yang sama. Null = belum pernah dinotifikasi.
-- ============================================================

alter table public.claimed_vouchers
  add column if not exists expiring_notified_at timestamptz;

comment on column public.claimed_vouchers.expiring_notified_at is
  'Waktu notifikasi "voucher hampir kadaluarsa" terakhir dikirim (null = belum)';
