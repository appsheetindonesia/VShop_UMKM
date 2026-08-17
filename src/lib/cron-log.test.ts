/**
 * Unit test src/lib/cron-log.ts — MODE DEMO (tanpa kredensial Supabase,
 * sebagaimana lingkungan vitest: getSupabaseAdmin() → null). Memverifikasi
 * pencatatan run job, run terakhir, dan riwayat per periode. Jalur Supabase
 * (write-through service-role) diverifikasi e2e (e2e-rls.mjs + verifikasi
 * live), bukan di unit test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeCronRun,
  expiryStaleInfo,
  getAllCronJobLastRuns,
  getCronRunHistory,
  getExpiryRunSummary,
  getLastCronRun,
  recordCronRun,
} from "./cron-log";

// ===== Mock Supabase (jalur write-through service-role) =====
const sbMock = vi.hoisted(() => {
  const state = {
    available: false,
    insertCalls: [] as unknown[],
    insertThrow: null as unknown,
    readThrow: null as unknown,
    eqCalls: [] as Array<[string, unknown]>,
    orderAsc: [] as Array<boolean | undefined>,
    limitCalls: [] as number[],
    result: { data: null as unknown, error: null as unknown },
    /** Hasil per-job (key = nilai eq job) — dipakai bila diisi; fallback ke `result`. */
    resultByJob: {} as Record<string, { data: unknown; error: unknown }>,
  };
  function client() {
    return {
      from: () => ({
        insert: async (row: unknown) => {
          state.insertCalls.push(row);
          if (state.insertThrow) throw state.insertThrow;
          return { error: null };
        },
        select: () => {
          let job: string | null = null;
          const q: any = {
            eq: (c: string, v: unknown) => {
              state.eqCalls.push([c, v]);
              if (c === "job") job = String(v);
              return q;
            },
            order: (_col: string, o: { ascending?: boolean }) => {
              state.orderAsc.push(o.ascending);
              return q;
            },
            limit: (n: number) => {
              state.limitCalls.push(n);
              return q;
            },
            then: (resolve: (v: unknown) => void) => {
              if (state.readThrow) throw state.readThrow;
              const r = job && state.resultByJob[job] ? state.resultByJob[job] : state.result;
              resolve({ data: r.data, error: r.error });
            },
          };
          return q;
        },
      }),
    };
  }
  return { state, client };
});

vi.mock("./supabase/server", () => ({
  getSupabaseAdmin: () => (sbMock.state.available ? sbMock.client() : null),
}));

beforeEach(() => {
  delete (globalThis as unknown as { __vshopCronRuns?: unknown }).__vshopCronRuns;
  sbMock.state.available = false;
  sbMock.state.insertCalls.length = 0;
  sbMock.state.insertThrow = null;
  sbMock.state.readThrow = null;
  sbMock.state.eqCalls.length = 0;
  sbMock.state.orderAsc.length = 0;
  sbMock.state.limitCalls.length = 0;
  sbMock.state.result = { data: null, error: null };
  sbMock.state.resultByJob = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordCronRun (demo)", () => {
  it("mencatat run dengan id, ranAt default, dan hitungan", async () => {
    recordCronRun({ job: "expire", expiredCount: 3, notifiedCount: 2 });
    const last = await getLastCronRun("expire");
    expect(last).not.toBeNull();
    expect(last!.id).toBeTruthy();
    expect(last!.ranAt).toBeTruthy();
    expect(last!.expiredCount).toBe(3);
    expect(last!.notifiedCount).toBe(2);
  });

  it("getLastCronRun memisahkan per job & memilih yang terbaru", async () => {
    recordCronRun({ job: "expire", expiredCount: 1, ranAt: "2026-08-16T10:00:00.000Z" });
    recordCronRun({ job: "expire", expiredCount: 5, ranAt: "2026-08-16T12:00:00.000Z" });
    recordCronRun({ job: "voucher-24h", expiredCount: 0, ranAt: "2026-08-16T11:00:00.000Z" });

    const last = await getLastCronRun("expire");
    expect(last!.expiredCount).toBe(5);
    expect(last!.ranAt).toBe("2026-08-16T12:00:00.000Z");

    const other = await getLastCronRun("voucher-24h");
    expect(other!.expiredCount).toBe(0);
  });
});

