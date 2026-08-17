/**
 * Unit test logika filter riwayat pembayaran (src/lib/payment-history.ts):
 * tab status (Semua / paid / failed+expired) dan pencarian nomor order —
 * termasuk mencocokkan nomor lama (originalOrderNumber / previousOrderNumbers)
 * untuk order yang pernah di-retry.
 */
import { describe, expect, it } from "vitest";
import {
  auditDisplayText,
  buildAuditTimeline,
  buildOrderNumberHistory,
  buildPaymentTimeline,
  filterPaymentOrders,
  getInvoiceNumber,
  paymentHistoryRowsToCsv,
  paymentHistoryToCsv,
  type CsvPaymentRow,
} from "./payment-history";
import type { Order } from "./types";

function makeOrder(partial: Partial<Order> & { id: string; orderNumber: string }): Order {
  return {
    userId: "u1",
    type: "package",
    items: [],
    totalAmount: 10000,
    status: "pending",
    paymentStatus: "pending",
    metadata: {},
    createdAt: "2026-08-16T10:00:00.000Z",
    ...partial,
  };
}

const paid = makeOrder({ id: "o1", orderNumber: "VS-20260816-0001", paymentStatus: "paid", status: "paid" });
const failed = makeOrder({ id: "o2", orderNumber: "VS-20260816-0002", paymentStatus: "failed", status: "cancelled" });
const expired = makeOrder({ id: "o3", orderNumber: "VS-20260816-0003", paymentStatus: "expired", status: "cancelled" });
const pending = makeOrder({ id: "o4", orderNumber: "VS-20260816-0004", paymentStatus: "pending", status: "pending" });
const retried = makeOrder({
  id: "o5",
  orderNumber: "VS-20260816-0005",
  paymentStatus: "failed",
  status: "cancelled",
  metadata: {
    originalOrderNumber: "VS-20260816-0000",
    previousOrderNumbers: ["VS-20260816-0000"],
  },
});

const all = [paid, failed, expired, pending, retried];

describe("filterPaymentOrders — tab status", () => {
  it("tanpa filter mengembalikan semua order", () => {
    expect(filterPaymentOrders(all)).toHaveLength(5);
    expect(filterPaymentOrders(all, undefined, undefined)).toHaveLength(5);
  });

  it("status=paid hanya order lunas", () => {
    const out = filterPaymentOrders(all, "paid");
    expect(out.map((o) => o.id)).toEqual(["o1"]);
  });

  it("status=failed mencakup failed DAN expired (tab Gagal)", () => {
    const out = filterPaymentOrders(all, "failed");
    expect(out.map((o) => o.id).sort()).toEqual(["o2", "o3", "o5"]);
  });

  it("status tak dikenal diperlakukan sebagai Semua", () => {
    expect(filterPaymentOrders(all, "gagal")).toHaveLength(5);
  });
});

describe("filterPaymentOrders — tab jenis transaksi", () => {
  const topup = makeOrder({ id: "t1", orderNumber: "VS-20260816-0011", type: "topup" });
  const merch = makeOrder({ id: "m1", orderNumber: "VS-20260816-0012", type: "merchandise" });
  const allTypes = [...all, topup, merch]; // 5 package + 1 topup + 1 merchandise

  it("tanpa type → semua jenis ikut", () => {
    expect(filterPaymentOrders(allTypes, undefined, undefined, undefined)).toHaveLength(7);
    expect(filterPaymentOrders(allTypes, undefined, undefined, "")).toHaveLength(7);
  });

  it("type=package / topup / merchandise memfilter sesuai jenis", () => {
    expect(filterPaymentOrders(allTypes, undefined, undefined, "package")).toHaveLength(5);
    expect(filterPaymentOrders(allTypes, undefined, undefined, "topup")).toHaveLength(1);
    expect(filterPaymentOrders(allTypes, undefined, undefined, "merchandise")).toHaveLength(1);
  });

  it("type tak dikenal diperlakukan sebagai Semua", () => {
    expect(filterPaymentOrders(allTypes, undefined, undefined, "gopay")).toHaveLength(7);
  });

  it("kombinasi status + type + pencarian (AND)", () => {
    // Satu topup failed → gabungan menghasilkan hanya itu.
    const failedTopup = makeOrder({
      id: "t2",
      orderNumber: "VS-20260816-0021",
      type: "topup",
      paymentStatus: "failed",
      status: "cancelled",
    });
    const out = filterPaymentOrders([...allTypes, failedTopup], "failed", "0021", "topup");
    expect(out).toEqual([failedTopup]);
    // status=paid + type=topup → tidak ada yang cocok.
    expect(filterPaymentOrders([...allTypes, failedTopup], "paid", undefined, "topup")).toEqual([]);
  });
});

