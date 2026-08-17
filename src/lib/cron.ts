/**
 * Job terjadwal (auto-expire order + 2 tier notifikasi voucher hampir
 * kadaluarsa). Pola yang SAMA untuk tiap job:
 *
 * 1. `runExpiryJob` — auto-expire order pending > ORDER_EXPIRY_HOURS jam
 *    (konsisten dengan field `expiry` payload Snap Midtrans) + tandai klaim
 *    voucher yang masa berlakunya lewat sebagai 'expired' + notifikasi
 *    "voucher hampir kadaluarsa" (tier 48 jam).
 * 2. `runVoucher24hJob` — pengingat H-1: notifikasi pelanggan yang
 *    vouchernya habis dalam VOUCHER_EXPIRY_24H_NOTIFY_HOURS jam ke depan
 *    (dedupe independen via `expiring_24h_notified_at`).
 * 3. `runNotificationRetryJob` — kirim ulang notifikasi WhatsApp gagal
 *    (backoff terbatas, migration 0011).
 * 4. `runMerchantDailySummaryJob` — ringkasan harian ke merchant (voucher
 *    terklaim hari ini, pendapatan, order pending; dedupe per hari via
 *    notification_logs jenis "daily_summary").
 *
 * Dua mekanisme (tidak wajib keduanya):
 * - **Vercel Cron** (produksi): `vercel.json` memanggil GET tiap route per
 *   jam; endpoint melindungi diri dengan `CRON_SECRET`. Cocok untuk
 *   serverless (setInterval tidak bertahan).
 * - **Interval lokal** (dev / self-host `next start`): `startExpiryScheduler`
 *   / `startVoucher24hScheduler` / `startNotificationRetryScheduler` /
 *   `startDailySummaryScheduler` menyalakan setInterval tiap jam di dalam
 *   proses (dimulai dari root layout; guard `globalThis` per job mencegah
 *   duplikat; `unref` agar tidak menahan proses Node).
 *
 * Konsistensi: batas waktu memakai ORDER_EXPIRY_HOURS dari `midtrans.ts`,
 * sumber yang sama dengan field `expiry` payload Snap Midtrans.
 */

import { ensureHydrated, getDB } from "./db";
import { recordCronRun, type CronJobName } from "./cron-log";
import {
  listFailedNotificationsForRetry,
  listNotificationLogs,
  NOTIFICATION_TYPE_LABEL,
  recordRetryResult,
} from "./notif-log";
import {
  expireStaleClaims,
  expireStaleOrders,
  getClaimsExpiringSoon,
  getClaimsExpiringSoon24h,
  getMerchantDailySummary,
  markClaimExpiringNotified,
  markClaimExpiring24hNotified,
} from "./service";
import {
  enqueueSend,
  normalizeToE164,
  notifyClaimExpiringSoon,
  notifyClaimExpiringSoon24h,
  notifyMerchantDailySummary,
  notifyOrderPayment,
} from "./whatsapp";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 jam

/** Berapa jam sebelum masa berlaku voucher pelanggan diingatkan (tier 48 jam). */
const VOUCHER_EXPIRY_NOTIFY_HOURS = Number(process.env.VOUCHER_EXPIRY_NOTIFY_HOURS ?? 48);
/** Berapa jam sebelum masa berlaku voucher pelanggan diingatkan (tier H-1). */
const VOUCHER_EXPIRY_24H_NOTIFY_HOURS = Number(process.env.VOUCHER_EXPIRY_24H_NOTIFY_HOURS ?? 24);

/**
 * Jalankan job terjadwal #1:
 * 1. Expire order basi + notifikasi WhatsApp "kadaluarsa" ke pelanggan.
 * 2. Kirim notifikasi "voucher hampir kadaluarsa" tier 48 jam (dedupe per
 *    klaim; hanya klaim yang belum pernah dinotifikasi tier ini).
 * Mengembalikan daftar id order yang di-expire.
 */
