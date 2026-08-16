/**
 * Adapter pembayaran Midtrans.
 *
 * Mode DEMO (default): tidak butuh credential — membuat snap token
 * tiruan dan pembayaran disimulasikan di halaman /bayar/[orderId].
 *
 * Mode SANDBOX / PRODUKSI: isi MIDTRANS_SERVER_KEY di environment.
 * Adapter memanggil Snap API Midtrans dan mengembalikan snap_token asli;
 * status pembayaran dicek lewat Status API dan notifikasi webhook
 * (signature SHA-512 diverifikasi). Sandbox default; set
 * MIDTRANS_IS_PRODUCTION=true hanya untuk transaksi nyata.
 * Rahasia hanya dibaca di server (SEC-05).
 */

import { createHash } from "node:crypto";

export interface PaymentTransaction {
  orderId: string;
  orderNumber: string;
  totalAmount: number;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}

export interface PaymentResult {
  token: string;
  redirectUrl?: string;
  mock: boolean;
}

const IS_PRODUCTION = process.env.MIDTRANS_IS_PRODUCTION === "true";

/**
 * Base URL Midtrans (seam pengujian). Bila MIDTRANS_API_BASE diisi,
 * dipakai untuk Snap v1 & Status v2 (mis. mengarah ke simulator lokal /
 * proxy). Tanpa override: sandbox / produksi sesuai MIDTRANS_IS_PRODUCTION.
 */
const OVERRIDE_API_BASE = process.env.MIDTRANS_API_BASE;
const SNAP_BASE =
  OVERRIDE_API_BASE ??
  (IS_PRODUCTION
    ? "https://app.midtrans.com/snap/v1"
    : "https://app.sandbox.midtrans.com/snap/v1");
const STATUS_BASE =
  OVERRIDE_API_BASE ??
  (IS_PRODUCTION
    ? "https://api.midtrans.com/v2"
    : "https://api.sandbox.midtrans.com/v2");

/**
 * Masa berlaku order & transaksi Midtrans (jam). Satu sumber kebenaran:
 * dipakai untuk field `expiry` di payload Snap DAN aturan auto-expire order
 * lokal (cron) — keduanya selalu konsisten. Default 24 jam (default Snap).
 */
export const ORDER_EXPIRY_HOURS = Number(process.env.ORDER_EXPIRY_HOURS ?? 24);

function serverKey(): string | undefined {
  return process.env.MIDTRANS_SERVER_KEY;
}

/**
 * Membuat transaksi pembayaran. Mengembalikan snap_token.
 * Di mode demo token bersifat lokal; di mode produksi dipanggil
 * Snap API Midtrans.
 */
