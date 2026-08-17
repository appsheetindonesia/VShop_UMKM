/**
 * Regresi otomatis `persistChain` (write-through koalesen di src/lib/db.ts).
 *
 * Beda dari src/lib/db.test.ts (yang men-stub `./supabase/server` dengan
 * client in-memory): test ini menjalankan **mock PostgREST HTTP sungguhan**
 * (node:http) dan mengarahkan env Supabase ke mock-nya, lalu mengimpor
 * `db.ts` ASLI — jadi yang diuji adalah perilaku HTTP nyata dari
 * supabase-js + antrean tulis (koalesensi per koleksi, snapshot terbaru,
 * urutan antar batch), bukan emulasi internal.
 *
 * Dijalankan otomatis oleh `npm test` (vitest include default mencakup
 * `scripts/*.test.ts`). Khusus: `npm run test:persist-chain`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// ---------- Mock PostgREST (HTTP sungguhan) ----------

interface Row {
  [key: string]: unknown;
}
interface MockCall {
  method: "GET" | "POST";
  table: string;
  rows?: unknown[];
  url?: string;
}

let store: Record<string, Row[]> = {};
let calls: MockCall[] = [];
let server: Server | null = null;
let baseUrl = "";
/** Tunda respons POST (ms) — untuk menguji batas waktu flushNow. */
let postDelayMs = 0;

/** Emulasi proyeksi alias PostgREST: `Alias:column` dan `col as "Alias"`. */
function project(sel: string, row: Row): Row {
  if (sel === "*") return row;
  const out: Row = {};
  const re =
    /([a-zA-Z_][a-zA-Z0-9_]*):([a-z_][a-z0-9_]*)|([a-z_][a-z0-9_]*)(?:\s+as\s+"([a-zA-Z_]+)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sel))) {
    if (m[1]) {
      if (m[2] in row) out[m[1]] = row[m[2]];
    } else {
      const src = m[3];
      const dest = m[4] ?? m[3];
      if (src in row) out[dest] = row[src];
    }
  }
  return out;
}

/** Upsert ala PostgREST: merge by `id` (PK). */
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
  postDelayMs = 0;
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
      const sel = url.searchParams.get("select") ?? "*";
      calls.push({ method: "GET", table, url: req.url ?? "" });
      send(200, (store[table] ?? []).map((r) => project(sel, r)));
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
        calls.push({ method: "POST", table, rows });
        const respond = () => send(201, rows);
        if (postDelayMs > 0) setTimeout(respond, postDelayMs);
        else respond();
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

type DbModule = typeof import("../src/lib/db");

const saveEnv: Record<string, string | undefined> = {};
function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/**
 * Import ulang db.ts dengan env mengarah ke mock. Holder globalThis dihapus
 * (pola db.test.ts) agar modul fresh, tidak mewarisi cache tes sebelumnya.
 */
async function freshDb(): Promise<DbModule> {
  vi.resetModules();
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  const mod = await import("../src/lib/db");
  await mod.ensureHydrated();
  expect(mod.getStoreMode()).toBe("supabase");
  return mod;
}

/** Tunggu flush fire-and-forget (rantai microtask + I/O). */
const waitFlush = () => new Promise((r) => setTimeout(r, 40));

const postCalls = () => calls.filter((c) => c.method === "POST");
const postTables = () => postCalls().map((c) => c.table).sort();
const postTableCalls = (table: string) => postCalls().filter((c) => c.table === table);

const now = "2026-08-16T00:00:00.000Z";
function order(id: string, over: Record<string, unknown> = {}) {
  return {
    id, orderNumber: `VS-2026-${id}`, userId: "u1", type: "package" as const,
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }], totalAmount: 7000,
    status: "pending" as const, paymentStatus: "pending" as const, snapToken: "snap-1",
    metadata: {}, createdAt: now, ...over,
  };
}

// ---------- Test ----------

