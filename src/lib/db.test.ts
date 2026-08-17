/**
 * Unit test `src/lib/db.ts` (mode Supabase) — tanpa Supabase/Docker asli:
 * `./supabase/server` di-mock dengan client PostgREST tiruan yang
 * meng-emulasi perilaku alias `col as "alias"` pada select dan menyimpan
 * hasil upsert sebagai "database".
 *
 * Cakupan:
 * 1. Dirty tracking — hanya koleksi yang berubah yang ditulis (termasuk
 *    no-op tanpa tulis, dan koalesensi batch).
 * 2. Mapping koleksi↔tabel — nama tabel + bentuk baris snake_case.
 * 3. Round-trip hydrate → mutate → hydrate — simetri pemetaan baris↔entitas.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Mock Supabase (PostgREST tiruan) ----------
// Mode kegagalan hydration: "ok" (default) | "error" (select mengembalikan
// error PostgREST/500) | "timeout" (promise select REJECT — simulasi timeout
// jaringan). Dipakai test fallback ke MODE DEMO.

const { mockAdmin, store, calls, resetAll, failHydration } = vi.hoisted(() => {
  const store: Record<string, unknown[]> = {};
  const calls: { method: string; table: string; rows?: unknown[] }[] = [];
  let hydrateFail: "ok" | "error" | "timeout" = "ok";

  // Emulasi alias PostgREST: "userId:user_id" (colon) dan "password_hash as
  // \"passwordHash\"" → rename. (Aplikasi memakai colon agar tidak dimutilasi
  // postgrest-js v2; bentuk `as` tetap didukung untuk kompatibilitas.)
  const project = (sel: string, row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    const re = /([a-zA-Z_][a-zA-Z0-9_]*):([a-z_][a-z0-9_]*)|([a-z_][a-z0-9_]*)(?:\s+as\s+"([a-zA-Z_]+)")?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sel))) {
      if (m[1]) {
        // colon: Alias:column
        if (m[2] in row) out[m[1]] = row[m[2]];
      } else {
        // as: column as "Alias"
        const src = m[3];
        const dest = m[4] ?? m[3];
        if (src in row) out[dest] = row[src];
      }
    }
    return out;
  };

  const client = {
    from(table: string) {
      return {
        select: async (sel: string) => {
          if (hydrateFail === "error") {
            // PostgREST mengembalikan error (mis. HTTP 500 / relasi hilang).
            return { data: null, error: { message: "relation does not exist (HTTP 500)" } };
          }
          if (hydrateFail === "timeout") {
            // Jaringan timeout: promise select menolak (bukan response error).
            throw new Error("request timed out");
          }
          return {
            data: (store[table] ?? []).map((r) => project(sel, r as Record<string, unknown>)),
            error: null,
          };
        },
        upsert: async (rows: unknown[]) => {
          calls.push({ method: "upsert", table, rows });
          store[table] = rows; // tulis balik ke "database"
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
    failHydration: (mode: "ok" | "error" | "timeout") => {
      hydrateFail = mode;
    },
  };
});

vi.mock("./supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => mockAdmin,
  getSupabaseAnon: () => mockAdmin,
}));

// ---------- Helper ----------

const now = "2026-08-16T00:00:00.000Z";

type DbModule = typeof import("./db");

/**
 * Import ulang db.ts dengan state bersih + hydrate dari mock (opsional
 * menyimpan store). CATATAN: db.ts kini menyimpan cache/mode di globalThis
 * (dibagikan antar bundle di Next dev) — globalThis tidak ikut di-reset oleh
 * `vi.resetModules()`, jadi holder-nya dihapus manual agar modul baru benar-
 * benar fresh, bukan mewarisi cache tes sebelumnya.
 */
async function freshDb(keepStore = false): Promise<DbModule> {
  vi.resetModules();
  if (!keepStore) resetAll();
  else calls.length = 0;
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  const mod = await import("./db");
  await mod.ensureHydrated();
  expect(mod.getStoreMode()).toBe("supabase");
  return mod;
}

/** Tunggu flush fire-and-forget dari `mutate` (rantai microtask). */
const waitFlush = () => new Promise((r) => setTimeout(r, 30));

