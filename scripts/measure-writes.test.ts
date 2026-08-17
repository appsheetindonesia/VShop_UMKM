/**
 * PENGUKURAN jumlah tulis nyata ke Supabase — SESUDAH vs SEBELUM koalesensi
 * `persistChain` pada alur yang memuat banyak `mutate()` berurutan:
 * klaim voucher, redeem (getken), daftar akun (pelanggan & merchant),
 * checkout (buat order), bayar sukses (paket / topup / merchandise).
 *
 * Cara kerja:
 *   - mock PostgREST menghitung request POST per tabel (tulis nyata di level
 *     HTTP supabase-js — bukan estimasi);
 *   - alur dijalankan lewat fungsi service ASLI dalam dua mode: default
 *     (koalesensi aktif) dan `DB_COALESCE=0` (setiap mutate = flush sendiri
 *     = perilaku sebelum koalesensi);
 *   - hasil dicetak sebagai tabel markdown → disalin ke README.
 *
 * Dijalankan otomatis oleh `npm test`. Khusus: `npm run test:measure-writes`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------- Mock PostgREST (HTTP sungguhan, penghitung per tabel) ----------

interface Row {
  [key: string]: unknown;
}
interface MockCall {
  method: "GET" | "POST";
  table: string;
}

let store: Record<string, Row[]> = {};
let calls: MockCall[] = [];
let server: Server | null = null;
let baseUrl = "";

function upsertMerge(existing: Row[], rows: Row[]): Row[] {
  const out = [...existing];
  for (const r of rows) {
    const idx = out.findIndex((x) => x.id === r.id);
    if (idx >= 0) out[idx] = r;
    else out.push(r);
  }
  return out;
}

async function startMock(): Promise<void> {
  store = {};
  calls = [];
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) {
      res.writeHead(404).end("not found");
      return;
    }
    const table = m[1];
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET") {
      calls.push({ method: "GET", table });
      send(200, store[table] ?? []);
      return;
    }
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        let rows: Row[] = [];
        try {
          const body = JSON.parse(raw || "[]");
          rows = Array.isArray(body) ? body : [body];
        } catch {
          /* payload tak terurai — catat tanpa baris */
        }
        store[table] = upsertMerge(store[table] ?? [], rows);
        calls.push({ method: "POST", table });
        send(201, rows);
      });
      return;
    }
    send(405, { error: "method not allowed" });
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

async function stopMock(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((err) => (err ? reject(err) : resolve()))
    );
    server = null;
  }
}

// ---------- Helper ----------

const saveEnv: Record<string, string | undefined> = {};
function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

type DbModule = typeof import("../src/lib/db");
type ServiceModule = typeof import("../src/lib/service");

const waitFlush = () => new Promise((r) => setTimeout(r, 60));

const now = "2026-08-16T00:00:00.000Z";

/** Seed data + reset penghitung, lalu kembalikan data yang dipakai alur. */
async function seed(db: DbModule): Promise<{ redeemKode: string; redeemKonfirmasi: string }> {
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
    // v1 — dipakai alur KLAIM voucher (u1 masih aktif).
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
    // v2 + klaim seed — dipakai alur REDEEM (getken), supaya ukuran alur
    // redeem saja yang terukur (bukan klaim).
    d.vouchers.push({
      id: "v2",
      merchantId: "m1",
      merchantName: "Kopi Nusantara",
      name: "Voucher Redeem",
      jenisVoucher: "diskon",
      nilai: 10000,
      minTransaksi: 0,
      kuota: 5,
      masaBerlaku: "2026-12-31T00:00:00.000Z",
      maksPenggunaan: 1,
      syaratKetentuan: "-",
      jumlah: 5,
      status: "active",
      createdAt: now,
    });
    d.claimedVouchers.push({
      id: "clm-seed",
      voucherId: "v2",
      userId: "u1",
      kode: "SEED-KODE-1",
      kodeKonfirmasi: "111111",
      status: "active",
      claimedAt: now,
      useCount: 0,
    });
    // Merchandise + keranjang u1 — dipakai alur bayar merchandise.
    d.merchandise.push({
      id: "mds1",
      name: "Kaos V Shop",
      slug: "kaos-v-shop",
      description: "-",
      price: 99000,
      stock: 5,
      image: "👕",
      category: "Apparel",
      status: "active",
      createdAt: now,
    });
    d.carts["u1"] = [{ productId: "mds1", quantity: 1 }];
  });
  // Flush seed adalah fire-and-forget — tunggu tuntas SEBELUM reset counter
  // agar tulis seed tidak ikut terhitung.
  await waitFlush();
  calls = []; // seed selesai — mulai hitung tulis dari sini
  return { redeemKode: "SEED-KODE-1", redeemKonfirmasi: "111111" };
}