describe("persistChain — koalesensi & urutan tulis (mock PostgREST HTTP)", () => {
  beforeEach(async () => {
    await startMock();
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SESSION_ENCRYPTION_KEY: "x".repeat(32),
    });
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await stopMock();
  });

  it("3 mutasi orders berurutan dalam satu tick → 1 POST dengan snapshot terbaru", async () => {
    const db = await freshDb();
    db.mutate((d) => d.orders.push(order("o1")));
    db.mutate((d) => d.orders.push(order("o2")));
    db.mutate((d) => {
      const o = d.orders.find((x) => x.id === "o1");
      if (o) o.paymentStatus = "paid";
    });
    await waitFlush();

    const posts = postTableCalls("orders");
    expect(posts).toHaveLength(1); // koalesensi: 1 tulis per koleksi
    const rows = posts[0].rows as Array<{ id: string; payment_status: string }>;
    expect(rows).toHaveLength(2);
    const o1 = rows.find((r) => r.id === "o1");
    expect(o1?.payment_status).toBe("paid"); // snapshot TERBARU menang
  });

  it("mutasi lintas koleksi → satu flush menulis semua tabel yang berubah", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push({
        id: "u1", name: "Siti Aminah", phone: "081234567890", passwordHash: "h",
        role: "customer" as const, createdAt: now,
      });
      d.orders.push(order("o1"));
      d.wallets.push({ userId: "u1", balance: 50000, updatedAt: now });
    });
    await waitFlush();
    expect(postTables()).toEqual(["orders", "profiles", "wallets"]);
    // Setiap tabel hanya sekali (dedupe per koleksi).
    expect(postTableCalls("profiles")).toHaveLength(1);
    expect(postTableCalls("orders")).toHaveLength(1);
  });

  it("batch antar flush tetap berurutan (A selesai → baru B)", async () => {
    const db = await freshDb();
    db.mutate((d) => d.users.push({
      id: "u1", name: "A", phone: "081111111111", passwordHash: "h",
      role: "customer" as const, createdAt: now,
    }));
    await waitFlush(); // flush A selesai
    db.mutate((d) => d.orders.push(order("o1")));
    await waitFlush(); // flush B selesai

    const tables = postCalls().map((c) => c.table);
    expect(tables).toEqual(["profiles", "orders"]); // urutan terjaga
  });

  it("LINTAS-FLUSH TUMPANG-TINDIH: tulis in-flight saat mutasi baru → batch baru tidak hilang, tetap berurutan", async () => {
    const db = await freshDb();
    postDelayMs = 150; // respons POST #1 ditahan → flush #1 "sedang berjalan"

    // Batch A — koleksi orders; flush #1 langsung dijalankan (antrean kosong).
    db.mutate((d) => d.orders.push(order("o1")));

    // Tunggu sampai POST #1 BENAR-BENAR tiba di mock (masih in-flight:
    // respons ditahan 150ms) — bukan sekadar "terjadwal" di microtask.
    const arrived = Date.now() + 2000;
    while (postCalls().length < 1 && Date.now() < arrived) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(postCalls()).toHaveLength(1); // flush #1 sudah berjalan

    // Saat flush #1 belum selesai, mutasi baru masuk → batch B. Tidak boleh
    // hilang, tidak boleh nyasar ke batch A yang sedang berjalan.
    db.mutate((d) => d.orders.push(order("o2")));
    db.mutate((d) => {
      const o = d.orders.find((x) => x.id === "o2");
      if (o) o.paymentStatus = "paid";
    });

    // Tunggu kedua batch tuntas (poll — robust terhadap latensi mock).
    const done = Date.now() + 3000;
    while (postTableCalls("orders").length < 2 && Date.now() < done) {
      await new Promise((r) => setTimeout(r, 20));
    }
    // Beri waktu respons terakhir mock (150ms) benar-benar selesai.
    await new Promise((r) => setTimeout(r, postDelayMs + 50));

    const posts = postTableCalls("orders");
    expect(posts).toHaveLength(2); // DUA batch terpisah (bukan satu gabungan)

    // Urutan: batch A (snapshot awal: hanya o1) dulu, batch B menyusul dengan
    // SNAPSHOT TERBARU (seluruh koleksi: o1 + o2 — writer menulis koleksi penuh,
    // upsert idempotent per PK sehingga tulis ulang o1 aman). Tidak ada yang
    // hilang, dan snapshot terbaru menang di dalam batch B.
    const a = posts[0].rows as Array<{ id: string }>;
    const b = posts[1].rows as Array<{ id: string; payment_status: string }>;
    expect(a.map((r) => r.id)).toEqual(["o1"]); // batch A terkunci saat in-flight
    expect(b.map((r) => r.id).sort()).toEqual(["o1", "o2"]);
    // Snapshot terbaru dalam batch B (mutasi o2 + paid digabung jadi satu).
    expect(b.find((r) => r.id === "o2")?.payment_status).toBe("paid");
    expect(b.find((r) => r.id === "o1")?.payment_status).toBe("pending");
    // Kedua order benar-benar tersimpan di "PostgreSQL".
    expect((store.orders ?? []).map((r) => r.id).sort()).toEqual(["o1", "o2"]);
  });

  it("LINTAS-FLUSH tumpang-tindih lintas koleksi: batch baru (koleksi lain) flush sendiri setelah in-flight selesai", async () => {
    const db = await freshDb();
    postDelayMs = 150;

    // Batch A: orders — flush #1 in-flight.
    db.mutate((d) => d.orders.push(order("o1")));
    const arrived = Date.now() + 2000;
    while (postCalls().length < 1 && Date.now() < arrived) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(postCalls()).toHaveLength(1);

    // Flush #1 (orders) masih berjalan — mutasi users masuk → batch B sendiri,
    // diantrekan SETELAH flush #1 (urutan antar batch tetap terjaga).
    db.mutate((d) =>
      d.users.push({
        id: "u1", name: "Siti Aminah", phone: "081234567890", passwordHash: "h",
        role: "customer" as const, createdAt: now,
      })
    );

    const done = Date.now() + 3000;
    while (postCalls().length < 2 && Date.now() < done) {
      await new Promise((r) => setTimeout(r, 20));
    }
    await new Promise((r) => setTimeout(r, postDelayMs + 50));

    // Urutan POST: [orders (batch A), profiles (batch B)] — tak ada yang hilang.
    const tables = postCalls().map((c) => c.table);
    expect(tables).toEqual(["orders", "profiles"]);
    // Batch A hanya orders, batch B hanya profiles (tidak digabung ke flush
    // yang sedang berjalan).
    expect(postTableCalls("orders")).toHaveLength(1);
    expect(postTableCalls("profiles")).toHaveLength(1);
    // Store akhir memuat keduanya.
    expect(store.profiles?.some((r) => r.id === "u1")).toBe(true);
  });

  it("FULL-FLUSH DEBOUNCE: persist kedua saat full flush pertama in-flight → tidak menambah batch", async () => {
    const db = await freshDb();
    // 3 koleksi berisi (users→profiles, orders, wallets) — writer melewati
    // tabel kosong, jadi full flush = 3 POST.
    db.mutate((d) => {
      d.users.push({
        id: "u1", name: "Siti Aminah", phone: "081234567890", passwordHash: "h",
        role: "customer" as const, createdAt: now,
      });
      d.orders.push(order("o1"));
      d.wallets.push({ userId: "u1", balance: 50000, updatedAt: now });
    });
    await waitFlush(); // batch mutate selesai
    const baseline = postCalls().length;

    postDelayMs = 200; // respons POST ditahan → full flush pertama in-flight
    const p1 = db.persist();
    // Tunggu POST full flush (3 tabel berisi) benar-benar tiba di mock.
    const arrived = Date.now() + 2000;
    while (postCalls().length < baseline + 3 && Date.now() < arrived) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(postCalls().length - baseline).toBeGreaterThanOrEqual(3);

    // persist KEDUA saat flush pertama masih berjalan → digabung (debounce),
    // BUKAN batch baru: total POST tetap 3 tabel (bukan 6).
    const p2 = db.persist();
    await p2;
    await new Promise((r) => setTimeout(r, postDelayMs + 50));
    expect(postCalls().length - baseline).toBe(3);
  });

  it("round-trip: data yang ditulis ke mock bisa di-hydrate kembali", async () => {
    const db = await freshDb();
    db.mutate((d) => d.orders.push(order("o1")));
    await db.persist();
    await waitFlush();

    // Re-hydrate dari mock (store dipertahankan) → state identik.
    const db2 = await freshDb();
    expect(db2.getDB().orders).toHaveLength(1);
    expect(db2.getDB().orders[0].id).toBe("o1");
    expect(db2.getDB().orders[0].paymentStatus).toBe("pending");
  });

  it("mutasi no-op tidak menghasilkan request POST", async () => {
    const db = await freshDb();
    db.mutate(() => {});
    await waitFlush();
    expect(postCalls()).toHaveLength(0);
  });
});

