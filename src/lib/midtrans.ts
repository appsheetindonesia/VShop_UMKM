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
import { getSetting } from "./settings";
// SUMBER SATU-SATUNYA tabel kode gagal ada di file data murni
// `./midtrans-codes` (dipakai ulang oleh halaman admin & unit test).
// Di-import untuk logika lokal + di-re-export agar import lama
// `from "@/lib/midtrans"` tetap bekerja.
import {
  CHANNEL_LABEL,
  CHANNEL_RESPONSE_CODES,
  MIDTRANS_FAILURE_CODES,
} from "./midtrans-codes";
export {
  CHANNEL_LABEL,
  CHANNEL_RESPONSE_CODES,
  MIDTRANS_FAILURE_CODES,
} from "./midtrans-codes";

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
 * Base URL Midtrans (seam pengujian & override admin). Prioritas:
 * 1. Setting admin `midtrans_api_base` (Configurasi — bisa diubah tanpa
 *    restart, mis. mengarah ke simulator/proxy lokal);
 * 2. env MIDTRANS_API_BASE;
 * 3. sandbox / produksi sesuai MIDTRANS_IS_PRODUCTION.
 * Dibaca PER PANGGILAN (bukan konstanta module-load) agar perubahan setting
 * berlaku live — pola yang sama dgn serverKey()/clientKey().
 */
function apiBase(): string | undefined {
  return getSetting("midtrans_api_base") ?? process.env.MIDTRANS_API_BASE ?? undefined;
}

function snapBase(): string {
  return (
    apiBase() ??
    (IS_PRODUCTION ? "https://app.midtrans.com/snap/v1" : "https://app.sandbox.midtrans.com/snap/v1")
  );
}

function statusBase(): string {
  return (
    apiBase() ??
    (IS_PRODUCTION ? "https://api.midtrans.com/v2" : "https://api.sandbox.midtrans.com/v2")
  );
}

/**
 * Masa berlaku order & transaksi Midtrans (jam). Satu sumber kebenaran:
 * dipakai untuk field `expiry` di payload Snap DAN aturan auto-expire order
 * lokal (cron) — keduanya selalu konsisten. Default 24 jam (default Snap).
 *
 * Dibaca PER PANGGILAN (bukan konstanta module-load) sehingga perubahan
 * langsung berlaku tanpa restart: setting admin "Order Expiry (jam)" di
 * Configurasi menang (cache di-refresh saat simpan), fallback env
 * `ORDER_EXPIRY_HOURS` (dev server / CI). Nilai tidak valid (NaN, ≤ 0)
 * jatuh kembali ke default 24.
 */
