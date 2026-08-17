/**
 * Logika murni untuk riwayat & detail pembayaran — dipisah dari komponen
 * agar bisa diuji unit tanpa JSX.
 *
 * Filter: tab status (Semua / paid / failed+expired) + pencarian nomor order
 * (juga mencocokkan originalOrderNumber & previousOrderNumbers untuk order
 * yang pernah di-retry).
 */
import { paymentBadge } from "../components/Badge";
import { formatDate } from "./format";
import type { Order, PaymentAuditEvent } from "./types";

/** Label peristiwa audit pembayaran untuk UI (timeline detail transaksi). */
export const AUDIT_EVENT_LABEL: Record<string, string> = {
  created: "Dibuat",
  paid: "Berhasil",
  failed: "Gagal",
  expired: "Kadaluarsa",
  pending: "Menunggu",
  retry: "Coba Lagi",
  success: "Snap Berhasil",
  error: "Snap Error",
  close: "Snap Ditutup",
  "config-error": "Konfigurasi Bermasalah",
};

/** Label sumber peristiwa audit pembayaran untuk UI. */
export const AUDIT_SOURCE_LABEL: Record<string, string> = {
  create: "Order",
  snap: "Snap",
  "status-api": "Status API",
  poll: "Polling",
  webhook: "Webhook",
  "client-fail": "Layar bayar",
  cron: "Auto-expire",
  retry: "Coba Lagi",
  mock: "Demo",
};

/** Satu langkah timeline status pembayaran (siap render, sudah di-label). */
export interface TimelineStep {
  at: string;
  label: string;
  sourceLabel: string;
  statusCode?: string;
  statusMessage?: string;
  transactionStatus?: string;
  transactionId?: string;
  paymentType?: string;
  /** channel_response_code — kode spesifik GoPay/OVO/VA/bank dari Midtrans. */
  channelResponseCode?: string;
  /** channel_response_message mentah dari Midtrans. */
  channelResponseMessage?: string;
  orderNumber?: string;
  detail?: string;
  /** Entri terbaru (posisi terakhir di metadata.paymentAudit) — status saat ini. */
  isLatest: boolean;
}

/**
 * Teks yang TAMPIL untuk satu entri audit: alasan terpetakan (`detail`)
 * ditampilkan sebagai teks utama; `status_message` MENTAH Midtrans tetap
 * disimpan di `paymentAudit.statusMessage` dan ditampilkan sebagai baris
 * sekunder berlabel — jadi alasan yang terbaca + data mentah tetap utuh
 * untuk audit.
 */
export interface AuditDisplayText {
  /** Teks utama: alasan spesifik terpetakan (detail) → fallback transaction_status / status_message mentah. */
  primary?: string;
  /** status_message mentah dari Midtrans bila berbeda dari teks utama. */
  raw?: string;
}

export function auditDisplayText(ev: {
  detail?: string;
  statusMessage?: string;
  transactionStatus?: string;
}): AuditDisplayText {
  const ne = (s?: string) => (typeof s === "string" && s.length > 0 ? s : undefined);
  const detail = ne(ev.detail);
  const statusMessage = ne(ev.statusMessage);
  const transactionStatus = ne(ev.transactionStatus);
  const primary = detail ?? transactionStatus ?? statusMessage;
  const raw =
    typeof statusMessage === "string" && statusMessage !== primary
      ? statusMessage
      : undefined;
  return { primary, raw };
}

/**
 * Bangun timeline status pembayaran dari array `paymentAudit`: urutan
 * KRONOLOGIS (tertua di atas), entri terakhir ditandai sebagai status saat
 * ini. Sumber label tunggal — dipakai `buildPaymentTimeline` (halaman
 * /transaksi/[orderId]) DAN panel detail admin (baris tabel dashboard
 * diklik), sehingga label konsisten di kedua tempat.
 */
