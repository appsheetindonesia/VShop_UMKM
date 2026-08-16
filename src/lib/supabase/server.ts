import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Factory client Supabase (server-side only).
 *
 * - `getSupabaseAdmin()` — memakai SUPABASE_SERVICE_ROLE_KEY (bypass RLS).
 *   Dipakai untuk semua operasi baca/tulis data aplikasi (via `db.ts`) dan
 *   manajemen Auth (createUser). Rahasia ini TIDAK boleh bocor ke client.
 * - `getSupabaseAnon()` — memakai NEXT_PUBLIC_SUPABASE_ANON_KEY. Dipakai
 *   untuk operasi publik Supabase Auth (signInWithPassword, resetPassword).
 *
 * Keduanya mengembalikan `null` bila Supabase belum dikonfigurasi, sehingga
 * aplikasi tetap berjalan dalam MODE DEMO (data JSON lokal).
 */

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

const NO_PERSIST = {
  auth: { persistSession: false, autoRefreshToken: false },
} as const;

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { ...NO_PERSIST });
}

export function getSupabaseAnon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { ...NO_PERSIST });
}
