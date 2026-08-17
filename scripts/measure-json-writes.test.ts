/**
 * PENGUKURAN penghematan I/O debounce tulis JSON (mode demo) — SESUDAH vs
 * SEBELUM debounce, diukur EMPIRIS lewat `getJsonWriteCount()` (counter tulis
 * file `data/db.json` seumur proses, bukan estimasi).
 *
 * Alur nyata dijalankan lewat fungsi service ASLI (claimVoucher,
 * createOrder, markOrderPaid) dalam dua mode:
 *   - SESUDAH debounce (default): banyak `mutate()` dalam satu tick →
 *     MAKSIMAL SATU tulis file (snapshot terbaru);
 *   - SEBELUM (per-mutate): `JSON_DEBOUNCE=0` — setiap `mutate()` menulis
 *     file LANGSUNG.
 * Hasil dicetak sebagai tabel markdown → disalin ke README.
 *
 * Dijalankan otomatis oleh `npm test`. Khusus: `npm run test:measure-json-writes`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- Helper ----------

type DbModule = typeof import("../src/lib/db");
type ServiceModule = typeof import("../src/lib/service");

const saveEnv: Record<string, string | undefined> = {};
const tick = () => new Promise((r) => setTimeout(r, 40));
const now = "2026-08-16T00:00:00.000Z";

let tempDir = "";

/** Seed data + kembalikan delta tulis per alur (diukur dari counter). */
async function seed(db: DbModule): Promise<void> {
  db.mutate((d) => {
    d.users.push({
      id: "u1",
      name: "Siti Aminah",
      phone: "6281234567890",
      passwordHash: "x",
      role: "customer",
      createdAt: now,
    });
    d.packages.push({
      id: "pkg1",
      name: "Paket 7 Hari",
      days: 7,
      price: 7000,
      features: [],
    });
    d.memberships.push({
      id: "mbr1",
      userId: "u1",
      packageId: "pkg1",
      packageName: "Paket 7 Hari",
      startDate: now,
      endDate: "2026-08-23T00:00:00.000Z",
      status: "active",
      createdAt: now,
    });
    d.vouchers.push({
      id: "v1",
      merchantId: "m1",
      merchantName: "Kopi Nusantara",
      name: "Diskon Kopi Spesial",
      jenisVoucher: "diskon",
      nilai: 5000,
      minTransaksi: 20000,
      kuota: 10,
      masaBerlaku: "2026-12-31T00:00:00.000Z",
      maksPenggunaan: 1,
      syaratKetentuan: "-",
      jumlah: 10,
      status: "active",
      createdAt: now,
    });
  });
  await tick(); // tulis seed (debounce) tuntas — mulai hitung dari sini
}

/** Import fresh db+service dalam mode demo murni (tanpa Supabase). */
async function freshDemo(
  mode: "debounced" | "per-mutate"
): Promise<{ db: DbModule; svc: ServiceModule }> {
  for (const k of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "MIDTRANS_SERVER_KEY",
  ]) {
    delete process.env[k];
  }
  saveEnv.JSON_DEBOUNCE = process.env.JSON_DEBOUNCE;
  if (mode === "per-mutate") process.env.JSON_DEBOUNCE = "0";
  else delete process.env.JSON_DEBOUNCE;

  // Direktori data SENDIRI per run — tanpa ini run kedua (per-mutate) dalam
  // satu test meng-hydrate db.json run pertama (klaim/order sudah ada),
  // sehingga alur lookup (claimVoucher) menemukan data basi.
  saveEnv.VSHOP_DATA_DIR = process.env.VSHOP_DATA_DIR;
  process.env.VSHOP_DATA_DIR = fs.mkdtempSync(path.join(tempDir, "run-"));

  vi.resetModules();
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  const db: DbModule = await import("../src/lib/db");
  await db.ensureHydrated();
  expect(db.getStoreMode()).toBe("json");
  const svc: ServiceModule = await import("../src/lib/service");
  await seed(db);
  return { db, svc };
}

