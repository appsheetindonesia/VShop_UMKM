import type { Metadata } from "next";
import { formatDateTime } from "@/lib/format";
import { describeCronRun, getAllCronJobLastRuns } from "@/lib/cron-log";
import { CRON_JOB_SPECS, getSchedulerConfig, getSchedulerStats } from "@/lib/cron";
import RunCronJobButton from "@/components/admin/RunCronJobButton";

/** "57 mnt" / "5 mnt" / "45 dtk" — delay tick berikutnya untuk tampilan. */
function formatDelay(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)} mnt`;
  return `${Math.round(ms / 1000)} dtk`;
}

export const metadata: Metadata = {
  title: "Cron Jobs",
};

export const dynamic = "force-dynamic";

/**
 * Halaman admin Cron Jobs: jadwal tiap job terjadwal (sama dengan
 * vercel.json), hasil run TERAKHIR (dari tabel cron_runs), dan tombol
 * "Jalankan Sekarang" untuk eksekusi manual per job (POST
 * /api/admin/cron/run). Sumber kebenaran jadwal = CRON_JOB_SPECS di
 * src/lib/cron.ts (dijaga sinkron manual dengan vercel.json).
 */
export default async function CronJobsPage() {
  const lastRuns = await getAllCronJobLastRuns();
  const stats = new Map(getSchedulerStats().map((s) => [s.name, s]));
  const sched = getSchedulerConfig();
  const hasCronSecret = Boolean(process.env.CRON_SECRET);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="chip bg-brand-100 text-brand-800">⏱️ CRON JOBS</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Cron Jobs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Jadwal, hasil terakhir, dan eksekusi manual untuk semua job terjadwal.
          </p>
        </div>
        {!hasCronSecret ? (
          <div
            role="status"
            className="max-w-xs rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800"
          >
            ⚠️ <strong>CRON_SECRET belum diatur</strong> — endpoint Vercel Cron
            tidak terproteksi (mode pengembangan) dan di Vercel Hobby cron
            berjalan terbatas. Scheduler lokal tetap aktif via root layout.
          </div>
        ) : (
          <div className="max-w-xs rounded-xl bg-emerald-50 px-4 py-3 text-xs leading-relaxed text-emerald-800">
            ✅ <strong>CRON_SECRET terisi</strong> — endpoint Vercel Cron
            terproteksi (Authorization: Bearer).
          </div>
        )}
      </div>

      <div className="rounded-xl bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
        ⚙️ Scheduler lokal: interval ~{formatDelay(sched.defaultIntervalMs)} · jitter ±
        {Math.round(sched.jitterRatio * 100)}% per tick · backoff gagal dimulai dari{" "}
        {formatDelay(sched.backoffBaseMs)} (eksponensial ×2, cap interval normal).
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CRON_JOB_SPECS.map((spec) => {
          const last = lastRuns[spec.key];
          const s = spec.schedulerName ? stats.get(spec.schedulerName) : undefined;
          const active = Boolean(s?.startedAt);
          return (
            <div key={spec.key} className="card flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-bold text-gray-900">{spec.label}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-gray-500">
                    {spec.description}
                  </p>
                </div>
                <code className="chip shrink-0 bg-gray-100 font-mono text-xs text-gray-700">
                  {spec.schedule}
                </code>
              </div>

              <dl className="space-y-1.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Run terakhir</dt>
                  <dd className="font-medium text-gray-800">
                    {last ? formatDateTime(last.ranAt) : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Hasil</dt>
                  <dd
                    className={`text-right font-medium ${
                      last ? "text-gray-800" : "text-gray-400"
                    }`}
                  >
                    {describeCronRun(last)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Scheduler lokal</dt>
                  <dd className="text-right">
                    {active ? (
                      <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                        <span aria-hidden="true">●</span> Aktif
                        {s!.backoff && (
                          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-800">
                            backoff
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-gray-400">Tidak aktif (Vercel Cron)</span>
                    )}
                  </dd>
                </div>
                {active && (
                  <>
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">Tick terakhir</dt>
                      <dd className="font-medium text-gray-800">
                        {s!.lastTickAt ? formatDateTime(s!.lastTickAt) : "belum"}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-gray-500">Kegagalan beruntun</dt>
                      <dd className="text-right">
                        <span
                          className={`inline-block rounded-full px-1.5 py-0.5 font-semibold ${
                            s!.consecutiveFailures === 0
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {s!.consecutiveFailures}
                        </span>
                        {s!.nextDelayMs !== null && (
                          <span className="ml-1.5 text-gray-500">
                            · tick berikutnya ~{formatDelay(s!.nextDelayMs)}
                            {s!.backoff ? " (lebih cepat)" : ""}
                          </span>
                        )}
                      </dd>
                    </div>
                  </>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Endpoint</dt>
                  <dd className="font-mono text-gray-700">{spec.route}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Tanpa Vercel</dt>
                  <dd className="text-right text-gray-600">{spec.localNote}</dd>
                </div>
              </dl>

              <div className="mt-auto border-t border-gray-100 pt-3">
                <RunCronJobButton jobKey={spec.key} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
