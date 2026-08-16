import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type {
  ClaimedVoucher,
  DB,
  Merchandise,
  Membership,
  Merchant,
  Order,
  Package,
  Promo,
  Session,
  User,
  Voucher,
  Wallet,
} from "./types";
import { getSupabaseAdmin, isSupabaseConfigured } from "./supabase/server";

/**
 * Penyimpanan data V Shop — MODE HIBRIDA:
 *
 * 1. MODE SUPABASE — bila `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
 *    tersedia. DB di-hydrate dari PostgreSQL (tabel `profiles`, `merchants`,
 *    `orders`, dst. — lihat supabase/migrations) saat server start (via
 *    `src/instrumentation.ts`), lalu setiap mutasi (`mutate`) di-persist
 *    kembali ke Supabase. Seluruh akses memakai service-role key (bypass RLS);
 *    RLS tetap aktif sebagai pertahanan berlapis untuk akses langsung.
 *
 * 2. MODE DEMO — fallback bila Supabase tidak dikonfigurasi atau tidak
 *    terjangkau. Data disimpan sebagai satu file JSON di <cwd>/data/db.json
 *    dan di-seed otomatis saat pertama kali dijalankan.
 *
 * Antarmuka operasi bisnis tetap sama melalui `src/lib/service.ts`.
 */

export type StoreMode = "supabase" | "json";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

// State store (cache + mode + promise hydrate) disimpan di **globalThis** —
// Next.js dev membuat SATU instance modul per bundle (route handler vs
// halaman). Cache modul biasa tidak dibagikan antar bundle, sehingga halaman
// bisa jatuh ke MODE DEMO diam-diam dan tidak melihat sesi/data yang dibuat
// route handler (bug: daftar/login sukses tapi halaman tetap belum-login).
// globalThis menyatukan state di semua bundle (pola sama seperti store OTP &
// guard scheduler cron).
interface DbSharedState {
  cache: DB | null;
  storeMode: StoreMode;
  hydrationPromise: Promise<void> | null;
}
function sharedState(): DbSharedState {
  const g = globalThis as unknown as { __vshopDbState?: DbSharedState };
  return (g.__vshopDbState ??= { cache: null, storeMode: "json", hydrationPromise: null });
}

let persistChain: Promise<void> = Promise.resolve();

export function getStoreMode(): StoreMode {
  return sharedState().storeMode;
}

export function hashPassword(password: string): string {
  return createHash("sha256")
    .update(`vshop-demo::${password}`)
    .digest("hex");
}

export function newId(prefix = "id"): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function emptyDB(): DB {
  return {
    users: [],
    merchants: [],
    packages: [],
    memberships: [],
    promos: [],
    vouchers: [],
    claimedVouchers: [],
    orders: [],
    merchandise: [],
    wallets: [],
    sessions: [],
    carts: {},
  };
}

