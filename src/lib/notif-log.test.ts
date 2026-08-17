/**
 * Unit test src/lib/notif-log.ts — MODE DEMO (tanpa kredensial Supabase,
 * sebagaimana lingkungan vitest: getSupabaseAdmin() → null). Memverifikasi
 * pencatatan append-only, pengurutan terbaru-dulu, dan filter kueri.
 * Jalur Supabase (write-through service-role) diverifikasi e2e (e2e-rls.mjs
 * + verifikasi live), bukan di unit test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  csvCell,
  listFailedNotificationsForRetry,
  listNotificationLogs,
  notificationsToCsv,
  recordNotificationLog,
  recordRetryResult,
  summarizeNotificationLogs,
  type NotificationLogEntry,
} from "./notif-log";

// ===== Mock Supabase (jalur write-through service-role) =====
const sbMock = vi.hoisted(() => {
  const state = {
    available: false,
    insertCalls: [] as unknown[],
    insertError: false,
    insertThrow: null as unknown,
    readThrow: null as unknown,
    eqCalls: [] as Array<[string, unknown]>,
    inCalls: [] as Array<[string, unknown[]]>,
    ltCalls: [] as Array<[string, unknown]>,
    gteCalls: [] as Array<[string, unknown]>,
    orCalls: [] as string[],
    updateCalls: [] as Record<string, unknown>[],
    singleData: null as Record<string, unknown> | null,
    headMode: false,
    headCounts: {} as Record<string, number>,
    orderAsc: [] as Array<boolean | undefined>,
    limitCalls: [] as number[],
    result: { data: null as unknown, error: null as unknown, count: undefined as number | undefined },
  };
  function client() {
    return {
      from: () => ({
        insert: async (row: unknown) => {
          state.insertCalls.push(row);
          if (state.insertThrow) throw state.insertThrow;
          if (state.insertError) return { error: { message: "insert gagal" } };
          return { error: null };
        },
        update: async (row: Record<string, unknown>) => {
          state.updateCalls.push(row);
          return { error: null };
        },
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          state.headMode = Boolean(opts?.head);
          const eqs: Array<[string, unknown]> = [];
          const q: any = {
            eq: (c: string, v: unknown) => {
              eqs.push([c, v]);
              state.eqCalls.push([c, v]);
              return q;
            },
            in: (c: string, v: unknown[]) => {
              state.inCalls.push([c, v]);
              return q;
            },
            lt: (c: string, v: unknown) => {
              state.ltCalls.push([c, v]);
              return q;
            },
            gte: (c: string, v: unknown) => {
              state.gteCalls.push([c, v]);
              return q;
            },
            or: (s: string) => {
              state.orCalls.push(s);
              return q;
            },
            single: () => ({
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: state.singleData, error: null }),
            }),
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
              if (state.headMode) {
                const key = eqs
                  .filter(([c]) => c === "status")
                  .map(([, v]) => String(v))
                  .join(",");
                resolve({ data: null, error: null, count: state.headCounts[key] ?? 0 });
                return;
              }
              resolve({ data: state.result.data, error: state.result.error, count: state.result.count });
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
  // Bersihkan holder in-memory antar-test (globalThis milik modul).
  delete (globalThis as unknown as { __vshopNotifLogs?: unknown }).__vshopNotifLogs;
  sbMock.state.available = false;
  sbMock.state.insertCalls.length = 0;
  sbMock.state.insertError = false;
  sbMock.state.insertThrow = null;
  sbMock.state.readThrow = null;
  sbMock.state.eqCalls.length = 0;
  sbMock.state.inCalls.length = 0;
  sbMock.state.ltCalls.length = 0;
  sbMock.state.gteCalls.length = 0;
  sbMock.state.orCalls.length = 0;
  sbMock.state.updateCalls.length = 0;
  sbMock.state.singleData = null;
  sbMock.state.headMode = false;
  sbMock.state.headCounts = {};
  sbMock.state.orderAsc.length = 0;
  sbMock.state.limitCalls.length = 0;
  sbMock.state.result = { data: null, error: null, count: undefined };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordNotificationLog (demo)", () => {
  it("mencatat entri dengan id + createdAt + channel", async () => {
    recordNotificationLog({
      orderNumber: "VS-0001",
      recipient: "6281234567890",
      type: "paid",
      status: "sent",
      delivered: true,
      templateName: "vshop_payment_success",
      message: "Halo!",
    });
    const { logs } = await listNotificationLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].id).toBeTruthy();
    expect(logs[0].createdAt).toBeTruthy();
    expect(logs[0].channel).toBe("whatsapp");
    expect(logs[0].orderNumber).toBe("VS-0001");
  });

  it("status failed menyimpan error", async () => {
    recordNotificationLog({
      recipient: "6281234567890",
      type: "failed",
      status: "failed",
      delivered: false,
      error: "HTTP 412",
    });
    const { logs } = await listNotificationLogs();
    expect(logs[0].status).toBe("failed");
    expect(logs[0].delivered).toBe(false);
    expect(logs[0].error).toBe("HTTP 412");
  });

  it("membatasi buffer demo (MAX_DEMO_LOGS=500) tanpa crash", async () => {
    for (let i = 0; i < 510; i++) {
      recordNotificationLog({ recipient: "6280000000000", type: "paid", status: "sent", delivered: true });
    }
    const { logs, total } = await listNotificationLogs({ limit: 1000 });
    expect(total).toBe(500);
    expect(logs).toHaveLength(500);
  });
});

describe("listNotificationLogs (demo)", () => {
  it("mengurutkan terbaru dulu dan filter status", async () => {
    recordNotificationLog({ recipient: "6281", type: "paid", status: "sent", delivered: true });
    await new Promise((r) => setTimeout(r, 5));
    recordNotificationLog({ recipient: "6282", type: "failed", status: "failed", delivered: false, error: "x" });
    await new Promise((r) => setTimeout(r, 5));
    recordNotificationLog({ recipient: "6283", type: "expired", status: "sent", delivered: true });

    const failed = await listNotificationLogs({ status: "failed" });
    expect(failed.total).toBe(1);
    expect(failed.logs[0].recipient).toBe("6282");

    const all = await listNotificationLogs();
    expect(all.total).toBe(3);
    // terbaru dulu: 6283 dicatat terakhir
    expect(all.logs[0].recipient).toBe("6283");
  });

  it("filter orderNumber dan search", async () => {
    recordNotificationLog({ orderNumber: "VS-100", recipient: "6281", type: "paid", status: "sent", delivered: true });
    recordNotificationLog({ orderNumber: "VS-200", recipient: "6282", type: "failed", status: "failed", delivered: false });

    const byOrder = await listNotificationLogs({ orderNumber: "VS-200" });
    expect(byOrder.total).toBe(1);
    expect(byOrder.logs[0].orderNumber).toBe("VS-200");

    const bySearch = await listNotificationLogs({ search: "6282" });
    expect(bySearch.total).toBe(1);

    const limit = await listNotificationLogs({ limit: 1 });
    expect(limit.logs).toHaveLength(1);
    expect(limit.total).toBe(2);
  });

  it("filter orderNumbers (sekumpulan nomor order) — demo", async () => {
    recordNotificationLog({ orderNumber: "VS-100", recipient: "6281", type: "paid", status: "sent", delivered: true });
    recordNotificationLog({ orderNumber: "VS-200", recipient: "6282", type: "failed", status: "failed", delivered: false });
    recordNotificationLog({ orderNumber: "VS-300", recipient: "6283", type: "demo", status: "demo", delivered: false });

    const bySet = await listNotificationLogs({ orderNumbers: ["VS-100", "VS-300"] });
    expect(bySet.total).toBe(2);
    expect(bySet.logs.map((l) => l.orderNumber).sort()).toEqual(["VS-100", "VS-300"]);

    // Kosong = tanpa filter (pemanggil sudah guard `length > 0` sebelum memanggil).
    const empty = await listNotificationLogs({ orderNumbers: [] });
    expect(empty.total).toBe(3);
  });

  it("filter type + recipient + since (dedupe ringkasan harian) — demo", async () => {
    recordNotificationLog({ recipient: "6281111", type: "daily_summary", status: "sent", delivered: true });
    await new Promise((r) => setTimeout(r, 5));
    recordNotificationLog({ recipient: "6282222", type: "daily_summary", status: "sent", delivered: true });
    await new Promise((r) => setTimeout(r, 5));
    recordNotificationLog({ recipient: "6281111", type: "paid", status: "sent", delivered: true });

    const since = new Date(Date.now() - 10_000).toISOString();
    const byType = await listNotificationLogs({ type: "daily_summary" });
    expect(byType.total).toBe(2);
    const byRecipient = await listNotificationLogs({ recipient: "6281111" });
    expect(byRecipient.total).toBe(2);
    const dedupe = await listNotificationLogs({ type: "daily_summary", recipient: "6281111", since, limit: 1 });
    expect(dedupe.total).toBe(1);
    expect(dedupe.logs[0].recipient).toBe("6281111");
    // since di MASA DEPAN → tidak ada entri yang lebih baru → kosong (batas hari).
    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await listNotificationLogs({ type: "daily_summary", recipient: "6281111", since: future });
    expect(none.total).toBe(0);
  });
});

describe("recordNotificationLog (jalur Supabase, service-role)", () => {
  it("insert ke notification_logs dengan kolom terpetakan (fire-and-forget)", async () => {
    sbMock.state.available = true;
    recordNotificationLog({
      orderNumber: "VS-1",
      recipient: "6281234567890",
      type: "paid",
      status: "sent",
      delivered: true,
      templateName: "vshop_paid",
      message: "Halo!",
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(sbMock.state.insertCalls).toHaveLength(1);
    const row = sbMock.state.insertCalls[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      order_id: "VS-1",
      recipient: "6281234567890",
      type: "paid",
      status: "sent",
      delivered: true,
      channel: "whatsapp",
      template_name: "vshop_paid",
      message: "Halo!",
    });
    expect(row.id).toBeTruthy();
    expect(row.created_at).toBeTruthy();
  });

  it("error insert dicatat, tidak melempar", async () => {
    sbMock.state.available = true;
    sbMock.state.insertError = true;
    expect(() =>
      recordNotificationLog({ recipient: "6281", type: "paid", status: "sent", delivered: true })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

describe("listNotificationLogs (jalur Supabase)", () => {
  it("query dengan filter + mapping baris → entri", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: [
        {
          id: "l1",
          order_id: "VS-9",
          recipient: "6281234567890",
          type: "failed",
          status: "failed",
          delivered: false,
          channel: "whatsapp",
          template_name: null,
          message: null,
          error: "HTTP 412",
          created_at: "2026-08-16T10:00:00.000Z",
        },
      ],
      error: null,
      count: 1,
    };
    const res = await listNotificationLogs({ status: "failed", orderNumber: "VS-9", limit: 5 });
    expect(res.total).toBe(1);
    expect(res.logs[0]).toMatchObject({
      id: "l1",
      orderNumber: "VS-9",
      status: "failed",
      error: "HTTP 412",
      channel: "whatsapp",
    });
    // filter order + status + limit diteruskan ke query
    expect(sbMock.state.eqCalls).toContainEqual(["order_id", "VS-9"]);
    expect(sbMock.state.eqCalls).toContainEqual(["status", "failed"]);
    expect(sbMock.state.orderAsc).toEqual([false]);
    expect(sbMock.state.limitCalls).toEqual([5]);
  });

  it("search diteruskan ke query (or ilike recipient/order_id/type/error)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: [], error: null, count: 0 };
    await listNotificationLogs({ search: "VS-9" });
    expect(sbMock.state.orCalls).toHaveLength(1);
    const or = sbMock.state.orCalls[0];
    expect(or).toContain("recipient.ilike.%vs-9%");
    expect(or).toContain("order_id.ilike.%vs-9%");
    expect(or).toContain("type.ilike.%vs-9%");
    expect(or).toContain("error.ilike.%vs-9%");
    // search + status digabung (eq tetap dipakai).
    await listNotificationLogs({ search: "6282", status: "failed" });
    expect(sbMock.state.eqCalls).toContainEqual(["status", "failed"]);
    expect(sbMock.state.orCalls).toHaveLength(2);
  });

  it("filter orderNumbers diteruskan sebagai in(order_id)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: [], error: null, count: 0 };
    await listNotificationLogs({ orderNumbers: ["VS-1", "VS-2"] });
    expect(sbMock.state.inCalls).toEqual([[ "order_id", ["VS-1", "VS-2"] ]]);
    // orderNumbers kosong → tanpa filter in (tidak membatasi query).
    await listNotificationLogs({ orderNumbers: [] });
    expect(sbMock.state.inCalls).toHaveLength(1);
  });

  it("filter type/recipient/since diteruskan (dedupe ringkasan harian)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: [], error: null, count: 0 };
    await listNotificationLogs({
      type: "daily_summary",
      recipient: "6281234567890",
      since: "2026-08-17T00:00:00.000Z",
    });
    expect(sbMock.state.eqCalls).toContainEqual(["type", "daily_summary"]);
    expect(sbMock.state.eqCalls).toContainEqual(["recipient", "6281234567890"]);
    expect(sbMock.state.gteCalls).toEqual([["created_at", "2026-08-17T00:00:00.000Z"]]);
    // Tanpa filter → tidak ada eq/gte tambahan.
    await listNotificationLogs({});
    expect(sbMock.state.gteCalls).toHaveLength(1);
  });

  it("error query → logs kosong", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: null, error: { message: "db down" }, count: undefined };
    const res = await listNotificationLogs();
    expect(res).toEqual({ logs: [], total: 0 });
  });

  it("read melempar Error maupun non-Error → logs kosong", async () => {
    sbMock.state.available = true;
    sbMock.state.readThrow = new Error("koneksi putus");
    expect(await listNotificationLogs()).toEqual({ logs: [], total: 0 });
    sbMock.state.readThrow = "boom";
    expect(await listNotificationLogs()).toEqual({ logs: [], total: 0 });
  });

  it("mapping baris lengkap: order_id, template, message; count null → pakai logs.length", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: [
        {
          id: "l2",
          order_id: "VS-10",
          recipient: "6281234567890",
          type: "paid",
          status: "sent",
          delivered: true,
          channel: "whatsapp",
          template_name: "vshop_paid",
          message: "Pembayaran berhasil",
          error: null,
          created_at: "2026-08-16T11:00:00.000Z",
        },
      ],
      error: null,
      count: undefined, // PostgREST tanpa exact count → fallback ke logs.length
    };
    const res = await listNotificationLogs();
    expect(res.total).toBe(1);
    expect(res.logs[0]).toMatchObject({
      orderNumber: "VS-10",
      templateName: "vshop_paid",
      message: "Pembayaran berhasil",
    });
  });

  it("insert melempar (Error & non-Error) → tidak menggagalkan record", async () => {
    sbMock.state.available = true;
    sbMock.state.insertThrow = new Error("koneksi putus");
    expect(() =>
      // error field ikut dipetakan ke kolom error (slice 300) walau insert gagal.
      recordNotificationLog({ recipient: "6281", type: "paid", status: "sent", delivered: true, error: "HTTP 500" })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    sbMock.state.insertThrow = "disk penuh";
    expect(() =>
      recordNotificationLog({ recipient: "6281", type: "paid", status: "sent", delivered: true })
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("data null tanpa error → fallback logs kosong; order_id null → undefined", async () => {
    sbMock.state.available = true;
    sbMock.state.result = {
      data: null,
      error: null,
      count: undefined,
    };
    expect(await listNotificationLogs()).toEqual({ logs: [], total: 0 });

    // Baris tanpa order_id → orderNumber undefined.
    sbMock.state.result = {
      data: [
        {
          id: "l3",
          order_id: null,
          recipient: "6281234567890",
          type: "paid",
          status: "sent",
          delivered: true,
          channel: "whatsapp",
          template_name: null,
          message: null,
          error: null,
          created_at: "2026-08-16T12:00:00.000Z",
        },
      ],
      error: null,
      count: 1,
    };
    const res = await listNotificationLogs();
    expect(res.logs[0].orderNumber).toBeUndefined();
    expect(res.total).toBe(1);
  });
});

describe("summarizeNotificationLogs — ringkasan delivered/error/demo", () => {
  it("demo: hitung dari buffer in-memory + delivery rate (1 desimal)", async () => {
    recordNotificationLog({ recipient: "6281111111111", type: "paid", status: "sent", delivered: true });
    recordNotificationLog({ recipient: "6282222222222", type: "failed", status: "failed", delivered: false, error: "HTTP 412" });
    recordNotificationLog({ recipient: "6283333333333", type: "expired", status: "sent", delivered: true });
    recordNotificationLog({ recipient: "6284444444444", type: "paid", status: "demo", delivered: false });
    const s = await summarizeNotificationLogs();
    expect(s.total).toBe(4);
    expect(s.delivered).toBe(2);
    expect(s.error).toBe(1);
    expect(s.demo).toBe(1);
    expect(s.deliveryRate).toBe(50); // 2/4
  });

  it("demo: tanpa log → 0 semua, rate 0 (bukan NaN)", async () => {
    const s = await summarizeNotificationLogs();
    expect(s).toEqual({ total: 0, delivered: 0, error: 0, demo: 0, deliveryRate: 0 });
  });

  it("Supabase: empat hitungan head per status; rate = delivered/total", async () => {
    sbMock.state.available = true;
    sbMock.state.headCounts = { "": 10, sent: 7, failed: 2, demo: 1 };
    const s = await summarizeNotificationLogs();
    expect(s).toEqual({ total: 10, delivered: 7, error: 2, demo: 1, deliveryRate: 70 });
    // empat kueri head: total (tanpa eq status) + 3 per status
    expect(sbMock.state.eqCalls.filter(([c]) => c === "status").map(([, v]) => v)).toEqual([
      "sent",
      "failed",
      "demo",
    ]);
  });

  it("Supabase: query melempar → tidak gagal, fallback 0", async () => {
    sbMock.state.available = true;
    sbMock.state.readThrow = new Error("koneksi putus");
    const s = await summarizeNotificationLogs();
    expect(s.total).toBe(0);
    expect(s.deliveryRate).toBe(0);
  });
});

describe("listFailedNotificationsForRetry — antrean retry cron", () => {
  const cfg = { maxAttempts: 3, backoffMs: 30 * 60_000, minAgeMs: 5 * 60_000, limit: 10 };
  const isoAgo = (ms: number) => new Date(Date.now() - ms).toISOString();

  function failedLog(id: string, over: Partial<Parameters<typeof recordNotificationLog>[0]> = {}) {
    recordNotificationLog({
      recipient: "6281234567890",
      type: "failed",
      status: "failed",
      delivered: false,
      error: "HTTP 412",
      ...over,
    });
  }

  it("demo: hanya entri failed yang layak (umur min, retry_count < maks, jarak backoff)", async () => {
    const old = isoAgo(60 * 60_000); // 1 jam lalu
    const fresh = isoAgo(60_000); // 1 menit lalu — terlalu muda
    const l1 = failedLog("l-old", { message: "Halo 1" });
    // override createdAt agar deterministik
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<{ id: string; createdAt: string }> })
      .__vshopNotifLogs!;
    demoLogs[0].createdAt = old;
    failedLog("l-fresh");
    demoLogs[1].createdAt = fresh;
    // sent tidak layak
    recordNotificationLog({ recipient: "6282", type: "paid", status: "sent", delivered: true });

    const { logs } = await listFailedNotificationsForRetry(cfg);
    expect(logs.map((l) => l.id)).toEqual([demoLogs[0].id]); // hanya l-old
  });

  it("demo: retry_count mencapai maks → tidak layak; backoff antar retry dihormati", async () => {
    const old = isoAgo(60 * 60_000);
    failedLog("l-max");
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<Record<string, unknown>> })
      .__vshopNotifLogs!;
    demoLogs[0].createdAt = old;
    demoLogs[0].retryCount = 3; // == maxAttempts → berhenti
    failedLog("l-backoff");
    demoLogs[1].createdAt = old;
    demoLogs[1].retryCount = 1;
    demoLogs[1].lastRetryAt = isoAgo(5 * 60_000); // baru 5 menit → masih backoff
    failedLog("l-ok");
    demoLogs[2].createdAt = old;
    demoLogs[2].retryCount = 1;
    demoLogs[2].lastRetryAt = isoAgo(60 * 60_000); // 1 jam lalu → layak lagi

    const { logs } = await listFailedNotificationsForRetry(cfg);
    expect(logs.map((l) => l.id)).toEqual([demoLogs[2].id]);
  });

  it("demo: diurutkan tertua dulu + batas limit", async () => {
    failedLog("a");
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<{ id: string; createdAt: string }> })
      .__vshopNotifLogs!;
    demoLogs[0].createdAt = isoAgo(2 * 60 * 60_000);
    failedLog("b");
    demoLogs[1].createdAt = isoAgo(60 * 60_000);
    failedLog("c");
    demoLogs[2].createdAt = isoAgo(30 * 60_000);

    const { logs } = await listFailedNotificationsForRetry({ ...cfg, limit: 2 });
    expect(logs.map((l) => l.id)).toEqual([demoLogs[0].id, demoLogs[1].id]); // a, b (tertua dulu, limit 2)
  });

  it("Supabase: filter eq status + lt retry_count + or last_retry_at + lt created_at, urut tertua", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: [], error: null, count: 0 };
    await listFailedNotificationsForRetry(cfg);
    expect(sbMock.state.eqCalls).toContainEqual(["status", "failed"]);
    expect(sbMock.state.ltCalls).toContainEqual(["retry_count", 3]);
    expect(sbMock.state.ltCalls.some(([c, v]) => c === "created_at" && typeof v === "string")).toBe(true);
    expect(sbMock.state.orCalls).toHaveLength(1);
    expect(sbMock.state.orCalls[0]).toContain("last_retry_at.is.null");
    expect(sbMock.state.orCalls[0]).toContain("last_retry_at.lt.");
    expect(sbMock.state.orderAsc).toEqual([true]); // tertua dulu
    expect(sbMock.state.limitCalls).toEqual([10]);
  });

  it("Supabase: error/throw → antrean kosong (tidak melempar)", async () => {
    sbMock.state.available = true;
    sbMock.state.result = { data: null, error: { message: "db down" }, count: undefined };
    expect((await listFailedNotificationsForRetry(cfg)).logs).toEqual([]);
    sbMock.state.readThrow = new Error("koneksi putus");
    expect((await listFailedNotificationsForRetry(cfg)).logs).toEqual([]);
  });
});

describe("recordRetryResult — catat hasil percobaan kirim ulang", () => {
  it("demo: sukses → status sent, retry_count +1, last_retry_at terisi, error bersih", async () => {
    recordNotificationLog({ recipient: "6281", type: "failed", status: "failed", delivered: false, error: "HTTP 412" });
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<Record<string, unknown>> })
      .__vshopNotifLogs!;
    const id = demoLogs[0].id as string;

    recordRetryResult(id, { ok: true, delivered: true });
    expect(demoLogs[0].retryCount).toBe(1);
    expect(demoLogs[0].status).toBe("sent");
    expect(demoLogs[0].delivered).toBe(true);
    expect(demoLogs[0].error).toBeUndefined();
    expect(typeof demoLogs[0].lastRetryAt).toBe("string");
  });

  it("demo: sukses dicatat tanpa token → status demo (bukan sent), delivered false", async () => {
    recordNotificationLog({ recipient: "6281", type: "failed", status: "failed", delivered: false, error: "HTTP 412" });
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<Record<string, unknown>> })
      .__vshopNotifLogs!;
    const id = demoLogs[0].id as string;

    recordRetryResult(id, { ok: true, delivered: false }); // mode demo: ok tapi tidak delivered
    expect(demoLogs[0].retryCount).toBe(1);
    expect(demoLogs[0].status).toBe("demo");
    expect(demoLogs[0].delivered).toBe(false);
    expect(demoLogs[0].error).toBeUndefined();
  });

  it("demo: gagal lagi → tetap failed, retry_count +1, error diperbarui", async () => {
    recordNotificationLog({ recipient: "6281", type: "failed", status: "failed", delivered: false, error: "HTTP 412" });
    const demoLogs = (globalThis as unknown as { __vshopNotifLogs?: Array<Record<string, unknown>> })
      .__vshopNotifLogs!;
    const id = demoLogs[0].id as string;

    recordRetryResult(id, { ok: false, delivered: false, error: "HTTP 500" });
    expect(demoLogs[0].retryCount).toBe(1);
    expect(demoLogs[0].status).toBe("failed");
    expect(demoLogs[0].error).toBe("HTTP 500");
  });

  it("Supabase: baca retry_count lalu update status + retry_count + last_retry_at", async () => {
    sbMock.state.available = true;
    sbMock.state.singleData = { retry_count: 1 };
    recordRetryResult("l1", { ok: false, delivered: false, error: "HTTP 500" });
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget — beri waktu di mesin sibuk
    expect(sbMock.state.updateCalls).toHaveLength(1);
    const upd = sbMock.state.updateCalls[0];
    expect(upd.retry_count).toBe(2); // 1 + 1
    expect(upd.status).toBe("failed");
    expect(upd.delivered).toBe(false);
    expect(upd.error).toBe("HTTP 500");
    expect(typeof upd.last_retry_at).toBe("string");
  });
});

describe("export CSV log notifikasi (audit admin)", () => {
  const entry: NotificationLogEntry = {
    id: "l1",
    orderNumber: "VS-1",
    recipient: "6281234567890",
    type: "failed",
    status: "failed",
    delivered: false,
    channel: "whatsapp",
    templateName: "vshop_payment_failed",
    message: "Pembayaran order VS-1 belum berhasil.",
    error: "HTTP 412",
    createdAt: "2026-08-16T10:00:00.000Z",
    retryCount: 2,
    lastRetryAt: "2026-08-16T11:00:00.000Z",
  };

  it("header + baris terpetakan (jenis berlabel, delivered ya/tidak, retry_count)", () => {
    const csv = notificationsToCsv([entry]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "waktu,status,delivered,jenis,penerima,nomor_order,template,retry_count,last_retry_at,pesan,error"
    );
    expect(lines[1]).toBe(
      "2026-08-16T10:00:00.000Z,failed,tidak,Pembayaran Gagal,6281234567890,VS-1,vshop_payment_failed,2,2026-08-16T11:00:00.000Z,Pembayaran order VS-1 belum berhasil.,HTTP 412"
    );
    // Diakhiri newline (baris akhir tetap terbaca Excel).
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("tanpa log → hanya header", () => {
    const csv = notificationsToCsv([]);
    expect(csv.trim().split("\r\n")).toHaveLength(1);
    expect(csv).toContain("nomor_order");
  });

  it("escaping RFC 4180: koma, kutip, newline dibungkus kutip + kutip digandakan", () => {
    const messy: NotificationLogEntry = {
      ...entry,
      message: 'Halo, "teman"!\nBaris 2',
    };
    const csv = notificationsToCsv([messy]);
    // Kutip dibungkus & digandakan; newline tetap di dalam sel.
    expect(csv).toContain('"Halo, ""teman""!\nBaris 2"');
    // csvCell langsung:
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell("polos")).toBe("polos");
    expect(csvCell(null)).toBe("");
    expect(csvCell(0)).toBe("0");
  });
});
