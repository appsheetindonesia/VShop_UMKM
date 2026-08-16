import { getDB, hashPassword, isoNow, mutate, newId } from "./db";
import { createPaymentTransaction, ORDER_EXPIRY_HOURS } from "./midtrans";
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
  const count = db.orders.filter((o) => o.orderNumber.includes(`VS-${ymd}`)).length + 1;
  return `VS-${ymd}-${String(count).padStart(4, "0")}`;
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
  const order = mutate((db) => {
    const orderNumber = nextOrderNumber(db);
    // Log audit dibuka sejak order dibuat — kronologi lengkap dari awal.
    const audit: PaymentAuditEvent[] = [
      {
        at: isoNow(),
        source: "create",
        event: "created",
        paymentStatus: "pending",
        orderNumber,
      },
    ];
    const order: Order = {
      id: newId("ord"),
      orderNumber,
      userId: input.userId,
      type: input.type,
      items: input.items,
      totalAmount: input.totalAmount,
      status: "pending",
      paymentStatus: "pending",
      shippingAddress: input.address,
      metadata: { ...input.metadata, paymentAudit: audit },
      createdAt: isoNow(),
    };
    db.orders.push(order);
    return order;
  });

  const user = getDB().users.find((u) => u.id === input.userId);
  const payment = await createPaymentTransaction({
    orderId: order.id,
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    customerName: user?.name,
    customerEmail: user?.email,
    customerPhone: user?.phone,
  });

  mutate((db) => {
    const o = db.orders.find((x) => x.id === order.id);
    if (o) {
      o.snapToken = payment.token;
      if (payment.redirectUrl) {
        o.metadata = { ...o.metadata, snapRedirectUrl: payment.redirectUrl };
      }
    }
  });

  return { order: { ...order, snapToken: payment.token }, mock: payment.mock };
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
  /** Nomor order saat kejadian (penting saat retry mengganti nomor). */
  orderNumber?: string;
  /** Alasan / keterangan tambahan. */
  detail?: string;
}

const MAX_PAYMENT_AUDIT = 50;

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
  const cutoff = now.getTime() - ORDER_EXPIRY_HOURS * 3_600_000;
  const stale = getDB().orders.filter(
    (o) =>
      o.paymentStatus === "pending" &&
      new Date(o.createdAt).getTime() < cutoff
  );
  const expiredIds: string[] = [];
  for (const o of stale) {
    // markOrderFailed idempotent: hanya memproses order yang belum terminal.
    // Sumber "cron" direkam ke log audit (auto-expire terjadwal).
    markOrderFailed(o.id, "expired", undefined, { source: "cron" });
    expiredIds.push(o.id);
  }
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