describe("flushNow — flush paksa dengan batas waktu", () => {
  beforeEach(async () => {
    await startMock();
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SESSION_ENCRYPTION_KEY: "x".repeat(32),
    });
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await stopMock();
  });

  it("memaksa batch pending ter-flush segera (tanpa menunggu tick antrean)", async () => {
    const db = await freshDb();
    db.mutate((d) => d.orders.push(order("o1")));
    // Belum ada flush (mutasi hanya mengantre) — flushNow langsung memaksanya.
    expect(postCalls()).toHaveLength(0);
    await db.flushNow(1_000);
    expect(postTableCalls("orders")).toHaveLength(1);
  });

  it("tidak menggantung melebihi max wait saat respons mock lambat", async () => {
    const db = await freshDb();
    postDelayMs = 400; // mock menahan respons 400ms
    db.mutate((d) => d.orders.push(order("o1")));
    const t0 = Date.now();
    await db.flushNow(150); // batas waktu 150ms < 400ms
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(100); // sempat menunggu antrean
    expect(elapsed).toBeLessThan(380); // tapi dibatasi ~150ms, bukan 400ms
    // Tulis tetap terkirim setelah mock selesai (antrean tidak hilang).
    await waitFlush();
    expect(postTableCalls("orders")).toHaveLength(1);
  });

  it("flushNow mengembalikan snapshot terbaru setelah antrean tuntas", async () => {
    const db = await freshDb();
    db.mutate((d) => d.orders.push(order("o1")));
    db.mutate((d) => {
      const o = d.orders.find((x) => x.id === "o1");
      if (o) o.paymentStatus = "paid";
    });
    await db.flushNow(1_000);
    const rows = postTableCalls("orders")[0].rows as Array<{ id: string; payment_status: string }>;
    expect(rows.find((r) => r.id === "o1")?.payment_status).toBe("paid");
  });
});

