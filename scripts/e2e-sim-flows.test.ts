/**
 * E2E ALUR SUKSES & GAGAL vs SIMULATOR Midtrans (`scripts/midtrans-simulator.ts`).
 *
 * Membuktikan dua alur end-to-end melalui modul ASLI (`src/lib/midtrans.ts`,
 * `src/lib/service.ts`, `src/lib/db.ts`) — OTOMATIS, tanpa kredensial sandbox
 * asli (env: `MIDTRANS_SERVER_KEY` tiruan + `MIDTRANS_API_BASE` → simulator,
 * store mode demo JSON di temp dir):
 *
 *   1. **SUKSES QRIS** — `sim.settleQris()` → Status API settlement/200,
 *      `payment_type: "qris"` → `isMidtransPaid` true → `markOrderPaid` →
 *      order `paid`, metode `QRIS`, `paidAt` terisi, tanpa alasan gagal.
 *   2. **GAGAL GOPAY** — `sim.denyGopay()` → Status API deny/202 + `payment_type:
 *      "gopay"` + `channel_response_code: "201"` (Saldo GoPay tidak mencukupi)
 *      → `midtransTerminalFailure` "failed" → `midtransFailureReason` memilih
 *      alasan SPESIFIK kanal (bukan 202 umum) → `markOrderFailed` → order
 *      `failed` dengan `metadata.failureReason` presisi.
 *
 * Dijalankan otomatis oleh `npm test`. Khusus: `npm run test:e2e-sim`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startMidtransSimulator, type MidtransSimulator } from "./midtrans-simulator";

const SERVER_KEY = "SB-Mid-server-simulator-local-test";

const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let sim: MidtransSimulator;
let tempDir = "";
const saveEnv: Record<string, string | undefined> = {};

function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    if (!(k in saveEnv)) saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeAll(async () => {
  sim = await startMidtransSimulator({ serverKey: SERVER_KEY });
});

afterAll(async () => {
  await sim.close();
  for (const [k, v] of Object.entries(saveEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-e2e-sim-flows-"));
  for (const k of SUPABASE_ENV_KEYS) setEnv({ [k]: undefined });
  setEnv({
    VSHOP_DATA_DIR: tempDir,
    MIDTRANS_SERVER_KEY: SERVER_KEY,
    MIDTRANS_API_BASE: sim.url,
    MIDTRANS_IS_PRODUCTION: undefined,
    MIDTRANS_CLIENT_KEY: undefined,
    ORDER_EXPIRY_HOURS: "24",
  });
  sim.transactions.clear();
  sim.usedOrderIds.clear();
  vi.resetModules();
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  vi.resetModules();
});

/** Import db + service + midtrans FRESH dengan env simulator (mode demo JSON). */
async function freshSvc() {
  const db = await import("../src/lib/db");
  await db.ensureHydrated();
  expect(db.getStoreMode()).toBe("json");
  const svc = await import("../src/lib/service");
  const midtrans = await import("../src/lib/midtrans");
  return { db, svc, midtrans };
}

