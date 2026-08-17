import { NextResponse } from "next/server";
import { runMerchantDailySummaryJob } from "@/lib/cron";

// Route handler murni (tidak boleh di-generate statis) + batas durasi
// eksekusi untuk Vercel Cron.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Endpoint cron (Vercel Cron → vercel.json, atau curl lokal) untuk
 * RINGKASAN HARIAN merchant: voucher terklaim hari ini, pendapatan, dan
 * order pending — dikirim via WhatsApp ke setiap merchant (dedupe per hari,
 * lihat `runMerchantDailySummaryJob`).
 * Proteksi: sama seperti cron lain — bila CRON_SECRET diatur, wajib header
 * `Authorization: Bearer <CRON_SECRET>` (dikirim otomatis oleh Vercel)
 * atau `x-vercel-cron: <CRON_SECRET>`.
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

  const result = await runMerchantDailySummaryJob();
  return NextResponse.json({ ok: true, ...result });
}
