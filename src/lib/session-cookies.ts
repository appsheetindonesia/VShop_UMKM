/**
 * Konstanta & opsi cookie sesi — modul MURNI (tanpa import db/fs/node),
 * aman dipakai di runtime mana pun termasuk middleware Edge.
 */

export const SESSION_COOKIE = "vshop_session";
export const REFRESH_COOKIE = "vshop_sb_refresh"; // refresh token Supabase Auth
export const GUEST_COOKIE = "vshop_guest";

// Sesi aplikasi tahan lama: 30 hari + rolling renewal (diperpanjang otomatis
// saat masih aktif), sehingga pengguna aktif tidak perlu login ulang.
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const SESSION_RENEW_MS = 15 * 24 * 60 * 60 * 1000; // perpanjang bila < 15 hari tersisa
const REFRESH_TTL_MS = 365 * 24 * 60 * 60 * 1000; // refresh token Supabase: 1 tahun

export const SESSION_COOKIE_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);
export const REFRESH_COOKIE_MAX_AGE = Math.floor(REFRESH_TTL_MS / 1000);

/** Opsi cookie sesi (httpOnly, secure di produksi). */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export { SESSION_RENEW_MS };