const upsertCalls = () => calls.filter((c) => c.method === "upsert");
const upsertTables = () => upsertCalls().map((c) => c.table).sort();

// ---------- Entitas contoh ----------

function user() {
  return { id: "u1", name: "Siti Aminah", phone: "081234567890", email: "siti@v.id", passwordHash: "h1", role: "customer" as const, createdAt: now };
}
function merchant() {
  return {
    id: "m1", userId: "u1", namaUsaha: "Warung Nusantara", kategoriUsaha: "Makanan",
    noWAUsaha: "081234567890", alamatUsaha: "Jl. Melati No. 12", namaPemilik: "Budi",
    noWAPemilik: "081234567890", email: "warung@v.id", status: "approved" as const, createdAt: now,
  };
}
function packageRow() {
  return { id: "pkg1", name: "Paket 7 Hari", days: 7, price: 7000, features: ["A", "B"], badge: "TERPOPULER" };
}
function membership() {
  return { id: "mbr1", userId: "u1", packageId: "pkg1", packageName: "Paket 7 Hari", startDate: now, endDate: now, status: "active" as const, createdAt: now };
}
function promo() {
  return { id: "prm1", merchantId: "m1", merchantName: "Warung Nusantara", name: "Promo A", jenisVoucher: "diskon" as const, startDate: now, endDate: now, jumlah: 100, createdAt: now };
}
function voucher() {
  return {
    id: "v1", merchantId: "m1", merchantName: "Warung Nusantara", promoId: "prm1", name: "Diskon 20%",
    jenisVoucher: "diskon" as const, nilai: 20000, minTransaksi: 100000, kuota: 50, masaBerlaku: now,
    maksPenggunaan: 2, syaratKetentuan: "s&k", jumlah: 50, status: "active" as const, createdAt: now,
  };
}
function claim() {
  return { id: "c1", voucherId: "v1", userId: "u1", kode: "VCH-001", kodeKonfirmasi: "K-001", status: "active" as const, claimedAt: now, useCount: 0 };
}
function order() {
  return {
    id: "o1", orderNumber: "VS-2026-001", userId: "u1", type: "package" as const,
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }], totalAmount: 7000,
    status: "pending" as const, paymentStatus: "pending" as const, snapToken: "snap-1",
    metadata: { packageId: "pkg1" }, createdAt: now,
  };
}
function merchandise() {
  return { id: "mds1", name: "Kaos", slug: "kaos", description: "Kaos premium", price: 99000, stock: 10, image: "👕", category: "Fashion", status: "active" as const, createdAt: now };
}
function wallet() {
  return { userId: "u1", balance: 50000, updatedAt: now };
}
function sessionRow() {
  return { token: "tok1", userId: "u1", createdAt: now, expiresAt: now };
}

// ==================== DIRTY TRACKING ====================

describe("dirty tracking", () => {
  it("hanya menulis koleksi yang berubah (orders saja)", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push(order());
    });
    await waitFlush();
    expect(upsertTables()).toEqual(["orders"]);
  });

  it("mutasi no-op tidak memicu tulis apa pun", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push(order());
    });
    await waitFlush();
    const before = upsertCalls().length;

    db.mutate(() => {}); // tidak mengubah apa pun
    await waitFlush();
    expect(upsertCalls().length).toBe(before);
  });

  it("satu mutate lintas koleksi menulis keduanya dalam satu flush", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.orders.push(order());
    });
    await waitFlush();
    expect(upsertTables()).toEqual(["orders", "profiles"]);
  });

  it("koalesensi: 3 mutasi orders berurutan → 1 tulis dengan snapshot terbaru", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push({ ...order(), id: "o1", status: "pending" });
    });
    db.mutate((d) => {
      d.orders.push({ ...order(), id: "o2" });
    });
    db.mutate((d) => {
      const o = d.orders.find((x) => x.id === "o1");
      if (o) o.paymentStatus = "paid";
    });
    await waitFlush();
    const posts = upsertCalls().filter((c) => c.table === "orders");
    expect(posts).toHaveLength(1); // dedupe per koleksi
    const rows = posts[0].rows as Array<{ id: string; payment_status: string }>;
    const o1 = rows.find((r) => r.id === "o1");
    expect(o1?.payment_status).toBe("paid"); // snapshot terbaru menang
    expect(rows).toHaveLength(2);
  });
});

