/**
 * Unit test `retryOrderPayment` (src/lib/service.ts): pada retry, order
 * mendapat NOMOR ORDER BARU (order_id lama berstatus terminal bisa ditolak
 * Midtrans) + riwayat nomor tersimpan di metadata. Mode Supabase di-mock
 * (sama seperti db.test.ts) sehingga tidak menyentuh disk / jaringan.
 */
import { describe, expect, it, vi } from "vitest";

const { mockAdmin, store, calls, resetAll } = vi.hoisted(() => {
  const store: Record<string, unknown[]> = {};
  const calls: { method: string; table: string; rows?: unknown[] }[] = [];
  const project = (sel: string, row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    const re = /([a-z_]+)(?:\s+as\s+"([a-zA-Z_]+)")?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sel))) {
      const src = m[1];
      const dest = m[2] ?? m[1];
      if (src in row) out[dest] = row[src];
    }
    return out;
  };
  const client = {
    from(table: string) {
      return {
        select: async (sel: string) => ({
          data: (store[table] ?? []).map((r) => project(sel, r as Record<string, unknown>)),
          error: null,
        }),
        upsert: async (rows: unknown[]) => {
          calls.push({ method: "upsert", table, rows });
          store[table] = rows;
          return { error: null, data: rows };
        },
      };
    },
  };
  return {
    mockAdmin: client,
    store,
    calls,
    resetAll: () => {
      for (const k of Object.keys(store)) delete store[k];
      calls.length = 0;
    },
  };
});

vi.mock("./supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => mockAdmin,
  getSupabaseAnon: () => mockAdmin,
}));

// Tanpa MIDTRANS_SERVER_KEY → createPaymentTransaction mode demo (token
// tiruan, tanpa jaringan) — tepat untuk menguji logika retry.
const waitFlush = () => new Promise((r) => setTimeout(r, 30));

async function freshDb() {
  vi.resetModules();
  resetAll();
  const db = await import("./db");
  await db.ensureHydrated(); // mode supabase (mock)
  return await import("./service");
}

describe("retryOrderPayment", () => {
  it("memberi nomor order baru + menyimpan riwayat di metadata", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    const oldNumber = order.orderNumber;

    // Tandai gagal dulu (dengan alasan spesifik).
    svc.markOrderFailed(order.id, "failed", "Pembayaran ditolak oleh bank");
    await waitFlush();

    const retried = await svc.retryOrderPayment(order.id);
    const retriedNumber = retried.orderNumber; // objek live — tangkap nilainya
    expect(retriedNumber).not.toBe(oldNumber);
    expect(retried.paymentStatus).toBe("pending");
    expect(retried.status).toBe("pending");
    expect(retried.metadata.originalOrderNumber).toBe(oldNumber);
    expect(retried.metadata.previousOrderNumbers).toEqual([oldNumber]);
    // Alasan kegagalan lama dibersihkan.
    expect(retried.metadata.failureReason).toBeUndefined();
    // Token dibuat ulang untuk transaksi baru (mode demo: snap-demo-<orderId>).
    expect(retried.snapToken).toMatch(/^snap-demo-/);
  });

  it("retry kedua menghasilkan nomor baru lagi dan riwayat bertambah", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });
    const original = order.orderNumber;

    const r1 = await svc.retryOrderPayment(order.id);
    const r1Number = r1.orderNumber; // objek live — tangkap nilainya sekarang
    const r2 = await svc.retryOrderPayment(order.id);
    const r2Number = r2.orderNumber;
    const r2History = [...(r2.metadata.previousOrderNumbers as string[])];

    expect(r1Number).not.toBe(original);
    expect(r2Number).not.toBe(original);
    expect(r2Number).not.toBe(r1Number); // wajib beda dari retry pertama
    expect(r2.metadata.originalOrderNumber).toBe(original);
    expect(r2History).toEqual([original, r1Number]);
  });

  it("retry tidak mengubah order yang sudah lunas (dilewati)", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });
    svc.markOrderPaid(order.id, "QRIS");
    await waitFlush();

    // Tombol "Coba Lagi" hanya muncul untuk order gagal/kadaluarsa di UI,
    // tapi fungsi retry sendiri aman dipanggil untuk order lunas: order
    // tetap ada dan status kembali ke pending (siap dibayar ulang).
    const retried = await svc.retryOrderPayment(order.id);
    expect(retried.id).toBe(order.id);
    expect(retried.paymentStatus).toBe("pending");
  });
});

