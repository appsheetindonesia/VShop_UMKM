/**
 * Kode QR verifikasi invoice — payload pembayaran (nomor invoice STABIL,
 * total, ID transaksi Midtrans, nomor order, tanggal) yang bisa dipindai
 * untuk memverifikasi bukti transaksi. QR dibuat SERVER-SIDE (paket
 * `qrcode`, murni JS) sebagai data URL PNG — tanpa dependensi client,
 * dan ikut tercetak di PDF `#invoice-print`.
 */
import QRCode from "qrcode";
import type { Order } from "./types";

/**
 * Payload QR verifikasi — JSON kompak & deterministik (kunci stabil agar
 * pemindai / alat verifikasi lain bisa parse): `inv` (nomor invoice stabil
 * `VS-INV-…`), `order` (nomor order saat ini), `total` (nominal, angka
 * mentah), `tid` (transaction_id Midtrans bila ada), `date` (YYYY-MM-DD).
 * Murni & sinkron — diuji unit.
 */
export function buildInvoiceQrPayload(input: {
  invoiceNumber: string;
  orderNumber: string;
  totalAmount: number;
  transactionId?: string;
  createdAt: string;
}): string {
  return JSON.stringify({
    v: 1,
    inv: input.invoiceNumber,
    order: input.orderNumber,
    total: input.totalAmount,
    tid: input.transactionId ?? "",
    date: input.createdAt.slice(0, 10),
  });
}

/** Ekstrak payload QR dari order penuh (untuk pemakaian halaman). */
export function buildInvoiceQrPayloadFromOrder(
  order: Order,
  opts: { invoiceNumber: string; transactionId?: string }
): string {
  return buildInvoiceQrPayload({
    invoiceNumber: opts.invoiceNumber,
    orderNumber: order.orderNumber,
    totalAmount: order.totalAmount,
    transactionId: opts.transactionId,
    createdAt: order.createdAt,
  });
}

/**
 * Data URL PNG dari payload — langsung dipakai `<img src>` di kartu invoice.
 * `errorCorrectionLevel: "M"` + margin 1 agar tetap terbaca saat dicetak
 * kecil; width default 160px (bisa di-override untuk pengujian).
 */
export async function invoiceQrDataUrl(
  payload: string,
  opts: { width?: number } = {}
): Promise<string> {
  const width = opts.width ?? 160;
  return QRCode.toDataURL(payload, {
    width,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}
