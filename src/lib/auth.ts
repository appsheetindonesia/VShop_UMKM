import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { getDB, isoNow, mutate, newId } from "./db";
import { decryptSecret, encryptSecret } from "./crypto";
import type { Role, User } from "./types";

// Konstanta & opsi cookie tinggal di modul murni ./session-cookies agar
// aman dipakai middleware Edge; di-re-export di sini agar import lama tetap
// berfungsi.
import {
  GUEST_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  SESSION_RENEW_MS,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from "./session-cookies";

export {
  GUEST_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  SESSION_TTL_MS,
  sessionCookieOptions,
};

/**
 * Buat sesi aplikasi baru. `sb` (opsional) menyimpan refresh token Supabase
 * Auth secara TERENKRIPSI (AES-256-GCM) di baris sesi — sehingga sesi bisa
 * dipulihkan lintas perangkat tanpa bergantung cookie `vshop_sb_refresh`.
 * Tanpa `SESSION_ENCRYPTION_KEY` terkonfigurasi, penyimpanan dilewati
 * (perilaku cookie-only; aplikasi tetap berjalan).
 */
export async function createSession(
  userId: string,
  sb?: { refreshToken: string; authUserId?: string }
): Promise<string> {
  const token = randomUUID();
  let sbRefreshEnc: string | undefined;
  if (sb) {
    try {
      sbRefreshEnc = await encryptSecret(sb.refreshToken);
    } catch {
      console.warn(
        "[auth] SESSION_ENCRYPTION_KEY belum diatur — refresh token tidak disimpan di sessions (cookie-only)."
      );
    }
  }
  mutate((db) => {
    db.sessions.push({
      token,
      userId,
      createdAt: isoNow(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      sbRefreshEnc,
      sbUserId: sb?.authUserId,
    });
    // bersihkan sesi kedaluwarsa
    db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > Date.now());
  });
  return token;
}

/**
 * Baca refresh token Supabase yang tersimpan (terenkripsi) di baris sesi
 * (dari cache proses Node). Dipakai sebagai fallback saat cookie refresh
 * hilang (pemulihan lintas perangkat); versi Edge-nya ada di
 * `session-renew.ts` (`getStoredRefreshTokenFromDb`). Null bila tidak
 * tersimpan / tidak bisa didekripsi.
 */
export async function getStoredSbRefreshToken(sessionToken: string): Promise<string | null> {
  const session = getDB().sessions.find((s) => s.token === sessionToken);
  if (!session?.sbRefreshEnc) return null;
  return decryptSecret(session.sbRefreshEnc);
}

export function destroySession(token: string): void {
  mutate((db) => {
    db.sessions = db.sessions.filter((s) => s.token !== token);
  });
}

/**
 * Ambil user dari cookie sesi; null bila tidak login / sesi kedaluwarsa.
 * Rolling renewal: saat sisa masa berlaku kurang dari ambang, sesi diperpanjang
 * otomatis (sesi aktif tidak pernah kedaluwarsa).
 */
export function getSessionUser(): User | null {
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDB();
  const session = db.sessions.find(
    (s) => s.token === token && new Date(s.expiresAt).getTime() > Date.now()
  );
  if (!session) return null;
  // Perpanjang bila mendekati kedaluwarsa (rolling).
  if (new Date(session.expiresAt).getTime() - Date.now() < SESSION_RENEW_MS) {
    mutate((d) => {
      const s = d.sessions.find((x) => x.token === token);
      if (s) s.expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    });
  }
  return db.users.find((u) => u.id === session.userId) ?? null;
}

export function isGuest(): boolean {
  return cookies().get(GUEST_COOKIE)?.value === "1";
}

export function canBrowseShop(user: User | null, guest: boolean): boolean {
  return !!user || guest;
}

/**
 * Guard untuk halaman yang butuh role tertentu (mirip middleware + RLS).
 * Dipanggil dari server component / layout; redirect bila tidak berhak.
 */
export function requireRole(roles: Role[]): User {
  const user = getSessionUser();
  if (!user) redirect(`/masuk?redirect=${encodeURIComponent("/")}`);
  if (!roles.includes(user.role)) {
    if (user.role === "admin") redirect("/admin");
    if (user.role === "merchant") redirect("/merchant/dashboard");
    redirect("/beranda");
  }
  return user;
}

export function redirectIfLoggedIn(): void {
  const user = getSessionUser();
  if (user) {
    if (user.role === "admin") redirect("/admin");
    if (user.role === "merchant") redirect("/merchant/dashboard");
    redirect("/beranda");
  }
}

export function currentUserOrNull(): User | null {
  return getSessionUser();
}

export function makeGuestId(): string {
  return `guest_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export function newUserId(): string {
  return newId("usr");
}