interface FlowResult {
  total: number;
  perTable: Record<string, number>;
}

/**
 * Jalankan semua alur pada satu modul db fresh, kembalikan jumlah POST per
 * alur. `mode` menentukan env DB_COALESCE.
 */
async function runFlows(
  mode: "coalesced" | "per-mutate"
): Promise<Record<string, FlowResult>> {
  vi.resetModules();
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  // Kosongkan store mock — runFlows bisa dipanggil 2× dalam satu test
  // (coalesced + per-mutate); tanpa ini run kedua meng-hydrate data run
  // pertama (mis. klaim redeem yang sudah "used") sehingga alur lookup
  // berdasarkan kode (redeemVoucher) menemukan baris basi.
  for (const k of Object.keys(store)) delete store[k];
  setEnv({
    NEXT_PUBLIC_SUPABASE_URL: baseUrl,
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
    SESSION_ENCRYPTION_KEY: "x".repeat(32),
    DB_COALESCE: mode === "per-mutate" ? "0" : undefined,
  });
  const db: DbModule = await import("../src/lib/db");
  await db.ensureHydrated();
  expect(db.getStoreMode()).toBe("supabase");
  const svc: ServiceModule = await import("../src/lib/service");
  const seedInfo = await seed(db);

  const snapshot = (): FlowResult => {
    const perTable: Record<string, number> = {};
    for (const c of calls.filter((c) => c.method === "POST")) {
      perTable[c.table] = (perTable[c.table] ?? 0) + 1;
    }
    return { total: Object.values(perTable).reduce((a, b) => a + b, 0), perTable };
  };
  const results: Record<string, FlowResult> = {};

  // 1) Klaim voucher — 1 mutate (1 tick)
  const claimRes = svc.claimVoucher("u1", "v1");
  expect(claimRes.ok).toBe(true);
  await waitFlush();
  results.claim = snapshot();

  // 2) Redeem voucher (getken) — 1 mutate, klaim seed
  calls = [];
  const redeemRes = svc.redeemVoucher("m1", seedInfo.redeemKode, seedInfo.redeemKonfirmasi);
  expect(redeemRes.ok).toBe(true);
  await waitFlush();
  results.redeem = snapshot();

  // 3) Daftar akun pelanggan — 1 mutate (users)
  calls = [];
  const cust = svc.registerCustomer({ name: "Budi", phone: "081300000001", password: "pw" });
  expect(cust.id).toBeTruthy();
  await waitFlush();
  results.register = snapshot();

  // 4) Daftar akun merchant — 1 mutate lintas koleksi (users + merchants)
  calls = [];
  const reg = svc.registerMerchant({
    namaUsaha: "Warung Nusantara",
    kategoriUsaha: "Makanan",
    noWAUsaha: "081300000002",
    alamatUsaha: "Jl. Melati 2",
    namaPemilik: "Budi",
    noWAPemilik: "081300000002",
    email: "merchant@vshop.test",
    password: "pw",
  });
  expect(reg.merchant.id).toBeTruthy();
  await waitFlush();
  results.registerMerchant = snapshot();

  // 5) Checkout (buat order paket) — SATU mutate (order + snapToken)
  calls = [];
  const { order } = await svc.createOrder({
    userId: "u1",
    type: "package",
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
    totalAmount: 7000,
    address: { nama: "Siti Aminah", phone: "081234567890", alamat: "Jl. Melati 1", kota: "Bandung", kodePos: "40111" },
    metadata: { packageId: "pkg1", packageName: "Paket 7 Hari", days: 7 },
  });
  await waitFlush();
  results.checkout = snapshot();

  // 6) Bayar sukses (order paket) — 2 mutate dalam 1 tick (status+membership,
  //    lalu audit)
  calls = [];
  svc.markOrderPaid(order.id, "qris");
  await waitFlush();
  results.pay = snapshot();

  // 7) Top up (buat order + bayar) — createOrder (1 mutate) + markOrderPaid
  //    (status + wallet, lalu audit; 2 mutate 1 tick)
  calls = [];
  const { order: topupOrder } = await svc.createOrder({
    userId: "u1",
    type: "topup",
    items: [{ name: "Top Up Saldo V Shop", unitPrice: 50000, quantity: 1 }],
    totalAmount: 50000,
    metadata: { topup: true },
  });
  svc.markOrderPaid(topupOrder.id, "qris");
  await waitFlush();
  results.topup = snapshot();

  // 8) Merchandise (buat order + bayar) — createOrder + markOrderPaid
  //    (status + stok + keranjang, lalu audit)
  calls = [];
  const { order: merchOrder } = await svc.createOrder({
    userId: "u1",
    type: "merchandise",
    items: [{ productId: "mds1", name: "Kaos V Shop", unitPrice: 99000, quantity: 1 }],
    totalAmount: 99000,
    metadata: { merchandise: true },
  });
  svc.markOrderPaid(merchOrder.id, "qris");
  await waitFlush();
  results.merchandise = snapshot();

  return results;
}