// ==================== OBSERVABILITAS ANTREAN (getPersistQueueInfo) ====================

describe("getPersistQueueInfo — status antrean untuk /api/health", () => {
  it("state awal: supabase, hydrated, tanpa batch pending, drain belum terdaftar", async () => {
    const db = await freshDb();
    const info = db.getPersistQueueInfo();
    expect(info.storeMode).toBe("supabase");
    expect(info.hydrated).toBe(true);
    expect(info.pendingBatches).toBe(0);
    expect(info.pendingCollections).toEqual([]);
    expect(info.drainRegistered).toBe(false);
    expect(info.lastFlushAt).toBeNull();
    expect(info.lastFlushDurationMs).toBeNull();
    // Mode Supabase tidak menulis JSON — counter harus 0.
    expect(info.jsonWriteCount).toBe(0);
  });

  it("setelah mutate (belum flush): 1 batch pending berisi koleksi yang berubah", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push(order());
      d.users.push(user());
    });
    // Sebelum microtask flush berjalan, batch harus terlihat di health.
    const info = db.getPersistQueueInfo();
    expect(info.pendingBatches).toBe(1);
    expect(info.pendingCollections.sort()).toEqual(["orders", "users"]);
  });

  it("setelah flush: batch kosong + lastFlushAt/durasi tercatat", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push(order());
    });
    await waitFlush();
    const info = db.getPersistQueueInfo();
    expect(info.pendingBatches).toBe(0);
    expect(info.pendingCollections).toEqual([]);
    expect(info.lastFlushAt).not.toBeNull();
    expect(info.lastFlushDurationMs).not.toBeNull();
    expect(info.lastFlushDurationMs!).toBeGreaterThanOrEqual(0);
  });

  it("drainRegistered true setelah registerShutdownFlush (guard + bersih-bersih)", async () => {
    const db = await freshDb();
    const sigTermBefore = process.listenerCount("SIGTERM");
    db.registerShutdownFlush();
    expect(db.getPersistQueueInfo().drainRegistered).toBe(true);
    // Lepas listener + guard agar tidak bocor ke test lain.
    while (process.listenerCount("SIGTERM") > sigTermBefore) {
      process.removeListener("SIGTERM", process.listeners("SIGTERM")[0]);
    }
    delete (globalThis as unknown as { __vshopShutdownFlush?: boolean }).__vshopShutdownFlush;
    expect(db.getPersistQueueInfo().drainRegistered).toBe(false);
  });
});

// ==================== DRAIN TERAKHIR (drainAndExit) ====================

describe("drainAndExit — jalur drain tunggal (sinyal + /api/dev/shutdown)", () => {
  it("flush snapshot pending lalu panggil process.exit(0)", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.orders.push(order());
    });
    // Belum ada flush (mutasi hanya mengantre) — drain harus menuntaskannya.
    expect(upsertCalls().some((c) => c.table === "orders")).toBe(false);

    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      return undefined as never; // catat panggilan saja, jangan keluar
    });
    try {
      db.drainAndExit();
      const deadline = Date.now() + 3000;
      while (!exitSpy.mock.calls.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      // Drain menuntaskan tulis SEBELUM exit (snapshot tidak hilang).
      expect(upsertCalls().some((c) => c.table === "orders")).toBe(true);
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
    }
  });

  it("registerShutdownFlush tetap memakai drainAndExit (SIGTERM/SIGINT)", async () => {
    const db = await freshDb();
    const sigTermBefore = process.listenerCount("SIGTERM");
    const sigIntBefore = process.listenerCount("SIGINT");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      return undefined as never;
    });
    try {
      db.registerShutdownFlush();
      expect(process.listenerCount("SIGTERM")).toBe(sigTermBefore + 1);
      expect(process.listenerCount("SIGINT")).toBe(sigIntBefore + 1);

      // Emit SIGTERM → handler = drainAndExit → flush lalu exit(0).
      process.emit("SIGTERM");
      const deadline = Date.now() + 3000;
      while (!exitSpy.mock.calls.length && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(exitSpy).toHaveBeenCalledWith(0);
    } finally {
      exitSpy.mockRestore();
      while (process.listenerCount("SIGTERM") > sigTermBefore) {
        process.removeListener("SIGTERM", process.listeners("SIGTERM")[0]);
      }
      while (process.listenerCount("SIGINT") > sigIntBefore) {
        process.removeListener("SIGINT", process.listeners("SIGINT")[0]);
      }
      delete (globalThis as unknown as { __vshopShutdownFlush?: boolean }).__vshopShutdownFlush;
    }
  });
});

