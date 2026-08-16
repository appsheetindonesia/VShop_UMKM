import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { registerCustomer, registerMerchant } from "@/lib/service";
import {
  createSession,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  sessionCookieOptions,
} from "@/lib/auth";
import { registerCustomerFields, registerMerchantFields } from "@/lib/validation";
import {
  isSupabaseAuthEnabled,
  signUpCustomerSupabase,
  signUpMerchantSupabase,
} from "@/lib/supabase-auth";

const bodySchema = z.discriminatedUnion("type", [
  registerCustomerFields.extend({ type: z.literal("customer") }),
  registerMerchantFields.extend({ type: z.literal("merchant") }),
]);

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
    const first = parsed.error.issues[0]?.message ?? "Data tidak valid";
    return NextResponse.json({ ok: false, message: first }, { status: 400 });
  }
  if (parsed.data.password !== parsed.data.confirmPassword) {
    return NextResponse.json(
      { ok: false, message: "Konfirmasi password tidak sama" },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.type === "customer") {
      // Mode Supabase: akun Auth dibuat di Supabase dengan nomor WhatsApp
      // (phone auth) — password dikelola Supabase.
      const result = isSupabaseAuthEnabled()
        ? await signUpCustomerSupabase(parsed.data)
        : null;
      const user = result?.user ?? registerCustomer(parsed.data);
      if (result?.refreshToken) {
        cookies().set(
          REFRESH_COOKIE,
          result.refreshToken,
          sessionCookieOptions(REFRESH_COOKIE_MAX_AGE)
        );
      }
      const token = await createSession(
        user.id,
        result?.refreshToken
          ? { refreshToken: result.refreshToken, authUserId: result.user.id }
          : undefined
      );
      cookies().set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE));
      return NextResponse.json({ ok: true, redirect: "/paket" });
    }

    const result = isSupabaseAuthEnabled()
      ? await signUpMerchantSupabase(parsed.data)
      : null;
    const { user } = result ?? registerMerchant(parsed.data);
    if (result?.refreshToken) {
      cookies().set(
        REFRESH_COOKIE,
        result.refreshToken,
        sessionCookieOptions(REFRESH_COOKIE_MAX_AGE)
      );
    }
    const token = await createSession(
      user.id,
      result?.refreshToken
        ? { refreshToken: result.refreshToken, authUserId: result.user.id }
        : undefined
    );
    cookies().set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_COOKIE_MAX_AGE));
    return NextResponse.json({ ok: true, redirect: "/merchant/dashboard" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
