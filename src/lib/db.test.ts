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
import { describe, expect, it, vi } from "vitest";

// ---------- Mock Supabase (PostgREST tiruan) ----------

const { mockAdmin, store, calls, resetAll } = vi.hoisted(() => {
  const store: Record<string, unknown[]> = {};
  const calls: { method: string; table: string; rows?: unknown[] }[] = [];

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
        select: async (sel: string) => ({
          data: (store[table] ?? []).map((r) => project(sel, r as Record<string, unknown>)),
          error: null,
        }),
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
});
