-- ============================================================
-- V Shop — Retry otomatis notifikasi WhatsApp yang gagal
--
-- Kolom retry pada notification_logs mendukung job terjadwal
-- (/api/cron/retry-notifications): setiap percobaan ulang dicatat
-- (retry_count + last_retry_at) agar backoff TERBATAS — entri yang sudah
-- melewati NOTIF_RETRY_MAX_ATTEMPTS tidak dicoba lagi, dan percobaan ulang
-- berikutnya hanya terjadi setelah jarak backoff (last_retry_at).
-- ============================================================

alter table public.notification_logs
  add column if not exists retry_count int not null default 0;

alter table public.notification_logs
  add column if not exists last_retry_at timestamptz;

comment on column public.notification_logs.retry_count is
  'Berapa kali notifikasi gagal ini sudah dicoba kirim ulang oleh cron retry';
comment on column public.notification_logs.last_retry_at is
  'Waktu percobaan kirim ulang terakhir (null = belum pernah di-retry)';