// ==================== MAPPING KOLEKSI ↔ TABEL ====================

describe("mapping koleksi ↔ tabel Supabase", () => {
  it("semua 12 koleksi memetakan ke tabel yang benar", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.merchants.push(merchant());
      d.packages.push(packageRow());
      d.memberships.push(membership());
      d.promos.push(promo());
      d.vouchers.push(voucher());
      d.claimedVouchers.push(claim());
      d.orders.push(order());
      d.merchandise.push(merchandise());
      d.wallets.push(wallet());
      d.sessions.push(sessionRow());
      d.carts["u1"] = [{ productId: "mds1", quantity: 1 }];
    });
    await db.persist();
    expect(upsertTables()).toEqual(
      [
        "claimed_vouchers", "carts", "memberships", "merchandise", "merchants",
        "orders", "packages", "profiles", "promos", "sessions", "vouchers", "wallets",
      ].sort()
    );
  });

  it("bentuk baris benar (camelCase → snake_case)", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.orders.push(order());
      d.vouchers.push(voucher());
      d.wallets.push(wallet());
      d.claimedVouchers.push(claim());
    });
    await db.persist();
    const byTable = Object.fromEntries(upsertCalls().map((c) => [c.table, c.rows ?? []]));

    expect(byTable["profiles"][0]).toEqual({
      id: "u1", name: "Siti Aminah", phone: "081234567890", email: "siti@v.id",
      password_hash: "h1", role: "customer", created_at: now,
    });
    expect(byTable["orders"][0]).toMatchObject({
      id: "o1", order_number: "VS-2026-001", user_id: "u1", type: "package",
      total_amount: 7000, status: "pending", payment_status: "pending",
      snap_token: "snap-1", metadata: { packageId: "pkg1" }, paid_at: null,
    });
    expect(byTable["vouchers"][0]).toMatchObject({
      id: "v1", jenis_voucher: "diskon", min_transaksi: 100000,
      masa_berlaku: now, maks_penggunaan: 2, syarat_ketentuan: "s&k",
    });
    expect(byTable["wallets"][0]).toEqual({ user_id: "u1", balance: 50000, updated_at: now });
    expect(byTable["claimed_vouchers"][0]).toMatchObject({
      id: "c1", kode: "VCH-001", kode_konfirmasi: "K-001", use_count: 0, used_at: null,
    });
  });
});

// ==================== PERSIST: DEBOUNCE FULL FLUSH ====================

describe("persist — debounce full flush (cron bersamaan)", () => {
  it("3 persist bersamaan (Promise.all) → SATU full flush, bukan 3", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.merchants.push(merchant());
      d.packages.push(packageRow());
      d.memberships.push(membership());
      d.promos.push(promo());
      d.vouchers.push(voucher());
      d.claimedVouchers.push(claim());
      d.orders.push(order());
      d.merchandise.push(merchandise());
      d.wallets.push(wallet());
      d.sessions.push(sessionRow());
      d.carts["u1"] = [{ productId: "mds1", quantity: 1 }];
    });
    await waitFlush(); // settle batch mutate
    const before = upsertCalls().length;

    await Promise.all([db.persist(), db.persist(), db.persist()]);
    await waitFlush();

    // SATU full flush: setiap 12 tabel ditulis SEKALI (12 upsert, bukan 36).
    const added = upsertCalls().slice(before);
    expect(added).toHaveLength(12);
    expect(new Set(added.map((c) => c.table)).size).toBe(12);
  });

  it("persist berurutan (setelah flush selesai) → tulis baru setiap kali", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.orders.push(order());
    });
    await waitFlush();
    const before = upsertCalls().length;

    await db.persist();
    await db.persist();
    await waitFlush();

    // 2 full flush × 2 tabel berisi (profiles, orders) = 4 upsert — debounce
    // TIDAK menekan panggilan berurutan (tabel kosong dilewati writer).
    expect(upsertCalls().length - before).toBe(4);
  });
});

