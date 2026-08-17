-- ============================================================
-- V Shop — Riwayat run job terjadwal (cron_runs)
--
-- Telemetri append-only: satu baris per EKSEKUSI job (auto-expire,
-- pengingat voucher, dll.) — kapan job terakhir berjalan dan berapa
-- banyak entitas yang diproses per periode. Dipakai laporan admin
-- (/admin/kadaluarsa: "Job terakhir & riwayat per periode").
-- Ditulis fire-and-forget dari src/lib/cron-log.ts via service-role.
-- RLS aktif TANPA policy → anon/authenticated tidak bisa membaca/
-- menulis (default deny); aplikasi memakai service-role (bypass).
-- ============================================================

create table if not exists public.cron_runs (
  id text primary key,
  job text not null,
  ran_at timestamptz not null default now(),
  expired_count integer not null default 0,
  notified_count integer not null default 0,
  detail text
);

create index if not exists cron_runs_job_ran_idx
  on public.cron_runs (job, ran_at desc);
create index if not exists cron_runs_ran_idx
  on public.cron_runs (ran_at desc);

alter table public.cron_runs enable row level security;
-- Tanpa policy: anon/authenticated mendapat 0 baris; service_role bypass.
