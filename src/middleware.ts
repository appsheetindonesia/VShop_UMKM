import { NextRequest, NextResponse } from "next/server";
import {
  REFRESH_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/session-cookies";
import { renewSessionForCookies } from "@/lib/session-renew";

/**
 * Renewal sesi di SISI SERVER sebelum halaman dirender — menggantikan
 * bootstrap client (`SessionBootstrap` → `/api/auth/renew` yang menyebabkan
 * flash login).
 *
 * Strategi (semua murah — tanpa kerja saat sesi sehat):
 * - Mode demo / pengunjung anonim → langsung lewat.
 * - Sesi + refresh cookie ada → lewat (rolling renewal saat render dilakukan
 *   `getSessionUser` di server component).
 * - Sesi cookie hilang (kedaluwarsa/terhapus) ATAU refresh cookie hilang
 *   (fallback token tersimpan) → perbarui sesi Supabase, buat baris sesi
 *   baru, set cookie di respons. Halaman berikutnya sudah login — tidak ada
 *   flash. Baris sesi baru disinkronkan ke cache proses Node oleh root
 *   layout (`fetchSessionIntoCache`).
 *
 * Renewal tidak pernah menggagalkan permintaan (opsional).
 */
export async function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Renewal hanya relevan di mode Supabase (demo tidak punya refresh token).
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return res;

  const appToken = req.cookies.get(SESSION_COOKIE)?.value;
  const refreshCookie = req.cookies.get(REFRESH_COOKIE)?.value;

  // Fast path: sesi sehat.
  if (appToken && refreshCookie) return res;
  // Pengunjung tanpa sumber refresh.
  if (!appToken && !refreshCookie) return res;

  try {
    const outcome = await renewSessionForCookies({
      sessionToken: appToken,
      refreshCookie,
    });
    if (outcome.ok && outcome.setSession) {
      // Ekspos sesi baru ke server component via HEADER response (propagasi
      // header middleware → pages() lebih andal daripada mutasi request cookie
      // yang tidak konsisten antar pass render di Next 14 dev). Root layout
      // membaca header ini dan menyinkronkan baris sesi ke cache sebelum
      // render — halaman PERTAMA setelah renewal langsung login (tanpa flash).
      res.headers.set("x-vshop-new-session", outcome.setSession.value);
      res.cookies.set(
        SESSION_COOKIE,
        outcome.setSession.value,
        sessionCookieOptions(outcome.setSession.maxAge)
      );
      if (outcome.setRefresh) {
        res.cookies.set(
          REFRESH_COOKIE,
          outcome.setRefresh.value,
          sessionCookieOptions(outcome.setRefresh.maxAge)
        );
      }
    } else if (outcome.clearRefresh) {
      res.cookies.set(REFRESH_COOKIE, "", { ...sessionCookieOptions(0), maxAge: 0 });
    }
  } catch {
    // Abaikan — renewal bersifat opsional.
  }

  return res;
}

export const config = {
  // Semua rute kecuali aset statis, API, dan _next.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