describe("filterPaymentOrders — pencarian nomor order", () => {
  it("mencocokkan substring nomor order (case-insensitive)", () => {
    const out = filterPaymentOrders(all, undefined, "vs-20260816-0002");
    expect(out.map((o) => o.id)).toEqual(["o2"]);
  });

  it("mencocokkan originalOrderNumber order hasil retry", () => {
    const out = filterPaymentOrders(all, undefined, "VS-20260816-0000");
    expect(out.map((o) => o.id)).toEqual(["o5"]);
  });

  it("mencocokkan previousOrderNumbers order hasil retry", () => {
    const out = filterPaymentOrders(all, undefined, "0000");
    expect(out.map((o) => o.id)).toEqual(["o5"]);
  });

  it("kombinasi tab + pencarian (AND)", () => {
    const out = filterPaymentOrders(all, "failed", "0000");
    expect(out.map((o) => o.id)).toEqual(["o5"]);
  });

  it("pencarian tanpa hasil mengembalikan []", () => {
    expect(filterPaymentOrders(all, undefined, "VS-9999")).toEqual([]);
  });
});

describe("paymentHistoryToCsv — ekspor CSV riwayat", () => {
  it("header + satu baris per order (nomor, jenis, status, nominal, tanggal)", () => {
    const failedTopup = makeOrder({
      id: "t1",
      orderNumber: "VS-20260816-0101",
      type: "topup",
      paymentStatus: "failed",
      status: "cancelled",
      totalAmount: 15000,
      metadata: { failureReason: "Ditolak bank" },
      createdAt: "2026-08-16T10:00:00.000Z",
    });
    const csv = paymentHistoryToCsv([paid, failedTopup]);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('"Nomor Order","Jenis","Status","Nominal","Tanggal"');
    expect(lines[1]).toContain('"VS-20260816-0001"');
    expect(lines[1]).toContain('"Paket"');
    expect(lines[1]).toContain('"Berhasil"');
    expect(lines[2]).toContain('"VS-20260816-0101"');
    expect(lines[2]).toContain('"Top Up"');
    // Label status memakai alasan spesifik (paymentBadge), bukan generik.
    expect(lines[2]).toContain('"Ditolak bank"');
    expect(lines[2]).toContain('15000'); // nominal angka mentah
  });

  it("escaping: tanda kutip di dalam nilai digandakan; koma aman", () => {
    const odd = makeOrder({
      id: "o9",
      orderNumber: "VS-1,2\"3",
      paymentStatus: "expired",
      status: "cancelled",
      metadata: { failureReason: "Alasan \"khusus\", berkom" },
    });
    const csv = paymentHistoryToCsv([odd]);
    expect(csv).toContain('"VS-1,2""3"');
    expect(csv).toContain('"Alasan ""khusus"", berkom"');
  });

  it("tanpa order → hanya baris header", () => {
    expect(paymentHistoryToCsv([])).toBe('"Nomor Order","Jenis","Status","Nominal","Tanggal"\r\n');
  });
});