function seed(): DB {
  const db = emptyDB();
  const now = isoNow();

  // ---- Pengguna demo ----
  const admin: User = {
    id: newId("usr"),
    name: "Admin Vshop",
    email: "admin@vshop.id",
    passwordHash: hashPassword("admin123"),
    role: "admin",
    createdAt: now,
  };
  const customer: User = {
    id: newId("usr"),
    name: "Siti Aminah",
    phone: "081234567890",
    email: "customer@vshop.id",
    passwordHash: hashPassword("customer123"),
    role: "customer",
    createdAt: daysFromNow(-12),
  };
  const budi: User = {
    id: newId("usr"),
    name: "Pak Budi",
    phone: "081298765432",
    email: "merchant@vshop.id",
    passwordHash: hashPassword("merchant123"),
    role: "merchant",
    createdAt: daysFromNow(-30),
  };
  const kopi: User = {
    id: newId("usr"),
    name: "Rina",
    phone: "081377766655",
    email: "kopi@vshop.id",
    passwordHash: hashPassword("kopi123"),
    role: "merchant",
    createdAt: daysFromNow(-20),
  };
  const pendingOwner: User = {
    id: newId("usr"),
    name: "Hendra",
    phone: "081555443322",
    email: "elektronik@vshop.id",
    passwordHash: hashPassword("elektronik123"),
    role: "customer", // role merchant aktif setelah disetujui admin
    createdAt: daysFromNow(-2),
  };
  db.users.push(admin, customer, budi, kopi, pendingOwner);

  // ---- Merchant ----
  const warung: Merchant = {
    id: newId("mch"),
    userId: budi.id,
    namaUsaha: "Warung Nusantara",
    kategoriUsaha: "Makanan & Minuman",
    noWAUsaha: "081298765432",
    alamatUsaha: "Jl. Melati No. 12, Jakarta Selatan",
    googleMapsUrl: "https://maps.google.com/?q=Warung+Nusantara",
    fotoUsaha: "🏪",
    logoUsaha: "🍛",
    namaPemilik: "Budi Santoso",
    noWAPemilik: "081298765432",
    email: "merchant@vshop.id",
    deskripsi: "Warung makan rumahan dengan menu nusantara.",
    jamOperasional: "08.00 - 21.00",
    status: "approved",
    createdAt: daysFromNow(-30),
  };
  const kopiNusantara: Merchant = {
    id: newId("mch"),
    userId: kopi.id,
    namaUsaha: "Kopi Nusantara",
    kategoriUsaha: "F&B - Kopi",
    noWAUsaha: "081377766655",
    alamatUsaha: "Jl. Kenanga No. 3, Bandung",
    googleMapsUrl: "https://maps.google.com/?q=Kopi+Nusantara",
    fotoUsaha: "☕",
    logoUsaha: "☕",
    namaPemilik: "Rina Wijaya",
    noWAPemilik: "081377766655",
    email: "kopi@vshop.id",
    deskripsi: "Kedai kopi specialty lokal.",
    jamOperasional: "07.00 - 22.00",
    status: "approved",
    createdAt: daysFromNow(-20),
  };
  const elektronikJaya: Merchant = {
    id: newId("mch"),
    userId: pendingOwner.id,
    namaUsaha: "Elektronik Jaya",
    kategoriUsaha: "Elektronik",
    noWAUsaha: "081555443322",
    alamatUsaha: "Jl. Merdeka No. 45, Surabaya",
    googleMapsUrl: "https://maps.google.com/?q=Elektronik+Jaya",
    fotoUsaha: "🖥️",
    logoUsaha: "🔌",
    namaPemilik: "Hendra Gunawan",
    noWAPemilik: "081555443322",
    email: "elektronik@vshop.id",
    deskripsi: "Toko elektronik dan aksesoris.",
    jamOperasional: "09.00 - 20.00",
    status: "pending",
    createdAt: daysFromNow(-2),
  };
  db.merchants.push(warung, kopiNusantara, elektronikJaya);

  // ---- Paket langganan (sesuai desain) ----
  db.packages.push(
    {
      id: newId("pkg"),
      name: "Paket 7 Hari",
      days: 7,
      price: 7000,
      features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"],
    },
    {
      id: newId("pkg"),
      name: "Paket 14 Hari",
      days: 14,
      price: 13000,
      features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"],
      badge: "TERPOPULER",
    },
    {
      id: newId("pkg"),
      name: "Paket 30 Hari",
      days: 30,
      price: 25000,
      features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"],
      badge: "PALING HEMAT",
    }
  );

  // ---- Promo & voucher merchant ----
  const promo1 = {
    id: newId("prm"),
    merchantId: warung.id,
    merchantName: "Warung Nusantara",
    name: "Promo Ramadhan Hemat",
    jenisVoucher: "diskon",
    startDate: daysFromNow(-10),
    endDate: daysFromNow(10),
    jumlah: 200,
    createdAt: daysFromNow(-10),
  };
  const promo2 = {
    id: newId("prm"),
    merchantId: warung.id,
    merchantName: "Warung Nusantara",
    name: "Weekend Cashback",
    jenisVoucher: "cashback",
    startDate: daysFromNow(-5),
    endDate: daysFromNow(5),
    jumlah: 150,
    createdAt: daysFromNow(-5),
  };
  const promo3 = {
    id: newId("prm"),
    merchantId: kopiNusantara.id,
    merchantName: "Kopi Nusantara",
    name: "Diskon Kopi Spesial",
    jenisVoucher: "diskon",
    startDate: daysFromNow(-3),
    endDate: daysFromNow(20),
    jumlah: 100,
    createdAt: daysFromNow(-3),
  };
  db.promos.push(promo1, promo2, promo3);

  db.vouchers.push(
    {
      id: newId("vch"),
      merchantId: warung.id,
      merchantName: "Warung Nusantara",
      promoId: promo1.id,
      name: "Diskon 20% Makanan",
      jenisVoucher: "diskon",
      nilai: 20000,
      minTransaksi: 100000,
      kuota: 200,
      masaBerlaku: daysFromNow(10),
      maksPenggunaan: 2,
      syaratKetentuan: "Berlaku untuk semua menu makanan. Tidak dapat digabung dengan promo lain.",
      jumlah: 200,
      status: "active",
      createdAt: daysFromNow(-10),
    },
    {
      id: newId("vch"),
      merchantId: warung.id,
      merchantName: "Warung Nusantara",
      promoId: promo1.id,
      name: "Gratis Ongkir 25rb",
      jenisVoucher: "gratis-ongkir",
      nilai: 25000,
      minTransaksi: 50000,
      kuota: 150,
      masaBerlaku: daysFromNow(12),
      maksPenggunaan: 3,
      syaratKetentuan: "Gratis ongkir untuk area Jabodetabek. Maksimal 3x per pelanggan.",
      jumlah: 150,
      status: "active",
      createdAt: daysFromNow(-10),
    },
    {
      id: newId("vch"),
      merchantId: warung.id,
      merchantName: "Warung Nusantara",
      promoId: promo2.id,
      name: "Cashback 15rb",
      jenisVoucher: "cashback",
      nilai: 15000,
      minTransaksi: 50000,
      kuota: 150,
      masaBerlaku: daysFromNow(5),
      maksPenggunaan: 1,
      syaratKetentuan: "Cashback diberikan setelah transaksi diverifikasi.",
      jumlah: 150,
      status: "active",
      createdAt: daysFromNow(-5),
    },
    {
      id: newId("vch"),
      merchantId: kopiNusantara.id,
      merchantName: "Kopi Nusantara",
      promoId: promo3.id,
      name: "Diskon 15% Kopi",
      jenisVoucher: "diskon",
      nilai: 15000,
      minTransaksi: 60000,
      kuota: 100,
      masaBerlaku: daysFromNow(20),
      maksPenggunaan: 2,
      syaratKetentuan: "Berlaku untuk semua menu kopi. Take away maupun dine in.",
      jumlah: 100,
      status: "active",
      createdAt: daysFromNow(-3),
    }
  );

  // ---- Merchandise (produk V Shop) ----
  db.merchandise.push(
    {
      id: newId("mds"),
      name: "Kaos V Shop Premium",
      slug: "kaos-vshop-premium",
      description: "Kaos katun combed 30s dengan logo V Shop. Nyaman dipakai sehari-hari.",
      price: 99000,
      stock: 50,
      image: "👕",
      category: "Fashion",
      status: "active",
      createdAt: daysFromNow(-20),
    },
    {
      id: newId("mds"),
      name: "Totebag V Shop",
      slug: "totebag-vshop",
      description: "Totebag kanvas tebal serbaguna untuk belanja hemat.",
      price: 45000,
      stock: 80,
      image: "👜",
      category: "Aksesoris",
      status: "active",
      createdAt: daysFromNow(-20),
    },
    {
      id: newId("mds"),
      name: "Mug Keramik V Shop",
      slug: "mug-keramik-vshop",
      description: "Mug keramik 350ml dengan desain eksklusif V Shop.",
      price: 35000,
      stock: 60,
      image: "☕",
      category: "Rumah Tangga",
      status: "active",
      createdAt: daysFromNow(-18),
    },
    {
      id: newId("mds"),
      name: "Hoodie V Shop",
      slug: "hoodie-vshop",
      description: "Hoodie fleece tebal, hangat dan stylish.",
      price: 150000,
      stock: 30,
      image: "🧥",
      category: "Fashion",
      status: "active",
      createdAt: daysFromNow(-15),
    },
    {
      id: newId("mds"),
      name: "Botol Minum Stainless",
      slug: "botol-minum-stainless",
      description: "Botol minum stainless 500ml, tahan panas dan dingin.",
      price: 60000,
      stock: 40,
      image: "🍶",
      category: "Rumah Tangga",
      status: "active",
      createdAt: daysFromNow(-12),
    },
    {
      id: newId("mds"),
      name: "Sticker Pack V Shop",
      slug: "sticker-pack-vshop",
      description: "Paket 10 stiker eksklusif V Shop untuk hiasan barang kesayanganmu.",
      price: 15000,
      stock: 200,
      image: "✨",
      category: "Aksesoris",
      status: "active",
      createdAt: daysFromNow(-10),
    }
  );

  // ---- Keanggotaan demo customer ----
  db.memberships.push({
    id: newId("mbr"),
    userId: customer.id,
    packageId: db.packages[2].id,
    packageName: db.packages[2].name,
    startDate: daysFromNow(-5),
    endDate: daysFromNow(25),
    status: "active",
    createdAt: daysFromNow(-5),
  });

  // ---- Voucher terklaim demo customer ----
  db.claimedVouchers.push(
    {
      id: newId("clm"),
      voucherId: db.vouchers[0].id,
      userId: customer.id,
      kode: "VS-8F3A-21KQ",
      kodeKonfirmasi: "482913",
      status: "used",
      claimedAt: daysFromNow(-4),
      usedAt: daysFromNow(-2),
      useCount: 1,
    },
    {
      id: newId("clm"),
      voucherId: db.vouchers[1].id,
      userId: customer.id,
      kode: "VS-7B2C-90MX",
      kodeKonfirmasi: "731205",
      status: "active",
      claimedAt: daysFromNow(-1),
      useCount: 0,
    }
  );

  // ---- Dompet demo customer ----
  db.wallets.push({
    userId: customer.id,
    balance: 50000,
    updatedAt: now,
  });

  // ---- Order demo (paket 30 hari sudah dibayar) ----
  db.orders.push({
    id: newId("ord"),
    orderNumber: "VS-20260811-0001",
    userId: customer.id,
    type: "package",
    items: [{ name: "Paket 30 Hari", unitPrice: 25000, quantity: 1 }],
    totalAmount: 25000,
    status: "paid",
    paymentStatus: "paid",
    paymentMethod: "QRIS",
    snapToken: "snap-demo-seeded",
    shippingAddress: {
      nama: "Siti Aminah",
      phone: "081234567890",
      alamat: "Jl. Anggrek No. 7",
      kota: "Jakarta",
      kodePos: "12345",
    },
    metadata: { packageId: db.packages[2].id, packageName: "Paket 30 Hari", days: 30 },
    createdAt: daysFromNow(-5),
    paidAt: daysFromNow(-5),
  });

  return db;
}