describe("registerShutdownFlush — drain SIGTERM/SIGINT", () => {
  // Baseline listener agar test tidak bocor ke file lain (vitest per-file
  // isolated, tapi bersih-bersih tetap baik).
  const baselineSigTerm = process.listenerCount("SIGTERM");
  const baselineSigInt = process.listenerCount("SIGINT");

  beforeEach(async () => {
    await startMock();
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SESSION_ENCRYPTION_KEY: "x".repeat(32),
    });
  });

  afterEach(async () => {
    // Lepas listener yang ditambahkan test ini.
    while (process.listenerCount("SIGTERM") > baselineSigTerm) {
      process.removeListener("SIGTERM", process.listeners("SIGTERM")[0]);
    }
    while (process.listenerCount("SIGINT") > baselineSigInt) {
      process.removeListener("SIGINT", process.listeners("SIGINT")[0]);
    }
    delete (globalThis as unknown as { __vshopShutdownFlush?: boolean }).__vshopShutdownFlush;
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await stopMock();
  });

  it("guard globalThis mencegah pendaftaran ganda", async () => {
    const db = await freshDb();
    const before = process.listenerCount("SIGTERM");
    db.registerShutdownFlush();
    db.registerShutdownFlush();
    expect(process.listenerCount("SIGTERM")).toBe(before + 1);
    expect(process.listenerCount("SIGINT")).toBeGreaterThan(baselineSigInt);
  });

  it("drain SIGTERM memanggil flushNow — snapshot mengantre ikut ter-flush", async () => {
    const db = await freshDb();
    db.mutate((d) => d.orders.push(order("o1")));
    db.registerShutdownFlush();

    // Stub process.exit agar emit SIGTERM tidak menghentikan worker vitest
    // (drain memanggil process.exit setelah flushNow selesai).
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      return undefined as never; // catat panggilan saja, jangan keluar
    });
    try {
      process.emit("SIGTERM");
      // Tunggu drain (flushNow) selesai sebelum proses "keluar" (poll, robust
      // terhadap variasi latensi mock HTTP).
      const deadline = Date.now() + 3000;
      while (!exitSpy.mock.calls.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // Flush terjadi SEBELUM exit: snapshot mengantre sudah tersimpan.
      expect(postTableCalls("orders")).toHaveLength(1);
      expect(exitSpy).toHaveBeenCalled();
    } finally {
      // mockRestore menjalankan mockReset (menghapus mock.calls) — restore
      // SETELAH assertion.
      exitSpy.mockRestore();
    }
  });
});

