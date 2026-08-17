/**
 * Unit test route cek status pembayaran (`GET /api/pay/[orderId]/status`).
 *
 * Verifikasi alur sinkronisasi "webhook utama, polling fallback":
 *
 *   1. Mode LOKAL (tanpa ?reconcile=1) TIDAK PERNAH memanggil Midtrans —
 *      status dibaca dari store (hasil webhook); polling di halaman bayar
 *      memakai mode ini agar settlement terdeteksi murah. Setiap observasi
 *      polling direkam ke `metadata.paymentAudit` (event "pending", source
 *      "poll") SEKALI — entri identik beruntun dilewati.
 *   2. Mode RECONCILE (?reconcile=1) membaca store dulu; status terminal
 *      yang sudah diterapkan webhook → return tanpa Midtrans; hanya bila
 *      masih `pending` barulah memanggil Status API sekali (fallback) dan
 *      merekam observasinya ke paymentAudit (source "status-api").
 *   3. Snap token tiruan (mode demo) → selalu "pending" tanpa Midtrans.
 *
 * `getMidtransStatus` di-stub (satu-satunya fungsi jaringan midtrans);
 * fungsi murni lain (isMidtransPaid, midtransTerminalFailure, dll.) tetap
 * ASLI via importOriginal. Service, auth, db, whatsapp di-mock stateful
 * (recordPaymentAudit menulis ke `state.order.metadata.paymentAudit` agar
 * dedupe polling bisa diuji).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_KEY = "SB-Mid-server-test-key-1234567890";

const { state, mocks, midMocks } = vi.hoisted(() => {
  const state = {
    user: null as { id: string; role: string } | null,
    order: null as {
      id: string;
      orderNumber: string;
      userId: string;
      paymentStatus: string;
      paymentMethod?: string;
      snapToken?: string;
      metadata?: Record<string, unknown>;
    } | null,
  };
  const mocks = {
    ensureHydrated: vi.fn(async () => {}),
    getSessionUser: vi.fn(() => state.user),
    getOrder: vi.fn(() => state.order),
    markOrderPaid: vi.fn((orderId: string, method?: string) => {
      const o = state.order;
      if (o && o.id === orderId && o.paymentStatus !== "paid") {
        o.paymentStatus = "paid";
        o.paymentMethod = method;
      }
      return o;
    }),
    markOrderFailed: vi.fn((orderId: string, status: string) => {
      const o = state.order;
      if (o && o.id === orderId) o.paymentStatus = status === "expired" ? "expired" : "failed";
      return o;
    }),
    recordPaymentAudit: vi.fn((orderId: string, input: Record<string, unknown>) => {
      const o = state.order;
      if (o && o.id === orderId) {
        const audit = Array.isArray(o.metadata?.paymentAudit)
          ? [...(o.metadata!.paymentAudit as Array<Record<string, unknown>>)]
          : [];
        audit.push({ ...input, at: new Date().toISOString() });
        o.metadata = { ...(o.metadata ?? {}), paymentAudit: audit };
      }
      return o;
    }),
    notifyOrderPayment: vi.fn(async () => {}),
    notifyMerchantPaymentConfigIssue: vi.fn(() => false),
  };
  const midMocks = {
    getMidtransStatus: vi.fn(),
  };
  return { state, mocks, midMocks };
});

vi.mock("@/lib/db", () => ({ ensureHydrated: mocks.ensureHydrated }));
vi.mock("@/lib/auth", () => ({ getSessionUser: mocks.getSessionUser }));
vi.mock("@/lib/service", () => ({
  getOrder: mocks.getOrder,
  markOrderPaid: mocks.markOrderPaid,
  markOrderFailed: mocks.markOrderFailed,
  recordPaymentAudit: mocks.recordPaymentAudit,
}));
vi.mock("@/lib/whatsapp", () => ({
  notifyOrderPayment: mocks.notifyOrderPayment,
  notifyMerchantPaymentConfigIssue: mocks.notifyMerchantPaymentConfigIssue,
}));
// Hanya fungsi JARINGAN yang di-stub; sisanya (isMidtransPaid, terminal,
// isMockSnapToken, paymentTypeToMethod, …) tetap implementasi asli.
vi.mock("@/lib/midtrans", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/midtrans")>();
  return { ...mod, getMidtransStatus: midMocks.getMidtransStatus };
});

import { GET } from "./route";

function order(over: Record<string, unknown> = {}): typeof state.order {
  return {
    id: "ord-1",
    orderNumber: "VS-20260816-0001",
    userId: "u1",
    paymentStatus: "pending",
    snapToken: "SNAP-REAL-TOKEN-1234567890abcdef",
    metadata: {},
    ...over,
  };
}

function statusReq(url = "http://localhost/api/pay/ord-1/status"): Request {
  return new Request(url);
}

function callGET(url?: string) {
  return GET(statusReq(url), { params: { orderId: "ord-1" } });
}

describe("GET /api/pay/[orderId]/status — webhook utama, polling fallback", () => {
  beforeEach(() => {
    process.env.MIDTRANS_SERVER_KEY = TEST_KEY;
    state.user = { id: "u1", role: "customer" };
    state.order = order();
    midMocks.getMidtransStatus.mockReset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.MIDTRANS_SERVER_KEY;
    state.order = null;
  });

  it("mode LOKAL (tanpa param): pending → 'pending' TANPA memanggil Midtrans", async () => {
    const res = await callGET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "pending" });
    expect(midMocks.getMidtransStatus).not.toHaveBeenCalled();
  });

  it("mode LOKAL: observasi polling direkam ke paymentAudit (source 'poll') SEKALI, dedupe entri identik", async () => {
    // Poll 1 → entri audit "pending/poll" tercatat.
    await callGET();
    expect(mocks.recordPaymentAudit).toHaveBeenCalledTimes(1);
    const first = mocks.recordPaymentAudit.mock.calls[0][1] as Record<string, unknown>;
    expect(first.source).toBe("poll");
    expect(first.event).toBe("pending");
    expect(first.paymentStatus).toBe("pending");

    // Poll 2 identik (masih pending) → TIDAK menambah entri (dedupe).
    mocks.recordPaymentAudit.mockClear();
    await callGET();
    expect(mocks.recordPaymentAudit).not.toHaveBeenCalled();
    expect((state.order!.metadata!.paymentAudit as unknown[])).toHaveLength(1);

    // Status BERUBAH (mis. webhook settlement → paid) → polling lokal
    // short-circuit ke paid tanpa entri "poll" tambahan.
    state.order = order({ paymentStatus: "paid" });
    const res = await callGET();
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(mocks.recordPaymentAudit).not.toHaveBeenCalled();
  });

  it("RECONCILE pending → observasi direkam ke paymentAudit (source 'status-api', event 'pending')", async () => {
    midMocks.getMidtransStatus.mockResolvedValue({
      transaction_status: "pending",
      status_code: "201",
      payment_type: "qris",
    });
    const res = await callGET("http://localhost/api/pay/ord-1/status?reconcile=1");
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(mocks.recordPaymentAudit).toHaveBeenCalledTimes(1);
    const input = mocks.recordPaymentAudit.mock.calls[0][1] as Record<string, unknown>;
    expect(input.source).toBe("status-api");
    expect(input.event).toBe("pending");
    expect(input.statusCode).toBe("201");
    expect(input.transactionStatus).toBe("pending");
  });

  it("mode LOKAL: webhook sudah menerapkan paid → redirect sukses, tanpa Midtrans", async () => {
    state.order = order({ paymentStatus: "paid" });
    const res = await callGET();
    const body = await res.json();
    expect(body.status).toBe("paid");
    expect(body.redirect).toBe("/sukses?order=ord-1");
    expect(midMocks.getMidtransStatus).not.toHaveBeenCalled();
  });

  it("mode LOKAL: webhook sudah menerapkan failed → redirect /bayar/gagal, tanpa Midtrans", async () => {
    state.order = order({ paymentStatus: "failed" });
    const res = await callGET();
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(body.redirect).toBe("/bayar/gagal?order=ord-1&reason=failed");
    expect(midMocks.getMidtransStatus).not.toHaveBeenCalled();
  });

  it("snap token TIRUAN (demo) → 'pending' tanpa Midtrans, di kedua mode", async () => {
    state.order = order({ snapToken: "snap-demo-abc" });
    const local = await callGET().then((r) => r.json());
    expect(local.status).toBe("pending");
    const rec = await callGET("http://localhost/api/pay/ord-1/status?reconcile=1").then((r) => r.json());
    expect(rec.status).toBe("pending");
    expect(midMocks.getMidtransStatus).not.toHaveBeenCalled();
  });

  it("RECONCILE: store pending → Status API settlement → paid + redirect sukses + notify", async () => {
    midMocks.getMidtransStatus.mockResolvedValue({
      transaction_status: "settlement",
      status_code: "200",
      payment_type: "qris",
      gross_amount: "7000.00",
    });
    const res = await callGET("http://localhost/api/pay/ord-1/status?reconcile=1");
    const body = await res.json();
    expect(midMocks.getMidtransStatus).toHaveBeenCalledTimes(1);
    expect(midMocks.getMidtransStatus).toHaveBeenCalledWith("VS-20260816-0001");
    expect(mocks.markOrderPaid).toHaveBeenCalledTimes(1);
    expect(mocks.markOrderPaid).toHaveBeenCalledWith("ord-1", "QRIS", expect.anything());
    expect(body).toMatchObject({ ok: true, status: "paid", redirect: "/sukses?order=ord-1" });
    expect(mocks.notifyOrderPayment).toHaveBeenCalledWith("ord-1", "paid");
  });

  it("RECONCILE: Status API deny → failed + redirect /bayar/gagal + notify", async () => {
    midMocks.getMidtransStatus.mockResolvedValue({
      transaction_status: "deny",
      status_code: "202",
      payment_type: "bank_transfer",
    });
    const res = await callGET("http://localhost/api/pay/ord-1/status?reconcile=1");
    const body = await res.json();
    expect(midMocks.getMidtransStatus).toHaveBeenCalledTimes(1);
    expect(mocks.markOrderFailed).toHaveBeenCalledTimes(1);
    expect(mocks.markOrderFailed).toHaveBeenCalledWith("ord-1", "failed", expect.anything(), expect.anything());
    expect(body).toMatchObject({ ok: true, status: "failed" });
    expect(mocks.notifyOrderPayment).toHaveBeenCalledWith("ord-1", "failed");
  });

  it("RECONCILE: store SUDAH terminal (webhook lebih baru) → return tanpa memanggil Midtrans", async () => {
    state.order = order({ paymentStatus: "failed" });
    const res = await callGET("http://localhost/api/pay/ord-1/status?reconcile=1");
    const body = await res.json();
    expect(body.status).toBe("failed");
    expect(midMocks.getMidtransStatus).not.toHaveBeenCalled();
  });

  it("belum login → 401; order bukan milik user → 403", async () => {
    state.user = null;
    const anon = await callGET();
    expect(anon.status).toBe(401);

    state.user = { id: "u1", role: "customer" };
    state.order = order({ userId: "u-other" });
    const other = await callGET();
    expect(other.status).toBe(403);
  });
});
