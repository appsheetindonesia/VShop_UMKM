-- ============================================================
-- V Shop — Skema awal (Supabase PostgreSQL)
--
-- Aplikasi membaca/menulis via service-role key (server), yang melewati RLS.
-- RLS tetap diaktifkan di setiap tabel sebagai pertahanan berlapis untuk
-- akses langsung (mis. lewat anon key / SQL editor).
--
-- Jalankan: supabase db push  ATAU tempel ke SQL Editor dashboard.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Profil pengguna (memperluas auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  phone text,
  email text,
  password_hash text,
  role text not null default 'customer' check (role in ('customer', 'merchant', 'admin')),
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_phone_key on public.profiles (phone) where phone is not null;
create unique index if not exists profiles_email_key on public.profiles (email) where email is not null;

-- Auto-buat profil saat user Auth dibuat (safety net; aplikasi juga
-- membuat/memperbarui profil secara eksplisit).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    new.phone,
    'customer'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Merchant ----------
create table if not exists public.merchants (
  id text primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  nama_usaha text not null,
  kategori_usaha text not null,
  no_wa_usaha text not null,
  alamat_usaha text not null,
  google_maps_url text,
  foto_usaha text,
  logo_usaha text,
  nama_pemilik text not null,
  no_wa_pemilik text not null,
  email text not null,
  deskripsi text,
  jam_operasional text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists merchants_user_idx on public.merchants (user_id);

-- ---------- Paket langganan ----------
create table if not exists public.packages (
  id text primary key,
  name text not null,
  days integer not null,
  price integer not null,
  features jsonb not null default '[]'::jsonb,
  badge text
);

-- ---------- Keanggotaan ----------
create table if not exists public.memberships (
  id text primary key,
  user_id text not null,
  package_id text not null,
  package_name text not null,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status text not null default 'active' check (status in ('active', 'expired')),
  created_at timestamptz not null default now()
);

create index if not exists memberships_user_idx on public.memberships (user_id);

-- ---------- Promo ----------
create table if not exists public.promos (
  id text primary key,
  merchant_id text not null,
  merchant_name text not null,
  name text not null,
  jenis_voucher text not null,
  start_date timestamptz not null,
  end_date timestamptz not null,
  jumlah integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists promos_merchant_idx on public.promos (merchant_id);

-- ---------- Voucher ----------
create table if not exists public.vouchers (
  id text primary key,
  merchant_id text not null,
  merchant_name text not null,
  promo_id text,
  name text not null,
  jenis_voucher text not null,
  nilai integer not null default 0,
  min_transaksi integer not null default 0,
  kuota integer not null default 0,
  masa_berlaku timestamptz not null,
  maks_penggunaan integer not null default 1,
  syarat_ketentuan text not null default '',
  jumlah integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create index if not exists vouchers_merchant_idx on public.vouchers (merchant_id);

-- ---------- Voucher terklaim ----------
create table if not exists public.claimed_vouchers (
  id text primary key,
  voucher_id text not null,
  user_id text not null,
  kode text not null unique,
  kode_konfirmasi text not null,
  status text not null default 'active' check (status in ('active', 'used', 'expired')),
  claimed_at timestamptz not null default now(),
  used_at timestamptz,
  use_count integer not null default 0
);

create index if not exists claimed_vouchers_user_idx on public.claimed_vouchers (user_id);
create index if not exists claimed_vouchers_voucher_idx on public.claimed_vouchers (voucher_id);

-- ---------- Order ----------
create table if not exists public.orders (
  id text primary key,
  order_number text not null unique,
  user_id text not null,
  type text not null check (type in ('package', 'topup', 'merchandise')),
  items jsonb not null default '[]'::jsonb,
  total_amount integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'processing', 'completed', 'cancelled')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed', 'expired')),
  payment_method text,
  snap_token text,
  shipping_address jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists orders_user_idx on public.orders (user_id);

-- ---------- Merchandise ----------
create table if not exists public.merchandise (
  id text primary key,
  name text not null,
  slug text not null unique,
  description text not null default '',
  price integer not null default 0,
  stock integer not null default 0,
  image text not null default '🛍️',
  category text not null default '',
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  created_at timestamptz not null default now()
);

-- ---------- Dompet ----------
create table if not exists public.wallets (
  user_id text primary key,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------- Sesi aplikasi ----------
create table if not exists public.sessions (
  token text primary key,
  user_id text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

-- ---------- Keranjang ----------
create table if not exists public.carts (
  user_id text primary key,
  items jsonb not null default '[]'::jsonb
);

-- ============================================================
-- ROW LEVEL SECURITY (pertahanan berlapis; service role bypass)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.merchants enable row level security;
alter table public.packages enable row level security;
alter table public.memberships enable row level security;
alter table public.promos enable row level security;
alter table public.vouchers enable row level security;
alter table public.claimed_vouchers enable row level security;
alter table public.orders enable row level security;
alter table public.merchandise enable row level security;
alter table public.wallets enable row level security;
alter table public.sessions enable row level security;
alter table public.carts enable row level security;

-- Profil: pemilik bisa lihat & ubah profilnya sendiri.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Merchant: publik boleh melihat (untuk browsing UMKM); pemilik mengelola.
drop policy if exists "merchants_select_public" on public.merchants;
create policy "merchants_select_public" on public.merchants
  for select using (true);

drop policy if exists "merchants_insert_authenticated" on public.merchants;
create policy "merchants_insert_authenticated" on public.merchants
  for insert to authenticated with check (true);

drop policy if exists "merchants_update_owner" on public.merchants;
create policy "merchants_update_owner" on public.merchants
  for update using (auth.uid() = user_id);

-- Paket: publik.
drop policy if exists "packages_select_public" on public.packages;
create policy "packages_select_public" on public.packages
  for select using (true);

-- Keanggotaan: pemilik.
drop policy if exists "memberships_select_own" on public.memberships;
create policy "memberships_select_own" on public.memberships
  for select using (user_id = auth.uid()::text);

-- Promo & voucher: publik lihat; pemilik kelola.
drop policy if exists "promos_select_public" on public.promos;
create policy "promos_select_public" on public.promos
  for select using (true);

drop policy if exists "promos_insert_owner" on public.promos;
create policy "promos_insert_owner" on public.promos
  for insert to authenticated with check (
    merchant_id in (select id from public.merchants where user_id = auth.uid())
  );

drop policy if exists "promos_update_owner" on public.promos;
create policy "promos_update_owner" on public.promos
  for update using (
    merchant_id in (select id from public.merchants where user_id = auth.uid())
  );

drop policy if exists "vouchers_select_public" on public.vouchers;
create policy "vouchers_select_public" on public.vouchers
  for select using (true);

drop policy if exists "vouchers_insert_owner" on public.vouchers;
create policy "vouchers_insert_owner" on public.vouchers
  for insert to authenticated with check (
    merchant_id in (select id from public.merchants where user_id = auth.uid())
  );

drop policy if exists "vouchers_update_owner" on public.vouchers;
create policy "vouchers_update_owner" on public.vouchers
  for update using (
    merchant_id in (select id from public.merchants where user_id = auth.uid())
  );

-- Voucher terklaim: pemilik lihat; user login boleh klaim.
drop policy if exists "claimed_vouchers_select_own" on public.claimed_vouchers;
create policy "claimed_vouchers_select_own" on public.claimed_vouchers
  for select using (user_id = auth.uid()::text);

drop policy if exists "claimed_vouchers_insert_authenticated" on public.claimed_vouchers;
create policy "claimed_vouchers_insert_authenticated" on public.claimed_vouchers
  for insert to authenticated with check (true);

-- Order: pemilik.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own" on public.orders
  for select using (user_id = auth.uid()::text);

-- Merchandise: publik lihat.
drop policy if exists "merchandise_select_public" on public.merchandise;
create policy "merchandise_select_public" on public.merchandise
  for select using (true);

-- Dompet & sesi & keranjang: pemilik.
drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets
  for select using (user_id = auth.uid()::text);

drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using (user_id = auth.uid()::text);

drop policy if exists "carts_select_own" on public.carts;
create policy "carts_select_own" on public.carts
  for select using (user_id = auth.uid()::text);

drop policy if exists "carts_update_own" on public.carts;
create policy "carts_update_own" on public.carts
  for update using (user_id = auth.uid()::text);

-- ============================================================
-- STORAGE (bucket publik untuk foto usaha, logo, produk)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('vshop-assets', 'vshop-assets', true)
on conflict (id) do nothing;

drop policy if exists "vshop_assets_read_public" on storage.objects;
create policy "vshop_assets_read_public" on storage.objects
  for select using (bucket_id = 'vshop-assets');

drop policy if exists "vshop_assets_insert_authenticated" on storage.objects;
create policy "vshop_assets_insert_authenticated" on storage.objects
  for insert to authenticated with check (bucket_id = 'vshop-assets');

drop policy if exists "vshop_assets_update_authenticated" on storage.objects;
create policy "vshop_assets_update_authenticated" on storage.objects
  for update to authenticated using (bucket_id = 'vshop-assets');

drop policy if exists "vshop_assets_delete_authenticated" on storage.objects;
create policy "vshop_assets_delete_authenticated" on storage.objects
  for delete to authenticated using (bucket_id = 'vshop-assets');

-- ============================================================
-- SEED: paket langganan (id tetap, sama dengan scripts/seed-supabase.mjs)
-- ============================================================

insert into public.packages (id, name, days, price, features, badge) values
  ('pkg_7hari',  'Paket 7 Hari',  7,  7000,  '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, null),
  ('pkg_14hari', 'Paket 14 Hari', 14, 13000, '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, 'TERPOPULER'),
  ('pkg_30hari', 'Paket 30 Hari', 30, 25000, '["Akses promo & voucher","Klaim setiap hari","Hemat maksimal"]'::jsonb, 'PALING HEMAT')
on conflict (id) do nothing;
