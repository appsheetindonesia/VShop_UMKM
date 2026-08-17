export type Role = "customer" | "merchant" | "admin";

export interface User {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  passwordHash: string;
  role: Role;
  createdAt: string;
}

export type MerchantStatus = "pending" | "approved" | "rejected";

export interface Merchant {
  id: string;
  userId: string;
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
  deskripsi?: string;
  jamOperasional?: string;
  status: MerchantStatus;
  createdAt: string;
}

export interface Package {
  id: string;
  name: string;
  days: number;
  price: number;
  features: string[];
  badge?: string;
}

export interface Membership {
  id: string;
  userId: string;
  packageId: string;
  packageName: string;
  startDate: string;
  endDate: string;
  status: "active" | "expired";
  createdAt: string;
}

export interface Promo {
  id: string;
  merchantId: string;
  merchantName: string;
  name: string;
  jenisVoucher: string;
  startDate: string;
  endDate: string;
  jumlah: number;
  createdAt: string;
}

export interface Voucher {
  id: string;
  merchantId: string;
  merchantName: string;
  promoId?: string;
  name: string;
  jenisVoucher: string;
  nilai: number;
  minTransaksi: number;
  kuota: number;
  masaBerlaku: string;
  maksPenggunaan: number;
  syaratKetentuan: string;
  jumlah: number;
  status: "active" | "archived";
  createdAt: string;
}

export type ClaimStatus = "active" | "used" | "expired";

export interface ClaimedVoucher {
  id: string;
  voucherId: string;
  userId: string;
  kode: string;
  kodeKonfirmasi: string;
  status: ClaimStatus;
  claimedAt: string;
  usedAt?: string;
  useCount: number;
  /** Waktu notifikasi "voucher hampir kadaluarsa" (48 jam) terakhir dikirim (dedupe cron). */
  expiringNotifiedAt?: string;
  /** Waktu notifikasi H-1 (24 jam) terakhir dikirim (dedupe cron tier kedua). */
  expiring24hNotifiedAt?: string;
}

export type OrderType = "package" | "topup" | "merchandise";
export type PaymentStatus = "pending" | "paid" | "failed" | "expired" | "cancelled";
export type OrderStatus =
  | "pending"
  | "paid"
  | "processing"
  | "completed"
  | "cancelled";

export interface OrderItem {
  productId?: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

export interface ShippingAddress {
  nama: string;
  phone: string;
  alamat: string;
  kota: string;
  kodePos: string;
}

/** Callback yang dikirim Snap.js ke halaman bayar (audit trail). */
export type SnapCallbackEvent = "success" | "pending" | "error" | "close";

export interface SnapCallbackRecord {
  event: SnapCallbackEvent;
  /** Waktu callback diterima (ISO). */
  at: string;
  /** Hasil transaksi mentah dari Snap (status_code, transaction_status, payment_type, …). */
  result?: Record<string, unknown>;
}

/**
 * Sumber peristiwa audit pembayaran — dari mana status Midtrans diamati /
 * perubahan status aplikasi terjadi.
 */
export type PaymentAuditSource =
  | "create" // order dibuat
  | "snap" // callback Snap.js dari halaman bayar
  | "status-api" // Status API Midtrans (pemantauan server)
  | "poll" // polling LOKAL halaman bayar (pantau store — tanpa Midtrans)
  | "webhook" // notifikasi webhook Midtrans
  | "client-fail" // route fail dari layar pembayaran
  | "cron" // auto-expire order
  | "retry" // coba lagi (nomor order baru)
  | "mock"; // pembayaran simulasi mode demo

/**
 * Satu entri log audit pembayaran — kronologi status Midtrans per order.
 * Disimpan di `metadata.paymentAudit` (array, terbaru di akhir, maks 50).
 * Setiap kegagalan bisa ditelusuri urutan waktunya lewat entri ini.
 */
export interface PaymentAuditEvent {
  /** Waktu kejadian (ISO). */
  at: string;
  source: PaymentAuditSource;
  /** Label peristiwa: created / paid / failed / expired / pending / retry / success / error / close. */
  event: string;
  /** Status pembayaran aplikasi setelah kejadian. */
  paymentStatus: string;
  /** status_code Midtrans (mis. "202" ditolak bank, "216" saldo QRIS kurang). */
  statusCode?: string;
  /** status_message mentah dari Midtrans. */
  statusMessage?: string;
  /** transaction_status Midtrans (pending / capture / settlement / deny / expire / …). */
  transactionStatus?: string;
  /** transaction_id Midtrans bila tersedia. */
  transactionId?: string;
  /** payment_type Midtrans (qris, bank_transfer, …). */
  paymentType?: string;
  /** channel_response_code Midtrans (kode spesifik GoPay/OVO/VA/bank). */
  channelResponseCode?: string;
  /** channel_response_message mentah dari Midtrans. */
  channelResponseMessage?: string;
  /** Nomor order saat kejadian (berubah saat retry). */
  orderNumber?: string;
  /** Alasan / keterangan tambahan (mis. alasan gagal spesifik). */
  detail?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  type: OrderType;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: string;
  snapToken?: string;
  shippingAddress?: ShippingAddress;
  /** Metadata bebas; snapCallbacks (riwayat Snap), paymentAudit (kronologi status
   * Midtrans) & failureReason disimpan di sini. */
  metadata: Record<string, unknown>;
  createdAt: string;
  paidAt?: string;
}

export interface Merchandise {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  stock: number;
  image: string; // emoji placeholder / URL
  category: string;
  status: "active" | "draft" | "archived";
  createdAt: string;
}

export interface Wallet {
  userId: string;
  balance: number;
  updatedAt: string;
}

export interface Session {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  /** Refresh token Supabase Auth terenkripsi (AES-256-GCM) — pemulihan lintas perangkat. */
  sbRefreshEnc?: string;
  /** ID user Supabase Auth (auth.users) pemilik refresh token. */
  sbUserId?: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface DB {
  users: User[];
  merchants: Merchant[];
  packages: Package[];
  memberships: Membership[];
  promos: Promo[];
  vouchers: Voucher[];
  claimedVouchers: ClaimedVoucher[];
  orders: Order[];
  merchandise: Merchandise[];
  wallets: Wallet[];
  sessions: Session[];
  carts: Record<string, CartItem[]>;
}
