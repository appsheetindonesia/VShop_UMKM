import { getDB, hashPassword, isoNow, mutate, newId } from "./db";
import { createPaymentTransaction, getOrderExpiryHours } from "./midtrans";
import type {
  CartItem,
  ClaimedVoucher,
  Merchandise,
  Membership,
  Merchant,
  Order,
  OrderItem,
  Package,
  PaymentAuditEvent,
  PaymentAuditSource,
  Promo,
  Role,
  ShippingAddress,
  SnapCallbackEvent,
  SnapCallbackRecord,
  User,
  Voucher,
} from "./types";

/** ==================== AUTH ==================== */

export interface RegisterCustomerInput {
  name: string;
  phone: string;
  password: string;
}

export function registerCustomer(input: RegisterCustomerInput): User {
  const phone = input.phone.replace(/[^0-9+]/g, "");
  return mutate((db) => {
    const exists = db.users.some((u) => u.phone === phone);
    if (exists) {
      throw new Error("Nomor WhatsApp sudah terdaftar. Silakan login.");
    }
    const user: User = {
      id: newId("usr"),
      name: input.name,
      phone,
      passwordHash: hashPassword(input.password),
      role: "customer",
      createdAt: isoNow(),
    };
    db.users.push(user);
    return user;
  });
}

export interface RegisterMerchantInput {
  namaUsaha: string;
  kategoriUsaha: string;
  noWAUsaha: string;
  alamatUsaha: string;
  googleMapsUrl?: string;
  fotoUsaha?: string;
  logoUsaha?: string;
  namaPemilik: string;
  noWAPemilik: string;
  email: string;
  password: string;
  deskripsi?: string;
  jamOperasional?: string;
}

export function registerMerchant(input: RegisterMerchantInput): { user: User; merchant: Merchant } {
  return mutate((db) => {
    const emailTaken = db.users.some((u) => u.email === input.email);
    if (emailTaken) {
      throw new Error("Email sudah terdaftar. Silakan login.");
    }
    const phoneTaken = db.users.some(
      (u) => u.phone === input.noWAPemilik.replace(/[^0-9+]/g, "")
    );
    if (phoneTaken) {
      throw new Error("Nomor WhatsApp pemilik sudah terdaftar.");
    }
    const user: User = {
      id: newId("usr"),
      name: input.namaPemilik,
      phone: input.noWAPemilik.replace(/[^0-9+]/g, ""),
      email: input.email.toLowerCase(),
      passwordHash: hashPassword(input.password),
      role: "merchant",
      createdAt: isoNow(),
    };
    db.users.push(user);
    const merchant: Merchant = {
      id: newId("mch"),
      userId: user.id,
      namaUsaha: input.namaUsaha,
      kategoriUsaha: input.kategoriUsaha,
      noWAUsaha: input.noWAUsaha,
      alamatUsaha: input.alamatUsaha,
      googleMapsUrl: input.googleMapsUrl || undefined,
      fotoUsaha: input.fotoUsaha || undefined,
      logoUsaha: input.logoUsaha || undefined,
      namaPemilik: input.namaPemilik,
      noWAPemilik: input.noWAPemilik,
      email: input.email.toLowerCase(),
      deskripsi: input.deskripsi || undefined,
      jamOperasional: input.jamOperasional || undefined,
      status: "pending",
      createdAt: isoNow(),
    };
    db.merchants.push(merchant);
    return { user, merchant };
  });
}

/** Login dengan email ATAU nomor WhatsApp. */
export function login(identifier: string, password: string): User | null {
  const db = getDB();
  const id = identifier.trim().toLowerCase();
  const user = db.users.find((u) => {
    const emailMatch = u.email?.toLowerCase() === id;
    const phoneMatch = u.phone?.replace(/[^0-9+]/g, "") === id.replace(/[^0-9+]/g, "");
    return emailMatch || phoneMatch;
  });
  if (!user) return null;
  if (user.passwordHash !== hashPassword(password)) return null;
  return user;
}

/** ==================== MEMBERSHIP ==================== */

export function getActiveMembership(userId: string): Membership | null {
  const db = getDB();
  const now = Date.now();
  return (
    db.memberships
      .filter((m) => m.userId === userId)
      .sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime())
      .find((m) => new Date(m.endDate).getTime() > now && m.status === "active") ?? null
  );
}

export function getPackages(): Package[] {
  return getDB().packages;
}

export function activateMembership(userId: string, packageId: string): Membership {
  return mutate((db) => {
    const pkg = db.packages.find((p) => p.id === packageId);
    if (!pkg) throw new Error("Paket tidak ditemukan");
    // Mulai dari hari ini; masa aktif baru tidak menimpa sisa akun lama.
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + pkg.days);
    // Nonaktifkan membership lama yang masih aktif
    db.memberships.forEach((m) => {
      if (m.userId === userId && m.status === "active") m.status = "expired";
    });
    const membership: Membership = {
      id: newId("mbr"),
      userId,
      packageId,
      packageName: pkg.name,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status: "active",
      createdAt: isoNow(),
    };
    db.memberships.push(membership);
    return membership;
  });
}

/** ==================== WALLET ==================== */

export function getWallet(userId: string): { userId: string; balance: number } {
  return mutate((db) => {
    let w = db.wallets.find((x) => x.userId === userId);
    if (!w) {
      w = { userId, balance: 0, updatedAt: isoNow() };
      db.wallets.push(w);
    }
    return { userId: w.userId, balance: w.balance };
  });
}

function addWalletBalance(userId: string, amount: number): void {
  const db = getDB();
  let w = db.wallets.find((x) => x.userId === userId);
  if (!w) {
    w = { userId, balance: 0, updatedAt: isoNow() };
    db.wallets.push(w);
  }
  w.balance += amount;
  w.updatedAt = isoNow();
}

/** ==================== CART ==================== */

export function getCart(userId: string): CartItem[] {
  return getDB().carts[userId] ?? [];
}

function cartWithDetails(userId: string): { item: CartItem; product: Merchandise | undefined }[] {
  const db = getDB();
  const cart = db.carts[userId] ?? [];
  return cart.map((item) => ({
    item,
    product: db.merchandise.find((m) => m.id === item.productId && m.status === "active"),
  }));
}

export function getCartDetailed(userId: string) {
  return cartWithDetails(userId);
}

export function addToCart(userId: string, productId: string, quantity: number): void {
  mutate((db) => {
    const product = db.merchandise.find((m) => m.id === productId && m.status === "active");
    if (!product) throw new Error("Produk tidak ditemukan");
    if (quantity < 1) throw new Error("Kuantitas minimal 1");
    if (quantity > product.stock) throw new Error(`Stok hanya tersisa ${product.stock}`);
    const cart = (db.carts[userId] ??= []);
    const existing = cart.find((c) => c.productId === productId);
    if (existing) {
      const next = existing.quantity + quantity;
      if (next > product.stock) throw new Error(`Stok hanya tersisa ${product.stock}`);
      existing.quantity = next;
    } else {
      cart.push({ productId, quantity });
    }
  });
}

export function updateCartItem(userId: string, productId: string, quantity: number): void {
  mutate((db) => {
    const product = db.merchandise.find((m) => m.id === productId && m.status === "active");
    if (!product) throw new Error("Produk tidak ditemukan");
    if (quantity < 1) throw new Error("Kuantitas minimal 1");
    if (quantity > product.stock) throw new Error(`Stok hanya tersisa ${product.stock}`);
    const cart = db.carts[userId];
    if (!cart) return;
    const existing = cart.find((c) => c.productId === productId);
    if (existing) existing.quantity = quantity;
  });
}