describe("e2e alur SUKSES QRIS vs simulator (settleQris)", () => {
  it("create → settleQris → Status API settlement/qris → order paid (QRIS) tanpa alasan gagal", async () => {
    const { db, svc, midtrans } = await freshSvc();

    // 1. Buat order — transaksi dibuat di simulator via HTTP nyata (pending/201).
    const { order } = await svc.createOrder({
      userId: "usr-1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    const tx = sim.transactions.get(order.orderNumber)!;
    expect(tx).toBeDefined();
    expect(tx.transactionStatus).toBe("pending");
    expect(tx.statusCode).toBe("201");
    expect(tx.paymentType).toBe("qris"); // Snap default di simulator

    // 2. Pelanggan membayar QRIS → simulator SETTLEMENT QRIS.
    sim.settleQris(order.orderNumber);
    const status = await midtrans.getMidtransStatus(order.orderNumber);
    expect(status.transaction_status).toBe("settlement");
    expect(status.status_code).toBe("200");
    expect(status.payment_type).toBe("qris");
    // Sukses → bukan kegagalan: terminal failure null & tanpa alasan gagal.
    expect(midtrans.midtransTerminalFailure(status)).toBeNull();
    expect(midtrans.midtransFailureReason(status)).toBeNull();
    expect(midtrans.isMidtransPaid(status)).toBe(true);

    // 3. Aplikasi menandai lunas lewat jalur yang dipakai webhook/reconcile.
    svc.markOrderPaid(order.id, midtrans.paymentTypeToMethod(status.payment_type));
    const paid = db.getDB().orders.find((x) => x.id === order.id)!;
    expect(paid.paymentStatus).toBe("paid");
    expect(paid.paymentMethod).toBe("QRIS"); // paymentTypeToMethod("qris")
    expect(paid.paidAt).toBeTruthy();
    expect(paid.metadata.failureReason).toBeUndefined();

    // 4. Status API tetap settlement pada pembacaan berikutnya (idempoten).
    const again = await midtrans.getMidtransStatus(order.orderNumber);
    expect(midtrans.isMidtransPaid(again)).toBe(true);
  });
});

describe("e2e alur GAGAL GOPAY vs simulator (denyGopay)", () => {
  it("create → denyGopay → deny/202 + channel 201 → alasan spesifik GoPay → order failed", async () => {
    const { db, svc, midtrans } = await freshSvc();

    // 1. Buat order (transaksi pending/201).
    const { order } = await svc.createOrder({
      userId: "usr-1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    expect(sim.transactions.get(order.orderNumber)!.transactionStatus).toBe("pending");

    // 2. Pelanggan gagal bayar GoPay → simulator DENY GOPAY (channel 201).
    sim.denyGopay(order.orderNumber);
    const status = await midtrans.getMidtransStatus(order.orderNumber);
    expect(status.transaction_status).toBe("deny");
    expect(status.status_code).toBe("202");
    expect(status.payment_type).toBe("gopay");
    // Field CHANNEL ikut di Status API — persis seperti GoPay asli.
    expect(status.channel_response_code).toBe("201");
    expect(status.channel_response_message).toBe("Saldo tidak mencukupi");

    // 3. Terminal → "failed", dengan alasan SPESIFIK kanal (bukan 202 umum).
    // Alasan = alasan tabel GoPay + pesan mentah penyedia (pola adapter).
    expect(midtrans.midtransTerminalFailure(status)).toBe("failed");
    const failure = midtrans.midtransFailureReason(status);
    expect(failure).toEqual({
      code: "201",
      reason: "Saldo GoPay tidak mencukupi — Saldo tidak mencukupi",
    });
    expect(failure!.reason).not.toBe("Pembayaran ditolak oleh bank"); // lebih presisi
    // Jalur langsung kanal juga konsisten.
    expect(
      midtrans.midtransChannelFailureReason(status.payment_type, status.channel_response_code, status.channel_response_message)
    ).toEqual({ code: "201", reason: "Saldo GoPay tidak mencukupi — Saldo tidak mencukupi" });

    // 4. Aplikasi menandai gagal dengan alasan spesifik → metadata terisi.
    svc.markOrderFailed(order.id, "failed", failure!.reason);
    const failed = db.getDB().orders.find((x) => x.id === order.id)!;
    expect(failed.paymentStatus).toBe("failed");
    expect(failed.metadata.failureReason).toBe("Saldo GoPay tidak mencukupi — Saldo tidak mencukupi");
    expect(failed.paidAt).toBeUndefined();

    // 5. Deny GoPay dengan channel kode LAIN (OTP salah 1604) tetap terpetakan.
    // `channelResponseMessage: ""` → adapter memakai alasan tabel saja.
    await svc.retryOrderPayment(order.id);
    const newNumber = db.getDB().orders.find((x) => x.id === order.id)!.orderNumber;
    sim.denyGopay(newNumber, {
      channelResponseCode: "1604",
      channelResponseMessage: "",
    });
    const status2 = await midtrans.getMidtransStatus(newNumber);
    const failure2 = midtrans.midtransFailureReason(status2);
    expect(failure2).toEqual({ code: "1604", reason: "Kode OTP GoPay tidak valid" });
  });
});
