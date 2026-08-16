import { isSupabaseAuthEnabled, sendOtpSupabase, verifyOtpSupabase } from "./supabase-auth";

/**
 * OTP WhatsApp (one-time password) — satu antarmuka kecil untuk dua adapter:
 *
 * - **Supabase Auth** (`isSupabaseAuthEnabled()`): `signInWithOtp` /
 *   `verifyOtp` (type "sms") — SMS/WhatsApp dikirim oleh Supabase.
 * - **Mode demo** (tanpa Supabase): kode 6 digit dibuat lokal, dicatat di
 *   log server, dan dikembalikan lewat `demoCode` agar alur bisa diuji
 *   tanpa penyedia SMS (pola yang sama seperti `auth.sms.test_otp` Supabase).
 *
 * Pemanggil tidak perlu tahu adapter mana yang aktif — cukup `sendOtp` /
 * `verifyOtp`.
 */

export type OtpVerifyResult =
  | { ok: true; supabaseUserId?: string; refreshToken?: string }
  | { ok: false; message: string };

const DEMO_OTP_TTL_MS = 5 * 60 * 1000; // berlaku 5 menit

// Next.js mem-bundle tiap route handler terpisah — state modul tidak dibagi
// antar bundle. Simpan di globalThis agar send & verify berbagi store yang
// sama (pola sama seperti scheduler cron).
const g = globalThis as unknown as {
  __vshopOtpStore?: Map<string, { code: string; expiresAt: number }>;
};
const demoStore: Map<string, { code: string; expiresAt: number }> =
  (g.__vshopOtpStore ??= new Map());

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

/** Kirim OTP ke nomor WhatsApp. Demo: kode dikembalikan untuk ditampilkan. */
export async function sendOtp(phone: string): Promise<{ demoCode?: string }> {
  if (isSupabaseAuthEnabled()) {
    await sendOtpSupabase(phone);
    return {};
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  demoStore.set(normalizePhone(phone), { code, expiresAt: Date.now() + DEMO_OTP_TTL_MS });
  console.log(`[otp] mode demo — kode untuk ${phone}: ${code}`);
  return { demoCode: code };
}

/**
 * Verifikasi kode OTP. Supabase asli bila aktif; selain itu store demo
 * (sekali pakai, kedaluwarsa 5 menit).
 */
export async function verifyOtp(phone: string, code: string): Promise<OtpVerifyResult> {
  if (isSupabaseAuthEnabled()) {
    const res = await verifyOtpSupabase(phone, code);
    if (!res) return { ok: false, message: "Kode OTP salah atau kedaluwarsa" };
    return { ok: true, supabaseUserId: res.authId, refreshToken: res.refreshToken };
  }
  const entry = demoStore.get(normalizePhone(phone));
  if (!entry) {
    return { ok: false, message: "Kirim kode OTP terlebih dahulu" };
  }
  if (Date.now() > entry.expiresAt) {
    demoStore.delete(normalizePhone(phone));
    return { ok: false, message: "Kode OTP kedaluwarsa. Kirim ulang." };
  }
  if (entry.code !== code) {
    return { ok: false, message: "Kode OTP salah. Periksa kembali." };
  }
  demoStore.delete(normalizePhone(phone));
  return { ok: true };
}