function fmt(f: FlowResult): string {
  const tables = Object.entries(f.perTable)
    .map(([t, n]) => `${t}×${n}`)
    .join(" + ");
  return `${tables} = ${f.total} tulis`;
}

// ---------- Test ----------

describe("pengukuran tulis Supabase — 8 alur (sebelum/sesudah koalesensi)", () => {
  beforeEach(async () => {
    await startMock();
  });
  afterEach(async () => {
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await stopMock();
  });

  it("mencetak tabel perbandingan tulis (koalesensi vs per-mutate)", async () => {
    const after = await runFlows("coalesced");
    const before = await runFlows("per-mutate");

    console.log("\n── Pengukuran tulis ke Supabase (mock PostgREST HTTP) ──");
    console.log("mode SESUDAH koalesensi : " + JSON.stringify(after, null, 2));
    console.log("mode SEBELUM (per-mutate): " + JSON.stringify(before, null, 2));
    console.log("\n| Alur | mutate | SESUDAH koalesensi | SEBELUM (per-mutate) |");
    console.log("|---|---|---|---|");
    // [kunci hasil, nama tampilan, kolom mutate]
    const rows: [string, string, string][] = [
      ["claim", "Klaim voucher", "1 (1 tick)"],
      ["redeem", "Redeem voucher (getken)", "1 (1 tick)"],
      ["register", "Daftar akun pelanggan", "1 (1 tick)"],
      ["registerMerchant", "Daftar akun merchant", "1 (1 tick, 2 koleksi)"],
      ["checkout", "Checkout (buat order)", "1 (order + snapToken satu mutate)"],
      ["pay", "Bayar sukses (paket)", "2 (1 tick)"],
      ["topup", "Top up (buat + bayar)", "3 (2 tick: createOrder, lalu paid+audit)"],
      ["merchandise", "Merchandise (buat + bayar)", "3 (2 tick: createOrder, lalu paid+audit)"],
    ];
    for (const [key, name, mut] of rows) {
      console.log(`| ${name} | ${mut} | ${fmt(after[key])} | ${fmt(before[key])} |`);
    }
  });

  it("klaim voucher: 1 mutate → 1 tulis claimed_vouchers di kedua mode", async () => {
    const after = await runFlows("coalesced");
    expect(after.claim).toEqual({ total: 1, perTable: { claimed_vouchers: 1 } });
  });

  it("redeem voucher: 1 mutate → 1 tulis claimed_vouchers di kedua mode", async () => {
    const after = await runFlows("coalesced");
    expect(after.redeem).toEqual({ total: 1, perTable: { claimed_vouchers: 1 } });
  });

  it("daftar akun: pelanggan 1 tulis profiles; merchant 1 mutate → profiles + merchants (2 tulis)", async () => {
    const after = await runFlows("coalesced");
    expect(after.register).toEqual({ total: 1, perTable: { profiles: 1 } });
    expect(after.registerMerchant).toEqual({
      total: 2,
      perTable: { profiles: 1, merchants: 1 },
    });
  });

  it("checkout: SATU mutate (order + snapToken) → 1 tulis orders di kedua mode", async () => {
    const after = await runFlows("coalesced");
    const before = await runFlows("per-mutate");
    // Refactor createOrder: token diambil SEBELUM tulis, jadi meski tanpa
    // koalesensi (per-mutate) checkout tetap 1 tulis.
    expect(after.checkout.total).toBe(1);
    expect(after.checkout.perTable.orders).toBe(1);
    expect(before.checkout.total).toBe(1);
    expect(before.checkout.perTable.orders).toBe(1);
  });

  it("bayar sukses: koalesensi menggabung 2 mutate 1 tick → 2 tulis (vs 3 tanpa)", async () => {
    const after = await runFlows("coalesced");
    const before = await runFlows("per-mutate");
    // SESUDAH: orders×1 + memberships×1 = 2 (batch digabung)
    expect(after.pay.total).toBe(2);
    expect(after.pay.perTable.orders).toBe(1);
    expect(after.pay.perTable.memberships).toBe(1);
    // SEBELUM: orders×2 + memberships×1 = 3 (tulis lama orders tidak dilewati)
    expect(before.pay.total).toBe(3);
    expect(before.pay.perTable.orders).toBe(2);
    expect(before.pay.perTable.memberships).toBe(1);
  });

  it("top up: buat+bayar → 3 tulis (orders×2 + wallets×1); per-mutate 4 (orders×3 + wallets×1)", async () => {
    const after = await runFlows("coalesced");
    const before = await runFlows("per-mutate");
    // SESUDAH: createOrder orders×1 + markOrderPaid (orders+wallets digabung) = 3
    expect(after.topup.total).toBe(3);
    expect(after.topup.perTable.orders).toBe(2);
    expect(after.topup.perTable.wallets).toBe(1);
    // SEBELUM: createOrder 1 + paid (orders×2) + audit (orders×1) = 4
    expect(before.topup.total).toBe(4);
    expect(before.topup.perTable.orders).toBe(3);
    expect(before.topup.perTable.wallets).toBe(1);
  });

  it("merchandise: buat+bayar → 4 tulis (orders×2 + merchandise×1 + carts×1); per-mutate 5 (orders×3 + …)", async () => {
    const after = await runFlows("coalesced");
    const before = await runFlows("per-mutate");
    // SESUDAH: createOrder 1 + markOrderPaid (orders+merchandise+carts digabung) = 4
    expect(after.merchandise.total).toBe(4);
    expect(after.merchandise.perTable.orders).toBe(2);
    expect(after.merchandise.perTable.merchandise).toBe(1);
    expect(after.merchandise.perTable.carts).toBe(1);
    // SEBELUM: createOrder 1 + paid (3 tulis) + audit (orders×1) = 5
    expect(before.merchandise.total).toBe(5);
    expect(before.merchandise.perTable.orders).toBe(3);
    expect(before.merchandise.perTable.merchandise).toBe(1);
    expect(before.merchandise.perTable.carts).toBe(1);
  });
});