describe("paymentHistoryRowsToCsv — ekspor CSV admin (kolom Pelanggan)", () => {
  const adminRow: CsvPaymentRow = {
    orderNumber: "VS-20260816-0101",
    customerName: "Budi Santoso",
    type: "topup",
    totalAmount: 15000,
    paymentStatus: "failed",
    failureReason: "Ditolak bank",
    createdAt: "2026-08-16T10:00:00.000Z",
  };

  it("header menyertakan Pelanggan bila salah satu baris punya customerName", () => {
    const csv = paymentHistoryRowsToCsv([adminRow]);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('"Nomor Order","Pelanggan","Jenis","Status","Nominal","Tanggal"');
    expect(lines[1]).toContain('"Budi Santoso"');
    expect(lines[1]).toContain('"Top Up"');
    expect(lines[1]).toContain('"Ditolak bank"'); // alasan spesifik ikut di label status
    expect(lines[1]).toContain('15000');
  });

  it("baris tanpa customerName → kolom Pelanggan '—' (header tetap 6 kolom)", () => {
    const noName: CsvPaymentRow = {
      orderNumber: "VS-20260816-0102",
      type: "package",
      totalAmount: 10000,
      paymentStatus: "paid",
      createdAt: "2026-08-16T10:00:00.000Z",
    };
    const csv = paymentHistoryRowsToCsv([noName, adminRow]);
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toBe('"Nomor Order","Pelanggan","Jenis","Status","Nominal","Tanggal"');
    expect(lines[1]).toContain('"—"');
  });

  it("tanpa customerName sama sekali → header 5 kolom (mode pelanggan)", () => {
    const csv = paymentHistoryRowsToCsv([
      {
        orderNumber: "VS-1",
        type: "package",
        totalAmount: 5000,
        paymentStatus: "pending",
        createdAt: "2026-08-16T10:00:00.000Z",
      },
    ]);
    expect(csv.trim().split(/\r?\n/)[0]).toBe('"Nomor Order","Jenis","Status","Nominal","Tanggal"');
  });
});

describe("filterPaymentOrders — baris admin (PaymentOrderLike tanpa metadata penuh)", () => {
  it("memfilter baris admin berdasarkan status & jenis tanpa metadata", () => {
    const rows = [
      {
        orderNumber: "VS-1",
        type: "topup" as const,
        paymentStatus: "paid",
        createdAt: "t",
        customerName: "A",
      },
      {
        orderNumber: "VS-2",
        type: "topup" as const,
        paymentStatus: "failed",
        createdAt: "t",
        customerName: "B",
      },
    ];
    const out = filterPaymentOrders(rows, "paid", undefined, "topup");
    expect(out.map((r) => r.customerName)).toEqual(["A"]);
  });

  it("baris tanpa metadata tetap aman saat pencarian nomor (tidak throw)", () => {
    const rows = [
      {
        orderNumber: "VS-3",
        type: "package" as const,
        paymentStatus: "pending",
        createdAt: "t",
      },
    ];
    expect(filterPaymentOrders(rows, undefined, "VS-3")).toEqual(rows);
    expect(filterPaymentOrders(rows, undefined, "0000")).toEqual([]);
  });
});

describe("getInvoiceNumber — nomor invoice stabil", () => {
  it("mengembalikan metadata.invoiceNumber bila valid (format VS-INV-…)", () => {
    const o = makeOrder({
      id: "inv1",
      orderNumber: "VS-20260817-0001",
      metadata: { invoiceNumber: "VS-INV-20260817-0007" },
    });
    expect(getInvoiceNumber(o)).toBe("VS-INV-20260817-0007");
  });

  it("fallback ke nomor order bila metadata kosong (order lama)", () => {
    const o = makeOrder({ id: "inv2", orderNumber: "VS-20260817-0001" });
    expect(getInvoiceNumber(o)).toBe("VS-20260817-0001");
  });

  it("fallback ke nomor order bila nilai bukan format VS-INV-…", () => {
    const o = makeOrder({
      id: "inv3",
      orderNumber: "VS-20260817-0001",
      metadata: { invoiceNumber: "INV-1" },
    });
    expect(getInvoiceNumber(o)).toBe("VS-20260817-0001");
  });
});

describe("buildAuditTimeline (panel detail admin & detail transaksi)", () => {
  it("melabeli event kronologis + menandai entri terakhir sebagai saat ini", () => {
    const steps = buildAuditTimeline([
      { at: "t1", source: "create", event: "created", paymentStatus: "pending" },
      {
        at: "t2",
        source: "snap",
        event: "error",
        paymentStatus: "pending",
        statusCode: "202",
        statusMessage: "denied by bank",
      },
      {
        at: "t3",
        source: "status-api",
        event: "failed",
        paymentStatus: "failed",
        detail: "Ditolak bank",
      },
    ]);
    expect(steps).toHaveLength(3);
    expect(steps[0].label).toBe("Dibuat");
    expect(steps[0].sourceLabel).toBe("Order");
    expect(steps[0].isLatest).toBe(false);
    expect(steps[1].label).toBe("Snap Error");
    expect(steps[1].statusCode).toBe("202");
    expect(steps[1].statusMessage).toBe("denied by bank");
    expect(steps[2].label).toBe("Gagal");
    expect(steps[2].sourceLabel).toBe("Status API");
    expect(steps[2].isLatest).toBe(true);
    expect(steps[2].detail).toBe("Ditolak bank");
  });

  it("array kosong → [] (panel menampilkan 'Belum ada riwayat audit')", () => {
    expect(buildAuditTimeline([])).toEqual([]);
  });
});