export async function createPaymentTransaction(
  tx: PaymentTransaction
): Promise<PaymentResult> {
  const key = serverKey();
  if (!key) {
    return { token: `snap-demo-${tx.orderId}`, mock: true };
  }

  const res = await fetch(`${SNAP_BASE}/transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      transaction_details: {
        order_id: tx.orderNumber,
        gross_amount: tx.totalAmount,
        expiry: { unit: "hours", duration: ORDER_EXPIRY_HOURS },
      },
      customer_details: {
        first_name: tx.customerName?.split(" ")[0] ?? "Customer",
        last_name: tx.customerName?.split(" ").slice(1).join(" ") || undefined,
        email: tx.customerEmail,
        phone: tx.customerPhone,
      },
      credit_card: { secure: true },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Midtrans error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { token: string; redirect_url?: string };
  return { token: data.token, redirectUrl: data.redirect_url, mock: false };
}

export function midtransClientKey(): string | undefined {
  return process.env.MIDTRANS_CLIENT_KEY;
}

/** True bila token Snap berasal dari mode demo (bukan Midtrans asli). */
export function isMockSnapToken(token?: string): boolean {
  return !token || token.startsWith("snap-demo-");
}

/** URL halaman Snap VT-web untuk snap token (sandbox / produksi). */
export function snapVtwebUrl(token: string): string {
  const base = IS_PRODUCTION
    ? "https://app.midtrans.com/snap/v2/vtweb"
    : "https://app.sandbox.midtrans.com/snap/v2/vtweb";
  return `${base}/${encodeURIComponent(token)}`;
}

export function isMidtransProduction(): boolean {
  return IS_PRODUCTION;
}

/**
 * URL script Snap.js (popup/embed) — sandbox / produksi. Bisa di-override
 * lewat MIDTRANS_SNAP_SCRIPT_URL (seam pengujian, mis. stub lokal).
 */
export function snapScriptUrl(): string {
  return (
    process.env.MIDTRANS_SNAP_SCRIPT_URL ??
    (IS_PRODUCTION
      ? "https://app.midtrans.com/snap/snap.js"
      : "https://app.sandbox.midtrans.com/snap/snap.js")
  );
}

/**
 * Verifikasi signature notifikasi webhook Midtrans:
 * SHA512(order_id + status_code + gross_amount + ServerKey).
 * Lihat https://docs.midtrans.com/docs/security-best-practice-https-signature.
 */
export function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  signatureKey: string
): boolean {
  const key = serverKey();
  if (!key) return false;
  const expected = createHash("sha512")
    .update(`${orderId}${statusCode}${grossAmount}${key}`)
    .digest("hex");
  return signatureKey === expected;
}

interface MidtransStatus {
  transaction_status?: string;
  fraud_status?: string;
  payment_type?: string;
  status_code?: string;
  gross_amount?: string;
  status_message?: string;
  transaction_id?: string;
}

/** Ambil status transaksi dari Midtrans Status API (server-to-server). */
export async function getMidtransStatus(orderNumber: string): Promise<MidtransStatus> {
  const key = serverKey();
  if (!key) throw new Error("MIDTRANS_SERVER_KEY belum diatur");
  const res = await fetch(`${STATUS_BASE}/${encodeURIComponent(orderNumber)}/status`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Midtrans status error ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as MidtransStatus;
}

/** True bila transaksi sudah dibayar (capture/settlement tanpa challenge). */
export function isMidtransPaid(status: MidtransStatus): boolean {
  const t = status.transaction_status;
  if (t === "settlement") return true;
  if (t === "capture") return status.fraud_status !== "challenge";
  return false;
}

/**
 * Status terminal GAGAL dari Midtrans: transaksi berhenti tanpa pembayaran.
 * - "expire" → kadaluarsa (waktu pembayaran habis)
 * - "deny" / "cancel" / "failure" → gagal / dibatalkan / ditolak
 * Mengembalikan null bila transaksi masih berjalan atau sudah lunas.
 */
export function midtransTerminalFailure(
  status: Pick<MidtransStatus, "transaction_status">
): "expired" | "failed" | null {
  switch (status.transaction_status) {
    case "expire":
      return "expired";
    case "deny":
    case "cancel":
    case "failure":
      return "failed";
    default:
      return null;
  }
}

/**
 * Tabel status_code Midtrans → alasan gagal spesifik (Bahasa Indonesia).
 *
 * 2xx = kode status pembayaran (kartu / bank transfer / e-channel /
 * convenience store / QRIS / e-wallet). 4xx = kode status Midtrans dari
 * Status API / pembuatan transaksi (bukan kode channel) — bisa muncul saat
 * transaksi bermasalah (mis. 407 transaksi sudah kedaluwarsa, 406 nomor
 * order sudah dipakai, 401/402 salah konfigurasi merchant).
 *
 * Sumber: docs.midtrans.com/reference/status-code (Code 2xx & Code 4xx).
 * Diekspor agar unit test bisa menguji SELURUH tabel (tidak boleh ada
 * kode yang terlewat).
 */
export const MIDTRANS_FAILURE_CODES: Readonly<Record<string, string>> = {
  // Kartu kredit
  "101": "Kartu kedaluwarsa",
  "102": "Kartu ditolak oleh bank",
  "103": "Saldo kartu tidak mencukupi",
  "104": "Kartu diblokir karena dugaan penipuan",
  "105": "Kartu tidak aktif",
  "106": "Melebihi limit transaksi",
  "107": "Kartu diblokir oleh bank",
  "108": "Nomor kartu tidak valid",
  "109": "Tanggal kedaluwarsa kartu tidak valid",
  "110": "Kode CVV tidak valid",
  "111": "Jenis kartu tidak didukung",
  "112": "Kartu ditolak saat verifikasi 3DS",
  "113": "Kartu ditolak oleh bank saat verifikasi 3DS",
  "114": "Saldo kartu tidak mencukupi saat verifikasi 3DS",
  "115": "Kartu diblokir oleh bank saat verifikasi 3DS",
  "116": "Melebihi limit transaksi saat verifikasi 3DS",
  "117": "Kartu tidak valid saat verifikasi 3DS",
  "118": "Kartu kedaluwarsa saat verifikasi 3DS",
  "119": "Kode CVV tidak valid saat verifikasi 3DS",
  "188": "Kartu belum terdaftar 3DS",
  // Umum / bank transfer / e-channel / retail
  "201": "Pembayaran dibatalkan",
  "202": "Pembayaran ditolak oleh bank",
  "203": "Waktu pembayaran habis",
  "204": "Pembayaran ditolak oleh bank",
  "205": "Pembayaran ditolak oleh bank",
  "206": "Pembayaran ditolak oleh bank",
  "207": "Transaksi ditolak karena dugaan penipuan",
  "208": "Pembayaran ditolak oleh bank",
  "209": "Pembayaran ditolak oleh penyedia",
  "210": "Pembayaran ditolak oleh bank",
  "211": "Pembayaran ditolak oleh penerbit",
  "212": "Pembayaran ditolak oleh bank",
  "213": "Jumlah transaksi tidak sesuai",
  // QRIS
  "214": "QRIS gagal diproses",
  "215": "Pembayaran ditolak oleh bank (QRIS)",
  "216": "Saldo tidak mencukupi (QRIS)",
  "217": "Pembayaran ditolak oleh bank (QRIS)",
  "218": "Pembayaran ditolak oleh bank (QRIS)",
  "219": "Melebihi limit transaksi (QRIS)",
  "220": "Pembayaran ditolak oleh bank (QRIS)",
  "221": "Waktu pembayaran QRIS habis",
  "222": "Pembayaran ditolak oleh bank (QRIS)",
  "223": "Pembayaran ditolak oleh bank (QRIS)",
  "224": "Pembayaran ditolak oleh bank (QRIS)",
  "225": "Pembayaran ditolak oleh bank (QRIS)",
  "226": "Pembayaran ditolak oleh bank (QRIS)",
  "227": "Pembayaran ditolak oleh bank (QRIS)",
  "228": "Pembayaran ditolak oleh bank (QRIS)",
  "229": "Pembayaran ditolak oleh bank (QRIS)",
  "230": "Pembayaran ditolak oleh bank (QRIS)",
  // 4xx — kode status Midtrans (docs: status-code-4xx); bukan kode channel.
  "400": "Data transaksi tidak valid",
  "401": "Akses ditolak — periksa konfigurasi kunci Midtrans",
  "402": "Metode pembayaran tidak tersedia untuk merchant",
  "403": "Permintaan ditolak (konten tidak sesuai)",
  "404": "Transaksi tidak ditemukan",
  "405": "Metode permintaan tidak diizinkan",
  "406": "Nomor order sudah pernah dipakai",
  "407": "Transaksi sudah kedaluwarsa",
  "408": "Tipe data transaksi salah",
  "410": "Akun merchant nonaktif — hubungi dukungan",
  "411": "Token transaksi tidak valid atau kedaluwarsa",
  "412": "Status transaksi tidak dapat diubah",
  "413": "Format permintaan tidak valid",
};

const FAILURE_TRANSACTION_MESSAGES: Record<string, string> = {
  expire: "Waktu pembayaran habis",
  deny: "Pembayaran ditolak oleh bank",
  cancel: "Pembayaran dibatalkan",
  failure: "Pembayaran gagal diproses",
};

export interface MidtransFailureDetail {
  /** Kode status Midtrans (mis. "202", "216") bila tersedia. */
  code?: string;
  /** Alasan spesifik dalam Bahasa Indonesia. */
  reason: string;
}

/**
 * Petakan status Midtrans ke alasan kegagalan spesifik. Mengembalikan null
 * bila status bukan kegagalan terminal (masih berjalan / sudah lunas).
 */
export function midtransFailureReason(
  status: Pick<MidtransStatus, "status_code" | "transaction_status">
): MidtransFailureDetail | null {
  const code = status.status_code?.trim();
  if (code && MIDTRANS_FAILURE_CODES[code]) {
    return { code, reason: MIDTRANS_FAILURE_CODES[code] };
  }
  const tx = status.transaction_status;
  if (tx && FAILURE_TRANSACTION_MESSAGES[tx]) {
    return { code, reason: FAILURE_TRANSACTION_MESSAGES[tx] };
  }
  return null;
}

/** Terjemahkan payment_type Midtrans → label metode pembayaran aplikasi. */
export function paymentTypeToMethod(paymentType?: string): string {
  switch (paymentType) {
    case "qris":
      return "QRIS";
    case "gopay":
      return "GoPay";
    case "ovo":
      return "OVO";
    case "dana":
      return "DANA";
    case "bank_transfer":
      return "Virtual Account";
    case "credit_card":
      return "Kartu Kredit";
    case "echannel":
      return "Mandiri Bill Payment";
    case "cstore":
      return "Convenience Store";
    case "shopeepay":
      return "ShopeePay";
    case "akulaku":
      return "Akulaku";
    default:
      return paymentType || "Midtrans";
  }
}