describe("getCronRunHistory (demo)", () => {
  it("mengurutkan terbaru dulu, mematuhi limit, filter per job", async () => {
    recordCronRun({ job: "expire", expiredCount: 1, ranAt: "2026-08-16T08:00:00.000Z" });
    recordCronRun({ job: "expire", expiredCount: 2, ranAt: "2026-08-16T09:00:00.000Z" });
    recordCronRun({ job: "expire", expiredCount: 3, ranAt: "2026-08-16T10:00:00.000Z" });
    recordCronRun({ job: "voucher-24h", expiredCount: 9, ranAt: "2026-08-16T10:00:00.000Z" });

    const h = await getCronRunHistory("expire", 2);
    expect(h).toHaveLength(2);
    expect(h[0].expiredCount).toBe(3);
    expect(h[1].expiredCount).toBe(2);

    const all = await getCronRunHistory("expire");
    expect(all).toHaveLength(3);
  });

  it("belum pernah berjalan → null / []", async () => {
    expect(await getLastCronRun("expire")).toBeNull();
    expect(await getCronRunHistory("expire")).toEqual([]);
  });
});

describe("recordCronRun (jalur Supabase, service-role)", () => {
  it("insert ke cron_runs dengan kolom terpetakan (fire-and-forget)", async () => {
    sbMock.state.available = true;
    recordCronRun({ job: "expire", expiredCount: 4, notifiedCount: 3, detail: "run uji", ranAt: "2026-08-16T12:00:00.000Z" });
    await new Promise((r) => setTimeout(r, 10));
    expect(sbMock.state.insertCalls).toHaveLength(1);
    const row = sbMock.state.insertCalls[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      job: "expire",
      ran_at: "2026-08-16T12:00:00.000Z",
      expired_count: 4,
      notified_count: 3,
      detail: "run uji",
    });
    expect(row.id).toBeTruthy();
  });
});