describe("buildPaymentTimeline (detail transaksi)", () => {
  it("membangun langkah kronologis dari metadata.paymentAudit", () => {
    const order = makeOrder({
      id: "o-timeline",
      orderNumber: "VS-20260816-0009",
      metadata: {
        paymentAudit: [
          {
            at: "2026-08-16T10:00:00.000Z",
            source: "create",
            event: "created",
            paymentStatus: "pending",
            orderNumber: "VS-20260816-0009",
          },
          {
            at: "2026-08-16T10:05:00.000Z",
            source: "webhook",
            event: "paid",
            paymentStatus: "paid",
            statusCode: "200",
            statusMessage: "Transaction is settlement",
            transactionStatus: "settlement",
            transactionId: "txn-123456789",
            paymentType: "qris",
            orderNumber: "VS-20260816-0009",
          },
        ],
      },
    });
    const steps = buildPaymentTimeline(order);
    expect(steps).toHaveLength(2);
    // Kronologis: tertua dulu.
    expect(steps[0].label).toBe("Dibuat");
    expect(steps[0].isLatest).toBe(false);
    expect(steps[0].sourceLabel).toBe("Order");
    expect(steps[1].label).toBe("Berhasil");
    expect(steps[1].isLatest).toBe(true);
    expect(steps[1].statusCode).toBe("200");
    expect(steps[1].transactionId).toBe("txn-123456789");
  });

  it("label & sumber yang tidak dikenal dipertahankan apa adanya", () => {
    const order = makeOrder({
      id: "o-x",
      orderNumber: "VS-1",
      metadata: {
        paymentAudit: [
          {
            at: "2026-08-16T10:00:00.000Z",
            source: "mystery-source",
            event: "mystery-event",
            paymentStatus: "pending",
          },
        ],
      },
    });
    const steps = buildPaymentTimeline(order);
    expect(steps[0].label).toBe("mystery-event");
    expect(steps[0].sourceLabel).toBe("mystery-source");
    expect(steps[0].isLatest).toBe(true);
  });

  it("tanpa paymentAudit → timeline kosong", () => {
    const order = makeOrder({ id: "o-empty", orderNumber: "VS-2" });
    expect(buildPaymentTimeline(order)).toEqual([]);
  });

  it("channel_response_code/message diteruskan ke langkah timeline", () => {
    const order = makeOrder({
      id: "o-channel",
      orderNumber: "VS-3",
      metadata: {
        paymentAudit: [
          {
            at: "2026-08-16T10:00:00.000Z",
            source: "webhook",
            event: "failed",
            paymentStatus: "failed",
            statusCode: "202",
            transactionStatus: "deny",
            paymentType: "ovo",
            channelResponseCode: "68",
            channelResponseMessage: "OVO Wallet late to give response to OVO JPOS",
          },
        ],
      },
    });
    const steps = buildPaymentTimeline(order);
    expect(steps[0].channelResponseCode).toBe("68");
    expect(steps[0].channelResponseMessage).toBe(
      "OVO Wallet late to give response to OVO JPOS"
    );
    expect(steps[0].paymentType).toBe("ovo");
  });
});

