import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { login } from "@/lib/service";
import {
  createSession,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  sessionCookieOptions,
} from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { isSupabaseAuthEnabled, signInSupabase } from "@/lib/supabase-auth";

const bodySchema = loginSchema.extend({
  role: z.enum(["customer", "merchant"]).optional(),
});

export async function POST(req: Request) {
  await ensureHydrated();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  const { identifier, password, role } = parsed.data;

  // Mode Supabase: verifikasi password oleh Supabase Auth (email / WhatsApp).
  const authResult = isSupabaseAuthEnabled() ? await signInSupabase(identifier, password) : null;
  const user = authResult?.user ?? login(identifier, password);
  if (!user) {
    // Pesan aman — tidak membocorkan apakah akun terdaftar (SEC)
    return NextResponse.json(
      { ok: false, message: "Email/WhatsApp atau password salah" },
      { status: 401 }
    );
  }
  if (authResult?.refreshToken) {
    cookies().set(
      REFRESH_COOKIE,
      authResult.refreshToken,
      sessionCookieOptions(REFRESH_COOKIE_MAX_AGE)
    );
  }

  if (role === "merchant" && user.role !== "merchant") {
    return NextResponse.json(
      { ok: false, message: "Akun bukan merchant. Gunakan login Pelanggan." },
      { status: 401 }
    );
  }
  if (role === "customer" && user.role === "merchant") {
    return NextResponse.json(
      { ok: false, message: "Akun ini terdaftar sebagai merchant. Gunakan login Merchant." },
      { status: 401 }
    );
  }

  const token = await createSession(
    user.id,
    authResult?.refreshToken
      ? { refreshToken: authResult.refreshToken, authUserId: authResult.user.id }
      : undefined
  );
  cookies().set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE));
  // Hapus status tamu bila ada
  cookies().delete("vshop_guest");

  const redirect =
    user.role === "admin" ? "/admin" : user.role === "merchant" ? "/merchant/dashboard" : "/beranda";
  return NextResponse.json({ ok: true, redirect });
}