export async function runExpiryJob(): Promise<string[]> {
  await ensureHydrated();
  const expiredIds = expireStaleOrders();
  for (const id of expiredIds) {
    void notifyOrderPayment(id, "expired");
  }
  if (expiredIds.length > 0) {
    console.log(`[cron] auto-expire: ${expiredIds.length} order kadaluarsa (${expiredIds.join(", ")})`);
  }

  // Voucher yang masa berlakunya sudah LEWAT → tandai klaim 'expired'
  // (konsisten di voucher-saya "Hangus" & getken menolak redeem), SEBELUM
  // notifikasi "hampir kadaluarsa" agar window hanya melihat klaim aktif.
  const staleClaims = expireStaleClaims();
  if (staleClaims > 0) {
    console.log(`[cron] klaim kadaluarsa: ${staleClaims} voucher hangus`);
  }

  // Notifikasi voucher hampir kadaluarsa — hanya klaim yang belum dinotifikasi.
  const dueClaims = getClaimsExpiringSoon(VOUCHER_EXPIRY_NOTIFY_HOURS);
  let notified = 0;
  for (const c of dueClaims) {
    const ok = await notifyClaimExpiringSoon(c);
    if (ok) {
      markClaimExpiringNotified(c.id);
      notified++;
    }
  }
  if (notified > 0) {
    console.log(`[cron] notifikasi voucher hampir kadaluarsa: ${notified} klaim`);
  }
  // Rekam SATU baris per eksekusi (laporan admin Cron Jobs / Kadaluarsa):
  // selalu direkam (termasuk 0) agar "job terakhir berjalan" akurat.
  // notifiedCount = pengingat 48 jam yang dikirim job ini (kolom terisi agar
  // laporan per periode bisa menjumlah notifikasi dari SEMUA job pengingat).
  recordCronRun({
    job: "expire",
    expiredCount: expiredIds.length,
    notifiedCount: notified,
    detail: `${expiredIds.length} order di-expire, ${notified} pengingat voucher`,
  });
  return expiredIds;
}

/**
 * Jalankan job terjadwal #2 (H-1 / 24 jam): kirim pengingat ke pelanggan
 * yang vouchernya akan kadaluarsa dalam VOUCHER_EXPIRY_24H_NOTIFY_HOURS jam
 * ke depan. Dedupe independen (`expiring_24h_notified_at`) — tidak mengirim
 * ulang per jam, dan tidak terblokir oleh tier 48 jam yang sudah terkirim.
 * Mengembalikan jumlah klaim yang dinotifikasi.
 */
export async function runVoucher24hJob(): Promise<number> {
  await ensureHydrated();
  const dueClaims = getClaimsExpiringSoon24h(VOUCHER_EXPIRY_24H_NOTIFY_HOURS);
  let notified = 0;
  for (const c of dueClaims) {
    const ok = await notifyClaimExpiringSoon24h(c);
    if (ok) {
      markClaimExpiring24hNotified(c.id);
      notified++;
    }
  }
  if (notified > 0) {
    console.log(`[cron] notifikasi H-1 voucher: ${notified} klaim`);
  }
  recordCronRun({ job: "voucher-24h", notifiedCount: notified });
  return notified;
}

declare global {
  // eslint-disable-next-line no-var
  var __vshopCronStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __vshopVoucher24hStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __vshopNotifRetryStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __vshopDailySummaryStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __vshopSchedulerStats: Record<string, SchedulerStat> | undefined;
}

/**
 * Konfigurasi job retry notifikasi — dibaca LAZY (tiap run) agar bisa
 * di-override saat pengujian:
 * - `NOTIF_RETRY_MAX_ATTEMPTS` (default 3) — backoff TERBATAS per entri.
 * - `NOTIF_RETRY_BACKOFF_MS` (default 30 menit) — jarak antar percobaan
 *   ulang entri yang sama (retry pertama menunggu jarak ini sejak
 *   `last_retry_at`; entri baru menunggu `NOTIF_RETRY_MIN_AGE_MS`).
 * - `NOTIF_RETRY_MIN_AGE_MS` (default 5 menit) — umur minimum entri gagal
 *   sebelum layak (antrian in-memory whatsapp.ts sudah mengelola retry
 *   cepat; cron ini untuk resilience lintas restart/proses).
 * - `NOTIF_RETRY_BATCH` (default 10) — maks entri per run (anti-burst).
 */