/** Muat DB dari disk (mode demo); seed otomatis bila file belum ada. */
function loadJsonDB(): DB {
  const S = sharedState();
  try {
    if (fs.existsSync(DB_FILE)) {
      S.cache = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as DB;
      return S.cache;
    }
  } catch {
    // korup / gagal baca → rebuild
  }
  S.cache = seed();
  writeJson(S.cache);
  return S.cache;
}

function writeJson(db: DB): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Nama tmp unik per tulis — aman terhadap tulis bersamaan (mis. beberapa
    // halaman statis di-prerender paralel saat build). Rename bersifat
    // replace-atomic, jadi penulis terakhir menang (full snapshot).
    const tmp = `${DB_FILE}.${process.pid}.${Math.random().toString(36).slice(2, 10)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2), "utf8");
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error(
      "[db] Gagal menulis data/db.json:",
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Inisialisasi store — panggil sekali saat server start (lihat
 * `src/instrumentation.ts`). Bila Supabase dikonfigurasi, seluruh koleksi
 * di-hydrate dari PostgreSQL; bila gagal / tidak dikonfigurasi, fallback ke
 * mode demo (JSON).
 */
export async function initDB(): Promise<void> {
  const S = sharedState();
  if (!isSupabaseConfigured()) {
    S.storeMode = "json";
    loadJsonDB();
    return;
  }
  try {
    S.cache = await hydrateFromSupabase();
    S.storeMode = "supabase";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[db] Supabase tidak tersedia (${msg}). Fallback ke MODE DEMO (JSON). ` +
        `Pastikan migration & SUPABASE_SERVICE_ROLE_KEY sudah benar.`
    );
    S.storeMode = "json";
    loadJsonDB();
  }
}

