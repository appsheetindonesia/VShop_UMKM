/**
 * Riwayat run job terjadwal (cron) — telemetri untuk laporan admin.
 *
 * Satu baris per EKSEKUSI job (bukan per order): kapan job terakhir
 * berjalan (`getLastCronRun`) dan berapa entitas yang diproses per
 * periode (`getCronRunHistory`). Contoh: job `expire` merekam berapa
 * order yang di-expire tiap run auto-expire.
 *
 * - Mode Supabase: ditulis ke tabel `cron_runs` via service-role
 *   (fire-and-forget, tidak pernah melempar) dan dibaca LANGSUNG dari
 *   Postgres (telemetri murni, tidak ikut cache/write-through db.ts).
 * - Mode demo (tanpa Supabase): disimpan di array in-memory (globalThis)
 *   agar laporan admin tetap berfungsi tanpa kredensial.
 *
 * Pola sama dengan `notif-log.ts` (tabel append-only + RLS default deny).
 */

import { getSupabaseAdmin } from "./supabase/server";

/** Nama job terjadwal yang direkam. */
export type CronJobName = "expire" | "voucher-24h" | "notif-retry" | "daily-summary";

export interface CronRunEntry {
  id: string;
  job: CronJobName;
  /** Waktu eksekusi job (ISO). */
  ranAt: string;
  /** Jumlah entitas yang diproses (mis. order yang di-expire). */
  expiredCount: number;
  /** Jumlah notifikasi terkirim selama run (opsional). */
  notifiedCount?: number;
  /** Keterangan tambahan (opsional). */
  detail?: string;
}

export type CronRunInput = Omit<CronRunEntry, "id" | "ranAt" | "expiredCount"> & {
  /** Default: sekarang. */
  ranAt?: string;
  /** Jumlah entitas yang diproses (default 0 — tidak semua job punya). */
  expiredCount?: number;
};

const MAX_DEMO_RUNS = 200;

declare global {
  // eslint-disable-next-line no-var
  var __vshopCronRuns: CronRunEntry[] | undefined;
}

function demoRuns(): CronRunEntry[] {
  if (!globalThis.__vshopCronRuns) globalThis.__vshopCronRuns = [];
  return globalThis.__vshopCronRuns;
}

/**
 * Catat satu eksekusi job. Fire-and-forget: kegagalan menulis log tidak
 * boleh mengganggu alur job (pola sama seperti recordNotificationLog).
 */