function retryJobConfig() {
  return {
    maxAttempts: Number(process.env.NOTIF_RETRY_MAX_ATTEMPTS ?? 3),
    backoffMs: Number(process.env.NOTIF_RETRY_BACKOFF_MS ?? 30 * 60_000),
    minAgeMs: Number(process.env.NOTIF_RETRY_MIN_AGE_MS ?? 5 * 60_000),
    limit: Number(process.env.NOTIF_RETRY_BATCH ?? 10),
  };
}

/**
 * Job terjadwal #3: KIRIM ULANG notifikasi WhatsApp yang gagal
 * (status=failed di notification_logs) dengan backoff terbatas.
 *
 * Setiap run mengambil entri layak (retry_count < maks, jarak backoff
 * terpenuhi, umur min terpenuhi), mengirim ulang lewat antrian whatsapp
 * (teks bebas dari `message` tersimpan — template asli mungkin gagal karena
 * alasan permanen), lalu mencatat hasilnya (retry_count+1, last_retry_at,
 * status: sent/demo bila berhasil, failed + error bila gagal). Entri yang
 * melewati batas percobaan tidak dicoba lagi. Tidak pernah melempar;
 * kegagalan per entri hanya dicatat.
 */
export async function runNotificationRetryJob(): Promise<{
  retried: number;
  success: number;
  failed: number;
}> {
  const cfg = retryJobConfig();
  const { logs } = await listFailedNotificationsForRetry(cfg);
  let success = 0;
  let failed = 0;
  for (const l of logs) {
    const fallback =
      NOTIFICATION_TYPE_LABEL[l.type] ?? "Notifikasi V Shop";
    const res = await enqueueSend(l.recipient, {
      text: l.message && l.message.trim() ? l.message : fallback,
    });
    recordRetryResult(l.id, res);
    // sukses = diterima/log dicatat (delivered di mode asli, demo di mode demo).
    if (res.ok) success++;
    else failed++;
  }
  if (logs.length > 0) {
    console.log(
      `[cron] retry notifikasi: ${logs.length} dicoba (${success} sukses, ${failed} gagal)`
    );
  }
  recordCronRun({
    job: "notif-retry",
    expiredCount: logs.length,
    notifiedCount: success,
    detail: `${logs.length} dicoba (${success} sukses, ${failed} gagal)`,
  });
  return { retried: logs.length, success, failed };
}

/**
 * Job terjadwal #4: KIRIM RINGKASAN HARIAN ke setiap merchant (voucher
 * terklaim hari ini, pendapatan = nilai voucher diredeem hari ini, order
 * pending miliknya). Dedupe per merchant per HARI via `notification_logs`
 * (jenis "daily_summary", penerima E.164, sejak tengah malam) — aman
 * dipanggil berulang (Vercel Cron 1×/hari ATAU scheduler lokal tiap jam):
 * merchant hanya menerima satu ringkasan per hari. Merchant tanpa nomor
 * valid di-skip. Mengembalikan jumlah terkirim & di-skip.
 */
export async function runMerchantDailySummaryJob(now: Date = new Date()): Promise<{
  sent: number;
  skipped: number;
}> {
  await ensureHydrated();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();
  let sent = 0;
  let skipped = 0;
  for (const m of getDB().merchants) {
    const phone = normalizeToE164(m.noWAUsaha);
    if (!phone) {
      skipped++;
      continue;
    }
    // Dedupe: sudah ada log "daily_summary" untuk merchant ini sejak pagi?
    const { total } = await listNotificationLogs({
      type: "daily_summary",
      recipient: phone,
      since: dayStartIso,
      limit: 1,
    });
    if (total > 0) {
      skipped++;
      continue;
    }
    const summary = getMerchantDailySummary(m.id, now);
    const ok = await notifyMerchantDailySummary(m, summary);
    if (ok) sent++;
    else skipped++;
  }
  if (sent > 0) {
    console.log(`[cron] ringkasan harian merchant: ${sent} terkirim (${skipped} di-skip)`);
  }
  recordCronRun({
    job: "daily-summary",
    notifiedCount: sent,
    detail: `${sent} terkirim, ${skipped} di-skip (dedupe per hari)`,
  });
  return { sent, skipped };
}