/**
 * Pastikan store ter-init — await di root layout & API routes sebelum
 * membaca/menulis data. Memoized di globalThis: hanya sekali hydrate per
 * proses; no-op setelahnya. Bekerja di dev maupun produksi (tanpa bergantung
 * instrumentation hook).
 */
export function ensureHydrated(): Promise<void> {
  const S = sharedState();
  if (S.storeMode === "supabase") return Promise.resolve();
  if (S.hydrationPromise) return S.hydrationPromise;
  S.hydrationPromise = initDB();
  return S.hydrationPromise;
}

/** Muat DB; seed otomatis bila belum di-init (mis. saat build). */
export function getDB(): DB {
  const S = sharedState();
  if (S.cache) return S.cache;
  S.storeMode = "json";
  return loadJsonDB();
}

/**
 * Sinkronkan SATU baris sesi dari PostgREST ke cache proses Node bila belum
 * ada (no-op bila sudah ada / mode demo). Dipanggil root layout setelah
 * middleware membuat/memperbarui sesi di sisi server — middleware berjalan
 * di runtime terpisah (Edge) sehingga tidak bisa menulis cache ini sendiri;
 * tanpa sinkronisasi ini halaman akan tetap render sebagai belum-login.
 * User pemilik sesi juga ikut disinkronkan bila belum ada di cache.
 */
export async function fetchSessionIntoCache(token: string): Promise<void> {
  const S = sharedState();
  if (S.storeMode !== "supabase" || !S.cache) return;
  if (S.cache.sessions.some((s) => s.token === token)) return;
  const sb = getSupabaseAdmin();
  if (!sb) return;
  // CATATAN: pakai sintaks alias `Alias:column` (bukan `col as "alias"`)
  // — postgrest-js v2 menormalkan select dan MEMBUANG spasi, sehingga
  // `col as "alias"` dikirim sebagai `colas"alias"` yang DITOLAK PostgREST
  // asli ("failed to parse select parameter"). Bentuk `Alias:column`
  // dipertahankan apa adanya dan valid di PostgREST.
  const { data } = await sb
    .from("sessions")
    .select(
      "token,userId:user_id,createdAt:created_at,expiresAt:expires_at,sbRefreshEnc:sb_refresh_enc,sbUserId:sb_user_id"
    )
    .eq("token", token)
    .maybeSingle();
  if (!data) return;
  const row = data as unknown as Row;
  S.cache.sessions.push(sessionFromRow(row));
  const userId = String(row.userId);
  if (!S.cache.users.some((u) => u.id === userId)) {
    const { data: profile } = await sb
      .from("profiles")
      .select("id,name,phone,email,passwordHash:password_hash,role,createdAt:created_at")
      .eq("id", userId)
      .maybeSingle();
    if (profile) S.cache.users.push(userFromRow(profile as unknown as Row));
  }
}

/** Kunci koleksi DB — dipakai untuk tracking perubahan per koleksi. */
const COLLECTION_KEYS = [
  "users",
  "merchants",
  "packages",
  "memberships",
  "promos",
  "vouchers",
  "claimedVouchers",
  "orders",
  "merchandise",
  "wallets",
  "sessions",
  "carts",
] as const;

type CollectionKey = (typeof COLLECTION_KEYS)[number];

/** Snapshot JSON per koleksi — deteksi perubahan (dirty tracking). */
function captureCollections(db: DB): Record<CollectionKey, string> {
  const snap = {} as Record<CollectionKey, string>;
  for (const key of COLLECTION_KEYS) snap[key] = JSON.stringify(db[key]);
  return snap;
}