describe("getLastCronRun / getCronRunHistory (jalur Supabase)", () => {
  it("membaca run terakhir (limit 1) + mapping kolom", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: [
        {
          id: "c1",
          job: "expire",
          ran_at: "2026-08-16T12:00:00.000Z",
          expired_count: 7,
          notified_count: 0,
          detail: null,
        },
      ],
      error: null,
    };
    const last = await getLastCronRun("expire");
    expect(last).toMatchObject({ id: "c1", job: "expire", ranAt: "2026-08-16T12:00:00.000Z", expiredCount: 7 });
    expect(sbMock.state.eqCalls).toContainEqual(["job", "expire"]);
    expect(sbMock.state.orderAsc).toEqual([false]);
    expect(sbMock.state.limitCalls).toEqual([1]);
  });

  it("riwayat mematuhi limit; tanpa baris → [] / null", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: [], error: null };
    expect(await getCronRunHistory("expire", 5)).toEqual([]);
    expect(await getLastCronRun("expire")).toBeNull();
    expect(sbMock.state.limitCalls).toEqual([5, 1]);
  });

  it("error query → null / []", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: null, error: { message: "db down" } };
    expect(await getLastCronRun("expire")).toBeNull();
    expect(await getCronRunHistory("expire")).toEqual([]);
  });

  it("read melempar Error → null / [] (catch block)", async () => {
    sbMock.state.available = true;
    sbMock.state.readThrow = new Error("koneksi putus");
    expect(await getLastCronRun("expire")).toBeNull();
    expect(await getCronRunHistory("expire")).toEqual([]);
  });

  it("read melempar non-Error → String(err) di log (kedua fungsi)", async () => {
    sbMock.state.available = true;
    sbMock.state.readThrow = "boom";
    expect(await getLastCronRun("expire")).toBeNull();
    expect(await getCronRunHistory("expire")).toEqual([]);
  });

  it("data null tanpa error → fallback [] (bukan error)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: null, error: null };
    expect(await getCronRunHistory("expire")).toEqual([]);
  });

  it("mapping baris: notified_count hadir, expired_count/detail opsional", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: [
        {
          id: "c2",
          job: "expire",
          ran_at: "2026-08-16T13:00:00.000Z",
          expired_count: 7,
          notified_count: 5,
          detail: "run uji",
        },
        // Tanpa expired_count/detail → fallback 0 / undefined.
        { id: "c3", job: "expire", ran_at: "2026-08-16T14:00:00.000Z" },
      ],
      error: null,
    };
    const h = await getCronRunHistory("expire");
    expect(h[0].notifiedCount).toBe(5);
    expect(h[0].detail).toBe("run uji");
    expect(h[1].expiredCount).toBe(0);
    expect(h[1].notifiedCount).toBeUndefined();
    expect(h[1].detail).toBeUndefined();
  });

  it("insert melempar (Error maupun non-Error) → tidak menggagalkan recordCronRun", async () => {
    sbMock.state.available = true;
    sbMock.state.insertThrow = new Error("koneksi putus");
    expect(() => recordCronRun({ job: "expire", expiredCount: 1 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    sbMock.state.insertThrow = "disk penuh";
    expect(() => recordCronRun({ job: "expire", expiredCount: 2 })).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("recordCronRun (demo) — buffer overflow", () => {
  it("memangkas ke MAX_DEMO_RUNS=200", async () => {
    for (let i = 0; i < 210; i++) {
      // ranAt naik agar urutan terbaru deterministik (sort oleh ranAt).
      recordCronRun({ job: "expire", expiredCount: i, ranAt: new Date(Date.now() + i).toISOString() });
    }
    const all = await getCronRunHistory("expire", 300);
    expect(all).toHaveLength(200);
    expect(all[0].expiredCount).toBe(209); // yang terbaru tetap ada
  });
});

describe("getAllCronJobLastRuns + describeCronRun (demo)", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopCronRuns?: unknown }).__vshopCronRuns;
  });

  it("run terakhir per job (terbaru per job, bukan global)", async () => {
    recordCronRun({ job: "expire", expiredCount: 1, ranAt: "2026-08-16T10:00:00.000Z" });
    recordCronRun({ job: "expire", expiredCount: 2, ranAt: "2026-08-17T10:00:00.000Z" });
    recordCronRun({ job: "voucher-24h", notifiedCount: 3, ranAt: "2026-08-17T09:00:00.000Z" });
    recordCronRun({ job: "notif-retry", expiredCount: 5, notifiedCount: 4, ranAt: "2026-08-17T11:00:00.000Z" });

    const runs = await getAllCronJobLastRuns();
    expect(runs.expire?.ranAt).toBe("2026-08-17T10:00:00.000Z");
    expect(runs.expire?.expiredCount).toBe(2);
    expect(runs["voucher-24h"]?.notifiedCount).toBe(3);
    expect(runs["notif-retry"]?.detail).toBeUndefined();
    expect(runs["notif-retry"]?.expiredCount).toBe(5);
    // Belum pernah berjalan → null.
    expect(runs["daily-summary"]).toBeNull();
  });

  it("expiryStaleInfo: batas 26 jam + belum pernah jalan → stale", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    // Belum pernah berjalan sama sekali → stale.
    expect(expiryStaleInfo(null, now)).toEqual({ stale: true, hoursSince: null });
    // 30 jam lalu → stale + hoursSince terhitung.
    expect(expiryStaleInfo("2026-08-16T06:00:00.000Z", now)).toEqual({
      stale: true,
      hoursSince: 30,
    });
    // Persis 26 jam → TIDAK stale (stale hanya bila > 26 jam).
    expect(expiryStaleInfo("2026-08-16T10:00:00.000Z", now)).toEqual({
      stale: false,
      hoursSince: 26,
    });
    // 25 jam lalu → sehat.
    expect(expiryStaleInfo("2026-08-16T11:00:00.000Z", now).stale).toBe(false);
  });

  it("expiryStaleInfo: thresholdHours kustom dipakai bila diisi", () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    // Dengan threshold 1 jam, run 2 jam lalu → stale.
    expect(expiryStaleInfo("2026-08-17T10:00:00.000Z", now, 1)).toEqual({
      stale: true,
      hoursSince: 2,
    });
  });

  it("describeCronRun: detail lebih dulu, fallback hitungan, null → teks default", () => {
    expect(describeCronRun({ id: "x", job: "expire", ranAt: "", expiredCount: 3, detail: "3 order di-expire, 1 pengingat" })).toBe(
      "3 order di-expire, 1 pengingat"
    );
    expect(describeCronRun({ id: "x", job: "notif-retry", ranAt: "", expiredCount: 5, notifiedCount: 4 })).toBe(
      "5 entitas diproses, 4 notifikasi"
    );
    expect(describeCronRun({ id: "x", job: "expire", ranAt: "", expiredCount: 0 })).toBe("Selesai");
    expect(describeCronRun(null)).toBe("Belum pernah berjalan");
    expect(describeCronRun(undefined)).toBe("Belum pernah berjalan");
  });
});