/**
 * Variasi interval scheduler lokal (±ratio, default 20%) — mencegah beberapa
 * job / beberapa instance server memicu pada menit yang sama persis
 * (thundering herd). Bisa di-override env (CRON_SCHEDULER_JITTER, 0–1).
 */
const SCHEDULER_JITTER = Math.max(0, Math.min(1, Number(process.env.CRON_SCHEDULER_JITTER ?? 0.2)));

/**
 * Base backoff setelah run GAGAL (eksponensial per kegagalan beruntun,
 * dibatasi interval normal agar job tetap sesering biasanya saat sehat).
 */
const FAILURE_BACKOFF_BASE_MS = Number(process.env.CRON_FAILURE_BACKOFF_MS ?? 5 * 60_000);

/** Jitter satu interval: interval·(1±ratio). Diekspor agar bisa diuji. */
export function jitterInterval(intervalMs: number, ratio: number = SCHEDULER_JITTER): number {
  const r = Math.max(0, Math.min(1, ratio));
  return Math.round(intervalMs * (1 - r + Math.random() * 2 * r));
}

/**
 * Delay tick berikutnya saat ada kegagalan beruntun: base·2^(n-1), dibatasi
 * interval normal. Diekspor agar bisa diuji.
 */
export function failureBackoffDelay(
  intervalMs: number,
  consecutiveFailures: number,
  baseMs: number = FAILURE_BACKOFF_BASE_MS
): number {
  const n = Math.max(1, consecutiveFailures);
  return Math.min(intervalMs, baseMs * 2 ** (n - 1));
}

/**
 * Status runtime SATU scheduler lokal (untuk halaman admin Cron): kapan tick
 * terakhir berjalan, jumlah kegagalan beruntun, dan delay yang dijadwalkan
 * untuk tick berikutnya — sehingga perilaku jitter/backoff terlihat.
 * `nextDelayMs` adalah delay SAAT INI (bisa berubah setelah tiap tick).
 */
export interface SchedulerStat {
  /** Nama scheduler (sama dengan `CronJobSpec.schedulerName`). */
  name: string;
  startedAt: string | null;
  /** Waktu tick terakhir SELESAI (sukses maupun gagal). */
  lastTickAt: string | null;
  consecutiveFailures: number;
  lastStatus: "ok" | "error" | null;
  /** Delay tick berikutnya (jitter normal / backoff bila `backoff` true). */
  nextDelayMs: number | null;
  /** true = kegagalan beruntun → tick berikutnya di-backoff lebih cepat. */
  backoff: boolean;
  intervalMs: number;
}

function schedulerStatsRecord(): Record<string, SchedulerStat> {
  const g = globalThis as unknown as { __vshopSchedulerStats?: Record<string, SchedulerStat> };
  return (g.__vshopSchedulerStats ??= {});
}