/**
 * Tulis yang belum ter-flush: snapshot DB terbaru + kumpulan koleksi yang
 * menunggu. Dipakai untuk KOALESENSI — beberapa `mutate()` berurutan
 * digabung jadi satu flush, koleksi yang sama hanya ditulis sekali dengan
 * snapshot TERBARU (tulis lama dilewati, karena upsert idempotent per PK).
 */
let pendingWrite: { snapshot: DB; keys: Set<CollectionKey> } | null = null;

/** Flush batch pending (bila ada) — satu tugas per batch. */
async function flushPendingWrite(): Promise<void> {
  const job = pendingWrite;
  pendingWrite = null; // tulis yang masuk selama flush berjalan → batch baru
  if (!job) return;
  await writeCollectionsToSupabase(job.snapshot, Array.from(job.keys));
}

/**
 * Antrekan tulis ke Supabase dengan KOALESENSI per koleksi: bila koleksi
 * yang sama sudah mengantre (belum ter-flush), tulis lama dilewati dan
 * digantikan snapshot terbaru. Urutan antar batch tetap terjaga lewat
 * rantai promise; tulis yang sedang berjalan tidak bisa di-dedupe.
 */
function enqueueWrite(snapshot: DB, keys: CollectionKey[]): Promise<void> {
  if (pendingWrite) {
    // Gabung ke batch yang belum ter-flush: snapshot terbaru menang,
    // kunci digabung (Set) sehingga tiap koleksi hanya ditulis sekali.
    pendingWrite.snapshot = snapshot;
    for (const key of keys) pendingWrite.keys.add(key);
  } else {
    pendingWrite = { snapshot, keys: new Set(keys) };
    const run = persistChain.then(() => flushPendingWrite());
    persistChain = run.catch((err) =>
      console.error(
        "[db] Gagal menulis ke Supabase:",
        err instanceof Error ? err.message : err
      )
    );
  }
  return persistChain;
}

/** Tulis hanya koleksi yang berubah (Supabase) / tulis file JSON (demo). */
function writeDirty(keys: CollectionKey[]): void {
  const S = sharedState();
  if (!S.cache) return;
  if (S.storeMode === "supabase") {
    void enqueueWrite(structuredClone(S.cache), keys);
  } else {
    writeJson(S.cache);
  }
}

/**
 * Persist state saat ini ke penyimpanan aktif (Supabase / JSON).
 * Di mode Supabase bersifat async berantai sehingga urutan tulis terjaga.
 * Full flush (semua koleksi) — dipakai untuk sinkronisasi penuh.
 */
export function persist(): Promise<void> {
  const S = sharedState();
  if (!S.cache) return Promise.resolve();
  if (S.storeMode === "supabase") {
    return enqueueWrite(structuredClone(S.cache), [...COLLECTION_KEYS]);
  }
  writeJson(S.cache);
  return Promise.resolve();
}

/**
 * Mutasi DB dengan aman: hasil mutasi langsung dipersist ke penyimpanan
 * aktif. Di mode Supabase, hanya koleksi yang benar-benar berubah yang
 * ditulis ke PostgreSQL (write-through per koleksi, dirty tracking via
 * snapshot JSON). Selalu panggil di server (route handler / server
 * component).
 */
export function mutate<T>(fn: (db: DB) => T): T {
  const db = getDB();
  const supabase = sharedState().storeMode === "supabase";
  const before = supabase ? captureCollections(db) : null;
  const result = fn(db);
  if (supabase && before) {
    const dirty: CollectionKey[] = [];
    for (const key of COLLECTION_KEYS) {
      if (JSON.stringify(db[key]) !== before[key]) dirty.push(key);
    }
    if (dirty.length > 0) void enqueueWrite(structuredClone(db), dirty);
  } else {
    writeJson(db);
  }
  return result;
}

/** Tambah/perbarui user di cache + Supabase (dipakai alur auth Supabase). */
export function upsertUser(user: User): void {
  const db = getDB();
  const idx = db.users.findIndex((u) => u.id === user.id);
  if (idx >= 0) db.users[idx] = user;
  else db.users.push(user);
  writeDirty(["users"]);
}

/** Tambah/perbarui merchant di cache + Supabase (dipakai alur auth Supabase). */
export function upsertMerchant(merchant: Merchant): void {
  const db = getDB();
  const idx = db.merchants.findIndex((m) => m.id === merchant.id);
  if (idx >= 0) db.merchants[idx] = merchant;
  else db.merchants.push(merchant);
  writeDirty(["merchants"]);
}

/* ==================== SUPABASE: mapping baris ↔ entitas ==================== */

interface Row {
  [key: string]: unknown;
}