describe("getExpiryRunSummary — ringkasan auto-expire dashboard admin", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopCronRuns?: unknown }).__vshopCronRuns;
  });

  it("menjumlahkan expiredCount + notifiedCount kedua job (48 jam & H-1) dalam 7 hari (demo)", async () => {
    const now = new Date("2026-08-17T12:00:00.000Z");
    recordCronRun({
      job: "expire",
      expiredCount: 5,
      notifiedCount: 2, // pengingat 48 jam yang dikirim run ini
      ranAt: "2026-08-17T10:00:00.000Z", // hari ini
    });
    recordCronRun({
      job: "expire",
      expiredCount: 2,
      ranAt: "2026-08-15T08:00:00.000Z", // 2 hari lalu, tanpa notifikasi
    });
    recordCronRun({
      job: "expire",
      expiredCount: 9,
      ranAt: "2026-08-08T08:00:00.000Z", // 9 hari lalu — di luar 7 hari
    });
    recordCronRun({ job: "voucher-24h", notifiedCount: 3, ranAt: "2026-08-17T09:00:00.000Z" });
    recordCronRun({ job: "voucher-24h", notifiedCount: 7, ranAt: "2026-08-07T09:00:00.000Z" }); // di luar jendela

    const s = await getExpiryRunSummary(7, now);
    expect(s.expiredTotal).toBe(7); // 5 + 2 (run 9 hari lalu diabaikan)
    expect(s.notifiedTotal).toBe(5); // 2 (48 jam) + 3 (H-1); run H-1 7 hari lalu & tanpa notify diabaikan
    expect(s.lastRunAt).toBe("2026-08-17T10:00:00.000Z");
  });

  it("belum pernah jalan → lastRunAt null dan total 0", async () => {
    const s = await getExpiryRunSummary(7, new Date());
    expect(s).toEqual({ lastRunAt: null, expiredTotal: 0, notifiedTotal: 0 });
  });

  it("jalur Supabase: akumulasi dari riwayat query kedua job (eq expire & voucher-24h, limit 500)", async () => {
    sbMock.state.available = true;
    sbMock.state.resultByJob = {
      expire: {
        data: [
          { id: "r1", job: "expire", ran_at: "2026-08-17T10:00:00.000Z", expired_count: 4, notified_count: 2, detail: null },
          { id: "r2", job: "expire", ran_at: "2026-08-10T10:00:00.000Z", expired_count: 11, notified_count: 1, detail: null },
        ],
        error: null,
      },
      "voucher-24h": {
        data: [
          { id: "h1", job: "voucher-24h", ran_at: "2026-08-17T09:00:00.000Z", expired_count: 0, notified_count: 5, detail: null },
          { id: "h2", job: "voucher-24h", ran_at: "2026-08-08T09:00:00.000Z", expired_count: 0, notified_count: 9, detail: null }, // di luar jendela
        ],
        error: null,
      },
    };
    const s = await getExpiryRunSummary(7, new Date("2026-08-17T12:00:00.000Z"));
    expect(s.expiredTotal).toBe(4); // hanya job expire, r2 (7 hari lalu tepat) di luar jendela
    expect(s.notifiedTotal).toBe(7); // 2 + 1 (expire) + 5 (H-1); h2 di luar jendela diabaikan
    expect(s.lastRunAt).toBe("2026-08-17T10:00:00.000Z");
    expect(sbMock.state.eqCalls).toContainEqual(["job", "expire"]);
    expect(sbMock.state.eqCalls).toContainEqual(["job", "voucher-24h"]);
    expect(sbMock.state.limitCalls).toEqual([500, 500]);
  });
});

describe("getAllCronJobLastRuns (jalur Supabase)", () => {
  it("satu query tanpa filter job → pilih terbaru per job", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: [
        { id: "c1", job: "daily-summary", ran_at: "2026-08-17T06:00:00.000Z", expired_count: 0, notified_count: 2, detail: "2 terkirim" },
        { id: "c2", job: "expire", ran_at: "2026-08-17T05:00:00.000Z", expired_count: 3, notified_count: 0, detail: null },
        { id: "c3", job: "expire", ran_at: "2026-08-17T04:00:00.000Z", expired_count: 1, notified_count: 0, detail: null },
        { id: "c4", job: "voucher-24h", ran_at: "2026-08-16T23:00:00.000Z", expired_count: 0, notified_count: 9, detail: null },
      ],
      error: null,
    };
    const runs = await getAllCronJobLastRuns();
    expect(runs.expire?.id).toBe("c2"); // terbaru untuk expire (bukan c3)
    expect(runs["daily-summary"]?.id).toBe("c1");
    expect(runs["voucher-24h"]?.id).toBe("c4");
    expect(runs["notif-retry"]).toBeNull();
    // Tanpa eq filter — satu query terbatas 200.
    expect(sbMock.state.eqCalls).toHaveLength(0);
    expect(sbMock.state.limitCalls).toEqual([200]);
  });

  it("error query → semua null (halaman tetap bisa render)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: null, error: { message: "db down" } };
    const runs = await getAllCronJobLastRuns();
    expect(runs.expire).toBeNull();
    expect(runs["daily-summary"]).toBeNull();
    expect(runs["notif-retry"]).toBeNull();
    expect(runs["voucher-24h"]).toBeNull();
  });
});
