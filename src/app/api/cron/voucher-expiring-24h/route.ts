import { NextResponse } from "next/server";
import { runVoucher24hJob } from "@/lib/cron";

// Route handler murni (tidak boleh di-generate statis) + batas durasi
// eksekusi untuk Vercel Cron.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint cron "pengingat H-1" (Vercel Cron → vercel.json, atau curl
 * lokal): kirim WhatsApp ke pelanggan yang vouchernya akan kadaluarsa
 * dalam VOUCHER_EXPIRY_24H_NOTIFY_HOURS jam ke depan (default 24 jam).
 * Proteksi sama dengan /api/cron/expire-orders: bila CRON_SECRET diatur,
 * wajib header `Authorization: Bearer <CRON_SECRET>` (dikirim otomatis
 * oleh Vercel) atau header `x-vercel-cron: <CRON_SECRET>`.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const cronHeader = req.headers.get("x-vercel-cron");
    const authorized = auth === `Bearer ${secret}` || cronHeader === secret;
    if (!authorized) {
      return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn("[cron] CRON_SECRET belum diatur — endpoint tanpa proteksi (hanya untuk pengembangan)");
  }

  const notified = await runVoucher24hJob();
  return NextResponse.json({ ok: true, notified, notifiedCount: notified });
}
