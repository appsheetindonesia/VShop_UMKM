import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { sendOtp } from "@/lib/otp";
import { phoneSchema } from "@/lib/validation";

const bodySchema = z.object({
  phone: phoneSchema,
});

/** Kirim kode OTP WhatsApp (Supabase Auth phone; demo: kode dikembalikan). */
export async function POST(req: Request) {
  await ensureHydrated();
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Nomor tidak valid" },
      { status: 400 }
    );
  }
  try {
    const { demoCode } = await sendOtp(parsed.data.phone);
    return NextResponse.json({ ok: true, demoCode });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal mengirim OTP" },
      { status: 400 }
    );
  }
}