/** Statistik runtime semua scheduler lokal (key = nama scheduler). */
export function getSchedulerStats(): SchedulerStat[] {
  return Object.values(schedulerStatsRecord()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Konfigurasi scheduler lokal (dari env, dibaca saat module load) untuk tampilan. */
export function getSchedulerConfig(): {
  jitterRatio: number;
  backoffBaseMs: number;
  defaultIntervalMs: number;
} {
  return {
    jitterRatio: SCHEDULER_JITTER,
    backoffBaseMs: FAILURE_BACKOFF_BASE_MS,
    defaultIntervalMs: DEFAULT_INTERVAL_MS,
  };
}

/**
 * Nyalakan scheduler per job (sekali per proses; aman dipanggil berulang).
 * Diekspor sebagai internal seam untuk pengujian (guard `globalThis`
 * terpisah per job — menyalakan ulang satu job tidak memengaruhi job lain).
 *
 * Interval memakai setTimeOut BERTINGKAT (bukan setInterval):
 * - Normal: tiap tick memakai interval dengan JITTER ±20% (interval acak
 *   per tick) — job tidak selalu memicu di menit yang sama.
 * - Gagal: tick berikutnya di-backoff LEBIH CEPAT (eksponensial per
 *   kegagalan beruntun, cap interval normal) agar error terdeteksi & dicoba
 *   lagi lebih awal; sukses mereset hitungan ke jitter normal.
 *
 * Status runtime dicatat ke `__vshopSchedulerStats` (dibaca halaman admin
 * Cron Jobs via `getSchedulerStats()`).
 */
export function startScheduler(
  name: string,
  guardKey:
    | "__vshopCronStarted"
    | "__vshopVoucher24hStarted"
    | "__vshopNotifRetryStarted"
    | "__vshopDailySummaryStarted",
  job: () => Promise<unknown>,
  intervalMs: number
): void {
  if (globalThis[guardKey]) return;
  globalThis[guardKey] = true;
  let failures = 0;
  const stats = schedulerStatsRecord()[name] ?? {
    name,
    startedAt: null,
    lastTickAt: null,
    consecutiveFailures: 0,
    lastStatus: null,
    nextDelayMs: null,
    backoff: false,
    intervalMs,
  };
  stats.startedAt ??= new Date().toISOString();
  stats.intervalMs = intervalMs;
  schedulerStatsRecord()[name] = stats;

  const schedule = (delayMs: number) => {
    stats.nextDelayMs = delayMs;
    stats.backoff = failures > 0;
    const timer = setTimeout(async () => {
      try {
        await job();
        failures = 0;
      } catch (err) {
        failures += 1;
        console.error(
          `[cron] ${name} gagal (${failures}x beruntun):`,
          err instanceof Error ? err.message : String(err)
        );
      }
      stats.lastTickAt = new Date().toISOString();
      stats.consecutiveFailures = failures;
      stats.lastStatus = failures === 0 ? "ok" : "error";
      const next = failures > 0 ? failureBackoffDelay(intervalMs, failures) : jitterInterval(intervalMs);
      schedule(next);
    }, delayMs);
    // Jangan menahan proses Node (mis. saat build / tooling).
    timer.unref?.();
  };
  schedule(intervalMs);
  console.log(
    `[cron] scheduler ${name} aktif (interval ~${Math.round(intervalMs / 60_000)} mnt ±${Math.round(
      SCHEDULER_JITTER * 100
    )}% jitter; backoff gagal ${Math.round(FAILURE_BACKOFF_BASE_MS / 1000)}s)`
  );
}

/** Nyalakan scheduler interval job auto-expire + tier 48 jam. */
export function startExpiryScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  startScheduler("auto-expire", "__vshopCronStarted", runExpiryJob, intervalMs);
}

/** Nyalakan scheduler interval job pengingat H-1 / 24 jam. */
export function startVoucher24hScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  startScheduler("voucher-H1", "__vshopVoucher24hStarted", runVoucher24hJob, intervalMs);
}

/** Nyalakan scheduler interval job retry notifikasi gagal. */
export function startNotificationRetryScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  startScheduler("notif-retry", "__vshopNotifRetryStarted", runNotificationRetryJob, intervalMs);
}

/** Nyalakan scheduler interval job ringkasan harian merchant. */
export function startDailySummaryScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  startScheduler("daily-summary", "__vshopDailySummaryStarted", runMerchantDailySummaryJob, intervalMs);
}

// ---------- Registry job (halaman admin Cron Jobs) ----------

