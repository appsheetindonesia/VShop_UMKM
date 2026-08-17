/**
 * Unit test route webhook Midtrans (`POST /api/midtrans/notification`).
 *
 * Signature diverifikasi dengan `verifyMidtransSignature` ASLI (SHA512)
 * terhadap server key TEST yang di-set di env — signature valid dihitung
 * ulang di test (bukan dari Midtrans asli), signature salah harus ditolak.
 * Service & WhatsApp di-mock stateful agar transisi dan pemanggilan
 * `notifyOrderPayment` bisa dihitung:
 *
 *   1. signature palsu → 403, tanpa efek apa pun;
 *   2. settlement valid → pending→paid SEKALI + notifyOrderPayment TEPAT 1×;
 *   3. webhook duplikat (settlement 2×) → idempoten: tetap paid, notify 1×;
 *   4. deny → failed + notify 1×; deny duplikat → notify tetap 1×;
 *   5. expire → expired + notify "expired" sekali.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const TEST_KEY = "SB-Mid-server-test-key-1234567890";

const { state, mocks } = vi.hoisted(() => {
  const state = {
    order: null as unknown as {
      id: string;
      orderNumber: string;
      paymentStatus: string;
      paymentMethod?: string;
    } | null,
  };
  const mocks = {
    ensureHydrated: vi.fn(async () => {}),
    getOrderByNumber: vi.fn(() => state.order),
    markOrderPaid: vi.fn((orderId: string, method?: string) => {
      const o = state.order;
      // Idempoten — transisi pending→paid HANYA sekali (meniru guard asli).
      if (o && o.id === orderId && o.paymentStatus !== "paid") {
        o.paymentStatus = "paid";
        o.paymentMethod = method;
      }
      return o;
    }),
    markOrderFailed: vi.fn((orderId: string, status: string) => {
      const o = state.order;
      if (o && o.id === orderId) {
        o.paymentStatus = status === "expired" ? "expired" : "failed";
      }
      return o;
    }),
    notifyOrderPayment: vi.fn(async () => {}),
  };
  return { state, mocks };
});

vi.mock("@/lib/db", () => ({ ensureHydrated: mocks.ensureHydrated }));
vi.mock("@/lib/service", () => ({
  getOrderByNumber: mocks.getOrderByNumber,
  markOrderPaid: mocks.markOrderPaid,
  markOrderFailed: mocks.markOrderFailed,
}));
vi.mock("@/lib/whatsapp", () => ({ notifyOrderPayment: mocks.notifyOrderPayment }));

// Route di-import SETELAH mock (hoisted) — midtrans tetap ASLI.
import { POST } from "./route";

/** Signature SHA512 ala Midtrans: order_id + status_code + gross_amount + ServerKey. */
function sign(orderId: string, statusCode: string, grossAmount: string): string {
  return createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${TEST_KEY}`)
    .digest("hex");
}

/** Bangun Request webhook; signature dihitung ulang bila tidak di-override. */
function webhook(over: Record<string, unknown> = {}): Request {
  const base = {
    order_id: "VS-20260816-0001",
    status_code: "200",
    gross_amount: "7000.00",
    transaction_status: "settlement",
    payment_type: "qris",
    transaction_id: "txn-123",
    signature_key: "",
  };
  const body = { ...base, ...over } as Record<string, unknown>;
  body.signature_key =
    body.signature_key ||
    sign(String(body.order_id), String(body.status_code), String(body.gross_amount));
  return new Request("http://localhost/api/midtrans/notification", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/midtrans/notification — webhook (signature asli, service di-mock)", () => {
  beforeEach(() => {
    process.env.MIDTRANS_SERVER_KEY = TEST_KEY;
    state.order = { id: "ord-1", orderNumber: "VS-20260816-0001", paymentStatus: "pending" };
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.MIDTRANS_SERVER_KEY;
    state.order = null;
  });

  it("signature PALSU → 403, tanpa transisi / notifikasi / audit", async () => {
    const res = await POST(webhook({ signature_key: "forged-not-a-real-signature" }));
    expect(res.status).toBe(403);
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.markOrderFailed).not.toHaveBeenCalled();
    expect(mocks.notifyOrderPayment).not.toHaveBeenCalled();
    expect(state.order?.paymentStatus).toBe("pending");
  });

  it("signature TERBENTUK BAIK tapi dihitung dengan kunci lain (pemalsuan realistis) → 403", async () => {
    // SHA512 valid secara format, tapi dengan server key yang BUKAN milik
    // aplikasi — pemalsuan nyata yang harus ditolak (bukan string sampah).
    const forged = createHash("sha512")
      .update("VS-20260816-00012007000.00SB-Mid-server-attacker-key")
      .digest("hex");
    const res = await POST(webhook({ signature_key: forged }));
    expect(res.status).toBe(403);
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.markOrderFailed).not.toHaveBeenCalled();
    expect(mocks.notifyOrderPayment).not.toHaveBeenCalled();
  });

  it("payload DITAMPER (order_id diganti) dengan signature valid utk payload lain → 403", async () => {
    // Signature dihitung untuk VS-20260816-0001, tapi body membawa
    // order_id berbeda — signature mengikat seluruh payload webhook.
    const good = sign("VS-20260816-0001", "200", "7000.00");
    const res = await POST(
      webhook({ order_id: "VS-20260816-0002", signature_key: good })
    );
    expect(res.status).toBe(403);
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.notifyOrderPayment).not.toHaveBeenCalled();
  });

  it("settlement valid → pending→paid SEKALI + notifyOrderPayment TEPAT 1×", async () => {
    const res = await POST(webhook());
    expect(res.status).toBe(200);
    expect(state.order?.paymentStatus).toBe("paid");
    expect(state.order?.paymentMethod).toBe("QRIS"); // paymentTypeToMethod
    expect(mocks.markOrderPaid).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledWith("ord-1", "paid");
  });

  it("webhook DUPLIKAT (settlement 2×) → idempoten: tetap paid, notify tetap 1×", async () => {
    await POST(webhook());
    await POST(webhook()); // Midtrans mengulang notifikasi
    expect(state.order?.paymentStatus).toBe("paid");
    // Route memanggil markOrderPaid tiap notifikasi (guard internal
    // idempoten), tapi transisi & notifikasi hanya SEKALI.
    expect(mocks.markOrderPaid).toHaveBeenCalledTimes(2);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledTimes(1);
  });

  it("deny → failed + notify 1×; deny duplikat → notify tetap 1×", async () => {
    const deny = { status_code: "202", transaction_status: "deny", payment_type: "bank_transfer" };
    const res1 = await POST(webhook(deny));
    expect(res1.status).toBe(200);
    expect(state.order?.paymentStatus).toBe("failed");
    expect(mocks.markOrderFailed).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledWith("ord-1", "failed");

    await POST(webhook(deny)); // duplikat
    expect(state.order?.paymentStatus).toBe("failed");
    expect(mocks.notifyOrderPayment).toHaveBeenCalledTimes(1); // tetap 1×
  });

  it("expire → expired + notify 'expired' sekali (status terminal berbeda)", async () => {
    const expire = { status_code: "203", transaction_status: "expire", payment_type: "bank_transfer" };
    await POST(webhook(expire));
    expect(state.order?.paymentStatus).toBe("expired");
    expect(mocks.markOrderFailed).toHaveBeenCalledWith("ord-1", "expired", expect.anything(), expect.anything());
    expect(mocks.notifyOrderPayment).toHaveBeenCalledTimes(1);
    expect(mocks.notifyOrderPayment).toHaveBeenCalledWith("ord-1", "expired");
  });

  it("signature valid tapi order tidak ditemukan → 200 tanpa efek (Midtrans tak mengulang)", async () => {
    state.order = null;
    const res = await POST(webhook());
    expect(res.status).toBe(200);
    expect(mocks.markOrderPaid).not.toHaveBeenCalled();
    expect(mocks.notifyOrderPayment).not.toHaveBeenCalled();
  });
});