export function getOrderExpiryHours(): number {
  const raw = Number(getSetting("order_expiry_hours") ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

function serverKey(): string | undefined {
  // Setting admin (Configurasi) menang; fallback env MIDTRANS_SERVER_KEY.
  return getSetting("midtrans_server_key") ?? undefined;
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

  const res = await fetch(`${snapBase()}/transactions`, {
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
        expiry: { unit: "hours", duration: getOrderExpiryHours() },
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
  // Setting admin (Configurasi) menang; fallback env MIDTRANS_CLIENT_KEY.
  return getSetting("midtrans_client_key") ?? undefined;
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
  /** Kode respons dari CHANNEL (GoPay/OVO/VA/bank) — lebih spesifik dari status_code. */
  channel_response_code?: string;
  /** Pesan mentah dari channel. */
  channel_response_message?: string;
}

/**
 * Error ter-struktur dari panggilan Midtrans API — membawa `statusCode`
 * (mis. "401") dan potongan body agar pemanggil bisa membedakan error
 * KONFIGURASI (401/402/410) dari error transaksi biasa.
 */
export class MidtransApiError extends Error {
  readonly statusCode: string;
  readonly body: string;
  constructor(statusCode: number | string, body: string) {
    super(`Midtrans status error ${statusCode}: ${body.slice(0, 200)}`);
    this.name = "MidtransApiError";
    this.statusCode = String(statusCode);
    this.body = body;
  }
}

/**
 * Ambil status transaksi dari Midtrans Status API (server-to-server).
 * Error non-2xx dilempar sebagai `MidtransApiError` (bawa statusCode).
 */
export async function getMidtransStatus(orderNumber: string): Promise<MidtransStatus> {
  const key = serverKey();
  if (!key) throw new Error("MIDTRANS_SERVER_KEY belum diatur");
  const res = await fetch(`${statusBase()}/${encodeURIComponent(orderNumber)}/status`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new MidtransApiError(res.status, body);
  }
  return (await res.json()) as MidtransStatus;
}

/**
 * True bila status_code adalah error KONFIGURASI pembayaran (bukan kegagalan
 * transaksi pelanggan): 401 akses ditolak (key salah), 402 metode tidak
 * tersedia untuk merchant, 403 konten ditolak, 410 akun merchant nonaktif.
 * Dipakai untuk memicu notifikasi ke merchant (lihat route Status API).
 */
export function isMidtransConfigError(statusCode?: string): boolean {
  switch (statusCode?.trim()) {
    case "401":
    case "402":
    case "403":
    case "410":
      return true;
    default:
      return false;
  }
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

const FAILURE_TRANSACTION_MESSAGES: Record<string, string> = {
  expire: "Waktu pembayaran habis",
  deny: "Pembayaran ditolak oleh bank",
  cancel: "Pembayaran dibatalkan",
  failure: "Pembayaran gagal diproses",
};

// Tabel channel_response_code & CHANNEL_LABEL: lihat `./midtrans-codes`
// (sumber tunggal; dipakai ulang halaman admin & unit test).

export interface MidtransFailureDetail {
  /** Kode status Midtrans (mis. "202", "216") bila tersedia. */
  code?: string;
  /** Alasan spesifik dalam Bahasa Indonesia. */
  reason: string;
}

/**
 * Petakan `channel_response_code` (kode dari penyedia channel) ke alasan
 * spesifik per channel. Mengembalikan null bila tidak ada kode channel atau
 * channel tidak dikenal. Kode channel yang TIDAK ada di tabel tetap memberi
 * alasan spesifik-kanal ("Ditolak oleh {channel} (kode …)") — penyebab
 * persisnya lebih berguna daripada pesan generik 202.
 */
export function midtransChannelFailureReason(
  paymentType?: string,
  channelCode?: string,
  channelMessage?: string
): MidtransFailureDetail | null {
  const code = channelCode?.trim();
  const channel = paymentType ? paymentType.trim().toLowerCase() : "";
  if (!code) return null;

  const table = CHANNEL_RESPONSE_CODES[channel];
  if (table?.[code]) {
    return {
      code,
      reason: table[code] + (channelMessage ? ` — ${channelMessage.trim()}` : ""),
    };
  }
  // Kanal dikenal tapi kode belum di tabel → tetap spesifik-kanal.
  const label = CHANNEL_LABEL[channel];
  if (label) {
    return {
      code,
      reason: `Ditolak oleh ${label} (kode ${code})` + (channelMessage ? ` — ${channelMessage.trim()}` : ""),
    };
  }
  return null;
}

/**
 * Petakan status Midtrans ke alasan kegagalan spesifik. Mengembalikan null
 * bila status bukan kegagalan terminal (masih berjalan / sudah lunas).
 *
 * Prioritas: (1) `channel_response_code` per channel (paling spesifik),
 * (2) `status_code` Midtrans (tabel 2xx/4xx), (3) fallback `transaction_status`.
 */
export function midtransFailureReason(
  status: Pick<
    MidtransStatus,
    "status_code" | "transaction_status" | "payment_type" | "channel_response_code" | "channel_response_message"
  >
): MidtransFailureDetail | null {
  const channel = midtransChannelFailureReason(
    status.payment_type,
    status.channel_response_code,
    status.channel_response_message
  );
  if (channel) return channel;

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