// ==================== ROUND-TRIP HYDRATE → MUTATE → HYDRATE ====================

describe("round-trip hydrate → mutate → hydrate", () => {
  it("data yang ditulis bisa di-hydrate kembali tanpa kehilangan (semua koleksi)", async () => {
    const db = await freshDb();
    db.mutate((d) => {
      d.users.push(user());
      d.merchants.push(merchant());
      d.packages.push(packageRow());
      d.memberships.push(membership());
      d.promos.push(promo());
      d.vouchers.push(voucher());
      d.claimedVouchers.push(claim());
      d.orders.push(order());
      d.merchandise.push(merchandise());
      d.wallets.push(wallet());
      d.sessions.push(sessionRow());
      d.carts["u1"] = [{ productId: "mds1", quantity: 1 }];
    });
    await db.persist();

    const before = JSON.stringify(db.getDB());
    // Re-hydrate dari "database" (hasil tulis writer) — store dipertahankan.
    const db2 = await freshDb(true);
    const after = JSON.stringify(db2.getDB());
    expect(after).toBe(before);
  });

  it("payment_status 'cancelled' round-trip (konsisten dgn CHECK migration 0010)", async () => {
    vi.resetModules();
    resetAll();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    store.orders = [
      {
        id: "o-cancelled", order_number: "VS-C", user_id: "u1", type: "package",
        items: [], total_amount: 0,
        status: "cancelled", payment_status: "cancelled", payment_method: null,
        snap_token: null, shipping_address: null, metadata: {}, created_at: now, paid_at: null,
      },
    ];
    store.profiles = [
      { id: "u1", name: "Siti", phone: "081234567890", email: "s@v.id", password_hash: "h", role: "customer", created_at: now },
    ];

    const dbA = await import("./db");
    await dbA.ensureHydrated();
    expect(dbA.getDB().orders[0].paymentStatus).toBe("cancelled");
    await dbA.persist();

    const dbB = await freshDb(true); // re-hydrate dari store hasil tulis
    expect(dbB.getDB().orders[0].paymentStatus).toBe("cancelled");
  });

  it("mutasi setelah hydrate terlihat kembali setelah re-hydrate", async () => {
    // Reset → seed "database" (snake_case, seperti hasil writer) → hydrate.
    vi.resetModules();
    resetAll();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    store.orders = [
      {
        id: "o1", order_number: "VS-1", user_id: "u1", type: "package",
        items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }], total_amount: 7000,
        status: "pending", payment_status: "pending", payment_method: null,
        snap_token: null, shipping_address: null, metadata: {}, created_at: now, paid_at: null,
      },
    ];
    store.profiles = [
      { id: "u1", name: "Siti", phone: "081234567890", email: "s@v.id", password_hash: "h", role: "customer", created_at: now },
    ];

    const dbA = await import("./db"); // hydrate dari seed
    await dbA.ensureHydrated();
    expect(dbA.getStoreMode()).toBe("supabase");
    expect(dbA.getDB().users[0]).toEqual({
      id: "u1", name: "Siti", phone: "081234567890", email: "s@v.id",
      passwordHash: "h", role: "customer", createdAt: now,
    });
    expect(dbA.getDB().orders[0].paymentStatus).toBe("pending");

    dbA.mutate((d) => {
      d.orders[0].paymentStatus = "paid";
      d.orders[0].paymentMethod = "QRIS";
      d.orders[0].paidAt = now;
    });
    await dbA.persist();

    const dbB = await freshDb(true); // re-hydrate dari store yang sudah di-update
    const o = dbB.getDB().orders[0];
    expect(o.paymentStatus).toBe("paid");
    expect(o.paymentMethod).toBe("QRIS");
    expect(o.paidAt).toBe(now);
  });

  // ---------- Kolom NULLABLE: paidAt / shippingAddress (orders),
  // promoId (vouchers), usedAt (claimed_vouchers) — simetri NULL ⇄ undefined
  // harus tetap terjaga bila skema berubah (mis. migration menambah/mengubah
  // kolom nullable). NULL di DB → undefined di entity → persist → NULL lagi.

  it("kolom nullable NULL di DB → undefined; persist menulis null (bukan undefined); re-hydrate tetap undefined", async () => {
    vi.resetModules();
    resetAll();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    // Seed "database" langsung (snake_case, kolom nullable = NULL).
    store.orders = [
      {
        id: "o-null", order_number: "VS-NULL", user_id: "u1", type: "package",
        items: [], total_amount: 7000, status: "pending", payment_status: "pending",
        payment_method: null, snap_token: null, shipping_address: null, metadata: {},
        created_at: now, paid_at: null,
      },
    ];
    store.vouchers = [
      {
        id: "v-null", merchant_id: "m1", merchant_name: "Warung Nusantara",
        promo_id: null, name: "Diskon", jenis_voucher: "diskon", nilai: 20000,
        min_transaksi: 0, kuota: 50, masa_berlaku: now, maks_penggunaan: 1,
        syarat_ketentuan: "", jumlah: 50, status: "active", created_at: now,
      },
    ];
    store.claimed_vouchers = [
      {
        id: "c-null", voucher_id: "v-null", user_id: "u1", kode: "VCH-1",
        kode_konfirmasi: "K-1", status: "active", claimed_at: now, used_at: null,
        use_count: 0, expiring_notified_at: null, expiring_24h_notified_at: null,
      },
    ];

    const dbA = await import("./db"); // hydrate dari seed
    await dbA.ensureHydrated();
    expect(dbA.getStoreMode()).toBe("supabase");
    expect(dbA.getDB().orders[0].paidAt).toBeUndefined();
    expect(dbA.getDB().orders[0].shippingAddress).toBeUndefined();
    expect(dbA.getDB().vouchers[0].promoId).toBeUndefined();
    expect(dbA.getDB().claimedVouchers[0].usedAt).toBeUndefined();

    // Mutasi kecil pada KETIGA koleksi agar persist menulis semuanya.
    dbA.mutate((d) => {
      d.orders[0].status = "processing";
      d.vouchers[0].name = "Diskon Baru";
      d.claimedVouchers[0].kode = "VCH-1B";
    });
    await dbA.persist();

    // Writer memetakan undefined → NULL (bukan undefined di row JSON).
    const written = Object.fromEntries(upsertCalls().map((c) => [c.table, c.rows ?? []]));
    expect((written["orders"][0] as Record<string, unknown>).paid_at).toBeNull();
    expect((written["orders"][0] as Record<string, unknown>).shipping_address).toBeNull();
    expect((written["vouchers"][0] as Record<string, unknown>).promo_id).toBeNull();
    expect((written["claimed_vouchers"][0] as Record<string, unknown>).used_at).toBeNull();

    // Re-hydrate: NULL → undefined lagi — simetri kosong terjaga.
    const dbB = await freshDb(true);
    expect(dbB.getDB().orders[0].paidAt).toBeUndefined();
    expect(dbB.getDB().orders[0].shippingAddress).toBeUndefined();
    expect(dbB.getDB().vouchers[0].promoId).toBeUndefined();
    expect(dbB.getDB().claimedVouchers[0].usedAt).toBeUndefined();
  });

  it("kolom nullable TERISI → round-trip mempertahankan nilai persis", async () => {
    const db = await freshDb();
    const addr = {
      nama: "Siti Aminah", phone: "081234567890",
      alamat: "Jl. Melati No. 12", kota: "Jakarta", kodePos: "12345",
    };
    db.mutate((d) => {
      d.orders.push({ ...order(), id: "o-full", paidAt: now, shippingAddress: addr });
      d.vouchers.push({ ...voucher(), id: "v-full", promoId: "prm-full" });
      d.claimedVouchers.push({ ...claim(), id: "c-full", usedAt: now });
    });
    await db.persist();

    // Perbandingan deep-equality (bukan JSON.stringify): urutan key antar
    // pemetaan row→entitas boleh beda — yang disimulasikan adalah NILAI.
    const db2 = await freshDb(true); // re-hydrate dari store hasil writer
    expect(db2.getDB()).toEqual(db.getDB());
    expect(db2.getDB().orders.find((x) => x.id === "o-full")!.paidAt).toBe(now);
    expect(db2.getDB().orders.find((x) => x.id === "o-full")!.shippingAddress).toEqual(addr);
    expect(db2.getDB().vouchers.find((x) => x.id === "v-full")!.promoId).toBe("prm-full");
    expect(db2.getDB().claimedVouchers.find((x) => x.id === "c-full")!.usedAt).toBe(now);
  });

  it("kolom riwayat retry (migration 0002): original_order_number/previous_order_numbers ⇄ metadata", async () => {
    // NULL → metadata tidak diubah (kompatibilitas baris lama).
    vi.resetModules();
    resetAll();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    store.orders = [
      {
        id: "o-hist", order_number: "VS-20260817-0002", user_id: "u1", type: "package",
        items: [], total_amount: 7000, status: "failed", payment_status: "failed",
        payment_method: null, snap_token: null, shipping_address: null, metadata: {},
        created_at: now, paid_at: null,
        original_order_number: null, previous_order_numbers: null,
      },
    ];
    const dbA = await import("./db");
    await dbA.ensureHydrated();
    expect(dbA.getDB().orders[0].metadata.originalOrderNumber).toBeUndefined();
    expect(dbA.getDB().orders[0].metadata.previousOrderNumbers).toBeUndefined();

    // Retry: metadata diisi → persist → KOLOM ikut terisi.
    dbA.mutate((d) => {
      const o = d.orders[0];
      o.metadata = {
        ...o.metadata,
        originalOrderNumber: "VS-20260817-0001",
        previousOrderNumbers: ["VS-20260817-0001"],
        paymentAudit: [],
      };
    });
    await dbA.persist();
    const written = Object.fromEntries(upsertCalls().map((c) => [c.table, c.rows ?? []]));
    const row = written["orders"][0] as Record<string, unknown>;
    expect(row.original_order_number).toBe("VS-20260817-0001");
    expect(row.previous_order_numbers).toEqual(["VS-20260817-0001"]);

    // Re-hydrate: kolom digabungkan kembali ke metadata (kolom menang).
    const dbB = await freshDb(true);
    const o = dbB.getDB().orders[0];
    expect(o.metadata.originalOrderNumber).toBe("VS-20260817-0001");
    expect(o.metadata.previousOrderNumbers).toEqual(["VS-20260817-0001"]);

    // Riwayat yang di-hydrate dari kolom tetap bisa dibaca helper riwayat.
    const { buildOrderNumberHistory } = await import("./payment-history");
    expect(buildOrderNumberHistory(o)).toEqual([
      { from: "VS-20260817-0001", to: "VS-20260817-0002" },
    ]);
  });

  // Migration 0002 menambah kolom nullable sb_refresh_enc & sb_user_id di
  // sessions — mapping round-trip mereka juga harus simetris.

  it("sesi (migration 0002): sb_refresh_enc/sb_user_id NULL ⇄ undefined, terisi round-trip", async () => {
    // NULL → undefined → persist → null.
    vi.resetModules();
    resetAll();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    store.sessions = [
      {
        token: "tok-null", user_id: "u1", created_at: now, expires_at: now,
        sb_refresh_enc: null, sb_user_id: null,
      },
    ];
    const dbA = await import("./db");
    await dbA.ensureHydrated();
    expect(dbA.getDB().sessions[0].sbRefreshEnc).toBeUndefined();
    expect(dbA.getDB().sessions[0].sbUserId).toBeUndefined();

    dbA.mutate((d) => {
      d.sessions[0].expiresAt = "2026-09-01T00:00:00.000Z";
    });
    await dbA.persist();
    const written = Object.fromEntries(upsertCalls().map((c) => [c.table, c.rows ?? []]));
    expect((written["sessions"][0] as Record<string, unknown>).sb_refresh_enc).toBeNull();
    expect((written["sessions"][0] as Record<string, unknown>).sb_user_id).toBeNull();

    // Terisi → round-trip penuh.
    const db = await freshDb();
    db.mutate((d) => {
      d.sessions.push({
        token: "tok-enc", userId: "u1", createdAt: now, expiresAt: now,
        sbRefreshEnc: "v1:enc", sbUserId: "auth-1",
      });
    });
    await db.persist();
    const db2 = await freshDb(true);
    const s = db2.getDB().sessions.find((x) => x.token === "tok-enc")!;
    expect(s.sbRefreshEnc).toBe("v1:enc");
    expect(s.sbUserId).toBe("auth-1");
  });
});