interface FlowResult {
  mutates: number;
  writes: number;
}

/** Jalankan alur, kembalikan jumlah mutate + tulis file (delta counter). */
async function runFlows(
  mode: "debounced" | "per-mutate"
): Promise<{ claim: FlowResult; checkout: FlowResult; pay: FlowResult }> {
  const { db, svc } = await freshDemo(mode);

  const run = async (mutates: number, fn: () => void | Promise<unknown>) => {
    const before = db.getJsonWriteCount();
    await fn();
    await tick(); // tuntaskan tulis debounce (per tick)
    return { mutates, writes: db.getJsonWriteCount() - before };
  };

  // 1) Klaim voucher — 1 mutate (1 tick)
  const claim = await run(1, () => {
    const res = svc.claimVoucher("u1", "v1");
    expect(res.ok).toBe(true);
  });

  // 2) Checkout (buat order) — 1 mutate (order + snapToken)
  const checkout = await run(1, async () => {
    await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1", packageName: "Paket 7 Hari", days: 7 },
    });
  });

  // 3) Bayar sukses (paket) — 2 mutate dalam 1 tick (paid+membership, audit)
  const pay = await run(2, () => {
    const order = db.getDB().orders[db.getDB().orders.length - 1];
    svc.markOrderPaid(order.id, "qris");
  });

  return { claim, checkout, pay };
}

function fmt(f: FlowResult): string {
  return `${f.writes} tulis (${f.mutates} mutate)`;
}

// ---------- Test ----------

describe("pengukuran I/O debounce JSON (mode demo) — sebelum/sesudah", () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-json-writes-"));
    saveEnv.VSHOP_DATA_DIR = process.env.VSHOP_DATA_DIR;
    process.env.VSHOP_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("mencetak tabel perbandingan tulis JSON (debounce vs per-mutate)", async () => {
    const after = await runFlows("debounced");
    const before = await runFlows("per-mutate");

    console.log("\n── Pengukuran tulis file JSON (mode demo, getJsonWriteCount) ──");
    console.log("mode SESUDAH debounce : " + JSON.stringify(after));
    console.log("mode SEBELUM (per-mutate): " + JSON.stringify(before));
    console.log("\n| Alur | mutate | SESUDAH debounce | SEBELUM (per-mutate) |");
    console.log("|---|---|---|---|");
    const rows: [keyof typeof after, string, string][] = [
      ["claim", "Klaim voucher", "1 (1 tick)"],
      ["checkout", "Checkout (buat order)", "1 (1 tick)"],
      ["pay", "Bayar sukses (paket)", "2 (1 tick)"],
    ];
    const totals = { mutates: 0, writesA: 0, writesB: 0 };
    for (const [key, name, mut] of rows) {
      const a = after[key];
      const b = before[key];
      console.log(`| ${name} | ${mut} | ${fmt(a)} | ${fmt(b)} |`);
      totals.mutates += a.mutates;
      totals.writesA += a.writes;
      totals.writesB += b.writes;
    }
    console.log(
      `| **Total** | **${totals.mutates}** | **${totals.writesA} tulis** | **${totals.writesB} tulis** |`
    );
  });

  it("debounce: mutate berurutan satu tick → 1 tulis; per-mutate → 1 tulis per mutate", async () => {
    const after = await runFlows("debounced");
    const before = await runFlows("per-mutate");
    // SESUDAH: klaim 1, checkout 1, bayar 1 (2 mutate digabung) = 3 tulis / 4 mutate
    expect(after.claim).toEqual({ mutates: 1, writes: 1 });
    expect(after.checkout).toEqual({ mutates: 1, writes: 1 });
    expect(after.pay).toEqual({ mutates: 2, writes: 1 });
    // SEBELUM: tiap mutate menulis langsung → bayar 2 tulis
    expect(before.claim).toEqual({ mutates: 1, writes: 1 });
    expect(before.checkout).toEqual({ mutates: 1, writes: 1 });
    expect(before.pay).toEqual({ mutates: 2, writes: 2 });
  });
});