function userFromRow(r: Row): User {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    phone: r.phone ? String(r.phone) : undefined,
    email: r.email ? String(r.email) : undefined,
    passwordHash: String(r.passwordHash ?? ""),
    role: r.role as User["role"],
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

function merchantFromRow(r: Row): Merchant {
  return {
    id: String(r.id),
    userId: String(r.userId),
    namaUsaha: String(r.namaUsaha ?? ""),
    kategoriUsaha: String(r.kategoriUsaha ?? ""),
    noWAUsaha: String(r.noWAUsaha ?? ""),
    alamatUsaha: String(r.alamatUsaha ?? ""),
    googleMapsUrl: r.googleMapsUrl ? String(r.googleMapsUrl) : undefined,
    fotoUsaha: r.fotoUsaha ? String(r.fotoUsaha) : undefined,
    logoUsaha: r.logoUsaha ? String(r.logoUsaha) : undefined,
    namaPemilik: String(r.namaPemilik ?? ""),
    noWAPemilik: String(r.noWAPemilik ?? ""),
    email: String(r.email ?? ""),
    deskripsi: r.deskripsi ? String(r.deskripsi) : undefined,
    jamOperasional: r.jamOperasional ? String(r.jamOperasional) : undefined,
    status: r.status as Merchant["status"],
    createdAt: String(r.createdAt ?? new Date().toISOString()),
  };
}

function packageFromRow(r: Row): Package {
  return {
    id: String(r.id),
    name: String(r.name),
    days: Number(r.days ?? 0),
    price: Number(r.price ?? 0),
    features: Array.isArray(r.features) ? (r.features as string[]) : [],
    badge: r.badge ? String(r.badge) : undefined,
  };
}

function membershipFromRow(r: Row): Membership {
  return {
    id: String(r.id),
    userId: String(r.userId),
    packageId: String(r.packageId),
    packageName: String(r.packageName ?? ""),
    startDate: String(r.startDate),
    endDate: String(r.endDate),
    status: r.status as Membership["status"],
    createdAt: String(r.createdAt),
  };
}

function promoFromRow(r: Row): Promo {
  return {
    id: String(r.id),
    merchantId: String(r.merchantId),
    merchantName: String(r.merchantName ?? ""),
    name: String(r.name ?? ""),
    jenisVoucher: String(r.jenisVoucher ?? ""),
    startDate: String(r.startDate),
    endDate: String(r.endDate),
    jumlah: Number(r.jumlah ?? 0),
    createdAt: String(r.createdAt),
  };
}

function voucherFromRow(r: Row): Voucher {
  return {
    id: String(r.id),
    merchantId: String(r.merchantId),
    merchantName: String(r.merchantName ?? ""),
    promoId: r.promoId ? String(r.promoId) : undefined,
    name: String(r.name ?? ""),
    jenisVoucher: String(r.jenisVoucher ?? ""),
    nilai: Number(r.nilai ?? 0),
    minTransaksi: Number(r.minTransaksi ?? 0),
    kuota: Number(r.kuota ?? 0),
    masaBerlaku: String(r.masaBerlaku),
    maksPenggunaan: Number(r.maksPenggunaan ?? 1),
    syaratKetentuan: String(r.syaratKetentuan ?? ""),
    jumlah: Number(r.jumlah ?? 0),
    status: r.status as Voucher["status"],
    createdAt: String(r.createdAt),
  };
}

function claimFromRow(r: Row): ClaimedVoucher {
  return {
    id: String(r.id),
    voucherId: String(r.voucherId),
    userId: String(r.userId),
    kode: String(r.kode ?? ""),
    kodeKonfirmasi: String(r.kodeKonfirmasi ?? ""),
    status: r.status as ClaimedVoucher["status"],
    claimedAt: String(r.claimedAt),
    usedAt: r.usedAt ? String(r.usedAt) : undefined,
    useCount: Number(r.useCount ?? 0),
  };
}

function orderFromRow(r: Row): Order {
  return {
    id: String(r.id),
    orderNumber: String(r.orderNumber),
    userId: String(r.userId),
    type: r.type as Order["type"],
    items: Array.isArray(r.items) ? (r.items as Order["items"]) : [],
    totalAmount: Number(r.totalAmount ?? 0),
    status: r.status as Order["status"],
    paymentStatus: r.paymentStatus as Order["paymentStatus"],
    paymentMethod: r.paymentMethod ? String(r.paymentMethod) : undefined,
    snapToken: r.snapToken ? String(r.snapToken) : undefined,
    shippingAddress: r.shippingAddress ? (r.shippingAddress as Order["shippingAddress"]) : undefined,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    createdAt: String(r.createdAt),
    paidAt: r.paidAt ? String(r.paidAt) : undefined,
  };
}

function merchandiseFromRow(r: Row): Merchandise {
  return {
    id: String(r.id),
    name: String(r.name),
    slug: String(r.slug),
    description: String(r.description ?? ""),
    price: Number(r.price ?? 0),
    stock: Number(r.stock ?? 0),
    image: String(r.image ?? "🛍️"),
    category: String(r.category ?? ""),
    status: r.status as Merchandise["status"],
    createdAt: String(r.createdAt),
  };
}

function walletFromRow(r: Row): Wallet {
  return {
    userId: String(r.userId),
    balance: Number(r.balance ?? 0),
    updatedAt: String(r.updatedAt ?? new Date().toISOString()),
  };
}

function sessionFromRow(r: Row): Session {
  return {
    token: String(r.token),
    userId: String(r.userId),
    createdAt: String(r.createdAt),
    expiresAt: String(r.expiresAt),
    sbRefreshEnc: r.sbRefreshEnc ? String(r.sbRefreshEnc) : undefined,
    sbUserId: r.sbUserId ? String(r.sbUserId) : undefined,
  };
}

async function fetchRows(table: string, select: string): Promise<Row[]> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const { data, error } = await sb.from(table).select(select);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

async function hydrateFromSupabase(): Promise<DB> {
  const [users, merchants, packages, memberships, promos, vouchers, claims, orders, merchandise, wallets, sessions, carts] =
    await Promise.all([
      fetchRows("profiles", "id,name,phone,email,passwordHash:password_hash,role,createdAt:created_at").then((rs) => rs.map(userFromRow)),
      fetchRows(
        "merchants",
        "id,userId:user_id,namaUsaha:nama_usaha,kategoriUsaha:kategori_usaha,noWAUsaha:no_wa_usaha,alamatUsaha:alamat_usaha,googleMapsUrl:google_maps_url,fotoUsaha:foto_usaha,logoUsaha:logo_usaha,namaPemilik:nama_pemilik,noWAPemilik:no_wa_pemilik,email,deskripsi,jamOperasional:jam_operasional,status,createdAt:created_at"
      ).then((rs) => rs.map(merchantFromRow)),
      fetchRows("packages", "id,name,days,price,features,badge").then((rs) => rs.map(packageFromRow)),
      fetchRows(
        "memberships",
        "id,userId:user_id,packageId:package_id,packageName:package_name,startDate:start_date,endDate:end_date,status,createdAt:created_at"
      ).then((rs) => rs.map(membershipFromRow)),
      fetchRows(
        "promos",
        "id,merchantId:merchant_id,merchantName:merchant_name,name,jenisVoucher:jenis_voucher,startDate:start_date,endDate:end_date,jumlah,createdAt:created_at"
      ).then((rs) => rs.map(promoFromRow)),
      fetchRows(
        "vouchers",
        "id,merchantId:merchant_id,merchantName:merchant_name,promoId:promo_id,name,jenisVoucher:jenis_voucher,nilai,minTransaksi:min_transaksi,kuota,masaBerlaku:masa_berlaku,maksPenggunaan:maks_penggunaan,syaratKetentuan:syarat_ketentuan,jumlah,status,createdAt:created_at"
      ).then((rs) => rs.map(voucherFromRow)),
      fetchRows(
        "claimed_vouchers",
        "id,voucherId:voucher_id,userId:user_id,kode,kodeKonfirmasi:kode_konfirmasi,status,claimedAt:claimed_at,usedAt:used_at,useCount:use_count"
      ).then((rs) => rs.map(claimFromRow)),
      fetchRows(
        "orders",
        "id,orderNumber:order_number,userId:user_id,type,items,totalAmount:total_amount,status,paymentStatus:payment_status,paymentMethod:payment_method,snapToken:snap_token,shippingAddress:shipping_address,metadata,createdAt:created_at,paidAt:paid_at"
      ).then((rs) => rs.map(orderFromRow)),
      fetchRows(
        "merchandise",
        "id,name,slug,description,price,stock,image,category,status,createdAt:created_at"
      ).then((rs) => rs.map(merchandiseFromRow)),
      fetchRows("wallets", "userId:user_id,balance,updatedAt:updated_at").then((rs) => rs.map(walletFromRow)),
      fetchRows(
        "sessions",
        "token,userId:user_id,createdAt:created_at,expiresAt:expires_at,sbRefreshEnc:sb_refresh_enc,sbUserId:sb_user_id"
      ).then((rs) => rs.map(sessionFromRow)),
      fetchRows("carts", "userId:user_id,items").then((rs) =>
        rs.reduce<Record<string, import("./types").CartItem[]>>((acc, r) => {
          const key = String(r.userId);
          acc[key] = Array.isArray(r.items) ? (r.items as import("./types").CartItem[]) : [];
          return acc;
        }, {})
      ),
    ]);

  return {
    users,
    merchants,
    packages,
    memberships,
    promos,
    vouchers,
    claimedVouchers: claims,
    orders,
    merchandise,
    wallets,
    sessions,
    carts,
  };
}

async function writeTable(table: string, rows: unknown[]): Promise<void> {
  if (rows.length === 0) return;
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const { error } = await sb.from(table).upsert(rows as never);
  if (error) throw new Error(`Gagal menulis ${table}: ${error.message}`);
}

type CollectionWriter = (db: DB) => Promise<void>;

/** Writer per koleksi → tabel Supabase (upsert). */
const COLLECTION_WRITERS: Record<CollectionKey, CollectionWriter> = {
  users: (db) =>
    writeTable(
      "profiles",
      db.users.map((u) => ({
        id: u.id,
        name: u.name,
        phone: u.phone ?? null,
        email: u.email ?? null,
        password_hash: u.passwordHash || null,
        role: u.role,
        created_at: u.createdAt,
      }))
    ),
  merchants: (db) =>
    writeTable(
      "merchants",
      db.merchants.map((m) => ({
        id: m.id,
        user_id: m.userId,
        nama_usaha: m.namaUsaha,
        kategori_usaha: m.kategoriUsaha,
        no_wa_usaha: m.noWAUsaha,
        alamat_usaha: m.alamatUsaha,
        google_maps_url: m.googleMapsUrl ?? null,
        foto_usaha: m.fotoUsaha ?? null,
        logo_usaha: m.logoUsaha ?? null,
        nama_pemilik: m.namaPemilik,
        no_wa_pemilik: m.noWAPemilik,
        email: m.email,
        deskripsi: m.deskripsi ?? null,
        jam_operasional: m.jamOperasional ?? null,
        status: m.status,
        created_at: m.createdAt,
      }))
    ),
  packages: (db) =>
    writeTable(
      "packages",
      db.packages.map((p) => ({
        id: p.id,
        name: p.name,
        days: p.days,
        price: p.price,
        features: p.features,
        badge: p.badge ?? null,
      }))
    ),
  memberships: (db) =>
    writeTable(
      "memberships",
      db.memberships.map((m) => ({
        id: m.id,
        user_id: m.userId,
        package_id: m.packageId,
        package_name: m.packageName,
        start_date: m.startDate,
        end_date: m.endDate,
        status: m.status,
        created_at: m.createdAt,
      }))
    ),
  promos: (db) =>
    writeTable(
      "promos",
      db.promos.map((p) => ({
        id: p.id,
        merchant_id: p.merchantId,
        merchant_name: p.merchantName,
        name: p.name,
        jenis_voucher: p.jenisVoucher,
        start_date: p.startDate,
        end_date: p.endDate,
        jumlah: p.jumlah,
        created_at: p.createdAt,
      }))
    ),
  vouchers: (db) =>
    writeTable(
      "vouchers",
      db.vouchers.map((v) => ({
        id: v.id,
        merchant_id: v.merchantId,
        merchant_name: v.merchantName,
        promo_id: v.promoId ?? null,
        name: v.name,
        jenis_voucher: v.jenisVoucher,
        nilai: v.nilai,
        min_transaksi: v.minTransaksi,
        kuota: v.kuota,
        masa_berlaku: v.masaBerlaku,
        maks_penggunaan: v.maksPenggunaan,
        syarat_ketentuan: v.syaratKetentuan,
        jumlah: v.jumlah,
        status: v.status,
        created_at: v.createdAt,
      }))
    ),
  claimedVouchers: (db) =>
    writeTable(
      "claimed_vouchers",
      db.claimedVouchers.map((c) => ({
        id: c.id,
        voucher_id: c.voucherId,
        user_id: c.userId,
        kode: c.kode,
        kode_konfirmasi: c.kodeKonfirmasi,
        status: c.status,
        claimed_at: c.claimedAt,
        used_at: c.usedAt ?? null,
        use_count: c.useCount,
      }))
    ),
  orders: (db) =>
    writeTable(
      "orders",
      db.orders.map((o) => ({
        id: o.id,
        order_number: o.orderNumber,
        user_id: o.userId,
        type: o.type,
        items: o.items,
        total_amount: o.totalAmount,
        status: o.status,
        payment_status: o.paymentStatus,
        payment_method: o.paymentMethod ?? null,
        snap_token: o.snapToken ?? null,
        shipping_address: o.shippingAddress ?? null,
        metadata: o.metadata ?? {},
        created_at: o.createdAt,
        paid_at: o.paidAt ?? null,
      }))
    ),
  merchandise: (db) =>
    writeTable(
      "merchandise",
      db.merchandise.map((m) => ({
        id: m.id,
        name: m.name,
        slug: m.slug,
        description: m.description,
        price: m.price,
        stock: m.stock,
        image: m.image,
        category: m.category,
        status: m.status,
        created_at: m.createdAt,
      }))
    ),
  wallets: (db) =>
    writeTable(
      "wallets",
      db.wallets.map((w) => ({
        user_id: w.userId,
        balance: w.balance,
        updated_at: w.updatedAt,
      }))
    ),
  sessions: (db) =>
    writeTable(
      "sessions",
      db.sessions.map((s) => ({
        token: s.token,
        user_id: s.userId,
        created_at: s.createdAt,
        expires_at: s.expiresAt,
        sb_refresh_enc: s.sbRefreshEnc ?? null,
        sb_user_id: s.sbUserId ?? null,
      }))
    ),
  carts: (db) =>
    writeTable(
      "carts",
      Object.entries(db.carts).map(([userId, items]) => ({ user_id: userId, items }))
    ),
};

/** Tulis hanya koleksi yang diminta ke Supabase (parallel). */
async function writeCollectionsToSupabase(
  db: DB,
  keys: CollectionKey[]
): Promise<void> {
  await Promise.all(keys.map((key) => COLLECTION_WRITERS[key](db)));
}

/** Full flush — semua koleksi (dipakai `persist()`). */
async function writeAllToSupabase(db: DB): Promise<void> {
  await writeCollectionsToSupabase(db, [...COLLECTION_KEYS]);
}
