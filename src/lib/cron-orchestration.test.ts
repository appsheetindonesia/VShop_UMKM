/**
 * Unit test ORKESTRASI job terjadwal (src/lib/cron.ts) dengan SEAM DI-STUB
 * (service + whatsapp + db): berbeda dari cron.test.ts yang memakai store
 * demo nyata, file ini memverifikasi URUTAN operasi persis:
 *
 *   ensureHydrated → expireStaleOrders → notifyOrderPayment(expired) →
 *   getClaimsExpiringSoon → notifyClaimExpiringSoon → (sukses) →
 *   markClaimExpiringNotified
 *
 * plus kontrak penting: klaim hanya ditandai SETELAH notifikasi sukses, dan
 * run berikutnya tidak mengirim duplikat (mark memfilter klaim yang sudah
 * dinotifikasi).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ===== Mock service + whatsapp + db (seam yang dipakai runExpiryJob) =====
const mocks = vi.hoisted(() => ({
  ensureHydrated: vi.fn<() => Promise<void>>(async () => {}),
  getDB: vi.fn<() => { merchants: unknown[] }>(() => ({ merchants: [] })),
  expireStaleOrders: vi.fn<() => string[]>(() => []),
  expireStaleClaims: vi.fn<() => number>(() => 0),
  getClaimsExpiringSoon: vi.fn<() => unknown[]>(() => []),
  getClaimsExpiringSoon24h: vi.fn<() => unknown[]>(() => []),
  getMerchantDailySummary: vi.fn<() => { claimedToday: number; revenueToday: number; pendingOrders: number }>(
    () => ({ claimedToday: 0, revenueToday: 0, pendingOrders: 0 })
  ),
  markClaimExpiringNotified: vi.fn<(id: string) => void>(),
  markClaimExpiring24hNotified: vi.fn<(id: string) => void>(),
  notifyOrderPayment: vi.fn<(id: string, t: string) => Promise<void>>(async () => {}),
  notifyClaimExpiringSoon: vi.fn<(c: unknown) => Promise<boolean>>(async () => true),
  notifyClaimExpiringSoon24h: vi.fn<(c: unknown) => Promise<boolean>>(async () => true),
  listNotificationLogs: vi.fn<
    (q?: { type?: string; recipient?: string; since?: string; limit?: number }) => Promise<{
      logs: unknown[];
      total: number;
    }>
  >(async () => ({ logs: [], total: 0 })),
  normalizeToE164: vi.fn<(p?: string) => string | null>((p?: string) => {
    if (!p) return null;
    let d = p.replace(/\D/g, "");
    if (!d) return null;
    if (d.startsWith("0")) d = `62${d.slice(1)}`;
    else if (!d.startsWith("62")) d = `62${d}`;
    return d.length >= 10 ? d : null;
  }),
  notifyMerchantDailySummary: vi.fn<
    (m: unknown, s: { claimedToday: number; revenueToday: number; pendingOrders: number }) => Promise<boolean>
  >(async () => true),
}));

vi.mock("./db", () => ({ ensureHydrated: mocks.ensureHydrated, getDB: mocks.getDB }));
vi.mock("./service", () => ({
  expireStaleOrders: mocks.expireStaleOrders,
  expireStaleClaims: mocks.expireStaleClaims,
  getClaimsExpiringSoon: mocks.getClaimsExpiringSoon,
  getClaimsExpiringSoon24h: mocks.getClaimsExpiringSoon24h,
  getMerchantDailySummary: mocks.getMerchantDailySummary,
  markClaimExpiringNotified: mocks.markClaimExpiringNotified,
  markClaimExpiring24hNotified: mocks.markClaimExpiring24hNotified,
}));
vi.mock("./notif-log", () => ({ listNotificationLogs: mocks.listNotificationLogs }));
vi.mock("./whatsapp", () => ({
  notifyOrderPayment: mocks.notifyOrderPayment,
  notifyClaimExpiringSoon: mocks.notifyClaimExpiringSoon,
  notifyClaimExpiringSoon24h: mocks.notifyClaimExpiringSoon24h,
  normalizeToE164: mocks.normalizeToE164,
  notifyMerchantDailySummary: mocks.notifyMerchantDailySummary,
}));

import { runExpiryJob, runMerchantDailySummaryJob, runVoucher24hJob } from "./cron";

/** Klaim minimal — shape cukup untuk id klaim (semua fungsi di-stub). */
const claim = (id: string) => ({
  id,
  voucherId: "v1",
  userId: "u1",
  kode: "VS-KODE-01",
  kodeKonfirmasi: "123456",
  status: "active",
  claimedAt: "2026-08-01T00:00:00.000Z",
  useCount: 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.expireStaleOrders.mockReturnValue([]);
  mocks.getClaimsExpiringSoon.mockReturnValue([]);
  mocks.getClaimsExpiringSoon24h.mockReturnValue([]);
  mocks.notifyClaimExpiringSoon.mockResolvedValue(true);
  mocks.notifyClaimExpiringSoon24h.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runExpiryJob — orkestrasi (service + whatsapp di-stub)", () => {
  it("urutan penuh: hydrated → expire order → expire klaim → notif order → notify klaim → TANDAI", async () => {
    mocks.expireStaleOrders.mockReturnValue(["ord-1", "ord-2"]);
    const c1 = claim("c1");
    const c2 = claim("c2");
    mocks.getClaimsExpiringSoon.mockReturnValue([c1, c2]);

    const expired = await runExpiryJob();
    expect(expired).toEqual(["ord-1", "ord-2"]);

    // Hydrate sebelum expire.
    expect(mocks.ensureHydrated.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.expireStaleOrders.mock.invocationCallOrder[0]
    );
    // Klaim yang lewat masa berlaku ditandai expired SEBELUM window notifikasi
    // dihitung (agar window hanya melihat klaim aktif).
    expect(mocks.expireStaleClaims).toHaveBeenCalledTimes(1);
    expect(mocks.expireStaleClaims.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getClaimsExpiringSoon.mock.invocationCallOrder[0]
    );
    // Setiap order basi dinotifikasi 'expired' (fire-and-forget dipanggil sinkron).
    expect(mocks.notifyOrderPayment).toHaveBeenNthCalledWith(1, "ord-1", "expired");
    expect(mocks.notifyOrderPayment).toHaveBeenNthCalledWith(2, "ord-2", "expired");
    // Klaim dinotifikasi lalu DITANDAI — mark menyusul notify utk tiap klaim.
    expect(mocks.notifyClaimExpiringSoon).toHaveBeenCalledTimes(2);
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledTimes(2);
    const n1 = mocks.notifyClaimExpiringSoon.mock.invocationCallOrder[0];
    const m1 = mocks.markClaimExpiringNotified.mock.invocationCallOrder[0];
    const n2 = mocks.notifyClaimExpiringSoon.mock.invocationCallOrder[1];
    const m2 = mocks.markClaimExpiringNotified.mock.invocationCallOrder[1];
    expect(n1).toBeLessThan(m1); // notify c1 → tandai c1
    expect(n2).toBeLessThan(m2); // notify c2 → tandai c2
    expect(m1).toBeLessThan(n2); // sekuensial per klaim
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledWith("c1");
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledWith("c2");
  });

  it("tanpa order basi & tanpa klaim jatuh tempo → tidak ada notifikasi & tidak ada mark", async () => {
    await runExpiryJob();
    expect(mocks.expireStaleOrders).toHaveBeenCalledTimes(1);
    expect(mocks.expireStaleClaims).toHaveBeenCalledTimes(1); // tetap dijalankan (idempoten)
    expect(mocks.notifyOrderPayment).not.toHaveBeenCalled();
    expect(mocks.notifyClaimExpiringSoon).not.toHaveBeenCalled();
    expect(mocks.markClaimExpiringNotified).not.toHaveBeenCalled();
  });

  it("TIDAK ADA DUPLIKAT: klaim yang ditandai run 1 tidak muncul di getClaimsExpiringSoon run 2", async () => {
    const c1 = claim("c1");
    // Service nyata menyaring expiringNotifiedAt — di sini disimulasikan:
    // run 1 mengembalikan c1, run 2 (setelah mark) mengembalikan kosong.
    mocks.getClaimsExpiringSoon
      .mockReturnValueOnce([c1])
      .mockReturnValueOnce([]);

    await runExpiryJob();
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledWith("c1");

    await runExpiryJob();
    // Notifikasi & mark TIDAK diulang pada run kedua.
    expect(mocks.notifyClaimExpiringSoon).toHaveBeenCalledTimes(1);
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledTimes(1);
  });

  it("notifyClaimExpiringSoon gagal (false) → klaim TIDAK ditandai → dicoba lagi run berikutnya", async () => {
    mocks.getClaimsExpiringSoon.mockReturnValue([claim("c1")]);
    mocks.notifyClaimExpiringSoon.mockResolvedValue(false);

    await runExpiryJob();
    expect(mocks.markClaimExpiringNotified).not.toHaveBeenCalled();

    await runExpiryJob();
    expect(mocks.notifyClaimExpiringSoon).toHaveBeenCalledTimes(2); // retry
    expect(mocks.markClaimExpiringNotified).not.toHaveBeenCalled(); // tetap belum ditandai
  });

  it("klaim yang notify-nya gagal TIDAK menghalangi klaim berikutnya (loop lanjut)", async () => {
    mocks.getClaimsExpiringSoon.mockReturnValue([claim("c1"), claim("c2")]);
    mocks.notifyClaimExpiringSoon
      .mockResolvedValueOnce(false) // c1 gagal
      .mockResolvedValueOnce(true); // c2 sukses

    await runExpiryJob();
    // c2 tetap ditandai walau c1 gagal.
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledTimes(1);
    expect(mocks.markClaimExpiringNotified).toHaveBeenCalledWith("c2");
  });
});

