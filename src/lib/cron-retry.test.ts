/**
 * Unit test orkestrasi job retry notifikasi (src/lib/cron.ts →
 * runNotificationRetryJob) dengan SEAM DI-STUB (notif-log + whatsapp):
 * memverifikasi URUTAN per entri (kirim dulu, catat hasil setelahnya),
 * pemilihan pesan (message tersimpan / fallback jenis), hitungan sukses-gagal,
 * dan tidak ada duplikat pada run berikutnya (entri yang sudah berhasil tidak
 * dikirim ulang — diputuskan upstream oleh listFailedNotificationsForRetry).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listFailedNotificationsForRetry: vi.fn(
    async (): Promise<{ logs: Array<Record<string, unknown>> }> => ({ logs: [] })
  ),
  recordRetryResult: vi.fn(),
  enqueueSend: vi.fn(
    async (): Promise<{ ok: boolean; delivered: boolean; error?: string }> => ({
      ok: true,
      delivered: true,
    })
  ),
  ensureHydrated: vi.fn(async () => {}),
}));

vi.mock("./db", () => ({ ensureHydrated: mocks.ensureHydrated }));
vi.mock("./notif-log", () => ({
  listFailedNotificationsForRetry: mocks.listFailedNotificationsForRetry,
  recordRetryResult: mocks.recordRetryResult,
  NOTIFICATION_TYPE_LABEL: { failed: "Pembayaran Gagal", paid: "Pembayaran Berhasil" },
}));
vi.mock("./service", () => ({
  expireStaleOrders: vi.fn(() => []),
  expireStaleClaims: vi.fn(() => 0),
  getClaimsExpiringSoon: vi.fn(() => []),
  getClaimsExpiringSoon24h: vi.fn(() => []),
  markClaimExpiringNotified: vi.fn(),
  markClaimExpiring24hNotified: vi.fn(),
}));
vi.mock("./whatsapp", () => ({
  enqueueSend: mocks.enqueueSend,
  notifyOrderPayment: vi.fn(async () => {}),
  notifyClaimExpiringSoon: vi.fn(async () => true),
  notifyClaimExpiringSoon24h: vi.fn(async () => true),
}));

import { runNotificationRetryJob } from "./cron";

/** Entri gagal minimal dari listFailedNotificationsForRetry. */
const failedEntry = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  recipient: "6281234567890",
  type: "failed",
  status: "failed",
  delivered: false,
  error: "HTTP 412",
  createdAt: "2026-08-16T10:00:00.000Z",
  retryCount: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listFailedNotificationsForRetry.mockResolvedValue({ logs: [] });
  mocks.enqueueSend.mockResolvedValue({ ok: true, delivered: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runNotificationRetryJob — orkestrasi (notif-log + whatsapp di-stub)", () => {
  it("urutan per entri: KIRIM dulu (pesan = message tersimpan), lalu CATAT hasil", async () => {
    mocks.listFailedNotificationsForRetry.mockResolvedValue({
      logs: [failedEntry("l1", { message: "Halo, pembayaran gagal" }), failedEntry("l2", { message: "Halo 2" })],
    });

    const result = await runNotificationRetryJob();
    expect(result).toEqual({ retried: 2, success: 2, failed: 0 });

    // Kirim dengan teks dari message tersimpan.
    expect(mocks.enqueueSend).toHaveBeenNthCalledWith(1, "6281234567890", {
      text: "Halo, pembayaran gagal",
    });
    expect(mocks.enqueueSend).toHaveBeenNthCalledWith(2, "6281234567890", {
      text: "Halo 2",
    });
    // Catat hasil SETELAH kirim, per entri (urutan invocationCallOrder).
    const s1 = mocks.enqueueSend.mock.invocationCallOrder[0];
    const r1 = mocks.recordRetryResult.mock.invocationCallOrder[0];
    const s2 = mocks.enqueueSend.mock.invocationCallOrder[1];
    const r2 = mocks.recordRetryResult.mock.invocationCallOrder[1];
    expect(s1).toBeLessThan(r1);
    expect(s2).toBeLessThan(r2);
    expect(r1).toBeLessThan(s2); // sekuensial per entri
    expect(mocks.recordRetryResult).toHaveBeenNthCalledWith(1, "l1", {
      ok: true,
      delivered: true,
    });
    expect(mocks.recordRetryResult).toHaveBeenNthCalledWith(2, "l2", {
      ok: true,
      delivered: true,
    });
  });

  it("kirim GAGAL → tetap dicatat (failed) dan dihitung gagal, tanpa melempar", async () => {
    mocks.listFailedNotificationsForRetry.mockResolvedValue({
      logs: [failedEntry("l1")],
    });
    mocks.enqueueSend.mockResolvedValue({ ok: false, delivered: false, error: "HTTP 500" });

    const result = await runNotificationRetryJob();
    expect(result).toEqual({ retried: 1, success: 0, failed: 1 });
    expect(mocks.recordRetryResult).toHaveBeenCalledWith("l1", {
      ok: false,
      delivered: false,
      error: "HTTP 500",
    });
  });

  it("pesan kosong → fallback ke label jenis notifikasi (bukan string kosong)", async () => {
    mocks.listFailedNotificationsForRetry.mockResolvedValue({
      logs: [failedEntry("l1", { message: "   " })],
    });
    await runNotificationRetryJob();
    expect(mocks.enqueueSend).toHaveBeenCalledWith("6281234567890", {
      text: "Pembayaran Gagal",
    });
  });

  it("tanpa entri layak → 0 percobaan, tidak ada kirim/catat (anti-duplikat run berikutnya)", async () => {
    mocks.listFailedNotificationsForRetry.mockResolvedValueOnce({ logs: [failedEntry("l1")] });
    await runNotificationRetryJob();
    expect(mocks.enqueueSend).toHaveBeenCalledTimes(1);

    // Run kedua: entri yang sudah sukses tidak lagi muncul di antrean.
    mocks.listFailedNotificationsForRetry.mockResolvedValueOnce({ logs: [] });
    const result = await runNotificationRetryJob();
    expect(result.retried).toBe(0);
    expect(mocks.enqueueSend).toHaveBeenCalledTimes(1); // tidak dikirim ulang
  });
});