export function buildAuditTimeline(events: PaymentAuditEvent[]): TimelineStep[] {
  return events.map((ev, i) => ({
    at: ev.at,
    label: AUDIT_EVENT_LABEL[ev.event] ?? ev.event,
    sourceLabel: AUDIT_SOURCE_LABEL[ev.source] ?? ev.source,
    statusCode: ev.statusCode,
    statusMessage: ev.statusMessage,
    transactionStatus: ev.transactionStatus,
    transactionId: ev.transactionId,
    paymentType: ev.paymentType,
    channelResponseCode: ev.channelResponseCode,
    channelResponseMessage: ev.channelResponseMessage,
    orderNumber: ev.orderNumber,
    detail: ev.detail,
    isLatest: i === events.length - 1,
  }));
}

/**
 * Bangun timeline status pembayaran dari `metadata.paymentAudit` order
 * penuh. Delegasi ke `buildAuditTimeline`.
 */
export function buildPaymentTimeline(order: Order): TimelineStep[] {
  const events = Array.isArray(order.metadata.paymentAudit)
    ? (order.metadata.paymentAudit as PaymentAuditEvent[])
    : [];
  return buildAuditTimeline(events);
}

export interface OrderNumberTransition {
  from: string;
  to: string;
}

/**
 * Riwayat PENGANTIAN nomor order (order_id Midtrans) akibat retry — untuk
 * halaman detail transaksi (pelanggan/admin bisa melacak order_id yang
 * diganti). Sumber: `metadata.originalOrderNumber` + `previousOrderNumbers`
 * + `order.orderNumber` saat ini, dirangkai jadi urutan transisi
 * [dari → ke], mis. `[{ from: "VS-...0004", to: "VS-...0005" }]` atau
 * rantai multi-retry `[0001→0002, 0002→0003]`. Mengembalikan [] bila order
 * tidak pernah di-retry.
 */
export function buildOrderNumberHistory(order: Order): OrderNumberTransition[] {
  const meta = order.metadata as Record<string, unknown>;
  const original =
    typeof meta.originalOrderNumber === "string" ? meta.originalOrderNumber : undefined;
  const prev = Array.isArray(meta.previousOrderNumbers)
    ? (meta.previousOrderNumbers as string[])
    : [];
  // Rantai lengkap: original → prev[0] → prev[1] → … → current (unik
  // berurutan — previousOrderNumbers[0] bisa sama dengan original).
  const chain: string[] = [];
  const push = (n: string) => {
    if (n && chain[chain.length - 1] !== n) chain.push(n);
  };
  if (original) push(original);
  for (const n of prev) push(n);
  push(order.orderNumber);

  const transitions: OrderNumberTransition[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    transitions.push({ from: chain[i], to: chain[i + 1] });
  }
  return transitions;
}

/**
 * Format nomor invoice STABIL: `VS-INV-YYYYMMDD-XXXX`. Berbeda dari nomor
 * order (yang DIGANTI saat Coba Lagi / retry karena order_id Midtrans)
 * — nomor invoice dibuat SEKALI saat order dibuat dan tidak pernah berubah,
 * jadi cocok untuk bukti transaksi / referensi pelanggan & akuntansi.
 */
export const INVOICE_NUMBER_RE = /^VS-INV-\d{8}-\d{4}$/;

/**
 * Nomor invoice order untuk tampilan kartu invoice & detail transaksi:
 * `metadata.invoiceNumber` bila valid (format `VS-INV-…`), fallback ke
 * nomor order untuk order lama yang dibuat sebelum fitur ini (agar tampilan
 * tidak kosong / tidak berubah). Murni & sinkron.
 */
export function getInvoiceNumber(
  order: Pick<Order, "metadata" | "orderNumber">
): string {
  const inv = order.metadata?.invoiceNumber;
  return typeof inv === "string" && INVOICE_NUMBER_RE.test(inv)
    ? inv
    : order.orderNumber;
}

/** Jenis transaksi yang bisa difilter (tab jenis). */
export type PaymentOrderType = "package" | "topup" | "merchandise";

const CSV_TYPE_LABEL: Record<Order["type"], string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

function csvCell(v: string | number): string {
  return `"${String(v).replace(/"/g, "\"\"")}"`;
}

/** Satu baris untuk ekspor CSV riwayat pembayaran (pelanggan & admin). */
export interface CsvPaymentRow {
  orderNumber: string;
  /** Bila diisi, kolom "Pelanggan" ikut disertakan (tampilan admin). */
  customerName?: string;
  type: Order["type"];
  totalAmount: number;
  paymentStatus: string;
  failureReason?: string;
  createdAt: string;
}

