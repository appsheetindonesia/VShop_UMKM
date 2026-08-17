/**
 * Unit test modul QR verifikasi invoice (src/lib/invoice-qr.ts): payload
 * JSON kompak (nomor invoice stabil, total, ID transaksi) + pembuatan data
 * URL PNG server-side (paket `qrcode`).
 */
import { describe, expect, it } from "vitest";
import {
  buildInvoiceQrPayload,
  buildInvoiceQrPayloadFromOrder,
  invoiceQrDataUrl,
} from "./invoice-qr";
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
    createdAt: "2026-08-17T10:00:00.000Z",
    ...partial,
  };
}

describe("buildInvoiceQrPayload — payload pembayaran verifikasi", () => {
  it("berisi nomor invoice, total, ID transaksi, nomor order & tanggal", () => {
    const payload = buildInvoiceQrPayload({
      invoiceNumber: "VS-INV-20260817-0001",
      orderNumber: "VS-20260817-0003",
      totalAmount: 7000,
      transactionId: "txn-abc-123",
      createdAt: "2026-08-17T12:35:00.000Z",
    });
    expect(JSON.parse(payload)).toEqual({
      v: 1,
      inv: "VS-INV-20260817-0001",
      order: "VS-20260817-0003",
      total: 7000,
      tid: "txn-abc-123",
      date: "2026-08-17",
    });
  });

  it("tid kosong bila transaksi belum punya transaction_id (order pending)", () => {
    const payload = JSON.parse(
      buildInvoiceQrPayload({
        invoiceNumber: "VS-INV-20260817-0001",
        orderNumber: "VS-20260817-0003",
        totalAmount: 7000,
        createdAt: "2026-08-17T12:35:00.000Z",
      })
    );
    expect(payload.tid).toBe("");
    expect(payload.total).toBe(7000); // nominal angka mentah, ramah pemindai
  });

  it("buildInvoiceQrPayloadFromOrder — delegasi dari order penuh", () => {
    const order = makeOrder({
      id: "o1",
      orderNumber: "VS-20260817-0003",
      totalAmount: 25000,
      createdAt: "2026-08-12T08:00:00.000Z",
    });
    const payload = JSON.parse(
      buildInvoiceQrPayloadFromOrder(order, {
        invoiceNumber: "VS-INV-20260817-0001",
        transactionId: "tid-9",
      })
    );
    expect(payload.inv).toBe("VS-INV-20260817-0001");
    expect(payload.order).toBe("VS-20260817-0003");
    expect(payload.total).toBe(25000);
    expect(payload.tid).toBe("tid-9");
    expect(payload.date).toBe("2026-08-12");
  });
});

describe("invoiceQrDataUrl — QR server-side", () => {
  it("mengembalikan data URL PNG yang bisa dipakai <img src>", async () => {
    const url = await invoiceQrDataUrl(
      '{"v":1,"inv":"VS-INV-20260817-0001","order":"VS-20260817-0003","total":7000,"tid":"","date":"2026-08-17"}',
      { width: 96 }
    );
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    // PNG nyata (tanda tangan header PNG: 8 byte 89 50 4E 47 0D 0A 1A 0A).
    const b64 = url.split(",")[1] ?? "";
    const head = Buffer.from(b64, "base64").subarray(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("payload berbeda → QR berbeda (data URL tidak sama)", async () => {
    const a = await invoiceQrDataUrl('{"inv":"A"}', { width: 64 });
    const b = await invoiceQrDataUrl('{"inv":"B"}', { width: 64 });
    expect(a).not.toBe(b);
  });
});