/**
 * Deskripsi SATU job terjadwal: metadata untuk halaman admin + wrapper
 * run manual. `schedule`/`route` disinkronkan manual dengan vercel.json;
 * `run()` menormalkan hasil ke teks ringkas untuk tampilan.
 */
export interface CronJobSpec {
  key: CronJobName;
  label: string;
  description: string;
  /** Ekspresi cron (sama dengan vercel.json). */
  schedule: string;
  /** Endpoint Vercel Cron (GET). */
  route: string;
  /** Cara job dijalankan tanpa Vercel Cron (scheduler lokal). */
  localNote: string;
  /** Nama scheduler lokal (link ke `SchedulerStat`; kosong = tanpa scheduler). */
  schedulerName: string | null;
  run: () => Promise<{ ok: true; detail: string }>;
}

export const CRON_JOB_SPECS: CronJobSpec[] = [
  {
    key: "expire",
    label: "Auto-Expire Order & Voucher",
    description:
      "Expire order pending > ORDER_EXPIRY_HOURS, tandai voucher hangus, kirim pengingat voucher hampir kadaluarsa (48 jam).",
    schedule: "0 * * * *",
    route: "/api/cron/expire-orders",
    localNote: "startExpiryScheduler — tiap jam.",
    schedulerName: "auto-expire",
    run: async () => {
      const expired = await runExpiryJob();
      return { ok: true, detail: `${expired.length} order di-expire (+ pengingat voucher)` };
    },
  },
  {
    key: "voucher-24h",
    label: "Pengingat Voucher H-1",
    description: "Kirim pengingat ke pelanggan yang vouchernya habis dalam VOUCHER_EXPIRY_24H_NOTIFY_HOURS jam (dedupe per hari).",
    schedule: "30 * * * *",
    route: "/api/cron/voucher-expiring-24h",
    localNote: "startVoucher24hScheduler — tiap jam.",
    schedulerName: "voucher-H1",
    run: async () => {
      const notified = await runVoucher24hJob();
      return { ok: true, detail: `${notified} klaim dinotifikasi` };
    },
  },
  {
    key: "notif-retry",
    label: "Retry Notifikasi Gagal",
    description:
      "Kirim ulang notifikasi WhatsApp gagal (notification_logs status=failed) dengan backoff terbatas (NOTIF_RETRY_*).",
    schedule: "15 * * * *",
    route: "/api/cron/retry-notifications",
    localNote: "startNotificationRetryScheduler — tiap jam.",
    schedulerName: "notif-retry",
    run: async () => {
      const r = await runNotificationRetryJob();
      return { ok: true, detail: `${r.retried} dicoba (${r.success} sukses, ${r.failed} gagal)` };
    },
  },
  {
    key: "daily-summary",
    label: "Ringkasan Harian Merchant",
    description: "Kirim ringkasan harian (voucher terklaim, pendapatan, order pending) ke merchant via WhatsApp (dedupe per hari).",
    schedule: "0 6 * * *",
    route: "/api/cron/daily-summary",
    localNote: "startDailySummaryScheduler — tiap jam (dedupe mencegah spam).",
    schedulerName: "daily-summary",
    run: async () => {
      const r = await runMerchantDailySummaryJob();
      return { ok: true, detail: `${r.sent} terkirim, ${r.skipped} di-skip` };
    },
  },
];

/**
 * Jalankan SATU job secara manual (tombol "Jalankan Sekarang" di halaman
 * admin Cron Jobs). Tidak pernah melempar; hasil/normalisasi per job dari
 * registry. Pencatatan ke cron_runs terjadi DI DALAM tiap run*Job — manual
 * maupun terjadwal tercatat dengan cara yang sama.
 */
export async function runCronJobManual(
  key: string
): Promise<{ ok: boolean; detail?: string; error?: string }> {
  const spec = CRON_JOB_SPECS.find((s) => s.key === key);
  if (!spec) return { ok: false, error: `Job tidak dikenal: ${key}` };
  try {
    const res = await spec.run();
    return { ok: true, detail: res.detail };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
