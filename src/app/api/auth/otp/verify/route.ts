import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ensureHydrated, getDB } from "@/lib/db";
import { registerCustomer } from "@/lib/service";
import {
  createSession,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  sessionCookieOptions,
} from "@/lib/auth";
import { verifyOtp } from "@/lib/otp";
import {
  isSupabaseAuthEnabled,
  syncUserFromSupabase,
} from "@/lib/supabase-auth";
import { phoneSchema } from "@/lib/validation";
import type { User } from "@/lib/types";

const bodySchema = z.object({
  phone: phoneSchema,
  otp: z.string().min(4, "Kode OTP minimal 4 digit").max(8, "Kode OTP maksimal 8 digit"),
  purpose: z.enum(["login", "register"]).default("login"),
  name: z.string().min(2, "Nama wajib diisi").max(80).optional(),
});

/**
 * Masuk / daftar via OTP WhatsApp:
 * 1. `verifyOtp` — Supabase Auth asli (verifyOtp type "sms") atau store demo.
 * 2. Sinkronkan user aplikasi (Supabase: dari profil; demo: cari/buat via nomor).
 * 3. Buat sesi aplikasi + simpan refresh token Supabase di cookie (tahan lama).
 *
 * Fallback password tetap tersedia lewat `/api/auth/login` (UI menawarkan
 * kedua tab).
 */
export async function POST(req: Request) {
  await ensureHydrated();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }
  const { phone, otp, purpose, name } = parsed.data;
  if (purpose === "register" && !name) {
    return NextResponse.json({ ok: false, message: "Nama wajib diisi" }, { status: 400 });
  }

  const result = await verifyOtp(phone, otp);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  try {
    let user: User | null = null;

    if (isSupabaseAuthEnabled() && result.supabaseUserId) {
      // Profil di Supabase (sumber kebenaran) → cache lokal.
      user = await syncUserFromSupabase(result.supabaseUserId, name);
      if (!user) {
        return NextResponse.json(
          { ok: false, message: "Profil akun tidak ditemukan. Hubungi dukungan." },
          { status: 404 }
        );
      }
    } else {
      // Mode demo: identitas lokal via nomor (password tidak relevan).
      const digits = phone.replace(/[^0-9]/g, "");
      user =
        purpose === "register"
          ? registerCustomer({
              name: name!,
              phone,
              // Password acak — akun demo cukup lewat OTP.
              password: randomBytes(12).toString("hex"),
            })
          : (getDB().users.find(
              (u) => u.phone?.replace(/[^0-9]/g, "") === digits
            ) ?? null);
      if (!user) {
        return NextResponse.json(
          { ok: false, message: "Akun belum terdaftar. Silakan daftar terlebih dahulu." },
          { status: 400 }
        );
      }
    }

    if (result.refreshToken) {
      cookies().set(
        REFRESH_COOKIE,
        result.refreshToken,
        sessionCookieOptions(REFRESH_COOKIE_MAX_AGE)
      );
    }
    const token = await createSession(
      user.id,
      result.refreshToken
        ? { refreshToken: result.refreshToken, authUserId: result.supabaseUserId }
        : undefined
    );
    cookies().set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE));

    return NextResponse.json({ ok: true, redirect: "/paket" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal verifikasi OTP" },
      { status: 400 }
    );
  }
}
