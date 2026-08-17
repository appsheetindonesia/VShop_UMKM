-- ============================================================
-- V Shop — payment_status: tambah 'cancelled'
--
-- Kolom `orders.status` sudah mengizinkan 'cancelled' (pembatalan order
-- lewat service.ts men-set `status = "cancelled"`), tapi `payment_status`
-- belum — jadi pembatalan tidak punya status pembayaran EKSPLISIT.
-- Migration ini menambah 'cancelled' ke CHECK constraint `payment_status`
-- (konsisten dengan badge paymentBadge yang sudah memetakan
-- cancelled → "Dibatalkan"/abu-abu sejak awal).
--
-- CONSTRAINT tidak bisa di-alter di Postgres: drop + re-add dengan nama
-- eksplisit (auto-named sebelumnya: orders_payment_status_check).
-- 0001_init.sql sudah diperbarui untuk fresh setup (db reset).
-- ============================================================

alter table public.orders
  drop constraint if exists orders_payment_status_check;

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('pending', 'paid', 'failed', 'expired', 'cancelled'));
