import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { forgotSchema } from "@/lib/validation";
import { isSupabaseAuthEnabled, resetPasswordSupabase } from "@/lib/supabase-auth";

// Reset password: bila Supabase Auth aktif, email reset dikirim via Supabase;
// selain itu disimulasikan. Selalu balas pesan umum (tidak membocorkan apakah
// email/nomor terdaftar — SEC).
export async function POST(req: Request) {
  await ensureHydrated();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const parsed = forgotSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }
  if (isSupabaseAuthEnabled()) {
    await resetPasswordSupabase(parsed.data.identifier);
  }
  return NextResponse.json({ ok: true });
}
