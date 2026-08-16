import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureHydrated } from "@/lib/db";
import { destroySession, REFRESH_COOKIE, SESSION_COOKIE } from "@/lib/auth";

export async function POST() {
  await ensureHydrated();
  const cookieStore = cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(REFRESH_COOKIE); // cabut refresh token Supabase
  cookieStore.delete("vshop_guest");
  return NextResponse.json({ ok: true, redirect: "/" });
}
