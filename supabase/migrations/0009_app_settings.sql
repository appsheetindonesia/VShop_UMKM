-- ============================================================
-- V Shop — Pengaturan aplikasi (app_settings) untuk menu admin Configurasi
--
-- Menyimpan pengaturan KONEKSI yang bisa diubah dari UI admin
-- (/admin/configurasi): PostgreSQL (URL + service key), payment gateway
-- Midtrans, WhatsApp Cloud API, AI, dan lainnya. Nilai rahasia (key/token)
-- disimpan TERENKRIPSI (AES-256-GCM via src/lib/settings.ts — format
-- `v1:iv:tag:ct`, sama dengan refresh token di sessions).
--
-- Keamanan:
--   - RLS aktif TANPA policy → default deny.
--   - Hak kolom: hanya service_role yang boleh baca/tulis (REVOKE untuk
--     anon/authenticated — pola sama dengan sessions di 0003, karena
--     `alter default privileges` 0003 memberi hak ke ketiga role).
--   - Halaman & API dibatasi role admin (requireRole / getSessionUser).
-- ============================================================

create table if not exists public.app_settings (
  key text primary key,
  category text not null,
  label text not null default '',
  description text not null default '',
  is_secret boolean not null default false,
  value_enc text,
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.app_settings is
  'Pengaturan koneksi yang diedit dari /admin/configurasi; rahasia terenkripsi AES-256-GCM, hanya service_role.';

alter table public.app_settings enable row level security;

-- Hanya service_role (bypass RLS): cabut hak anon/authenticated (default
-- privileges 0003 memberinya), lalu pastikan service_role punya hak penuh.
revoke all on public.app_settings from anon, authenticated;
grant all on public.app_settings to service_role;
