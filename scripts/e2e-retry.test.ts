/**
 * E2E retry pembayaran vs SIMULATOR Midtrans (fixture
 * `scripts/midtrans-simulator.ts`) — OTOMATIS, tanpa kredensial sandbox asli.
 *
 * Menjalankan modul ASLI (`src/lib/midtrans.ts`, `src/lib/service.ts`,
 * `src/lib/db.ts`) dengan env:
 *   - `MIDTRANS_SERVER_KEY` → kunci sandbox tiruan (adapter mode ASLI, bukan
 *     demo: memanggil HTTP beneran ke simulator);
 *   - `MIDTRANS_API_BASE`   → URL simulator (seam resmi adapter);
 *   - tanpa env Supabase + `VSHOP_DATA_DIR` temp → store mode demo (JSON).
 *
 * Alur yang diverifikasi (persis "Coba Lagi" di layar Pembayaran Gagal):
 *   1. `createOrder` → transaksi dibuat di simulator (pending/201);
 *   2. pelanggan gagal bayar → `fail()` deny/202 → Status API + adapter
 *      memetakan alasan spesifik \"Pembayaran ditolak oleh bank\";
 *   3. order_id lama TIDAK bisa dipakai ulang → simulator menolak 406
 *      (\"Nomor order sudah pernah dipakai\") — alasan retry memakai nomor baru;
 *   4. `retryOrderPayment` → nomor order BARU → simulator menerima transaksi
 *      baru; riwayat nomor tersimpan di metadata;
 *   5. bayar sukses transaksi baru → `settle()` settlement/200 →
 *      `isMidtransPaid` true → order lunas.
 *
 * Dijalankan otomatis oleh `npm test`. Khusus: `npm run test:e2e-retry`.
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-e2e-retry-"));
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

describe("e2e retry pembayaran vs simulator Midtrans", () => {
  it("alur coba lagi: deny (202) → duplikat 406 → retry nomor baru → sukses settlement", async () => {
    const { db, svc, midtrans } = await freshSvc();

    // 1. Buat order — transaksi dibuat di simulator via HTTP nyata.
    const { order } = await svc.createOrder({
      userId: "usr-1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    const oldNumber = order.orderNumber;
    const firstTx = sim.transactions.get(oldNumber);
    expect(firstTx).toBeDefined();
    expect(firstTx!.transactionStatus).toBe("pending");
    expect(firstTx!.statusCode).toBe("201");

    // 2. Pelanggan gagal bayar → simulator deny (202) → alasan spesifik.
    sim.fail(oldNumber, { statusCode: "202" });
    const status1 = await midtrans.getMidtransStatus(oldNumber);
    const failure = midtrans.midtransFailureReason(status1);
    expect(failure?.code).toBe("202");
    expect(failure?.reason).toBe("Pembayaran ditolak oleh bank");
    svc.markOrderFailed(order.id, "failed", failure!.reason);

    // 3. Duplikat: order_id terminal TIDAK bisa dipakai ulang → 406.
    await expect(
      midtrans.createPaymentTransaction({
        orderId: order.id,
        orderNumber: oldNumber,
        totalAmount: 7000,
      })
    ).rejects.toThrow(/Nomor order sudah pernah dipakai/);
    expect(sim.transactions.get(oldNumber)!.transactionStatus).toBe("deny");

    // 4. Retry → nomor BARU → simulator menerima transaksi baru (bukan duplikat).
    const retried = await svc.retryOrderPayment(order.id);
    const newNumber = retried.orderNumber;
    expect(newNumber).not.toBe(oldNumber);
    expect(sim.transactions.has(newNumber)).toBe(true);
    expect(sim.transactions.get(newNumber)!.transactionStatus).toBe("pending");
    const o = db.getDB().orders.find((x) => x.id === order.id)!;
    expect(o.metadata.previousOrderNumbers).toEqual([oldNumber]);
    expect(o.metadata.originalOrderNumber).toBe(oldNumber);
    expect(o.metadata.failureReason).toBeUndefined(); // alasan lama dibersihkan
    expect(o.paymentStatus).toBe("pending");

    // 5. Bayar sukses transaksi baru → settlement → order lunas.
    sim.settle(newNumber, { paymentType: "qris" });
    const status2 = await midtrans.getMidtransStatus(newNumber);
    expect(midtrans.isMidtransPaid(status2)).toBe(true);
    svc.markOrderPaid(order.id, "qris");
    const paid = db.getDB().orders.find((x) => x.id === order.id)!;
    expect(paid.paymentStatus).toBe("paid");
    expect(paid.paidAt).toBeTruthy();
    expect(paid.paymentMethod).toBe("qris");

    // Riwayat kronologi tercatat (created → failed → retry → paid).
    const audit = paid.metadata.paymentAudit as Array<{ event: string }>;
    const events = audit.map((e) => e.event);
    expect(events).toContain("failed");
    expect(events).toContain("retry");
    expect(events).toContain("paid");
  });
});

describe("fixture simulator: status matrix + tolak duplikat", () => {
  it("create → settle/fail/expire mengubah Status API; 404 & 406 sesuai kontrak", async () => {
    const { midtrans } = await freshSvc();

    // Create — token asli dari simulator (mock: false).
    const r1 = await midtrans.createPaymentTransaction({
      orderId: "ord-a",
      orderNumber: "VS-SIM-0001",
      totalAmount: 15000,
    });
    expect(r1.mock).toBe(false);
    expect(r1.token).toMatch(/^snap-sim-/);
    expect(r1.redirectUrl).toContain("127.0.0.1");
    expect(sim.transactions.get("VS-SIM-0001")!.transactionStatus).toBe("pending");

    // Settlement → paid.
    sim.settle("VS-SIM-0001");
    const st1 = await midtrans.getMidtransStatus("VS-SIM-0001");
    expect(midtrans.isMidtransPaid(st1)).toBe(true);
    expect(st1.payment_type).toBe("qris");

    // Expire → terminal gagal "kadaluarsa".
    await midtrans.createPaymentTransaction({
      orderId: "ord-b",
      orderNumber: "VS-SIM-0002",
      totalAmount: 5000,
    });
    sim.expire("VS-SIM-0002");
    const st2 = await midtrans.getMidtransStatus("VS-SIM-0002");
    expect(midtrans.midtransTerminalFailure(st2)).toBe("expired");
    expect(midtrans.midtransFailureReason(st2)?.reason).toBe("Waktu pembayaran habis");

    // Fail dengan kode kustom (mis. QRIS saldo kurang 216).
    await midtrans.createPaymentTransaction({
      orderId: "ord-c",
      orderNumber: "VS-SIM-0003",
      totalAmount: 9000,
    });
    sim.fail("VS-SIM-0003", {
      statusCode: "216",
      statusMessage: "Saldo tidak mencukupi (QRIS)",
    });
    const st3 = await midtrans.getMidtransStatus("VS-SIM-0003");
    expect(midtrans.midtransFailureReason(st3)?.reason).toBe("Saldo tidak mencukupi (QRIS)");

    // 404 — transaksi tidak dikenal → adapter melempar.
    await expect(midtrans.getMidtransStatus("VS-SIM-NOPE")).rejects.toThrow(/404/);

    // 406 — order_id ditandai sudah dipakai tanpa transaksi aktif.
    sim.markUsed("VS-SIM-0004");
    await expect(
      midtrans.createPaymentTransaction({
        orderId: "ord-d",
        orderNumber: "VS-SIM-0004",
        totalAmount: 1000,
      })
    ).rejects.toThrow(/Nomor order sudah pernah dipakai/);

    // Auth salah → 401: adapter tetap memakai SERVER_KEY (kunci A), tapi
    // diarahkan ke simulator yang mengharapkan kunci berbeda (kunci B).
    const wrongKey = await startMidtransSimulator({ serverKey: "SB-Mid-server-salah" });
    try {
      setEnv({ MIDTRANS_API_BASE: wrongKey.url }); // MIDTRANS_SERVER_KEY tetap A
      vi.resetModules();
      const m2 = await import("../src/lib/midtrans");
      await expect(
        m2.createPaymentTransaction({ orderId: "ord-e", orderNumber: "VS-SIM-0005", totalAmount: 1 })
      ).rejects.toThrow(/401/);
    } finally {
      await wrongKey.close();
    }
  });
});