export function recordCronRun(input: CronRunInput): void {
  const entry: CronRunEntry = {
    id: `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    ranAt: input.ranAt ?? new Date().toISOString(),
    job: input.job,
    expiredCount: input.expiredCount ?? 0,
    notifiedCount: input.notifiedCount,
    detail: input.detail,
  };

  const sb = getSupabaseAdmin();
  if (sb) {
    void (async () => {
      try {
        await sb.from("cron_runs").insert({
          id: entry.id,
          job: entry.job,
          ran_at: entry.ranAt,
          expired_count: entry.expiredCount,
          notified_count: entry.notifiedCount ?? 0,
          detail: entry.detail ? entry.detail.slice(0, 500) : null,
        });
      } catch (err) {
        console.error(
          "[cron-log] gagal menulis run ke Supabase:",
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
    return;
  }

  // Mode demo: simpan di memori proses.
  const runs = demoRuns();
  runs.push(entry);
  if (runs.length > MAX_DEMO_RUNS) runs.splice(0, runs.length - MAX_DEMO_RUNS);
}

function rowToEntry(r: Record<string, unknown>): CronRunEntry {
  return {
    id: String(r.id),
    job: String(r.job) as CronJobName,
    ranAt: String(r.ran_at),
    expiredCount: Number(r.expired_count ?? 0),
    notifiedCount: r.notified_count ? Number(r.notified_count) : undefined,
    detail: r.detail ? String(r.detail) : undefined,
  };
}

/** Run TERAKHIR untuk sebuah job (null bila belum pernah berjalan). */
export async function getLastCronRun(job: CronJobName): Promise<CronRunEntry | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("cron_runs")
        .select("id,job,ran_at,expired_count,notified_count,detail")
        .eq("job", job)
        .order("ran_at", { ascending: false })
        .limit(1);
      if (error) {
        console.error("[cron-log] gagal baca run terakhir:", error.message);
        return null;
      }
      const row = data?.[0];
      return row ? rowToEntry(row as Record<string, unknown>) : null;
    } catch (err) {
      console.error("[cron-log] error baca run terakhir:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  const runs = [...demoRuns()]
    .filter((r) => r.job === job)
    .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime());
  return runs[0] ?? null;
}

/** Riwayat run terbaru-dulu (maks `limit` baris) untuk laporan per periode. */
export async function getCronRunHistory(
  job: CronJobName,
  limit: number = 30
): Promise<CronRunEntry[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("cron_runs")
        .select("id,job,ran_at,expired_count,notified_count,detail")
        .eq("job", job)
        .order("ran_at", { ascending: false })
        .limit(limit);
      if (error) {
        console.error("[cron-log] gagal baca riwayat:", error.message);
        return [];
      }
      return (data ?? []).map((r) => rowToEntry(r as Record<string, unknown>));
    } catch (err) {
      console.error("[cron-log] error baca riwayat:", err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  return [...demoRuns()]
    .filter((r) => r.job === job)
    .sort((a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime())
    .slice(0, limit);
}

export interface ExpiryRunSummary {
  /** Waktu run terakhir job `expire` (null = belum pernah berjalan). */
  lastRunAt: string | null;
  /** Total order yang di-expire dalam `days` hari terakhir (semua run). */
  expiredTotal: number;
  /** Total pengingat voucher terkirim dalam `days` hari terakhir — menjumlah
   * `notified_count` dari job `expire` (tier 48 jam) DAN `voucher-24h`
   * (tier H-1), sehingga laporan per periode mencakup kedua job pengingat. */
  notifiedTotal: number;
}

/**
 * Ringkasan job auto-expire untuk dashboard admin (statistik utama): kapan
 * terakhir jalan + total order di-expire dalam N hari terakhir. Riwayat
 * diambil terbaru-dulu, lalu diakumulasi run dalam jendela. Murni & mudah
 * diuji; `now` bisa di-override untuk batas periode.
 */
export async function getExpiryRunSummary(
  days: number = 7,
  now: Date = new Date()
): Promise<ExpiryRunSummary> {
  const cutoff = now.getTime() - days * 86_400_000;
  const [expireHistory, remindHistory] = await Promise.all([
    getCronRunHistory("expire", 500),
    getCronRunHistory("voucher-24h", 500),
  ]);
  let expiredTotal = 0;
  let notifiedTotal = 0;
  for (const r of expireHistory) {
    if (new Date(r.ranAt).getTime() >= cutoff) {
      expiredTotal += r.expiredCount;
      notifiedTotal += r.notifiedCount ?? 0;
    }
  }
  // Job H-1 mencatat notified_count-nya sendiri — jumlahkan agar laporan
  // per periode mencakup kedua tier pengingat.
  for (const r of remindHistory) {
    if (new Date(r.ranAt).getTime() >= cutoff) {
      notifiedTotal += r.notifiedCount ?? 0;
    }
  }
  return {
    // Riwayat terbaru-dulu → entri pertama adalah run terakhir (null bila kosong).
    lastRunAt: expireHistory[0]?.ranAt ?? null,
    expiredTotal,
    notifiedTotal,
  };
}

/**
 * Deteksi cron mati: auto-expire dianggap stale bila run terakhir lebih dari
 * `thresholdHours` jam lalu (default 26 — jadwal job tiap jam, jadi 26 jam
 * memberi toleransi ~1 run terlewat) atau belum pernah berjalan sama sekali.
 * Murni & sinkron — mudah diuji.
 */
export function expiryStaleInfo(
  lastRunAt: string | null,
  now: Date = new Date(),
  thresholdHours: number = 26
): { stale: boolean; hoursSince: number | null } {
  if (!lastRunAt) return { stale: true, hoursSince: null };
  const hoursSince = (now.getTime() - new Date(lastRunAt).getTime()) / 3_600_000;
  return { stale: hoursSince > thresholdHours, hoursSince };
}

/**
 * Teks ringkas hasil sebuah run untuk tampilan (detail lebih dulu; fallback
 * dari kolom hitungan). Murni & sinkron — mudah diuji.
 */
export function describeCronRun(entry: CronRunEntry | null | undefined): string {
  if (!entry) return "Belum pernah berjalan";
  if (entry.detail && entry.detail.trim()) return entry.detail;
  const parts: string[] = [];
  if (entry.expiredCount > 0) parts.push(`${entry.expiredCount} entitas diproses`);
  if (entry.notifiedCount) parts.push(`${entry.notifiedCount} notifikasi`);
  return parts.length > 0 ? parts.join(", ") : "Selesai";
}

/**
 * Run TERAKHIR per job (untuk halaman admin Cron Jobs). Satu query: ambil
 * ~200 run terbaru, ambil yang paling baru untuk tiap job. Kosong/error →
 * map dengan nilai null (job belum pernah berjalan).
 */
export async function getAllCronJobLastRuns(): Promise<Record<CronJobName, CronRunEntry | null>> {
  const empty = (): Record<CronJobName, CronRunEntry | null> => ({
    expire: null,
    "voucher-24h": null,
    "notif-retry": null,
    "daily-summary": null,
  });

  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const { data, error } = await sb
        .from("cron_runs")
        .select("id,job,ran_at,expired_count,notified_count,detail")
        .order("ran_at", { ascending: false })
        .limit(200);
      if (error) {
        console.error("[cron-log] gagal baca run terakhir per job:", error.message);
        return empty();
      }
      const out = empty();
      const seen = new Set<string>();
      for (const r of data ?? []) {
        const job = String(r.job) as CronJobName;
        if (job in out && !seen.has(job)) {
          out[job] = rowToEntry(r as Record<string, unknown>);
          seen.add(job);
        }
      }
      return out;
    } catch (err) {
      console.error(
        "[cron-log] error baca run terakhir per job:",
        err instanceof Error ? err.message : String(err)
      );
      return empty();
    }
  }

  const runs = [...demoRuns()].sort(
    (a, b) => new Date(b.ranAt).getTime() - new Date(a.ranAt).getTime()
  );
  const out = empty();
  for (const r of runs) {
    if (r.job in out && out[r.job] === null) out[r.job] = r;
  }
  return out;
}