describe("buildOrderNumberHistory — riwayat penggantian nomor order (retry)", () => {
  it("tanpa retry → [] (tidak ada transisi)", () => {
    const order = makeOrder({ id: "o-n", orderNumber: "VS-20260816-0004" });
    expect(buildOrderNumberHistory(order)).toEqual([]);
  });

  it("satu retry → [{ from: nomor lama, to: nomor saat ini }]", () => {
    const order = makeOrder({
      id: "o-r1",
      orderNumber: "VS-20260816-0005",
      metadata: {
        originalOrderNumber: "VS-20260816-0004",
        previousOrderNumbers: ["VS-20260816-0004"],
      },
    });
    expect(buildOrderNumberHistory(order)).toEqual([
      { from: "VS-20260816-0004", to: "VS-20260816-0005" },
    ]);
  });

  it("multi-retry → rantai transisi lengkap (0001→0002, 0002→0003)", () => {
    const order = makeOrder({
      id: "o-r2",
      orderNumber: "VS-20260816-0003",
      metadata: {
        originalOrderNumber: "VS-20260816-0001",
        previousOrderNumbers: ["VS-20260816-0001", "VS-20260816-0002"],
      },
    });
    expect(buildOrderNumberHistory(order)).toEqual([
      { from: "VS-20260816-0001", to: "VS-20260816-0002" },
      { from: "VS-20260816-0002", to: "VS-20260816-0003" },
    ]);
  });

  it("previousOrderNumbers[0] sama dengan original → di-dedupe (bukan lompatan ganda)", () => {
    // Retry pertama menyimpan original DAN menaruhnya di previousOrderNumbers
    // (duplikat) — rantai harus tetap [original, current], bukan [orig, orig, cur].
    const order = makeOrder({
      id: "o-r3",
      orderNumber: "VS-20260816-0006",
      metadata: {
        originalOrderNumber: "VS-20260816-0005",
        previousOrderNumbers: ["VS-20260816-0005", "VS-20260816-0006"],
      },
    });
    expect(buildOrderNumberHistory(order)).toEqual([
      { from: "VS-20260816-0005", to: "VS-20260816-0006" },
    ]);
  });

  it("metada parsial (hanya previousOrderNumbers) tetap menghasilkan rantai dari nomor saat ini", () => {
    const order = makeOrder({
      id: "o-r4",
      orderNumber: "VS-20260816-0007",
      metadata: { previousOrderNumbers: ["VS-20260816-0006"] },
    });
    expect(buildOrderNumberHistory(order)).toEqual([
      { from: "VS-20260816-0006", to: "VS-20260816-0007" },
    ]);
  });
});

describe("auditDisplayText — alasan tampil, status_message mentah disimpan terpisah", () => {
  it("alasan terpetakan (detail) jadi teks utama; status_message mentah jadi baris raw", () => {
    // Skenario webhook deny: detail = alasan terpetakan, statusMessage = mentah.
    const t = auditDisplayText({
      detail: "Pembayaran ditolak oleh bank",
      statusMessage: "Transaction is denied",
      transactionStatus: "deny",
    });
    expect(t.primary).toBe("Pembayaran ditolak oleh bank");
    expect(t.raw).toBe("Transaction is denied");
  });

  it("tanpa detail → fallback transaction_status lalu status_message mentah (tanpa baris raw duplikat)", () => {
    expect(auditDisplayText({ transactionStatus: "deny", statusMessage: "Transaction is denied" })).toEqual({
      primary: "deny",
      raw: "Transaction is denied",
    });
    expect(auditDisplayText({ statusMessage: "Transaction is pending" })).toEqual({
      primary: "Transaction is pending",
      raw: undefined,
    });
  });

  it("status_message mentah SAMA dengan alasan → tidak ada baris raw duplikat", () => {
    const t = auditDisplayText({
      detail: "Saldo tidak mencukupi (QRIS)",
      statusMessage: "Saldo tidak mencukupi (QRIS)",
    });
    expect(t.primary).toBe("Saldo tidak mencukupi (QRIS)");
    expect(t.raw).toBeUndefined();
  });

  it("semua kosong → { primary: undefined, raw: undefined }", () => {
    expect(auditDisplayText({})).toEqual({ primary: undefined, raw: undefined });
    expect(auditDisplayText({ statusMessage: "" })).toEqual({ primary: undefined, raw: undefined });
  });

  it("langkah timeline membawa detail & statusMessage utuh (data mentah tak hilang)", () => {
    const order = makeOrder({
      id: "o-raw",
      orderNumber: "VS-4",
      metadata: {
        paymentAudit: [
          {
            at: "2026-08-16T10:00:00.000Z",
            source: "webhook",
            event: "failed",
            paymentStatus: "failed",
            statusCode: "202",
            transactionStatus: "deny",
            statusMessage: "Transaction is denied",
            detail: "Pembayaran ditolak oleh bank",
          },
        ],
      },
    });
    const steps = buildPaymentTimeline(order);
    const t = auditDisplayText(steps[0]);
    // Alasan yang tampil + data mentah yang tersimpan — keduanya utuh.
    expect(t.primary).toBe("Pembayaran ditolak oleh bank");
    expect(t.raw).toBe("Transaction is denied");
    expect(steps[0].detail).toBe("Pembayaran ditolak oleh bank");
    expect(steps[0].statusMessage).toBe("Transaction is denied");
  });
});