function toCsvRow(row: CsvPaymentRow, withCustomer: boolean): string {
  const cols = [
    csvCell(row.orderNumber),
    ...(withCustomer ? [csvCell(row.customerName ?? "—")] : []),
    csvCell(CSV_TYPE_LABEL[row.type] ?? row.type),
    csvCell(paymentBadge(row.paymentStatus, row.failureReason).label),
    csvCell(row.totalAmount),
    csvCell(formatDate(row.createdAt)),
  ];
  return cols.join(",");
}

/**
 * Serialisasi baris-baris order ke CSV (tombol "Unduh CSV" riwayat
 * pembayaran pelanggan & admin). Kolom: nomor order, jenis, status (label
 * dari `paymentBadge` — alasan kegagalan ikut bila ada), nominal (angka
 * mentah, ramah spreadsheet), tanggal. Kolom **Pelanggan** otomatis masuk
 * bila salah satu baris menyertakan `customerName` (tampilan admin). Murni
 * & sinkron — BOM (`\uFEFF`) ditambahkan oleh route agar Excel membaca
 * UTF-8 dengan benar.
 */
export function paymentHistoryRowsToCsv(rows: CsvPaymentRow[]): string {
  const withCustomer = rows.some((r) => r.customerName !== undefined);
  const header = withCustomer
    ? ["Nomor Order", "Pelanggan", "Jenis", "Status", "Nominal", "Tanggal"]
    : ["Nomor Order", "Jenis", "Status", "Nominal", "Tanggal"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) lines.push(toCsvRow(r, withCustomer));
  return lines.join("\r\n") + "\r\n";
}

/**
 * Serialisasi order TERFILTER ke CSV untuk tombol "Unduh CSV" (halaman
 * riwayat pembayaran pelanggan). Delegasi ke `paymentHistoryRowsToCsv`.
 */
export function paymentHistoryToCsv(orders: Order[]): string {
  return paymentHistoryRowsToCsv(
    orders.map((o) => ({
      orderNumber: o.orderNumber,
      type: o.type,
      totalAmount: o.totalAmount,
      paymentStatus: o.paymentStatus,
      failureReason:
        typeof o.metadata?.failureReason === "string" ? o.metadata.failureReason : undefined,
      createdAt: o.createdAt,
    }))
  );
}

/**
 * Bentuk minimal order yang bisa difilter `filterPaymentOrders` — Order
 * penuh (pelanggan) ATAU baris admin (AdminPaymentRow) yang tidak membawa
 * semua kolom Order. `metadata` hanya perlu bagian yang dipakai pencarian
 * (failureReason / originalOrderNumber / previousOrderNumbers).
 */
export interface PaymentOrderLike {
  orderNumber: string;
  type: Order["type"];
  paymentStatus: string;
  createdAt: string;
  metadata?: {
    failureReason?: unknown;
    originalOrderNumber?: unknown;
    previousOrderNumbers?: unknown;
  };
}

export function filterPaymentOrders<T extends PaymentOrderLike>(
  orders: T[],
  status?: string,
  q?: string,
  type?: string
): T[] {
  let out = orders;
  if (status === "paid") {
    out = out.filter((o) => o.paymentStatus === "paid");
  } else if (status === "failed") {
    out = out.filter((o) => o.paymentStatus === "failed" || o.paymentStatus === "expired");
  }
  if (type === "package" || type === "topup" || type === "merchandise") {
    out = out.filter((o) => o.type === type);
  }
  const needle = q?.trim().toLowerCase();
  if (needle) {
    out = out.filter((o) => {
      const meta = (o.metadata ?? {}) as Record<string, unknown>;
      const prev = Array.isArray(meta.previousOrderNumbers)
        ? (meta.previousOrderNumbers as string[])
        : [];
      const orig = typeof meta.originalOrderNumber === "string" ? meta.originalOrderNumber : "";
      return (
        o.orderNumber.toLowerCase().includes(needle) ||
        orig.toLowerCase().includes(needle) ||
        prev.some((n) => n.toLowerCase().includes(needle))
      );
    });
  }
  return out;
}
