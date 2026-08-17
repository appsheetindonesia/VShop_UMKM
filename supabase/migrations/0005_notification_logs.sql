-- ============================================================
-- V Shop — Log Notifikasi (riwayat pengiriman WhatsApp)
--
-- Mencatat SETIAP percobaan kirim notifikasi (order / voucher) untuk
-- pemantauan admin: status, penerima, hasil, error. Tabel ini APPEND-ONLY
-- (ditulis fire-and-forget dari src/lib/notif-log.ts, dibaca admin via
-- service-role). RLS aktif TANPA policy → anon/authenticated tidak bisa
-- membaca/menulis (default deny); aplikasi memakai service-role (bypass).
-- ============================================================

create table if not exists public.notification_logs (
  id text primary key,
  order_id text,
  recipient text not null,
  type text not null,
  status text not null check (status in ('sent', 'failed', 'demo')),
  delivered boolean not null default false,
  channel text not null default 'whatsapp',
  template_name text,
  message text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists notification_logs_created_idx
  on public.notification_logs (created_at desc);
create index if not exists notification_logs_order_idx
  on public.notification_logs (order_id);
create index if not exists notification_logs_recipient_idx
  on public.notification_logs (recipient);

alter table public.notification_logs enable row level security;
-- Tanpa policy: anon/authenticated mendapat 0 baris; service_role bypass.