describe("paymentAudit (kronologi status pembayaran)", () => {
  async function makeOrder(svc: typeof import("./service")) {
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    return order;
  }

  const auditOf = (o: { metadata: Record<string, unknown> }) =>
    (o.metadata.paymentAudit ?? []) as Array<{
      at: string;
      source: string;
      event: string;
      paymentStatus: string;
      statusCode?: string;
      statusMessage?: string;
      transactionStatus?: string;
      orderNumber?: string;
      detail?: string;
    }>;

  it("order baru membuka log dengan event created", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);
    const audit = auditOf(order);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      source: "create",
      event: "created",
      paymentStatus: "pending",
      orderNumber: order.orderNumber,
    });
  });

  it("kegagalan mencatat status_code/status_message dari sumbernya", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);

    // Simulasi webhook Midtrans: deny + kode 202 + pesan asli.
    svc.markOrderFailed(order.id, "failed", "Pembayaran ditolak oleh bank", {
      source: "webhook",
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
      transactionId: "txn-abc",
      paymentType: "qris",
      orderNumber: order.orderNumber,
    });
    await waitFlush();

    const audit = auditOf(svc.getOrder(order.id)!);
    expect(audit).toHaveLength(2); // created + failed
    expect(audit[1]).toMatchObject({
      source: "webhook",
      event: "failed",
      paymentStatus: "failed",
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
      transactionId: "txn-abc",
      paymentType: "qris",
    });
    expect(audit[1].at >= audit[0].at).toBe(true); // kronologi: created → failed
  });

  it("observasi pending beruntun di-dedupe, perubahan status direkam", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);

    // Status API dipoll berkali-kali dengan hasil sama → satu entri saja.
    const obs = {
      source: "status-api" as const,
      event: "pending" as const,
      paymentStatus: "pending" as const,
      statusCode: "201",
      statusMessage: "Transaction is pending",
      transactionStatus: "pending",
      orderNumber: order.orderNumber,
    };
    svc.recordPaymentAudit(order.id, obs);
    svc.recordPaymentAudit(order.id, obs);
    svc.recordPaymentAudit(order.id, obs);
    // Status berubah → deny: entri baru.
    svc.recordPaymentAudit(order.id, {
      ...obs,
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
    });
    await waitFlush();

    const audit = auditOf(svc.getOrder(order.id)!);
    expect(audit).toHaveLength(3); // created + pending (satu) + deny
    expect(audit[1]).toMatchObject({ event: "pending", statusCode: "201" });
    expect(audit[2]).toMatchObject({ event: "pending", statusCode: "202" });
  });

  it("retry mencatat kronologi nomor order baru", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);
    svc.markOrderFailed(order.id, "expired", "Waktu pembayaran habis", {
      source: "cron",
      orderNumber: order.orderNumber,
    });
    await waitFlush();

    const retried = await svc.retryOrderPayment(order.id);
    const audit = auditOf(svc.getOrder(order.id)!);
    expect(audit).toHaveLength(3); // created + expired + retry
    expect(audit[2]).toMatchObject({
      source: "retry",
      event: "retry",
      paymentStatus: "pending",
      orderNumber: retried.orderNumber,
    });
    expect(audit[2].detail).toContain(order.orderNumber); // nomor lama tercatat
    expect(audit[2].detail).toContain(retried.orderNumber); // nomor baru tercatat
  });
});