describe("pengukuran jumlah request — batas atas regresi (N mutasi → ≤ k POST)", () => {
  beforeEach(async () => {
    await startMock();
    setEnv({
      NEXT_PUBLIC_SUPABASE_URL: baseUrl,
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SESSION_ENCRYPTION_KEY: "x".repeat(32),
    });
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await stopMock();
  });

  it("N=25 mutasi orders dalam satu tick → tepat 1 POST berisi 25 baris (bukan 25 request)", async () => {
    const db = await freshDb();
    const N = 25;
    for (let i = 0; i < N; i++) db.mutate((d) => d.orders.push(order(`o${i}`)));
    await waitFlush();

    const posts = postTableCalls("orders");
    const rows = (posts[0]?.rows ?? []) as Row[];
    expect(posts).toHaveLength(1); // batas atas: 1 POST per koleksi per tick
    expect(rows).toHaveLength(N); // tidak ada mutasi yang hilang
    console.log(
      `  [ukur] orders: ${N} mutasi (1 tick) → ${posts.length} POST (${rows.length} baris) — rasio ${N}:1 ✓`
    );
  });

  it("N=24 mutasi tersebar T=4 tick → ≤ T POST (batas atas = jumlah tick, bukan N)", async () => {
    const db = await freshDb();
    const T = 4;
    const M = 6;
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < M; i++) db.mutate((d) => d.orders.push(order(`t${t}o${i}`)));
      await waitFlush(); // satu flush per tick
    }

    const posts = postTableCalls("orders");
    expect(posts.length).toBeLessThanOrEqual(T); // batas atas regresi: 1 per tick
    expect(posts).toHaveLength(T); // deterministik: tiap tick tepat 1
    // Writer menulis SNAPSHOT KOLEKSI PENUH per flush (upsert idempotent),
    // jadi total baris terkirim = M × (1+2+…+T) — kumulatif, bukan M×T.
    const totalRows = posts.reduce((n, p) => n + (p.rows as Row[]).length, 0);
    const cumulative = (M * T * (T + 1)) / 2;
    expect(totalRows).toBe(cumulative);
    // Tidak ada mutasi yang hilang: batch TERAKHIR memuat SEMUA N order.
    const lastRows = (posts[posts.length - 1].rows as Row[]).map((r) => r.id);
    expect(new Set(lastRows).size).toBe(T * M);
    console.log(
      `  [ukur] orders: ${T * M} mutasi (${T} tick) → ${posts.length} POST — batas atas ${T} ✓ (${totalRows} baris kumulatif, batch akhir memuat ${T * M} order, 0 hilang)`
    );
  });

  it("lintas 3 koleksi × M=10 mutasi satu tick → ≤ 3 POST total, tepat 1 per koleksi", async () => {
    const db = await freshDb();
    const M = 10;
    for (let i = 0; i < M; i++) {
      db.mutate((d) => {
        d.orders.push(order(`c-o${i}`));
        d.users.push({
          id: `c-u${i}`,
          name: `User ${i}`,
          phone: `0812${String(10000000 + i)}`,
          passwordHash: "h",
          role: "customer" as const,
          createdAt: now,
        });
        d.wallets.push({ userId: `c-u${i}`, balance: 1000 * i, updatedAt: now });
      });
    }
    await waitFlush();

    const tables = postTables(); // urut: orders, profiles, wallets
    expect(tables).toEqual(["orders", "profiles", "wallets"]);
    const perTable: string[] = [];
    for (const table of ["orders", "profiles", "wallets"]) {
      const posts = postTableCalls(table);
      expect(posts).toHaveLength(1); // batas atas: 1 POST per koleksi
      expect((posts[0].rows as Row[])).toHaveLength(M);
      perTable.push(`${table}:${posts.length}`);
    }
    console.log(
      `  [ukur] 3 koleksi × ${M} mutasi (1 tick) → ${tables.length} POST (${perTable.join(", ")}) — batas atas 3 ✓`
    );
  });
});