describe("runVoucher24hJob — orkestrasi (stub)", () => {
  it("notify → tandai per klaim; run kedua tanpa duplikat (dedupe expiring24hNotifiedAt)", async () => {
    mocks.getClaimsExpiringSoon24h
      .mockReturnValueOnce([claim("c1")])
      .mockReturnValueOnce([]);

    expect(await runVoucher24hJob()).toBe(1);
    expect(mocks.notifyClaimExpiringSoon24h).toHaveBeenCalledWith(claim("c1"));
    expect(mocks.markClaimExpiring24hNotified).toHaveBeenCalledWith("c1");
    const n1 = mocks.notifyClaimExpiringSoon24h.mock.invocationCallOrder[0];
    const m1 = mocks.markClaimExpiring24hNotified.mock.invocationCallOrder[0];
    expect(n1).toBeLessThan(m1);

    expect(await runVoucher24hJob()).toBe(0);
    expect(mocks.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(1);
    expect(mocks.markClaimExpiring24hNotified).toHaveBeenCalledTimes(1);
  });

  it("notify gagal → hasil job 0 dan klaim tidak ditandai (retry run berikutnya)", async () => {
    mocks.getClaimsExpiringSoon24h.mockReturnValue([claim("c1")]);
    mocks.notifyClaimExpiringSoon24h.mockResolvedValue(false);

    expect(await runVoucher24hJob()).toBe(0);
    expect(mocks.markClaimExpiring24hNotified).not.toHaveBeenCalled();
    await runVoucher24hJob();
    expect(mocks.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(2);
  });
});

describe("runMerchantDailySummaryJob — orkestrasi (stub)", () => {
  const merchant = (id: string, noWA: string) => ({
    id,
    userId: `u-${id}`,
    namaUsaha: `Usaha ${id}`,
    kategoriUsaha: "kuliner",
    noWAUsaha: noWA,
    alamatUsaha: "Jl. Test 1",
    namaPemilik: "Pemilik",
    noWAPemilik: noWA,
    email: `${id}@test.id`,
    status: "approved",
    createdAt: "2026-08-01T00:00:00.000Z",
  });

  beforeEach(() => {
    mocks.getDB.mockReturnValue({ merchants: [] });
    mocks.listNotificationLogs.mockResolvedValue({ logs: [], total: 0 });
    mocks.getMerchantDailySummary.mockReturnValue({
      claimedToday: 3,
      revenueToday: 15000,
      pendingOrders: 1,
    });
    mocks.notifyMerchantDailySummary.mockResolvedValue(true);
    // Jalankan implementasi default (jangan bocor dari test lain).
    mocks.normalizeToE164.mockImplementation((p?: string) => {
      if (!p) return null;
      let d = p.replace(/\D/g, "");
      if (!d) return null;
      if (d.startsWith("0")) d = `62${d.slice(1)}`;
      else if (!d.startsWith("62")) d = `62${d}`;
      return d.length >= 10 ? d : null;
    });
  });

  it("kirim ke SEMUA merchant bernomor valid — summary per merchant, urutan hydrated dulu", async () => {
    mocks.getDB.mockReturnValue({ merchants: [merchant("m1", "081234567890"), merchant("m2", "6281987654321")] });

    const res = await runMerchantDailySummaryJob();
    expect(res).toEqual({ sent: 2, skipped: 0 });
    // Summary dihitung per merchant (dengan now yang sama untuk batas hari).
    expect(mocks.getMerchantDailySummary).toHaveBeenCalledTimes(2);
    expect(mocks.getMerchantDailySummary).toHaveBeenNthCalledWith(
      1,
      "m1",
      expect.any(Date)
    );
    expect(mocks.notifyMerchantDailySummary).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "m1" }),
      { claimedToday: 3, revenueToday: 15000, pendingOrders: 1 }
    );
    expect(mocks.notifyMerchantDailySummary).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "m2" }),
      expect.objectContaining({ claimedToday: 3 })
    );
    // ensureHydrated dijalankan sebelum iterasi merchant.
    expect(mocks.ensureHydrated.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.notifyMerchantDailySummary.mock.invocationCallOrder[0]
    );
  });

  it("DEDUPE per hari: merchant yang sudah dapat ringkasan hari ini di-skip", async () => {
    mocks.getDB.mockReturnValue({ merchants: [merchant("m1", "081234567890"), merchant("m2", "081298765432")] });
    // m1 sudah dikirim hari ini (log ada sejak tengah malam); m2 belum.
    mocks.listNotificationLogs.mockImplementation(async (q) => ({
      logs: [],
      total: q?.recipient === "6281234567890" ? 1 : 0,
    }));

    const res = await runMerchantDailySummaryJob();
    expect(res).toEqual({ sent: 1, skipped: 1 });
    // Query dedupe memakai jenis + penerima E.164 + since tengah malam.
    const q = mocks.listNotificationLogs.mock.calls[0][0] ?? {};
    expect(q.type).toBe("daily_summary");
    expect(q.recipient).toBe("6281234567890");
    expect(typeof q.since).toBe("string");
    // Hanya m2 yang dikirim.
    expect(mocks.notifyMerchantDailySummary).toHaveBeenCalledTimes(1);
    expect((mocks.notifyMerchantDailySummary.mock.calls[0][0] as { id: string }).id).toBe("m2");
  });

  it("nomor merchant tidak valid → skip TANPA query dedupe & tanpa kirim", async () => {
    mocks.getDB.mockReturnValue({ merchants: [merchant("m1", ""), merchant("m2", "abc")] });
    mocks.normalizeToE164.mockReturnValue(null);

    const res = await runMerchantDailySummaryJob();
    expect(res).toEqual({ sent: 0, skipped: 2 });
    expect(mocks.listNotificationLogs).not.toHaveBeenCalled();
    expect(mocks.notifyMerchantDailySummary).not.toHaveBeenCalled();
  });

  it("notify gagal → dihitung skipped; run kedua tanpa duplikat (log sudah ada)", async () => {
    mocks.getDB.mockReturnValue({ merchants: [merchant("m1", "081234567890")] });
    mocks.notifyMerchantDailySummary.mockResolvedValue(false);

    const res1 = await runMerchantDailySummaryJob();
    expect(res1).toEqual({ sent: 0, skipped: 1 });
    // Run berikutnya: log tetap belum ada (kirim gagal) → dicoba lagi.
    expect(await runMerchantDailySummaryJob()).toEqual({ sent: 0, skipped: 1 });
    expect(mocks.notifyMerchantDailySummary).toHaveBeenCalledTimes(2);
  });
});
