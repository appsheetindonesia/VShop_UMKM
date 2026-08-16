import { getSupabaseAdmin, getSupabaseAnon } from "./supabase/server";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "./crypto";
import {
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE_MAX_AGE,
  SESSION_TTL_MS,
} from "./session-cookies";

/**
 * Renewal sesi di SISI SERVER sebelum halaman dirender (middleware Edge).
 *
 * Modul ini TIDAK boleh mengimpor `db.ts`/`auth.ts` (mereka memakai fs dan
 * cache proses Node) — ia bekerja langsung ke Supabase (PostgREST + Auth)
 * dengan Web Crypto, sehingga aman di runtime Edge. Baris sesi baru ditulis
 * ke tabel `sessions`; cache proses Node disinkronkan oleh root layout
 * (`fetchSessionIntoCache`) pada render berikutnya.
 */

export interface RenewalOutcome {
  ok: boolean;
  /** Cookie sesi baru yang harus di-set pemanggil. */
  setSession?: { value: string; maxAge: number };
  /** Cookie refresh hasil rotasi (Supabase me-rotasi refresh token). */
  setRefresh?: { value: string; maxAge: number };
  /** Refresh token tidak valid → hapus cookie refresh. */
  clearRefresh?: boolean;
}

/** Baca refresh token terenkripsi dari baris sesi (fallback lintas perangkat). */
export async function getStoredRefreshTokenFromDb(
  sessionToken: string
): Promise<string | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data } = await sb
    .from("sessions")
    .select("sb_refresh_enc")
    .eq("token", sessionToken)
    .maybeSingle();
  if (!data?.sb_refresh_enc) return null;
  return decryptSecret(String(data.sb_refresh_enc));
}

/**
 * Perbarui sesi Supabase dari refresh token (cookie atau tersimpan), buat
 * baris sesi aplikasi baru (terenkripsi), dan kembalikan instruksi cookie.
 * Tidak pernah melempar — pemanggil (middleware) tidak boleh gagal karena
 * renewal bersifat opsional.
 */
export async function renewSessionForCookies(input: {
  sessionToken?: string;
  refreshCookie?: string;
}): Promise<RenewalOutcome> {
  try {
    let refreshToken = input.refreshCookie;
    if (!refreshToken && input.sessionToken) {
      refreshToken = (await getStoredRefreshTokenFromDb(input.sessionToken)) ?? undefined;
    }
    if (!refreshToken) return { ok: false };

    const sb = getSupabaseAnon();
    if (!sb) return { ok: false };
    const { data, error } = await sb.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.user) {
      // Token kedaluwarsa / dicabut → bersihkan cookie refresh.
      return { ok: false, clearRefresh: Boolean(input.refreshCookie) };
    }

    const rotated = data.session?.refresh_token ?? refreshToken;
    const sessionToken = crypto.randomUUID();
    const now = new Date();

    const admin = getSupabaseAdmin();
    if (admin) {
      const sbRefreshEnc = isEncryptionConfigured()
        ? await encryptSecret(rotated)
        : null;
      await admin.from("sessions").upsert(
        {
          token: sessionToken,
          user_id: data.user.id,
          created_at: now.toISOString(),
          expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
          sb_refresh_enc: sbRefreshEnc,
          sb_user_id: data.user.id,
        },
        { onConflict: "token" }
      );
    }

    return {
      ok: true,
      setSession: { value: sessionToken, maxAge: SESSION_COOKIE_MAX_AGE },
      setRefresh: { value: rotated, maxAge: REFRESH_COOKIE_MAX_AGE },
    };
  } catch {
    return { ok: false };
  }
}
