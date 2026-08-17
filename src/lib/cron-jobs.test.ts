/**
 * Unit test REGISTRY job cron + eksekusi manual (halaman admin Cron Jobs):
 * CRON_JOB_SPECS (metadata: jadwal sinkron dengan vercel.json) dan
 * `runCronJobManual` (normalisasi hasil, job tak dikenal, job melempar).
 * Seam di-stub (db/service/whatsapp/notif-log/cron-log) — run*Job nyata
 * dieksekusi dengan stub, jadi pencatatan ke cron_runs ikut terverifikasi.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface WaSendResult {
  ok: boolean;
  delivered: boolean;
  error?: string;
}

const mocks = vi.hoisted(() => ({
  ensureHydrated: vi.fn<() => Promise<void>>(async () => {}),
  getDB: vi.fn<() => { merchants: Array<{ id: string; noWAUsaha: string; namaUsaha: string }> }>(
    () => ({ merchants: [] })
  ),
  recordCronRun: vi.fn<(input: { job: string; expiredCount?: number; notifiedCount?: number; detail?: string }) => void>(),
  expireStaleOrders: vi.fn<() => string[]>(() => []),
  expireStaleClaims: vi.fn<() => number>(() => 0),
  getClaimsExpiringSoon: vi.fn<() => unknown[]>(() => []),
  getClaimsExpiringSoon24h: vi.fn<() => unknown[]>(() => []),
  getMerchantDailySummary: vi.fn<() => { claimedToday: number; revenueToday: number; pendingOrders: number }>(
    () => ({ claimedToday: 0, revenueToday: 0, pendingOrders: 0 })
  ),
  markClaimExpiringNotified: vi.fn<(id: string) => void>(),
  markClaimExpiring24hNotified: vi.fn<(id: string) => void>(),
  listFailedNotificationsForRetry: vi.fn<
    () => Promise<{ logs: Array<{ id: string; recipient: string; type: string; message?: string }> }>
  >(async () => ({ logs: [] })),
  listNotificationLogs: vi.fn<
    (q?: { type?: string; recipient?: string; since?: string; limit?: number }) => Promise<{
      logs: unknown[];
      total: number;
    }>
  >(async () => ({ logs: [], total: 0 })),
  recordRetryResult: vi.fn<(id: string, res: WaSendResult) => void>(),
  enqueueSend: vi.fn<(to: string, msg: { text: string }) => Promise<WaSendResult>>(
    async () => ({ ok: true, delivered: true })
  ),
  normalizeToE164: vi.fn<(p?: string) => string | null>((p?: string) => {
    if (!p) return null;
    let d = p.replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("0")) d = `62${d.slice(1)}`;
    else if (!d.startsWith("62")) d = `62${d}`;
    return d.length >= 10 ? d : null;
  }),
  notifyClaimExpiringSoon: vi.fn<(c: unknown) => Promise<boolean>>(async () => true),
  notifyClaimExpiringSoon24h: vi.fn<(c: unknown) => Promise<boolean>>(async () => true),
  notifyMerchantDailySummary: vi.fn<
    (m: unknown, s: { claimedToday: number; revenueToday: number; pendingOrders: number }) => Promise<boolean>
  >(async () => true),
  notifyOrderPayment: vi.fn<(id: string, t: string) => Promise<void>>(async () => {}),
}));

vi.mock("./db", () => ({ ensureHydrated: mocks.ensureHydrated, getDB: mocks.getDB }));
vi.mock("./cron-log", () => ({ recordCronRun: mocks.recordCronRun }));
vi.mock("./notif-log", () => ({
  listFailedNotificationsForRetry: mocks.listFailedNotificationsForRetry,
  listNotificationLogs: mocks.listNotificationLogs,
  NOTIFICATION_TYPE_LABEL: { paid: "Pembayaran Berhasil", failed: "Pembayaran Gagal" },
  recordRetryResult: mocks.recordRetryResult,
}));
vi.mock("./service", () => ({
  expireStaleOrders: mocks.expireStaleOrders,
  expireStaleClaims: mocks.expireStaleClaims,
  getClaimsExpiringSoon: mocks.getClaimsExpiringSoon,
  getClaimsExpiringSoon24h: mocks.getClaimsExpiringSoon24h,
  getMerchantDailySummary: mocks.getMerchantDailySummary,
  markClaimExpiringNotified: mocks.markClaimExpiringNotified,
  markClaimExpiring24hNotified: mocks.markClaimExpiring24hNotified,
}));
vi.mock("./whatsapp", () => ({
  enqueueSend: mocks.enqueueSend,
  normalizeToE164: mocks.normalizeToE164,
  notifyClaimExpiringSoon: mocks.notifyClaimExpiringSoon,
  notifyClaimExpiringSoon24h: mocks.notifyClaimExpiringSoon24h,
  notifyMerchantDailySummary: mocks.notifyMerchantDailySummary,
  notifyOrderPayment: mocks.notifyOrderPayment,
}));

import { CRON_JOB_SPECS, runCronJobManual } from "./cron";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDB.mockReturnValue({ merchants: [] });
  mocks.listNotificationLogs.mockResolvedValue({ logs: [], total: 0 });
  mocks.notifyMerchantDailySummary.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CRON_JOB_SPECS — metadata (sinkron dengan vercel.json)", () => {
  it("4 job, key unik, jadwal & route sesuai vercel.json", () => {
    const keys = CRON_JOB_SPECS.map((s) => s.key);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);

    const byKey = Object.fromEntries(CRON_JOB_SPECS.map((s) => [s.key, s]));
    // vercel.json: expire-orders 0 * * * *, voucher-expiring-24h 30 * * * *,
    // retry-notifications 15 * * * *, daily-summary 0 6 * * *.
    expect(byKey.expire.schedule).toBe("0 * * * *");
    expect(byKey.expire.route).toBe("/api/cron/expire-orders");
    expect(byKey["voucher-24h"].schedule).toBe("30 * * * *");
    expect(byKey["voucher-24h"].route).toBe("/api/cron/voucher-expiring-24h");
    expect(byKey["notif-retry"].schedule).toBe("15 * * * *");
    expect(byKey["notif-retry"].route).toBe("/api/cron/retry-notifications");
    expect(byKey["daily-summary"].schedule).toBe("0 6 * * *");
    expect(byKey["daily-summary"].route).toBe("/api/cron/daily-summary");
    // Semua punya deskripsi & catatan lokal (halaman admin butuh keduanya).
    for (const s of CRON_JOB_SPECS) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
      expect(s.localNote.length).toBeGreaterThan(0);
    }
  });
});

describe("runCronJobManual", () => {
  it("expire: menjalankan runExpiryJob nyata (stub) + menormalkan hasil + MENCATAT run", async () => {
    mocks.expireStaleOrders.mockReturnValue(["ord-1", "ord-2"]);
    const res = await runCronJobManual("expire");
    expect(res).toEqual({ ok: true, detail: "2 order di-expire (+ pengingat voucher)" });
    // Pencatatan terjadi di dalam runExpiryJob (job "expire", detail lengkap).
    expect(mocks.recordCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ job: "expire", expiredCount: 2 })
    );
  });

  it("daily-summary: hitung per merchant + normalkan sent/skipped", async () => {
    mocks.getDB.mockReturnValue({
      merchants: [
        { id: "m1", noWAUsaha: "081234567890", namaUsaha: "Warung A" },
        { id: "m2", noWAUsaha: "081298765432", namaUsaha: "Kopi B" },
      ],
    });
    mocks.notifyMerchantDailySummary.mockResolvedValue(false); // kirim gagal → dihitung skipped
    const res = await runCronJobManual("daily-summary");
    expect(res).toEqual({ ok: true, detail: "0 terkirim, 2 di-skip" });
    expect(mocks.recordCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ job: "daily-summary", notifiedCount: 0 })
    );
  });

  it("notif-retry: normalkan retried/success/failed", async () => {
    mocks.listFailedNotificationsForRetry.mockResolvedValue({
      logs: [
        { id: "l1", recipient: "6281", type: "failed", message: "x" },
        { id: "l2", recipient: "6282", type: "failed", message: "y" },
      ],
    });
    mocks.enqueueSend
      .mockResolvedValueOnce({ ok: true, delivered: true })
      .mockResolvedValueOnce({ ok: false, delivered: false, error: "down" });
    const res = await runCronJobManual("notif-retry");
    expect(res).toEqual({ ok: true, detail: "2 dicoba (1 sukses, 1 gagal)" });
    expect(mocks.recordCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ job: "notif-retry", expiredCount: 2, notifiedCount: 1 })
    );
  });

  it("key tidak dikenal → { ok:false, error } tanpa menjalankan apa pun", async () => {
    const res = await runCronJobManual("backup-db");
    expect(res.ok).toBe(false);
    expect(res.error).toContain("backup-db");
    expect(mocks.recordCronRun).not.toHaveBeenCalled();
  });

  it("job melempar → { ok:false, error: pesan } (tidak pernah melempar)", async () => {
    mocks.expireStaleOrders.mockImplementation(() => {
      throw new Error("koneksi putus");
    });
    const res = await runCronJobManual("expire");
    expect(res).toEqual({ ok: false, error: "koneksi putus" });
  });

  it("voucher-24h: normalkan jumlah klaim dinotifikasi", async () => {
    mocks.getClaimsExpiringSoon24h.mockReturnValue([{ id: "c1" }, { id: "c2" }]);
    const res = await runCronJobManual("voucher-24h");
    expect(res).toEqual({ ok: true, detail: "2 klaim dinotifikasi" });
    expect(mocks.recordCronRun).toHaveBeenCalledWith(
      expect.objectContaining({ job: "voucher-24h", notifiedCount: 2 })
    );
  });
});
