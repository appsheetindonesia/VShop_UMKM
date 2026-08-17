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
 *
 * PENTING (cache): semua request lewat `fetch` global yang di-patch Next.js.
 * Cache fetch Next.js (app router) bisa menyajikan respons GET yang STALE
 * (dikunci per URL, dipersist di `.next/cache/fetch-cache`) — mis. query
 * dedupe cron dengan URL KONSTAN bisa "terpoison" oleh respons kosong
 * pertama. Karena Supabase adalah sumber kebenaran live, SEMUA request
 * memakai `cache: "no-store"` agar tidak pernah disajikan dari cache.
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

/**
 * Fetch yang SELALU fresh (no-store). Dipakai sebagai `global.fetch` tiap
 * client agar Next.js fetch cache tidak pernah menyajikan data Supabase
 * yang basi (lihat komentar header modul).
 */
function noStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: "no-store" });
}

export function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    ...NO_PERSIST,
    global: { fetch: noStoreFetch },
  });
}

export function getSupabaseAnon(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    ...NO_PERSIST,
    global: { fetch: noStoreFetch },
  });
}
