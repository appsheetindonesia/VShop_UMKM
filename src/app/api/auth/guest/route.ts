import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ensureHydrated } from "@/lib/db";

export async function POST() {
  await ensureHydrated();
  const cookieStore = cookies();
  cookieStore.set("vshop_guest", "1", {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return NextResponse.json({ ok: true });
}
