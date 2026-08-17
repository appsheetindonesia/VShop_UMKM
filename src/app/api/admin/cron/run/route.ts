import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { CRON_JOB_SPECS, runCronJobManual } from "@/lib/cron";

export const dynamic = "force-dynamic";

/**
 * Jalankan SATU job cron SECARA MANUAL dari halaman admin Cron Jobs
 * (POST /api/admin/cron/run, body { job }). Guard admin (sama seperti route
 * admin lain); hanya job yang terdaftar di CRON_JOB_SPECS yang diterima.
 * Hasil per-job dicatat ke cron_runs DI DALAM run*Job — manual maupun
 * terjadwal tercatat identik.
 */
export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  let body: { job?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const job = typeof body?.job === "string" ? body.job : "";
  if (!job) {
    return NextResponse.json({ ok: false, message: "Field job wajib diisi" }, { status: 400 });
  }
  if (!CRON_JOB_SPECS.some((s) => s.key === job)) {
    return NextResponse.json(
      { ok: false, message: `Job tidak dikenal: ${job}` },
      { status: 400 }
    );
  }

  const result = await runCronJobManual(job);
  return NextResponse.json({ ok: result.ok, job, detail: result.detail, message: result.error });
}