export function removeCartItem(userId: string, productId: string): void {
  mutate((db) => {
    const cart = db.carts[userId];
    if (!cart) return;
    db.carts[userId] = cart.filter((c) => c.productId !== productId);
  });
}

export function clearCart(userId: string): void {
  mutate((db) => {
    db.carts[userId] = [];
  });
}

export function cartTotal(userId: string): number {
  const db = getDB();
  const cart = db.carts[userId] ?? [];
  return cart.reduce((sum, c) => {
    const p = db.merchandise.find((m) => m.id === c.productId);
    return sum + (p?.price ?? 0) * c.quantity;
  }, 0);
}

/** ==================== ORDER & PAYMENT ==================== */

export interface CreateOrderInput {
  userId: string;
  type: "package" | "topup" | "merchandise";
  items: OrderItem[];
  totalAmount: number;
  address?: ShippingAddress;
  metadata: Record<string, unknown>;
}

function nextOrderNumber(db: ReturnType<typeof getDB>): string {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate()
  ).padStart(2, "0")}`;
  // Pakai SUFFIX MAKSIMAL + 1 (bukan jumlah+1) agar aman terhadap nomor yang
  // dihapus / gap: mis. hanya tersisa VS-…-0002 → berikutnya 0003, BUKAN 0002
  // (duplikat). Deret diasumsikan berurutan di versi lama — bisa collision
  // saat order uji dihapus.
  let max = 0;
  const re = new RegExp(`^VS-${ymd}-(\\d{4})$`);
  for (const o of db.orders) {
    const m = o.orderNumber.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `VS-${ymd}-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Nomor invoice STABIL `VS-INV-YYYYMMDD-XXXX` — dibuat SEKALI saat order
 * dibuat dan TIDAK pernah berubah (beda dari `orderNumber` yang diganti
 * saat retry). Sama seperti `nextOrderNumber`: suffix MAKSIMAL + 1 agar
 * tahan gap/deletion; scan `metadata.invoiceNumber` (jsonb) karena bukan
 * kolom tersendiri.
 */