// ==================== FALLBACK KE MODE DEMO ====================
// Bila Supabase dikonfigurasi tapi hydration GAGAL (error PostgREST / 500,
// atau timeout jaringan), `initDB` harus jatuh ke MODE DEMO (JSON) dengan
// peringatan yang jelas — bukan crash, bukan mode supabase setengah jadi.
// `VSHOP_DATA_DIR` diarahkan ke direktori temp agar seed/tulis JSON tidak
// menyentuh data proyek.

describe("fallback ke MODE DEMO saat Supabase gagal hydration", () => {
  const saveEnv: Record<string, string | undefined> = {};
  let tempDir = "";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-db-fallback-"));
    saveEnv.VSHOP_DATA_DIR = process.env.VSHOP_DATA_DIR;
    process.env.VSHOP_DATA_DIR = tempDir;
  });

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (saveEnv.VSHOP_DATA_DIR === undefined) delete process.env.VSHOP_DATA_DIR;
    else process.env.VSHOP_DATA_DIR = saveEnv.VSHOP_DATA_DIR;
    failHydration("ok");
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    vi.restoreAllMocks();
  });

  /** Import ulang db.ts dengan mode kegagalan hydration tertentu. */
  async function freshFallback(mode: "error" | "timeout") {
    failHydration(mode);
    vi.resetModules();
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    const mod = await import("./db");
    await mod.ensureHydrated(); // resolve TANPA melempar (fallback graceful)
    return mod;
  }

  it("select mengembalikan error (HTTP 500) → mode json + peringatan spesifik + data ter-seed", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await freshFallback("error");

    expect(mod.getStoreMode()).toBe("json");
    // Data demo ter-seed (bukan cache supabase kosong).
    expect(mod.getDB().users.length).toBeGreaterThan(0);
    expect(mod.getDB().merchandise.length).toBeGreaterThan(0);

    // Satu peringatan dengan pesan yang benar (pesan error PostgREST ikut).
    const warns = errSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Fallback ke MODE DEMO"));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("[db] Supabase tidak tersedia");
    expect(warns[0]).toContain("relation does not exist (HTTP 500)");
    expect(warns[0]).toContain("MODE DEMO (JSON)");

    // Mode demo benar-benar berfungsi setelah fallback: mutate → tulis JSON.
    const writesBefore = mod.getJsonWriteCount();
    mod.mutate((d) => {
      d.carts["u-fallback"] = [{ productId: "mds1", quantity: 1 }];
    });
    await mod.flushNow();
    expect(mod.getJsonWriteCount()).toBeGreaterThan(writesBefore);
    // Snapshot tersimpan di file temp.
    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tempDir, "db.json"), "utf8")
    ) as { carts: Record<string, unknown> };
    expect(onDisk.carts["u-fallback"]).toEqual([{ productId: "mds1", quantity: 1 }]);
  });

  it("select REJECT (timeout jaringan) → mode json + peringatan timeout", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await freshFallback("timeout");

    expect(mod.getStoreMode()).toBe("json");
    const warns = errSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Fallback ke MODE DEMO"));
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain("request timed out");
    expect(warns[0]).toContain("[db] Supabase tidak tersedia");
  });

  it("fallback memoized: ensureHydrated kedua tidak mencoba Supabase lagi", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await freshFallback("error");

    // Pulihkan mock jadi sehat — tapi karena hydration sudah di-memoize di
    // globalThis, store TIDAK boleh pindah ke supabase atau mencoba ulang.
    failHydration("ok");
    await mod.ensureHydrated();
    expect(mod.getStoreMode()).toBe("json");
    const warns = errSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Fallback ke MODE DEMO"));
    expect(warns).toHaveLength(1); // tidak ada percobaan kedua / peringatan baru
  });
});
