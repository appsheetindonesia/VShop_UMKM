import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Badge, { paymentBadge } from "@/components/Badge";
import AutoPrintInvoice from "@/components/AutoPrintInvoice";
import InvoicePrintButton from "@/components/InvoicePrintButton";
import PaymentTimeline from "@/components/PaymentTimeline";
import {
  buildOrderNumberHistory,
  buildPaymentTimeline,
  getInvoiceNumber,
} from "@/lib/payment-history";
import {
  buildInvoiceQrPayloadFromOrder,
  invoiceQrDataUrl,
} from "@/lib/invoice-qr";
import { getSessionUser } from "@/lib/auth";
import { getMerchantByUserId, getOrder } from "@/lib/service";
import {
  buildWaSupportLink,
  getSupportAppUrl,
  getSupportPhone,
} from "@/lib/wa-support";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Detail Transaksi",
};

const TYPE_LABEL: Record<string, string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

/**
 * Detail transaksi (bukti/invoice + timeline status pembayaran).
 * Akses: pemilik order ATAU admin. Seluruh isi invoice berada di
 * `#invoice-print` — dicetak / disimpan sebagai PDF via window.print().
 */
export default async function TransaksiDetailPage({
  params,
  searchParams,
}: {
  params: { orderId: string };
  searchParams?: { print?: string };
}) {
  const user = getSessionUser();
  const order = getOrder(params.orderId);
  if (!user || !order) notFound();
  // Merchant pemilik order (order merchandise via `metadata.merchantId`) juga
  // boleh membuka detail — notifikasi "pesanan baru" merchant menautkan ke
  // halaman ini agar penjual langsung melihat pesanan masuk.
  const merchant =
    user.role === "merchant" ? getMerchantByUserId(user.id) : undefined;
  const isMerchantOwner =
    merchant !== undefined && order.metadata?.merchantId === merchant.id;
  if (order.userId !== user.id && user.role !== "admin" && !isMerchantOwner) {
    notFound();
  }

  const invoiceNumber = getInvoiceNumber(order);
  const timeline = buildPaymentTimeline(order);
  const badge = paymentBadge(
    order.paymentStatus,
    typeof order.metadata.failureReason === "string"
      ? order.metadata.failureReason
      : undefined
  );
  const numberHistory = buildOrderNumberHistory(order);
  const snapTxn = timeline.find((t) => t.transactionId);
  const reason =
    typeof order.metadata.failureReason === "string"
      ? order.metadata.failureReason
      : undefined;

  // Tombol "Lacak Pesanan": chat WhatsApp ke nomor support (Configurasi →
  // WhatsApp Gateway) dengan konteks order — hanya saat status gagal/
  // kadaluarsa. Null bila nomor support belum diatur → tombol disembunyikan.
  const failedOrExpired =
    order.paymentStatus === "failed" || order.paymentStatus === "expired";
  const supportLink = buildWaSupportLink(getSupportPhone(), {
    orderNumber: order.orderNumber,
    invoiceNumber,
    orderUrl: `${getSupportAppUrl()}/transaksi/${order.id}`,
  });

  // QR verifikasi: payload berisi nomor invoice STABIL, total, dan ID
  // transaksi Midtrans (bila sudah ada) — dibuat server-side sebagai data
  // URL PNG agar ikut tercetak di PDF invoice.
  const qrPayload = buildInvoiceQrPayloadFromOrder(order, {
    invoiceNumber,
    transactionId: snapTxn?.transactionId,
  });
  const qrDataUrl = await invoiceQrDataUrl(qrPayload);

  return (
    <div className="mx-auto max-w-md">
      {/* Link "Invoice PDF" (?print=1) dari notifikasi → buka dialog cetak. */}
      {searchParams?.print === "1" && <AutoPrintInvoice />}

      {/* ---------- Kontrol layar (tidak ikut cetak) ---------- */}
      <div className="mb-4 flex items-center justify-between gap-2 print:hidden">
        <Link href="/akun" className="text-sm text-gray-500 hover:text-gray-800">
          ← Riwayat Pembayaran
        </Link>
        <InvoicePrintButton className="btn-secondary !py-2 text-sm" />
      </div>

      {/* ---------- Invoice / bukti (satu-satunya area yang dicetak) ---------- */}
      <div id="invoice-print" className="space-y-4">
        <div className="card overflow-hidden p-0">
          <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
            <div>
              <p className="text-lg font-extrabold text-gray-900">V SHOP</p>
              <p className="text-xs text-gray-500">Bukti Transaksi / Invoice</p>
            </div>
            <div className="text-right">
              <Badge color={badge.color}>{badge.label}</Badge>
              {/* Nomor invoice STABIL (VS-INV-…) — tidak berubah saat order
                  di-retry, berbeda dari nomor order di bawahnya. */}
              <p className="mt-1 font-mono text-xs font-semibold text-brand-700">
                {invoiceNumber}
              </p>
              <p className="font-mono text-[10px] text-gray-400">
                No. Order: {order.orderNumber}
              </p>
            </div>
          </div>

          <div className="space-y-3 p-5 text-sm">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <Info label="Tanggal dibuat" value={formatDateTime(order.createdAt)} />
              <Info
                label="Status pesanan"
                value={String(order.status).replace(/^\w/, (c) => c.toUpperCase())}
              />
              <Info
                label="Jenis transaksi"
                value={TYPE_LABEL[order.type] ?? order.type}
              />
              <Info
                label="Metode pembayaran"
                value={order.paymentMethod
                  ? String(order.paymentMethod).replace(/-/g, " ")
                  : "-"}
              />
              {order.paidAt && (
                <Info label="Dibayar pada" value={formatDateTime(order.paidAt)} />
              )}
              {snapTxn?.transactionId && (
                <Info label="ID transaksi" value={`#${snapTxn.transactionId.slice(0, 18)}`} mono />
              )}
            </div>

            {reason && (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                Alasan: {reason}
              </div>
            )}

            {/* Item */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Rincian Item
              </p>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                {order.items.length === 0 && (
                  <p className="px-3 py-2 text-xs text-gray-500">Tanpa item.</p>
                )}
                {order.items.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-gray-700">
                      {item.name}
                      <span className="text-gray-400"> × {item.quantity}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-gray-900">
                      {formatRupiah(item.unitPrice * item.quantity)}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm font-bold text-gray-900">Total</span>
                  <span className="text-sm font-extrabold text-accent-600">
                    {formatRupiah(order.totalAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Alamat pengiriman */}
            {order.shippingAddress && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Alamat Pengiriman
                </p>
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                  <p className="font-semibold">{order.shippingAddress.nama}</p>
                  <p className="text-gray-500">{order.shippingAddress.phone}</p>
                  <p className="mt-0.5">{order.shippingAddress.alamat}</p>
                  <p className="text-gray-500">
                    {order.shippingAddress.kota} {order.shippingAddress.kodePos}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* QR verifikasi — payload: nomor invoice, total, ID transaksi */}
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 px-5 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrDataUrl}
              alt={`Kode QR verifikasi transaksi ${invoiceNumber}`}
              width={160}
              height={160}
              className="rounded-lg border border-gray-200 p-1"
            />
            <p className="text-center text-[11px] text-gray-500">
              Pindai kode QR untuk memverifikasi bukti transaksi ini
            </p>
            <p className="max-w-full break-all rounded bg-gray-50 px-2 py-1 font-mono text-[9px] leading-relaxed text-gray-400">
              {qrPayload}
            </p>
          </div>

          <p className="border-t border-gray-100 px-5 py-3 text-center text-[11px] text-gray-400">
            Terima kasih telah berbelanja di V SHOP · {formatDate(order.createdAt)}
          </p>
        </div>

        {/* ---------- Timeline status pembayaran ---------- */}
        <div className="card p-5">
          <p className="mb-3 text-sm font-bold text-gray-900">📜 Timeline Status Pembayaran</p>
          <PaymentTimeline timeline={timeline} />

          {numberHistory.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                Riwayat Nomor Order
              </p>
              {numberHistory.map((t, i) => (
                <p key={i} className="text-[11px] text-gray-500">
                  Nomor lama:{" "}
                  <span className="font-mono text-gray-700">{t.from}</span>
                  {" → "}
                  <span className="font-mono text-gray-700">{t.to}</span>
                </p>
              ))}
              <p className="mt-1 text-[11px] text-gray-400">
                Nomor order diganti saat pembayaran disiapkan ulang (Coba Lagi)
                agar order_id Midtrans tidak bentrok dengan transaksi lama.
              </p>
            </div>
          )}
        </div>

        {/* ---------- Aksi layar (tidak ikut cetak) ---------- */}
        <div className="space-y-3 print:hidden">
          {order.paymentStatus === "paid" && (
            <Link href={`/sukses?order=${order.id}`} className="btn-secondary w-full">
              Lihat Halaman Sukses
            </Link>
          )}
          {failedOrExpired && (
            <Link href={`/bayar/gagal?order=${order.id}`} className="btn-secondary w-full">
              Halaman Pembayaran Gagal
            </Link>
          )}
          {failedOrExpired && supportLink && (
            <a
              href={supportLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-accent w-full"
            >
              💬 Lacak Pesanan (WhatsApp Support)
            </a>
          )}
          <InvoicePrintButton />
          <Link href="/akun" className="btn-secondary w-full">
            Kembali ke Riwayat
          </Link>
        </div>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`text-xs font-semibold text-gray-800 ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  );
}
