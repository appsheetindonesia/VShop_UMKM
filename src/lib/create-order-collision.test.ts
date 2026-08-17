/**
 * Unit test jalur KONKURENSI `createOrder` (src/lib/service.ts): order +
 * snapToken ditulis dalam SATU mutate, tapi nomor order dihitung SEBELUM
 * await Midtrans — bila order lain keburu memakai nomor itu selama await
 * (tabrakan langka), createOrder harus renumber ATOMIK di dalam mutate dan
 * membuat ulang transaksi Midtrans dengan nomor FINAL (agar order_id
 * Midtrans tetap sama dengan orderNumber — kontrak webhook).
 *
 * `createPaymentTransaction` di-mock dengan DEFERRED promise sehingga test
 * bisa menyuntik order penabrakan di sela-sela await, lalu menyelesaikan
 * panggilan pertama & kedua secara terpisah.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentResult } from "./midtrans";

const { mockAdmin, store, calls, resetAll, deferreds } = vi.hoisted(() => {
  const store: Record<string, unknown[]> = {};
  const calls: { method: string; table: string; rows?: unknown[] }[] = [];
  const deferreds: { tx: Record<string, unknown>; resolve: (v: unknown) => void }[] = [];
  const client = {
    from(table: string) {
      return {
        select: async () => ({ data: store[table] ?? [], error: null }),
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
      deferreds.length = 0;
    },
    deferreds,
  };
});

vi.mock("./supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => mockAdmin,
  getSupabaseAnon: () => mockAdmin,
}));

vi.mock("./midtrans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./midtrans")>();
  return {
    ...actual,
    createPaymentTransaction: vi.fn(
      (tx: Record<string, unknown>) =>
        new Promise<PaymentResult>((resolve) => {
          deferreds.push({ tx, resolve: resolve as (v: unknown) => void });
        })
    ),
  };
});

const waitFlush = () => new Promise((r) => setTimeout(r, 30));
const waitFor = async (fn: () => boolean) => {
  const deadline = Date.now() + 2000;
  while (!fn() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  expect(fn()).toBe(true);
};

const now = "2026-08-16T00:00:00.000Z";

function order(over: Record<string, unknown> = {}) {
  return {
    id: "ord-x",
    orderNumber: "VS-20260816-0001",
    userId: "u1",
    type: "package" as const,
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
    totalAmount: 7000,
    status: "pending" as const,
    paymentStatus: "pending" as const,
    snapToken: "",
    metadata: {},
    createdAt: now,
    ...over,
  };
}

type ServiceModule = typeof import("./service");

async function freshDb(): Promise<{ svc: ServiceModule; db: typeof import("./db") }> {
  vi.resetModules();
  resetAll();
  // Cache/mode db.ts disimpan di globalThis — hapus agar modul fresh (pola
  // db.test.ts), bukan mewarisi state test sebelumnya.
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  const db = await import("./db");
  await db.ensureHydrated();
  const svc = await import("./service");
  return { svc, db };
}

describe("createOrder — SATU mutate (order + snapToken) & jalur tabrakan nomor", () => {
  beforeEach(async () => {
    resetAll();
  });

  it("jalur normal: order + snapToken ditulis dalam SATU tulis orders", async () => {
    const { svc, db } = await freshDb();
    db.mutate((d) => {
      d.users.push({
        id: "u1",
        name: "Siti Aminah",
        phone: "081234567890",
        passwordHash: "x",
        role: "customer",
        createdAt: now,
      });
    });
    await waitFlush();
    calls.length = 0; // seed tidak terhitung

    const pending = svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1", packageName: "Paket 7 Hari", days: 7 },
    });
    await waitFor(() => deferreds.length === 1);
    const provisional = String(deferreds[0].tx.orderNumber);
    expect(provisional).toMatch(/^VS-\d{8}-\d{4}$/);

    deferreds[0].resolve({ token: "snap-token-1", mock: false });
    const { order } = await pending;
    await waitFlush();

    expect(order.snapToken).toBe("snap-token-1");
    expect(order.orderNumber).toBe(provisional);
    // SATU tulis orders — token sudah ada di baris yang sama.
    const posts = calls.filter((c) => c.table === "orders");
    expect(posts).toHaveLength(1);
    const rows = posts[0].rows as Array<{ id: string; snap_token: string }>;
    expect(rows.find((r) => r.id === order.id)?.snap_token).toBe("snap-token-1");
  });

  it("tabrakan nomor selama await → renumber atomik + transaksi dibuat ulang dengan nomor final", async () => {
    const { svc, db } = await freshDb();
    db.mutate((d) => {
      d.users.push({
        id: "u1",
        name: "Siti Aminah",
        phone: "081234567890",
        passwordHash: "x",
        role: "customer",
        createdAt: now,
      });
    });
    await waitFlush();
    calls.length = 0;

    const pending = svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    await waitFor(() => deferreds.length === 1);
    const provisional = String(deferreds[0].tx.orderNumber);

    // Order lain menyelinap memakai nomor yang sama selama await.
    db.mutate((d) => d.orders.push(order({ id: "ord-other", orderNumber: provisional })));
    await waitFlush();

    deferreds[0].resolve({ token: "snap-token-1", mock: false }); // panggilan pertama selesai
    await waitFor(() => deferreds.length === 2); // renumber → transaksi dibuat ulang
    const rebuiltNumber = String(deferreds[1].tx.orderNumber);
    expect(rebuiltNumber).not.toBe(provisional);
    expect(rebuiltNumber).toMatch(/^VS-\d{8}-\d{4}$/);

    deferreds[1].resolve({ token: "snap-token-2", mock: false });
    const { order: created } = await pending;
    await waitFlush();

    // Order memakai nomor FINAL + token dari transaksi kedua.
    expect(created.orderNumber).toBe(rebuiltNumber);
    expect(created.snapToken).toBe("snap-token-2");
    // Kedua order tersimpan (tidak ada yang hilang / duplikat nomor).
    const dbOrders = db.getDB().orders;
    expect(dbOrders).toHaveLength(2);
    expect(new Set(dbOrders.map((o) => o.orderNumber)).size).toBe(2);
    // Audit mencatat tabrakan + transaksi dibuat ulang.
    const audit = (created.metadata.paymentAudit ?? []) as Array<{ event: string; detail?: string }>;
    expect(audit[0].detail).toContain("bertabrakan");
    expect(audit.at(-1)?.detail).toContain("dibuat ulang");
  });
});
