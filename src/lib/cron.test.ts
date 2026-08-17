/**
 * Unit test scheduler lokal (src/lib/cron.ts): jitter interval + backoff
 * saat run gagal, dan job terjadwal (auto-expire order dengan
 * ORDER_EXPIRY_HOURS kecil, notifikasi voucher hampir kadaluarsa 2 tier).
 * Timer di-fake (vi.useFakeTimers) agar deterministik; Math.random di-stub
 * supaya jitter presisi; whatsapp di-mock agar job tidak mengirim jaringan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  failureBackoffDelay,
  getSchedulerStats,
  jitterInterval,
  startExpiryScheduler,
  startScheduler,
  startVoucher24hScheduler,
} from "./cron";

// ===== Mock whatsapp untuk job terjadwal (tanpa jaringan, hitung panggilan) =====
const waMock = vi.hoisted(() => ({
  notifyOrderPayment: vi.fn(async () => {}),
  notifyClaimExpiringSoon: vi.fn(async () => true),
  notifyClaimExpiringSoon24h: vi.fn(async () => true),
}));
vi.mock("./whatsapp", () => waMock);

declare global {
  // eslint-disable-next-line no-var
  var __vshopCronStarted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __vshopVoucher24hStarted: boolean | undefined;
}

beforeEach(() => {
  delete globalThis.__vshopCronStarted;
  delete globalThis.__vshopVoucher24hStarted;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.__vshopCronStarted;
  delete globalThis.__vshopVoucher24hStarted;
});

describe("jitterInterval", () => {
  it("presisi dengan Math.random di-stub (0 / 0.5 / 1)", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(jitterInterval(60000, 0.2)).toBe(48000); // 60000·0.8
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(jitterInterval(60000, 0.2)).toBe(60000); // 60000·1.0
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(jitterInterval(60000, 0.2)).toBe(72000); // 60000·1.2
  });

  it("selalu dalam rentang ±ratio untuk banyak sampel acak", () => {
    vi.restoreAllMocks();
    for (let i = 0; i < 500; i++) {
      const d = jitterInterval(60000, 0.2);
      expect(d).toBeGreaterThanOrEqual(48000);
      expect(d).toBeLessThanOrEqual(72000);
    }
  });

  it("ratio 0 = interval tetap", () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    expect(jitterInterval(60000, 0)).toBe(60000);
  });
});

describe("failureBackoffDelay", () => {
  it("eksponensial per kegagalan beruntun, dibatasi interval normal", () => {
    // base 5 detik, interval 60 detik
    expect(failureBackoffDelay(60000, 1, 5000)).toBe(5000);
    expect(failureBackoffDelay(60000, 2, 5000)).toBe(10000);
    expect(failureBackoffDelay(60000, 3, 5000)).toBe(20000);
    expect(failureBackoffDelay(60000, 4, 5000)).toBe(40000);
    expect(failureBackoffDelay(60000, 5, 5000)).toBe(60000); // cap
    expect(failureBackoffDelay(60000, 6, 5000)).toBe(60000); // cap
    // interval kecil → cap ke interval
    expect(failureBackoffDelay(1000, 1, 300000)).toBe(1000);
  });
});

describe("startScheduler — jitter & backoff runtime", () => {
  it("sukses → tick jitter normal; gagal → tick berikutnya di-backoff cepat; sukses mereset", async () => {
    vi.useFakeTimers();
    // jitter Math.random=0.5 → interval persis (tick normal = 600000ms).
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    const calls: string[] = [];
    const job = vi.fn(async () => {
      calls.push("run");
      if (calls.length === 2) throw new Error("boom");
    });

    startScheduler("uji", "__vshopCronStarted", job, 600000); // 10 menit
    expect(calls).toHaveLength(0);

    // Tick 1 (t=600000): sukses → berikutnya jitter 600000.
    await vi.advanceTimersByTimeAsync(600000);
    expect(calls).toHaveLength(1);

    // Tick 2 (t=1_200_000): GAGAL → backoff beruntun#1 = min(600000, 300000·1) = 300000.
    await vi.advanceTimersByTimeAsync(600000);
    expect(calls).toHaveLength(2);
    // Belum waktunya tick 3 pada 299999ms setelahnya…
    await vi.advanceTimersByTimeAsync(299999);
    expect(calls).toHaveLength(2);
    // …tapi sudah terpicu pada 300000ms (lebih cepat dari interval normal).
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);

    // Tick 3 sukses → reset → berikutnya jitter normal 600000 lagi.
    await vi.advanceTimersByTimeAsync(600000);
    expect(calls).toHaveLength(4);
  });

  it("startScheduler kedua kali dengan guard yang sama diabaikan (anti-duplikat)", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const job = vi.fn(async () => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    startScheduler("uji", "__vshopCronStarted", job, 600000);
    const logsAfterFirst = logSpy.mock.calls.length;
    startScheduler("uji", "__vshopCronStarted", job, 600000); // harus diabaikan
    expect(logSpy.mock.calls.length).toBe(logsAfterFirst);
  });

  it("startExpiryScheduler & startVoucher24hScheduler memakai guard terpisah", () => {
    vi.useFakeTimers();
    vi.spyOn(console, "log").mockImplementation(() => {});
    startExpiryScheduler(600000);
    expect(globalThis.__vshopCronStarted).toBe(true);
    startVoucher24hScheduler(600000);
    expect(globalThis.__vshopVoucher24hStarted).toBe(true);
  });

  it("mencatat statistik runtime: tick terakhir, kegagalan beruntun, backoff, delay berikutnya", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    delete (globalThis as unknown as { __vshopSchedulerStats?: unknown }).__vshopSchedulerStats;
    vi.spyOn(Math, "random").mockReturnValue(0.5); // jitter → interval persis
    vi.spyOn(console, "error").mockImplementation(() => {});

    const calls: string[] = [];
    const job = vi.fn(async () => {
      calls.push("run");
      if (calls.length === 2) throw new Error("boom");
    });
    startScheduler("uji-stats", "__vshopCronStarted", job, 600000); // 10 mnt

    const stat = () => getSchedulerStats().find((x) => x.name === "uji-stats")!;
    // Mulai: tercatat, belum ada tick, delay awal = interval, tanpa backoff.
    expect(stat().startedAt).toBe("2026-08-17T12:00:00.000Z");
    expect(stat().lastTickAt).toBeNull();
    expect(stat().consecutiveFailures).toBe(0);
    expect(stat().backoff).toBe(false);
    expect(stat().nextDelayMs).toBe(600000);

    // Tick 1 sukses (t=+600000) → ok, 0 gagal, berikutnya jitter normal.
    await vi.advanceTimersByTimeAsync(600000);
    expect(stat().lastTickAt).toBe("2026-08-17T12:10:00.000Z");
    expect(stat().lastStatus).toBe("ok");
    expect(stat().consecutiveFailures).toBe(0);
    expect(stat().backoff).toBe(false);
    expect(stat().nextDelayMs).toBe(600000);

    // Tick 2 GAGAL (t=+1200000) → error, 1 gagal beruntun, backoff AKTIF,
    // delay berikutnya di-backoff lebih cepat (base 5 mnt).
    await vi.advanceTimersByTimeAsync(600000);
    expect(stat().lastTickAt).toBe("2026-08-17T12:20:00.000Z");
    expect(stat().lastStatus).toBe("error");
    expect(stat().consecutiveFailures).toBe(1);
    expect(stat().backoff).toBe(true);
    expect(stat().nextDelayMs).toBe(300000); // failureBackoffDelay(600000, 1, base 5 mnt)

    // Tick 3 sukses (t=+1500000, backoff memicu lebih cepat) → reset.
    await vi.advanceTimersByTimeAsync(300000);
    expect(stat().lastStatus).toBe("ok");
    expect(stat().consecutiveFailures).toBe(0);
    expect(stat().backoff).toBe(false);
    expect(stat().nextDelayMs).toBe(600000);
  });

  it("job melempar non-Error → dicatat sebagai kegagalan tanpa crash, tetap berlanjut", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = vi.fn(async () => {
      throw "boom"; // non-Error → String(err)
    });
    startScheduler("uji", "__vshopCronStarted", job, 600000);
    await vi.advanceTimersByTimeAsync(600000);
    expect(errSpy).toHaveBeenCalled();
    // Tick berikutnya di-backoff cepat tapi tetap berjalan.
    await vi.advanceTimersByTimeAsync(600000);
    expect(job).toHaveBeenCalledTimes(2);
  });
});

describe("runExpiryJob / runVoucher24hJob — auto-expire dengan ORDER_EXPIRY_HOURS kecil", () => {
  // Mode demo (JSON) di direktori temp + env kecil sebelum modul di-import
  // ulang (nilai ORDER_EXPIRY_HOURS kini dibaca per-panggilan — resetModules
  // dipertahankan agar seluruh state modul benar-benar segar antar-test).
  const saveEnv: Record<string, string | undefined> = {};
  let tempDir = "";

  const setEnv = (pairs: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(pairs)) {
      saveEnv[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();
  const isoAhead = (ms: number) => new Date(Date.now() + ms).toISOString();

  async function setupDemoCron() {
    vi.resetModules();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    const db = await import("./db");
    await db.ensureHydrated();
    expect(db.getStoreMode()).toBe("json");
    const cron = await import("./cron");
    return { db, cron };
  }

  /** Seed user + satu order pending (createdAt diberikan pemanggil). */
  function seedPendingOrder(db: { mutate: (fn: (d: any) => void) => void }, id: string, createdAt: string) {
    db.mutate((d: any) => {
      d.users.push({
        id: "u1", name: "Siti", phone: "081234567890",
        passwordHash: "x", role: "customer", createdAt: isoAgo(86_400_000),
      });
      d.orders.push({
        id, orderNumber: `VS-${id}`, userId: "u1", type: "package",
        items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
        totalAmount: 7000, status: "pending", paymentStatus: "pending",
        metadata: {}, createdAt,
      });
    });
  }

  /** Seed user + voucher + klaim aktif (masa berlaku `masaBerlaku`). */
  function seedClaim(db: { mutate: (fn: (d: any) => void) => void }, masaBerlaku: string, claimId = "c1") {
    db.mutate((d: any) => {
      d.users.push({
        id: "u1", name: "Siti", phone: "081234567890",
        passwordHash: "x", role: "customer", createdAt: isoAgo(86_400_000),
      });
      d.vouchers.push({
        id: "v1", merchantId: "m1", merchantName: "Warung Nusantara",
        name: "Diskon 20% Makanan", jenisVoucher: "diskon", nilai: 20000,
        minTransaksi: 100000, kuota: 100, masaBerlaku,
        maksPenggunaan: 1, syaratKetentuan: "", jumlah: 100, status: "active",
        createdAt: isoAgo(86_400_000),
      });
      d.claimedVouchers.push({
        id: claimId, voucherId: "v1", userId: "u1", kode: "VS-KODE-01",
        kodeKonfirmasi: "123456", status: "active", claimedAt: isoAgo(86_400_000),
        useCount: 0,
      });
    });
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-cron-"));
    for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      delete process.env[k];
    }
    setEnv({
      VSHOP_DATA_DIR: tempDir,
      ORDER_EXPIRY_HOURS: "0.01", // = 36 detik — batas waktu bisa diuji cepat
      VOUCHER_EXPIRY_NOTIFY_HOURS: "48",
      VOUCHER_EXPIRY_24H_NOTIFY_HOURS: "24",
    });
    waMock.notifyOrderPayment.mockClear();
    waMock.notifyClaimExpiringSoon.mockClear();
    waMock.notifyClaimExpiringSoon24h.mockClear();
    waMock.notifyClaimExpiringSoon.mockResolvedValue(true);
    waMock.notifyClaimExpiringSoon24h.mockResolvedValue(true);
  });

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("order pending > 36 detik di-expire → notifikasi expired ke pelanggan", async () => {
    const { db, cron } = await setupDemoCron();
    seedPendingOrder(db, "ord-stale", isoAgo(60_000)); // 60 detik > 36 detik

    const expired = await cron.runExpiryJob();
    expect(expired).toEqual(["ord-stale"]);
    const o = db.getDB().orders.find((x: any) => x.id === "ord-stale") as any;
    expect(o.paymentStatus).toBe("expired");
    expect(o.status).toBe("cancelled");
    expect(o.metadata.failureReason).toBe("Waktu pembayaran habis");
    expect(waMock.notifyOrderPayment).toHaveBeenCalledWith("ord-stale", "expired");
  });

  it("order muda (< 36 detik) TIDAK di-expire dan tidak dinotifikasi", async () => {
    const { db, cron } = await setupDemoCron();
    seedPendingOrder(db, "ord-fresh", isoAgo(10_000)); // 10 detik < 36 detik

    const expired = await cron.runExpiryJob();
    expect(expired).toEqual([]);
    const o = db.getDB().orders.find((x: any) => x.id === "ord-fresh") as any;
    expect(o.paymentStatus).toBe("pending");
    expect(waMock.notifyOrderPayment).not.toHaveBeenCalled();
  });

  it("fake timers: satu run end-to-end — order basi di-expire + notifikasi + cron_runs tercatat", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const { db, cron } = await setupDemoCron();
    // Seed dalam waktu fiktif: basi (60 dtk > ambang 36 dtk) + muda (10 dtk).
    db.mutate((d: any) => {
      d.users.push({
        id: "u1", name: "Siti", phone: "081234567890",
        passwordHash: "x", role: "customer",
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
      const mk = (id: string, createdAt: string) => ({
        id, orderNumber: `VS-${id}`, userId: "u1", type: "package",
        items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
        totalAmount: 7000, status: "pending", paymentStatus: "pending",
        metadata: {}, createdAt,
      });
      d.orders.push(mk("ord-stale", new Date(Date.now() - 60_000).toISOString()));
      d.orders.push(mk("ord-fresh", new Date(Date.now() - 10_000).toISOString()));
    });
    // Bersihkan run dari test sebelumnya (globalThis bertahan lintas resetModules).
    delete (globalThis as unknown as { __vshopCronRuns?: unknown }).__vshopCronRuns;

    const expired = await cron.runExpiryJob();
    // 1) Hanya order basi yang di-expire; order muda tetap pending.
    expect(expired).toEqual(["ord-stale"]);
    const o = db.getDB().orders.find((x: any) => x.id === "ord-stale") as any;
    expect(o.paymentStatus).toBe("expired");
    expect(o.metadata.failureReason).toBe("Waktu pembayaran habis");
    const fresh = db.getDB().orders.find((x: any) => x.id === "ord-fresh") as any;
    expect(fresh.paymentStatus).toBe("pending");
    // 2) Notifikasi terkirim tepat satu kali, untuk order yang di-expire.
    expect(waMock.notifyOrderPayment).toHaveBeenCalledTimes(1);
    expect(waMock.notifyOrderPayment).toHaveBeenCalledWith("ord-stale", "expired");
    // 3) cron_runs tercatat dalam run yang sama (mode demo: array in-memory).
    const { getLastCronRun } = await import("./cron-log");
    const run = await getLastCronRun("expire");
    expect(run).not.toBeNull();
    expect(run!.expiredCount).toBe(1);
    expect(run!.notifiedCount).toBe(0); // tanpa pengingat voucher di skenario ini
    expect(run!.detail).toContain("1 order di-expire");
    expect(run!.ranAt).toBe("2026-08-17T12:00:00.000Z"); // waktu fiktif
  });

  it("runExpiryJob: notifikasi voucher hampir kadaluarsa (48 jam) + dedupe", async () => {
    const { db, cron } = await setupDemoCron();
    seedClaim(db, isoAhead(24 * 3_600_000)); // kadaluarsa dalam 24 jam (< 48 jam)

    await cron.runExpiryJob();
    expect(waMock.notifyClaimExpiringSoon).toHaveBeenCalledTimes(1);
    // Dedupe: klaim sudah ditandai expiringNotifiedAt → run kedua tidak kirim ulang.
    await cron.runExpiryJob();
    expect(waMock.notifyClaimExpiringSoon).toHaveBeenCalledTimes(1);
  });

  it("runVoucher24hJob: pengingat H-1 + dedupe tier 24 jam", async () => {
    const { db, cron } = await setupDemoCron();
    seedClaim(db, isoAhead(12 * 3_600_000)); // kadaluarsa dalam 12 jam (< 24 jam)

    expect(await cron.runVoucher24hJob()).toBe(1);
    expect(waMock.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(1);
    expect(await cron.runVoucher24hJob()).toBe(0); // dedupe expiring24hNotifiedAt
    expect(waMock.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(1);
  });

  it("notifyClaimExpiringSoon gagal (false) → klaim TIDAK ditandai, dicoba lagi", async () => {
    const { db, cron } = await setupDemoCron();
    seedClaim(db, isoAhead(24 * 3_600_000)); // masuk tier 48 jam
    waMock.notifyClaimExpiringSoon.mockResolvedValue(false);

    await cron.runExpiryJob();
    expect(waMock.notifyClaimExpiringSoon).toHaveBeenCalledTimes(1);
    // Tidak ditandai → run kedua tetap mencoba mengirim ulang.
    await cron.runExpiryJob();
    expect(waMock.notifyClaimExpiringSoon).toHaveBeenCalledTimes(2);
  });

  it("order expired yang di-retry: nomor BARU + TIDAK di-expire ulang pada run berikutnya", async () => {
    const { db, cron } = await setupDemoCron();
    seedPendingOrder(db, "ord-retry", isoAgo(60_000)); // basi (> 36 dtk)

    // Run 1: order di-expire oleh cron.
    expect(await cron.runExpiryJob()).toEqual(["ord-retry"]);
    const expired = db.getDB().orders.find((x: any) => x.id === "ord-retry") as any;
    expect(expired.paymentStatus).toBe("expired");
    const oldNumber = expired.orderNumber;
    const notifyAfterRun1 = waMock.notifyOrderPayment.mock.calls.length;

    // Retry: nomor order BARU + kembali pending + anchor kadaluarsa di-reset.
    const svc = await import("./service");
    const retried = await svc.retryOrderPayment("ord-retry");
    expect(retried.paymentStatus).toBe("pending");
    expect(retried.status).toBe("pending");
    expect(retried.orderNumber).not.toBe(oldNumber);
    expect(retried.orderNumber).toMatch(/^VS-\d{8}-\d{4}$/);
    const meta = retried.metadata as Record<string, unknown>;
    expect(meta.previousOrderNumbers).toEqual([oldNumber]);
    expect(typeof meta.lastRetryAt).toBe("string");

    // Run 2: order yang baru di-retry TIDAK di-expire ulang (anchor = lastRetryAt).
    expect(await cron.runExpiryJob()).toEqual([]);
    const afterRun2 = db.getDB().orders.find((x: any) => x.id === "ord-retry") as any;
    expect(afterRun2.paymentStatus).toBe("pending");
    expect(afterRun2.status).toBe("pending");
    // Tidak ada notifikasi "expired" baru untuk order ini setelah retry.
    expect(waMock.notifyOrderPayment.mock.calls.length).toBe(notifyAfterRun1);
  });

  it("notifyClaimExpiringSoon24h gagal (false) → hasil job 0, dicoba lagi", async () => {
    const { db, cron } = await setupDemoCron();
    seedClaim(db, isoAhead(12 * 3_600_000)); // masuk tier 24 jam
    waMock.notifyClaimExpiringSoon24h.mockResolvedValue(false);

    expect(await cron.runVoucher24hJob()).toBe(0);
    expect(waMock.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(1);
    await cron.runVoucher24hJob();
    expect(waMock.notifyClaimExpiringSoon24h).toHaveBeenCalledTimes(2);
  });
});