function nextInvoiceNumber(db: ReturnType<typeof getDB>): string {
  const today = new Date();
  const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate()
  ).padStart(2, "0")}`;
  let max = 0;
  const re = new RegExp(`^VS-INV-${ymd}-(\\d{4})$`);
  for (const o of db.orders) {
    const inv =
      typeof o.metadata?.invoiceNumber === "string" ? o.metadata.invoiceNumber : "";
    const m = inv.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `VS-INV-${ymd}-${String(max + 1).padStart(4, "0")}`;
}

/**
 * Nomor order baru untuk retry: `nextOrderNumber` menghitung order ini
 * sendiri sehingga bisa menghasilkan nomor yang sama — geser ke nomor bebas
 * berikutnya yang berbeda dari `current` dan belum dipakai order lain.
 */
function nextRetryOrderNumber(
  db: ReturnType<typeof getDB>,
  current: string
): string {
  let candidate = nextOrderNumber(db);
  if (candidate !== current) return candidate;
  const ymd = candidate.slice(3, 11); // "VS-YYYYMMDD-0001" → "YYYYMMDD"
  let n = Number(candidate.slice(-4)) + 1;
  while (db.orders.some((o) => o.orderNumber === `VS-${ymd}-${String(n).padStart(4, "0")}`)) n++;
  return `VS-${ymd}-${String(n).padStart(4, "0")}`;
}

export async function createOrder(
  input: CreateOrderInput
): Promise<{ order: Order; mock: boolean }> {
  const user = getDB().users.find((u) => u.id === input.userId);

  // id & nomor order dihitung SEBELUM transaksi Midtrans (transaksi butuh
  // keduanya). Order + snapToken lalu ditulis dalam SATU mutate di bawah —
  // checkout hanya 1 tulis ke tabel orders (sebelumnya 2: order tanpa token,
  // lalu token di mutate kedua). Konsekuensinya: kalau Midtrans gagal, order
  // tidak pernah dibuat (all-or-nothing) — pemanggil (route checkout)
  // menangkap error dan pelanggan mengulang checkout.
  const orderId = newId("ord");
  const provisionalNumber = nextOrderNumber(getDB());
  const payment = await createPaymentTransaction({
    orderId,
    orderNumber: provisionalNumber,
    totalAmount: input.totalAmount,
    customerName: user?.name,
    customerEmail: user?.email,
    customerPhone: user?.phone,
  });

  const created = mutate((db) => {
    // Nomor FINAL divalidasi ATOMIK di dalam mutate: bila order lain keburu
    // memakai provisionalNumber selama await Midtrans (konkurensi langka),
    // geser ke nomor bebas — keunikan dijamin scan di sini (pola sama dengan
    // retry). Transaksi Midtrans pertama memakai provisionalNumber; pada
    // tabrakan transaksi dibuat ulang dengan nomor final (lihat bawah) agar
    // order_id Midtrans tetap sama dengan orderNumber (kontrak webhook).
    const taken = db.orders.some((o) => o.orderNumber === provisionalNumber);
    const orderNumber = taken
      ? nextRetryOrderNumber(db, provisionalNumber)
      : provisionalNumber;

    // Log audit dibuka sejak order dibuat — kronologi lengkap dari awal.
    const audit: PaymentAuditEvent[] = [
      {
        at: isoNow(),
        source: "create",
        event: "created",
        paymentStatus: "pending",
        orderNumber,
        ...(taken
          ? { detail: `Nomor sementara ${provisionalNumber} bertabrakan — dipakai ${orderNumber}` }
          : {}),
      },
    ];
    // Nomor invoice dibuat SEKALI di sini dan tidak pernah berubah — bahkan
    // saat retry mengganti orderNumber — jadi bukti transaksi selalu punya
    // referensi yang stabil (VS-INV-YYYYMMDD-XXXX).
    const invoiceNumber = nextInvoiceNumber(db);
    const order: Order = {
      id: orderId,
      orderNumber,
      userId: input.userId,
      type: input.type,
      items: input.items,
      totalAmount: input.totalAmount,
      status: "pending",
      paymentStatus: "pending",
      shippingAddress: input.address,
      snapToken: payment.token,
      metadata: {
        ...input.metadata,
        invoiceNumber,
        paymentAudit: audit,
        ...(payment.redirectUrl ? { snapRedirectUrl: payment.redirectUrl } : {}),
      },
      createdAt: isoNow(),
    };
    db.orders.push(order);
    return { order, needsRebuild: taken };
  });

  if (created.needsRebuild) {
    // JALUR JARANG (konkurensi): transaksi pertama memakai nomor yang
    // ternyata diambil order lain — buat ulang dengan nomor FINAL. Kasus ini
    // menulis 2× (order + token); jalur normal tetap 1 tulis.
    const payment2 = await createPaymentTransaction({
      orderId,
      orderNumber: created.order.orderNumber,
      totalAmount: created.order.totalAmount,
      customerName: user?.name,
      customerEmail: user?.email,
      customerPhone: user?.phone,
    });
    const rebuilt = mutate((db) => {
      const o = db.orders.find((x) => x.id === orderId);
      if (!o) return null;
      o.snapToken = payment2.token;
      const meta = o.metadata as Record<string, unknown>;
      if (payment2.redirectUrl) meta.snapRedirectUrl = payment2.redirectUrl;
      else delete meta.snapRedirectUrl;
      const audit = Array.isArray(meta.paymentAudit)
        ? (meta.paymentAudit as PaymentAuditEvent[])
        : [];
      meta.paymentAudit = [
        ...audit.slice(-(MAX_PAYMENT_AUDIT - 1)),
        {
          at: isoNow(),
          source: "create",
          event: "created",
          paymentStatus: "pending",
          orderNumber: o.orderNumber,
          detail: "Transaksi Midtrans dibuat ulang dengan nomor final (tabrakan nomor)",
        },
      ];
      o.metadata = meta;
      return o;
    });
    return { order: rebuilt ?? created.order, mock: payment2.mock };
  }

  return { order: created.order, mock: payment.mock };
}

export function getOrder(orderId: string): Order | undefined {
  return getDB().orders.find((o) => o.id === orderId);
}

export function getOrderByNumber(orderNumber: string): Order | undefined {
  return getDB().orders.find((o) => o.orderNumber === orderNumber);
}

export function getOrdersByUser(userId: string): Order[] {
  return getDB()
    .orders.filter((o) => o.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Data observasi Midtrans yang ikut direkam ke log audit pembayaran
 * (`metadata.paymentAudit`) — status_code / status_message asli dari
 * Midtrans (webhook / Status API / callback Snap).
 */
export interface PaymentAuditInput {
  source: PaymentAuditSource;
  /** Label peristiwa — diwajibkan oleh recordPaymentAudit (diisi otomatis
   * oleh markOrderPaid/markOrderFailed). */
  event?: string;
  /** Status pembayaran aplikasi setelah kejadian. */
  paymentStatus?: string;
  /** status_code Midtrans (mis. "202" ditolak bank). */
  statusCode?: string;
  /** status_message mentah dari Midtrans. */
  statusMessage?: string;
  /** transaction_status Midtrans (pending / settlement / deny / …). */
  transactionStatus?: string;
  /** transaction_id Midtrans bila tersedia. */
  transactionId?: string;
  /** payment_type Midtrans (qris, bank_transfer, …). */
  paymentType?: string;
  /** channel_response_code Midtrans (kode spesifik GoPay/OVO/VA/bank). */
  channelResponseCode?: string;
  /** channel_response_message mentah dari Midtrans. */
  channelResponseMessage?: string;
  /** Nomor order saat kejadian (penting saat retry mengganti nomor). */
  orderNumber?: string;
  /** Alasan / keterangan tambahan. */
  detail?: string;
}

const MAX_PAYMENT_AUDIT = 50;

/**
 * Batas percobaan "Coba Lagi" per order (guard di sisi service). Order yang
 * gagal terus-menerus tidak boleh di-retry tanpa batas — tiap retry membuat
 * transaksi Midtrans baru & nomor order baru (riwayat mengembang). Bisa
 * disetel via env MAX_ORDER_RETRIES (default 3).
 */
export const MAX_ORDER_RETRIES = Number(process.env.MAX_ORDER_RETRIES ?? 3);

/** Hitung berapa kali order sudah di-retry (dari log audit paymentAudit). */
export function countOrderRetries(order: Pick<Order, "metadata">): number {
  const audit = Array.isArray(order.metadata?.paymentAudit)
    ? (order.metadata.paymentAudit as PaymentAuditEvent[])
    : [];
  return audit.filter((e) => e.event === "retry").length;
}

/**
 * Tambahkan satu entri ke log audit pembayaran order
 * (`metadata.paymentAudit`, terbaru di akhir, maks 50). Entri identik
 * beruntun (source + event + statusCode + transactionStatus + paymentStatus
 * sama) dilewati agar polling Status API / webhook berulang tidak menumpuk.
 */
export function recordPaymentAudit(
  orderId: string,
  input: PaymentAuditInput & { event: string; paymentStatus: string }
): Order {
  return mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order tidak ditemukan");
    const audit = Array.isArray(order.metadata.paymentAudit)
      ? (order.metadata.paymentAudit as PaymentAuditEvent[])
      : [];
    const last = audit[audit.length - 1];
    const sameAsLast =
      !!last &&
      last.source === input.source &&
      last.event === "pending" &&
      input.event === "pending" &&
      last.statusCode === input.statusCode &&
      last.transactionStatus === input.transactionStatus;
    if (sameAsLast) return order;
    const next: PaymentAuditEvent[] = [
      ...audit.slice(-(MAX_PAYMENT_AUDIT - 1)),
      { ...input, at: isoNow() },
    ];
    order.metadata = { ...order.metadata, paymentAudit: next };
    return order;
  });
}

/** Proses pembayaran berhasil (dipanggil dari mock payment / webhook Midtrans). */
export function markOrderPaid(
  orderId: string,
  method: string,
  audit?: PaymentAuditInput
): Order {
  const updated = mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order tidak ditemukan");
    if (order.paymentStatus === "paid") return order; // idempotent (webhook duplikat)
    order.paymentStatus = "paid";
    order.status = "paid";
    order.paymentMethod = method;
    order.paidAt = isoNow();

    // Efek sesuai jenis order
    if (order.type === "package") {
      const packageId = String(order.metadata.packageId ?? "");
      const pkg = db.packages.find((p) => p.id === packageId);
      if (pkg) {
        db.memberships.forEach((m) => {
          if (m.userId === order.userId && m.status === "active") m.status = "expired";
        });
        const start = new Date();
        const end = new Date(start);
        end.setDate(end.getDate() + pkg.days);
        db.memberships.push({
          id: newId("mbr"),
          userId: order.userId,
          packageId: pkg.id,
          packageName: pkg.name,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          status: "active",
          createdAt: isoNow(),
        });
      }
    } else if (order.type === "topup") {
      addWalletBalance(order.userId, order.totalAmount);
    } else if (order.type === "merchandise") {
      for (const item of order.items) {
        const product = db.merchandise.find((m) => m.id === item.productId);
        if (product) {
          product.stock = Math.max(0, product.stock - item.quantity);
        }
      }
      order.status = "processing";
      db.carts[order.userId] = [];
    }
    return order;
  });

  // Rekam transisi lunas ke log audit (maks 1 entri; transisi hanya sekali).
  if (updated.paymentStatus === "paid") {
    recordPaymentAudit(orderId, {
      ...audit,
      source: audit?.source ?? "mock",
      event: "paid",
      paymentStatus: "paid",
      orderNumber: updated.orderNumber,
      detail: audit?.detail ?? `Pembayaran via ${method}`,
    });
  }
  return updated;
}

/**
 * Tandai order gagal / kadaluarsa (status terminal tanpa pembayaran).
 * Order yang sudah lunas tidak diubah (idempotent).
 *
 * `detail` (opsional) adalah alasan spesifik yang akan ditampilkan di layar
 * Pembayaran Gagal (mis. "Pembayaran ditolak oleh bank", "Saldo tidak
 * mencukupi"); disimpan di `metadata.failureReason`. Bila tidak diberikan,
 * dipakai default sesuai `reason`.
 */
export function markOrderFailed(
  orderId: string,
  reason: "failed" | "expired",
  detail?: string,
  audit?: PaymentAuditInput
): Order {
  const updated = mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order tidak ditemukan");
    if (order.paymentStatus === "paid") return order;
    order.paymentStatus = reason;
    order.status = "cancelled";
    order.metadata = {
      ...order.metadata,
      failureReason:
        detail ?? (reason === "expired" ? "Waktu pembayaran habis" : "Pembayaran belum berhasil"),
    };
    return order;
  });

  // Rekam kegagalan/kadaluarsa ke log audit (transisi terminal hanya sekali).
  if (updated.paymentStatus === reason) {
    recordPaymentAudit(orderId, {
      ...audit,
      source: audit?.source ?? "client-fail",
      event: reason,
      paymentStatus: reason,
      orderNumber: updated.orderNumber,
      detail:
        audit?.detail ??
        (typeof updated.metadata.failureReason === "string"
          ? updated.metadata.failureReason
          : undefined),
    });
  }
  return updated;
}

const MAX_SNAP_CALLBACKS = 20;

/**
 * Catat callback Snap.js (success / pending / error / close) ke
 * `metadata.snapCallbacks` sebagai audit trail — tanpa mengubah status
 * pembayaran. `result` adalah hasil transaksi mentah dari Snap
 * (status_code, transaction_status, payment_type, transaction_id, …).
 * Riwayat dibatasi 20 entri terakhir (yang terbaru di akhir).
 */
export function recordSnapCallback(
  orderId: string,
  event: SnapCallbackEvent,
  result?: Record<string, unknown>
): Order {
  return mutate((db) => {
    const order = db.orders.find((o) => o.id === orderId);
    if (!order) throw new Error("Order tidak ditemukan");
    const callbacks = Array.isArray(order.metadata.snapCallbacks)
      ? (order.metadata.snapCallbacks as SnapCallbackRecord[])
      : [];
    const next: SnapCallbackRecord[] = [...callbacks, { event, at: isoNow(), result }];
    // Hasil transaksi Snap juga direkam ke log audit (status_code / pesan asli).
    const audit = Array.isArray(order.metadata.paymentAudit)
      ? (order.metadata.paymentAudit as PaymentAuditEvent[])
      : [];
    const sc = result?.status_code;
    const sm = result?.status_message;
    const ts = result?.transaction_status;
    const tid = result?.transaction_id;
    const pt = result?.payment_type;
    const auditNext: PaymentAuditEvent[] = [
      ...audit.slice(-(MAX_PAYMENT_AUDIT - 1)),
      {
        at: isoNow(),
        source: "snap",
        event,
        paymentStatus: order.paymentStatus,
        statusCode: typeof sc === "string" ? sc : undefined,
        statusMessage: typeof sm === "string" ? sm : undefined,
        transactionStatus: typeof ts === "string" ? ts : undefined,
        transactionId: typeof tid === "string" ? tid : undefined,
        paymentType: typeof pt === "string" ? pt : undefined,
        orderNumber: order.orderNumber,
      },
    ];
    order.metadata = {
      ...order.metadata,
      snapCallbacks: next.slice(-MAX_SNAP_CALLBACKS),
      paymentAudit: auditNext,
    };
    return order;
  });
}

/**
 * Auto-expire order yang masih `pending` lebih dari ORDER_EXPIRY_HOURS jam
 * (konsisten dengan field `expiry` di transaksi Midtrans). Order yang sudah
 * lunas/gagal/kadaluarsa tidak disentuh. Mengembalikan id order yang baru
 * saja di-expire (pemanggil bisa memicu notifikasi lanjutan).
 */
export function expireStaleOrders(now: Date = new Date()): string[] {
  const cutoff = now.getTime() - getOrderExpiryHours() * 3_600_000;
  const stale = getDB().orders.filter(
    (o) =>
      o.paymentStatus === "pending" &&
      // Anchor kadaluarsa = retry terakhir (bila ada) ATAU createdAt. Tanpa
      // ini, order yang di-retry (kembali pending, createdAt LAMA) akan
      // di-expire ulang pada run berikutnya — padahal jendela pembayaran
      // baru dimulai sejak retry.
      new Date(
        typeof o.metadata?.lastRetryAt === "string"
          ? o.metadata.lastRetryAt
          : o.createdAt
      ).getTime() < cutoff
  );
  const expiredIds: string[] = [];
  for (const o of stale) {
    // markOrderFailed idempotent: hanya memproses order yang belum terminal.
    // Sumber "cron" direkam ke log audit (auto-expire terjadwal).
    markOrderFailed(o.id, "expired", undefined, { source: "cron" });
    expiredIds.push(o.id);
  }
  // Pencatatan run job (cron_runs) dipindah ke runExpiryJob (src/lib/cron.ts)
  // agar SATU baris per eksekusi lengkap (order + pengingat voucher), bukan
  // per sub-fungsi. Service ini tetap murni: hanya menandai & mengembalikan id.
  return expiredIds;
}

/**
 * Siapkan ulang pembayaran order yang gagal/kadaluarsa: kembalikan ke
 * status pending + buat snap token baru dari Midtrans (mode demo: token
 * tiruan). Dipanggil tombol "Coba Lagi" di layar Pembayaran Gagal.
 *
 * NOMOR ORDER BARU: order_id lama berstatus terminal (expired/denied) bisa
 * ditolak Midtrans saat dibuatkan transaksi ulang (duplicate order_id).
 * Karena itu retry selalu memakai `nextOrderNumber()` yang segar; nomor lama
 * disimpan di metadata (`originalOrderNumber` + `previousOrderNumbers`)
 * untuk audit & referensi.
 */
export async function retryOrderPayment(orderId: string): Promise<Order> {
  const order = getOrder(orderId);
  if (!order) throw new Error("Order tidak ditemukan");
  // Pertahanan di sisi API (bukan hanya UI): order yang sudah LUNAS tidak
  // boleh di-retry — membuat transaksi baru untuk order yang sudah dibayar
  // berisiko charge ganda. UI hanya menampilkan "Coba Lagi" untuk
  // gagal/kadaluarsa, tapi endpoint retry harus menolak sendiri bila order
  // ternyata sudah berubah jadi paid (mis. dibayar di tab lain) atau dipanggil
  // langsung. Caller mengembalikan 400 (rute /api/pay/[orderId]/retry).
  if (order.paymentStatus === "paid") {
    throw new Error("Order sudah lunas — tidak bisa di-retry");
  }
  // Batas percobaan: order yang gagal terus-menerus tidak boleh di-retry
  // tanpa batas. Dihitung dari log audit (event "retry" di paymentAudit),
  // jadi konsisten dengan metrik retry admin & riwayat nomor order.
  if (countOrderRetries(order) >= MAX_ORDER_RETRIES) {
    throw new Error(
      `Batas percobaan pembayaran ulang tercapai (maks ${MAX_ORDER_RETRIES}x) — hubungi admin`
    );
  }

  // Nomor baru dihitung dari state saat ini — transaksi Midtrans memakai
  // nomor segar sehingga tidak bentrok dengan order_id terminal sebelumnya
  // (dan tidak sama dengan nomor lama order ini).
  const newOrderNumber = nextRetryOrderNumber(getDB(), order.orderNumber);
  const user = getDB().users.find((u) => u.id === order.userId);
  const payment = await createPaymentTransaction({
    orderId: order.id,
    orderNumber: newOrderNumber,
    totalAmount: order.totalAmount,
    customerName: user?.name,
    customerEmail: user?.email,
    customerPhone: user?.phone,
  });

  return mutate((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o) throw new Error("Order tidak ditemukan");
    o.paymentStatus = "pending";
    o.status = "pending";
    o.paymentMethod = undefined;
    o.paidAt = undefined;
    o.snapToken = payment.token;
    if (payment.redirectUrl) {
      o.metadata = { ...o.metadata, snapRedirectUrl: payment.redirectUrl };
    } else {
      delete (o.metadata as Record<string, unknown>).snapRedirectUrl;
    }
    // Hapus alasan kegagalan lama agar layar gagal tidak menampilkannya lagi.
    delete (o.metadata as Record<string, unknown>).failureReason;

    // Ganti nomor order + simpan riwayat (audit & referensi webhook lama).
    let oldNumber = o.orderNumber;
    if (o.orderNumber !== newOrderNumber) {
      const meta = o.metadata as Record<string, unknown>;
      if (typeof meta.originalOrderNumber !== "string") {
        meta.originalOrderNumber = o.orderNumber;
      }
      const history = Array.isArray(meta.previousOrderNumbers)
        ? (meta.previousOrderNumbers as string[])
        : [];
      history.push(o.orderNumber);
      meta.previousOrderNumbers = history;
      o.metadata = meta;
      o.orderNumber = newOrderNumber;
    } else {
      oldNumber = newOrderNumber;
    }
    // Rekam kronologi "coba lagi" ke log audit (nomor order baru tercatat).
    const meta = o.metadata as Record<string, unknown>;
    const audit = Array.isArray(meta.paymentAudit)
      ? (meta.paymentAudit as PaymentAuditEvent[])
      : [];
    meta.paymentAudit = [
      ...audit.slice(-(MAX_PAYMENT_AUDIT - 1)),
      {
        at: isoNow(),
        source: "retry",
        event: "retry",
        paymentStatus: "pending",
        orderNumber: newOrderNumber,
        detail:
          oldNumber === newOrderNumber
            ? "Pembayaran disiapkan ulang"
            : `Nomor order: ${oldNumber} → ${newOrderNumber}`,
      },
    ];
    // Restart jendela kadaluarsa: anchor auto-expire = retry terakhir
    // (expireStaleOrders memakai lastRetryAt ?? createdAt). Tanpa ini order
    // yang di-retry di-expire ulang oleh cron pada run berikutnya.
    meta.lastRetryAt = isoNow();
    o.metadata = meta;
    return o;
  });
}

/** ==================== VOUCHER ==================== */

export function listActivePromos(): Promo[] {
  const db = getDB();
  const now = Date.now();
  return db.promos
    .filter(
      (p) =>
        new Date(p.endDate).getTime() >= now
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function listActiveVouchers(): Voucher[] {
  const db = getDB();
  const now = Date.now();
  return db.vouchers
    .filter(
      (v) => v.status === "active" && new Date(v.masaBerlaku).getTime() >= now
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getVoucher(voucherId: string): Voucher | undefined {
  return getDB().vouchers.find((v) => v.id === voucherId);
}

export interface ClaimResult {
  ok: boolean;
  message?: string;
  claim?: ClaimedVoucher;
}

function randomKode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `VS-${s.slice(0, 4)}-${s.slice(4)}`;
}

function randomKonfirmasi(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function claimVoucher(userId: string, voucherId: string): ClaimResult {
  const db = getDB();
  const voucher = db.vouchers.find((v) => v.id === voucherId);
  if (!voucher || voucher.status !== "active") {
    return { ok: false, message: "Voucher tidak ditemukan atau sudah tidak aktif" };
  }
  if (new Date(voucher.masaBerlaku).getTime() < Date.now()) {
    return { ok: false, message: "Masa berlaku voucher sudah habis" };
  }
  const membership = getActiveMembership(userId);
  if (!membership) {
    return { ok: false, message: "Aktifkan paket dulu untuk mengklaim voucher" };
  }

  const claims = db.claimedVouchers.filter((c) => c.voucherId === voucherId);
  const usedKuota = claims.length;
  if (usedKuota >= voucher.kuota) {
    return { ok: false, message: "Kuota voucher sudah habis" };
  }
  const userClaims = claims.filter((c) => c.userId === userId);
  if (userClaims.some((c) => c.status === "active")) {
    return { ok: false, message: "Kamu sudah memiliki voucher ini yang masih aktif" };
  }
  if (userClaims.length >= voucher.maksPenggunaan) {
    return {
      ok: false,
      message: `Maksimal penggunaan voucher ini ${voucher.maksPenggunaan}x per pelanggan`,
    };
  }

  return mutate((db2) => {
    const claim: ClaimedVoucher = {
      id: newId("clm"),
      voucherId,
      userId,
      kode: randomKode(),
      kodeKonfirmasi: randomKonfirmasi(),
      status: "active",
      claimedAt: isoNow(),
      useCount: 0,
    };
    db2.claimedVouchers.push(claim);
    return { ok: true, claim };
  });
}

export interface RedeemResult {
  ok: boolean;
  message?: string;
  claim?: ClaimedVoucher & { voucher?: Voucher; user?: User };
}

export function redeemVoucher(
  merchantId: string,
  kode: string,
  kodeKonfirmasi: string
): RedeemResult {
  const db = getDB();
  const claim = db.claimedVouchers.find((c) => c.kode === kode.trim().toUpperCase());
  if (!claim) return { ok: false, message: "Kode voucher tidak ditemukan" };
  const voucher = db.vouchers.find((v) => v.id === claim.voucherId);
  if (!voucher || voucher.merchantId !== merchantId) {
    return { ok: false, message: "Voucher ini bukan milik usaha Anda" };
  }
  if (claim.status === "used") return { ok: false, message: "Voucher sudah terpakai" };
  if (claim.status === "expired") return { ok: false, message: "Voucher sudah kedaluwarsa" };
  if (claim.kodeKonfirmasi !== kodeKonfirmasi.trim()) {
    return { ok: false, message: "Kode konfirmasi tidak cocok" };
  }
  const user = db.users.find((u) => u.id === claim.userId);
  const nextUse = claim.useCount + 1;
  const done = nextUse >= voucher.maksPenggunaan;

  mutate((db2) => {
    const c = db2.claimedVouchers.find((x) => x.id === claim.id);
    if (c) {
      c.useCount = nextUse;
      c.usedAt = isoNow();
      if (done) c.status = "used";
    }
  });

  return {
    ok: true,
    claim: { ...claim, useCount: nextUse, usedAt: isoNow(), voucher, user },
  };
}

export function getMyClaims(userId: string): (ClaimedVoucher & { voucher?: Voucher })[] {
  const db = getDB();
  return db.claimedVouchers
    .filter((c) => c.userId === userId)
    .sort((a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime())
    .map((c) => ({ ...c, voucher: db.vouchers.find((v) => v.id === c.voucherId) }));
}

/** Jenis tier notifikasi voucher hampir kadaluarsa (dedupe terpisah). */
export type ExpiringNotifyTier = "expiring" | "expiring_24h";

/**
 * Klaim voucher AKTIF yang masa berlakunya segera habis (dalam
 * `windowHours` ke depan) dan BELUM pernah dinotifikasi untuk tier
 * `notifiedField` yang diberikan. Basis kadaluarsa = `masaBerlaku` voucher
 * terkait. Dipakai job terjadwal (cron) → notifikasi WhatsApp ke pelanggan.
 */
function claimsExpiringInWindow(
  windowHours: number,
  notifiedField: "expiringNotifiedAt" | "expiring24hNotifiedAt",
  now: Date
): (ClaimedVoucher & { voucher?: Voucher; user?: User })[] {
  const db = getDB();
  const nowMs = now.getTime();
  const limitMs = nowMs + windowHours * 3_600_000;
  return db.claimedVouchers
    .filter((c) => {
      if (c.status !== "active") return false;
      if (c[notifiedField]) return false;
      const v = db.vouchers.find((x) => x.id === c.voucherId);
      if (!v) return false;
      const exp = new Date(v.masaBerlaku).getTime();
      return exp > nowMs && exp <= limitMs;
    })
    .map((c) => ({
      ...c,
      voucher: db.vouchers.find((x) => x.id === c.voucherId),
      user: db.users.find((u) => u.id === c.userId),
    }));
}

/**
 * Tier 48 jam: klaim yang masa berlakunya habis dalam `windowHours` ke
 * depan dan BELUM dinotifikasi (dedupe `expiringNotifiedAt`).
 */
export function getClaimsExpiringSoon(
  windowHours: number,
  now: Date = new Date()
): (ClaimedVoucher & { voucher?: Voucher; user?: User })[] {
  return claimsExpiringInWindow(windowHours, "expiringNotifiedAt", now);
}

/**
 * Tier H-1 (24 jam): klaim yang masa berlakunya habis dalam `windowHours`
 * ke depan dan BELUM dinotifikasi tier 24 jam (dedupe
 * `expiring24hNotifiedAt`, independen dari tier 48 jam).
 */
export function getClaimsExpiringSoon24h(
  windowHours: number = 24,
  now: Date = new Date()
): (ClaimedVoucher & { voucher?: Voucher; user?: User })[] {
  return claimsExpiringInWindow(windowHours, "expiring24hNotifiedAt", now);
}

/** Tandai klaim sudah dinotifikasi "hampir kadaluarsa" 48 jam (dedupe cron). */
export function markClaimExpiringNotified(claimId: string, at: Date = new Date()): void {
  mutate((db) => {
    const c = db.claimedVouchers.find((x) => x.id === claimId);
    if (c) c.expiringNotifiedAt = at.toISOString();
  });
}

export interface TierDeliveryMetric {
  /** Label tier pengingat: "48-jam" (expiringNotifiedAt) / "H-1" (expiring24hNotifiedAt). */
  tier: "48-jam" | "H-1";
  /** Pelanggan (distinct userId) yang DINOTIFIKASI tier ini dalam periode. */
  reminded: number;
  /** Dari yang diingatkan, berapa yang lalu MEMBUAT KLAIM BARU setelah pengingat pertama. */
  reclaimed: number;
}

/**
 * Metrik pengiriman pengingat voucher per TIER (48 jam vs H-1) untuk
 * halaman admin Log Notifikasi: berapa pelanggan diingatkan tiap tier, dan
 * berapa dari mereka yang lalu "mengklaim ulang" — membuat klaim voucher
 * BARU setelah pengingat pertama mereka (tanda notifikasi mendorong
 * kunjungan ulang).
 *
 * Sumber: marker dedupe di klaim (`expiringNotifiedAt` /
 * `expiring24hNotifiedAt`) — hanya diisi bila notifikasi benar-benar
 * terkirim/dicatat (pemanggil cron menandai setelah sukses), jadi akurat
 * per tier tanpa query notification_logs. Murni & sinkron; `now` bisa
 * di-override untuk pengujian batas periode.
 */
export function getTierDeliveryMetrics(
  now: Date = new Date(),
  periodDays: number = 30
): TierDeliveryMetric[] {
  const db = getDB();
  const periodStartMs = now.getTime() - periodDays * 86_400_000;
  const tiers: Array<{
    tier: TierDeliveryMetric["tier"];
    field: "expiringNotifiedAt" | "expiring24hNotifiedAt";
  }> = [
    { tier: "48-jam", field: "expiringNotifiedAt" },
    { tier: "H-1", field: "expiring24hNotifiedAt" },
  ];

  return tiers.map(({ tier, field }) => {
    // Klaim yang dinotifikasi tier ini dalam periode (marker terisi).
    const notified = db.claimedVouchers.filter((c) => {
      const at = c[field];
      return at !== undefined && new Date(at).getTime() >= periodStartMs;
    });
    const remindedUsers = new Set(notified.map((c) => c.userId));

    // "Mengklaim ulang": user diingatkan yang punya klaim BARU (claimedAt)
    // SETELAH pengingat pertama mereka untuk tier ini.
    let reclaimed = 0;
    for (const userId of Array.from(remindedUsers)) {
      const firstReminderMs = Math.min(
        ...notified
          .filter((c) => c.userId === userId)
          .map((c) => new Date(c[field] as string).getTime())
      );
      const hasNewClaim = db.claimedVouchers.some(
        (c) =>
          c.userId === userId &&
          new Date(c.claimedAt).getTime() > firstReminderMs
      );
      if (hasNewClaim) reclaimed++;
    }

    return { tier, reminded: remindedUsers.size, reclaimed };
  });
}

/** Tandai klaim sudah dinotifikasi H-1 / 24 jam (dedupe cron tier kedua). */
export function markClaimExpiring24hNotified(claimId: string, at: Date = new Date()): void {
  mutate((db) => {
    const c = db.claimedVouchers.find((x) => x.id === claimId);
    if (c) c.expiring24hNotifiedAt = at.toISOString();
  });
}

/**
 * Tandai klaim yang masa berlakunya sudah LEWAT sebagai 'expired' secara
 * otomatis (dipanggil job terjadwal runExpiryJob). Konsistensi: voucher-saya
 * menampilkan "Hangus", getken menolak redeem ("Voucher sudah kedaluwarsa"),
 * dan klaim tidak lagi muncul di window notifikasi "hampir kadaluarsa".
 * Idempoten: klaim non-aktif, tanpa voucher, atau belum lewat masa berlaku
 * tidak disentuh. Mengembalikan jumlah klaim yang baru ditandai expired.
 */
export function expireStaleClaims(now: Date = new Date()): number {
  const nowMs = now.getTime();
  return mutate((db) => {
    let count = 0;
    for (const c of db.claimedVouchers) {
      if (c.status !== "active") continue;
      const v = db.vouchers.find((x) => x.id === c.voucherId);
      if (!v) continue;
      if (new Date(v.masaBerlaku).getTime() <= nowMs) {
        c.status = "expired";
        count++;
      }
    }
    return count;
  });
}

export function getMerchantByUserId(userId: string): Merchant | undefined {
  return getDB().merchants.find((m) => m.userId === userId);
}

export function getMerchantById(merchantId: string): Merchant | undefined {
  return getDB().merchants.find((m) => m.id === merchantId);
}

/** ==================== MERCHANT: PROMO & VOUCHER ==================== */

export interface CreatePromoInput {
  merchantId: string;
  merchantName: string;
  promoName: string;
  jenisVoucher: string;
  startDate: string;
  endDate: string;
  jumlahPromo: number;
  voucherName: string;
  nilaiVoucher: number;
  minTransaksi: number;
  kuota: number;
  masaBerlaku: string;
  maksPenggunaan: number;
  syaratKetentuan: string;
  jumlahVoucher: number;
}

export function createPromoWithVouchers(input: CreatePromoInput): { promo: Promo; vouchers: Voucher[] } {
  return mutate((db) => {
    const promo: Promo = {
      id: newId("prm"),
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      name: input.promoName,
      jenisVoucher: input.jenisVoucher,
      startDate: new Date(input.startDate).toISOString(),
      endDate: new Date(input.endDate).toISOString(),
      jumlah: input.jumlahPromo,
      createdAt: isoNow(),
    };
    db.promos.push(promo);

    const vouchers: Voucher[] = [];
    for (let i = 0; i < Math.min(input.jumlahVoucher, 500); i++) {
      const voucher: Voucher = {
        id: newId("vch"),
        merchantId: input.merchantId,
        merchantName: input.merchantName,
        promoId: promo.id,
        name: input.voucherName,
        jenisVoucher: input.jenisVoucher,
        nilai: input.nilaiVoucher,
        minTransaksi: input.minTransaksi,
        kuota: input.kuota,
        masaBerlaku: new Date(input.masaBerlaku).toISOString(),
        maksPenggunaan: input.maksPenggunaan,
        syaratKetentuan: input.syaratKetentuan,
        jumlah: input.kuota,
        status: "active",
        createdAt: isoNow(),
      };
      db.vouchers.push(voucher);
      vouchers.push(voucher);
    }
    return { promo, vouchers };
  });
}

export function getMerchantPromos(merchantId: string): Promo[] {
  return getDB()
    .promos.filter((p) => p.merchantId === merchantId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getMerchantVouchers(merchantId: string): Voucher[] {
  return getDB()
    .vouchers.filter((v) => v.merchantId === merchantId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function archiveVoucher(merchantId: string, voucherId: string): void {
  mutate((db) => {
    const v = db.vouchers.find((x) => x.id === voucherId && x.merchantId === merchantId);
    if (!v) throw new Error("Voucher tidak ditemukan");
    v.status = v.status === "active" ? "archived" : "active";
  });
}

export function getMerchantClaims(merchantId: string) {
  const db = getDB();
  const voucherIds = new Set(
    db.vouchers.filter((v) => v.merchantId === merchantId).map((v) => v.id)
  );
  return db.claimedVouchers
    .filter((c) => voucherIds.has(c.voucherId))
    .sort((a, b) => new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime())
    .map((c) => ({
      ...c,
      voucher: db.vouchers.find((v) => v.id === c.voucherId),
      user: db.users.find((u) => u.id === c.userId),
    }));
}

/** ==================== ADMIN ==================== */

export function listMerchants(status?: Merchant["status"]): Merchant[] {
  const db = getDB();
  return db.merchants
    .filter((m) => (status ? m.status === status : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function reviewMerchant(merchantId: string, decision: "approved" | "rejected"): Merchant {
  return mutate((db) => {
    const merchant = db.merchants.find((m) => m.id === merchantId);
    if (!merchant) throw new Error("Merchant tidak ditemukan");
    merchant.status = decision;
    if (decision === "approved") {
      const user = db.users.find((u) => u.id === merchant.userId);
      if (user) user.role = "merchant";
    }
    return merchant;
  });
}

export function listMerchandise(status?: Merchandise["status"]): Merchandise[] {
  const db = getDB();
  return db.merchandise
    .filter((m) => (status ? m.status === status : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getMerchandiseBySlug(slug: string): Merchandise | undefined {
  const db = getDB();
  return db.merchandise.find((m) => m.slug === slug && m.status === "active");
}

export function getMerchandiseById(id: string): Merchandise | undefined {
  return getDB().merchandise.find((m) => m.id === id);
}

export interface MerchandiseInput {
  name: string;
  description: string;
  price: number;
  stock: number;
  image?: string;
  category: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

export function createMerchandise(input: MerchandiseInput): Merchandise {
  return mutate((db) => {
    const item: Merchandise = {
      id: newId("mds"),
      name: input.name,
      slug: `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`,
      description: input.description,
      price: input.price,
      stock: input.stock,
      image: input.image || "🛍️",
      category: input.category,
      status: "active",
      createdAt: isoNow(),
    };
    db.merchandise.push(item);
    return item;
  });
}

export function updateMerchandise(id: string, input: MerchandiseInput): Merchandise {
  return mutate((db) => {
    const item = db.merchandise.find((m) => m.id === id);
    if (!item) throw new Error("Produk tidak ditemukan");
    item.name = input.name;
    item.description = input.description;
    item.price = input.price;
    item.stock = input.stock;
    item.image = input.image || item.image;
    item.category = input.category;
    return item;
  });
}

export function setMerchandiseStatus(id: string, status: Merchandise["status"]): void {
  mutate((db) => {
    const item = db.merchandise.find((m) => m.id === id);
    if (!item) throw new Error("Produk tidak ditemukan");
    item.status = status;
  });
}

export function getAdminStats() {
  const db = getDB();
  const paidOrders = db.orders.filter((o) => o.paymentStatus === "paid");
  return {
    totalUsers: db.users.length,
    totalCustomers: db.users.filter((u) => u.role === "customer").length,
    totalMerchants: db.merchants.length,
    pendingMerchants: db.merchants.filter((m) => m.status === "pending").length,
    totalOrders: db.orders.length,
    paidOrders: paidOrders.length,
    revenue: paidOrders.reduce((s, o) => s + o.totalAmount, 0),
    activeMemberships: db.memberships.filter((m) => m.status === "active").length,
    claimedVouchers: db.claimedVouchers.length,
  };
}

/**
 * Ringkasan riwayat pembayaran untuk dashboard admin: jumlah order per
 * status PEMBAYARAN yang dibuat hari ini (zona server) + N order terbaru
 * dengan nama pelanggan (join users). Dipakai seksi "Riwayat Pembayaran"
 * di /admin (kartu ringkasan + tabel aksi retry dari sisi admin).
 */
export interface RetryMetricsDay {
  /** Tanggal (zona server, YYYY-MM-DD). */
  date: string;
  attempts: number;
  success: number;
  failed: number;
  /** Retry yang masih berstatus pending (belum ada hasil terminal). */
  pending: number;
}

/** Ringkasan retry pembayaran untuk dashboard admin. */
export interface RetryMetrics {
  daily: RetryMetricsDay[];
  /** Jumlah percobaan Coba Lagi pada hari ini (zona server). */
  todayAttempts: number;
  totalAttempts: number;
  success: number;
  failed: number;
  pending: number;
  /** success / (success+failed) ×100 (1 desimal); 0 bila belum ada hasil tuntas. */
  successRate: number;
}

/** Kunci tanggal lokal (YYYY-MM-DD) untuk bucket per hari. */
function localDateKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Event audit yang menandai HASIL TERMINAL dari sebuah retry. */
const RETRY_TERMINAL_EVENTS = new Set(["paid", "failed", "expired", "cancelled"]);

/**
 * Metrik RETRY MASSAL untuk dashboard admin: jumlah percobaan "Coba Lagi"
 * per hari + tingkat keberhasilan, dihitung dari log audit
 * (`metadata.paymentAudit`, entri `event: "retry"`).
 *
 * Hasil tiap retry: status terminal PERTAMA setelah retry pada audit order
 * (paid → sukses; failed/expired/cancelled → gagal); bila belum ada event
 * terminal berikutnya, dipakai status pembayaran order saat ini (pending =
 * masih berjalan, TIDAK dihitung dalam penyebut tingkat sukses). Retry yang
 * terjadi di luar jendela `days` diabaikan.
 */
export function getRetryMetrics(days: number = 7): RetryMetrics {
  const db = getDB();
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayKey = localDateKey(new Date(startOfToday));

  const daily = new Map<string, RetryMetricsDay>();
  for (let i = days - 1; i >= 0; i--) {
    const key = localDateKey(new Date(startOfToday - i * 86_400_000));
    daily.set(key, { date: key, attempts: 0, success: 0, failed: 0, pending: 0 });
  }

  let todayAttempts = 0;
  let totalAttempts = 0;
  let success = 0;
  let failed = 0;
  let pending = 0;

  for (const o of db.orders) {
    const audit = Array.isArray(o.metadata.paymentAudit)
      ? (o.metadata.paymentAudit as PaymentAuditEvent[])
      : [];
    for (let i = 0; i < audit.length; i++) {
      const ev = audit[i];
      if (ev.event !== "retry") continue;

      const day = daily.get(localDateKey(new Date(ev.at)));
      if (!day) continue; // di luar jendela metrik

      // Hasil retry: status terminal pertama setelahnya di audit; fallback
      // ke status order saat ini (retry terakhir yang belum tuntas).
      let outcome: string = o.paymentStatus;
      for (let j = i + 1; j < audit.length; j++) {
        if (RETRY_TERMINAL_EVENTS.has(audit[j].event)) {
          outcome = audit[j].paymentStatus;
          break;
        }
      }

      day.attempts++;
      totalAttempts++;
      if (localDateKey(new Date(ev.at)) === todayKey) todayAttempts++;
      if (outcome === "paid") {
        day.success++;
        success++;
      } else if (outcome === "pending") {
        day.pending++;
        pending++;
      } else {
        day.failed++;
        failed++;
      }
    }
  }

  const completed = success + failed;
  return {
    daily: Array.from(daily.values()),
    todayAttempts,
    totalAttempts,
    success,
    failed,
    pending,
    successRate: completed > 0 ? Math.round((success / completed) * 1000) / 10 : 0,
  };
}

/**
 * Satu baris order untuk tampilan admin (dashboard Riwayat Pembayaran &
 * ekspor CSV): nomor order + nama pelanggan + jenis + nominal + status.
 * `metadata` dibawa apa adanya (bukan untuk tampilan) agar
 * `filterPaymentOrders` bisa mencocokkan nomor retry lama saat ekspor CSV
 * terfilter — sama seperti halaman pelanggan. `items` / `paymentAudit` /
 * `snapCallbacks` (rincian untuk panel detail saat baris diklik) dibawa
 * dari order penuh sehingga dashboard tidak perlu request tambahan.
 */
export interface AdminPaymentRow {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  type: Order["type"];
  totalAmount: number;
  paymentStatus: string;
  status: string;
  createdAt: string;
  failureReason?: string;
  metadata?: Record<string, unknown>;
  /** Item order (panel detail). */
  items?: OrderItem[];
  /** Kronologi status pembayaran dari metadata.paymentAudit (panel detail). */
  paymentAudit?: PaymentAuditEvent[];
  /** Riwayat callback Snap.js dari metadata.snapCallbacks (panel detail). */
  snapCallbacks?: SnapCallbackRecord[];
}

/** Map satu order ke `AdminPaymentRow` (nama pelanggan dari `db.users`). */
function mapPaymentRow(o: Order, users: User[]): AdminPaymentRow {
  const user = users.find((u) => u.id === o.userId);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerId: o.userId,
    customerName: user?.name ?? "—",
    type: o.type,
    totalAmount: o.totalAmount,
    paymentStatus: o.paymentStatus,
    status: o.status,
    createdAt: o.createdAt,
    failureReason:
      typeof o.metadata?.failureReason === "string" ? o.metadata.failureReason : undefined,
    metadata: o.metadata,
    items: o.items,
    paymentAudit: Array.isArray(o.metadata?.paymentAudit)
      ? (o.metadata.paymentAudit as PaymentAuditEvent[])
      : [],
    snapCallbacks: Array.isArray(o.metadata?.snapCallbacks)
      ? (o.metadata.snapCallbacks as SnapCallbackRecord[])
      : [],
  };
}

/**
 * Rentang waktu ringkasan pembayaran ADMIN (dashboard Riwayat Pembayaran &
 * ekspor CSV): "today" (sejak awal hari, zona server), "7d", "30d" (N hari
 * terakhir). Dipilih lewat `?range=` di dashboard.
 */
export type PaymentRange = "today" | "7d" | "30d";

/**
 * Awal rentang (ms) untuk `PaymentRange`, relatif `now` (bisa di-override
 * untuk pengujian). "today" = awal hari zona server; "7d"/"30d" = `now`
 * dikurangi N×86.400.000.
 */
export function paymentRangeStart(range: PaymentRange, now: Date = new Date()): number {
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  const days = range === "7d" ? 7 : 30;
  return now.getTime() - days * 86_400_000;
}

/**
 * SEMUA order platform (terbaru dulu, dengan nama pelanggan) untuk ekspor
 * CSV admin. `range` opsional membatasi ke order yang dibuat sejak awal
 * rentang — dipakai tombol "Unduh CSV" agar konsisten dengan filter
 * tanggal dashboard.
 */
export function getAllAdminPaymentRows(range?: PaymentRange): AdminPaymentRow[] {
  const db = getDB();
  const startMs = range ? paymentRangeStart(range) : undefined;
  return db.orders
    .filter((o) => startMs === undefined || new Date(o.createdAt).getTime() >= startMs)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .map((o) => mapPaymentRow(o, db.users));
}

/**
 * Ringkasan riwayat pembayaran dashboard admin: jumlah order per status
 * PEMBAYARAN dalam rentang `range` (hari ini / 7 hari / 30 hari, lewat
 * `?range=` di halaman) + N order terbaru DI DALAM rentang tersebut dengan
 * nama pelanggan (join users). Dipakai seksi "Riwayat Pembayaran" di
 * /admin (kartu ringkasan + tabel aksi retry dari sisi admin).
 */
export function getAdminPaymentSummary(
  range: PaymentRange = "today",
  limit: number = 8
) {
  const db = getDB();
  const startMs = paymentRangeStart(range);
  const inRange = db.orders.filter(
    (o) => new Date(o.createdAt).getTime() >= startMs
  );
  const countBy = (s: Order["paymentStatus"]) =>
    inRange.filter((o) => o.paymentStatus === s).length;
  const rangePaid = inRange.filter((o) => o.paymentStatus === "paid");

  const recent = db.orders
    .filter((o) => new Date(o.createdAt).getTime() >= startMs)
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
    .map((o) => mapPaymentRow(o, db.users));

  return {
    range,
    period: {
      total: inRange.length,
      paid: countBy("paid"),
      failed: countBy("failed"),
      expired: countBy("expired"),
      pending: countBy("pending"),
      revenue: rangePaid.reduce((s, o) => s + o.totalAmount, 0),
    },
    recent,
  };
}

export function getMerchantStats(merchantId: string) {
  const db = getDB();
  const vouchers = db.vouchers.filter((v) => v.merchantId === merchantId);
  const voucherIds = new Set(vouchers.map((v) => v.id));
  const claims = db.claimedVouchers.filter((c) => voucherIds.has(c.voucherId));
  const used = claims.filter((c) => c.status === "used");
  return {
    totalVouchers: vouchers.length,
    totalKuota: vouchers.reduce((s, v) => s + v.kuota, 0),
    claimed: claims.length,
    used: used.length,
    promos: db.promos.filter((p) => p.merchantId === merchantId).length,
    claimedValue: claims.reduce((s, c) => {
      const v = db.vouchers.find((x) => x.id === c.voucherId);
      return s + (v?.nilai ?? 0);
    }, 0),
  };
}

export interface MerchantDailySummary {
  /** Voucher merchant yang diklaim sejak awal hari ini (zona server). */
  claimedToday: number;
  /** Nilai voucher yang DIREEDEM hari ini (pendapatan merchant). */
  revenueToday: number;
  /** Order milik merchant (metadata.merchantId) yang masih pending. */
  pendingOrders: number;
}

/**
 * Ringkasan harian per merchant untuk notifikasi WhatsApp (cron harian):
 * voucher terklaim hari ini, pendapatan (nilai voucher yang diredeem hari
 * ini), dan order pending milik merchant. Murni & sinkron — `now` dapat
 * di-override untuk pengujian batas hari.
 */
export function getMerchantDailySummary(
  merchantId: string,
  now: Date = new Date()
): MerchantDailySummary {
  const db = getDB();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayStartMs = dayStart.getTime();

  const voucherIds = new Set(
    db.vouchers.filter((v) => v.merchantId === merchantId).map((v) => v.id)
  );
  const claims = db.claimedVouchers.filter((c) => voucherIds.has(c.voucherId));

  const claimedToday = claims.filter(
    (c) => new Date(c.claimedAt).getTime() >= dayStartMs
  ).length;

  // Pendapatan = nilai voucher yang diredeem (status used) hari ini.
  const revenueToday = claims
    .filter(
      (c) =>
        c.status === "used" &&
        c.usedAt !== undefined &&
        new Date(c.usedAt).getTime() >= dayStartMs
    )
    .reduce((s, c) => {
      const v = db.vouchers.find((x) => x.id === c.voucherId);
      return s + (v?.nilai ?? 0);
    }, 0);

  // Order pending milik merchant (order merchandise via metadata.merchantId).
  const pendingOrders = db.orders.filter(
    (o) => o.paymentStatus === "pending" && o.metadata?.merchantId === merchantId
  ).length;

  return { claimedToday, revenueToday, pendingOrders };
}

/** Perbandingan role untuk helper UI */
export function roleLabel(role: Role): string {
  switch (role) {
    case "customer":
      return "Pelanggan";
    case "merchant":
      return "Merchant";
    case "admin":
      return "Admin";
  }
}
