import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PayForm from "@/components/PayForm";
import { getSessionUser } from "@/lib/auth";
import { getOrder } from "@/lib/service";
import { formatRupiah } from "@/lib/format";
import {
  isMockSnapToken,
  midtransClientKey,
  snapScriptUrl,
  snapVtwebUrl,
} from "@/lib/midtrans";

export const metadata: Metadata = {
  title: "Pembayaran",
};

export default function BayarPage({ params }: { params: { orderId: string } }) {
  const user = getSessionUser();
  const order = getOrder(params.orderId);

  if (!order) notFound();
  if (!user || order.userId !== user.id) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <h1 className="text-lg font-bold">Order tidak ditemukan</h1>
        <Link href="/beranda" className="btn-primary mt-4 w-full">Ke Beranda</Link>
      </div>
    );
  }

  const mock = isMockSnapToken(order.snapToken);
  // Mode Midtrans asli + client key tersedia → Snap EMBED (form pembayaran
  // inline di halaman, bukan popup). Tanpa client key → fallback redirect
  // ke halaman Snap VT-web.
  const clientKey = midtransClientKey();
  const useSnap = !mock && Boolean(clientKey) && Boolean(order.snapToken);
  // Fallback redirect VT-web (dipakai bila Snap.js gagal dimuat / tanpa client key).
  const snapRedirect =
    typeof order.metadata?.snapRedirectUrl === "string"
      ? order.metadata.snapRedirectUrl
      : !mock && order.snapToken
        ? snapVtwebUrl(order.snapToken)
        : undefined;

  if (order.paymentStatus === "paid") {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <span className="text-5xl" aria-hidden="true">✅</span>
        <h1 className="mt-3 text-lg font-bold text-gray-900">Pembayaran sudah selesai</h1>
        <Link href={`/sukses?order=${order.id}`} className="btn-primary mt-5 w-full">
          Lihat Detail Pesanan
        </Link>
      </div>
    );
  }

  // Order yang gagal / kadaluarsa → layar Pembayaran Gagal (Coba Lagi /
  // Kembali ke Beranda). "Coba Lagi" me-reset order lewat API retry dulu,
  // jadi tidak ada loop saat kembali ke halaman ini.
  if (order.paymentStatus === "failed" || order.paymentStatus === "expired") {
    redirect(`/bayar/gagal?order=${order.id}&reason=${order.paymentStatus}`);
  }

  return (
    <div className="mx-auto max-w-md">
      <div className="text-center">
        <span className="chip bg-brand-100 text-brand-800">MIDTRANS SNAP</span>
        <h1 className="mt-2 text-xl font-bold text-gray-900">Pilih Metode Pembayaran</h1>
        <p className="mt-1 text-xs text-gray-500">
          {mock
            ? "Mode demo — pembayaran disimulasikan (tidak ada uang asli)."
            : "Pembayaran diproses oleh Midtrans (sandbox) secara aman."}
        </p>
      </div>

      <div className="card mt-5 space-y-2 p-5">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">No. Order</span>
          <span className="text-sm font-bold text-gray-900">{order.orderNumber}</span>
        </div>
        {order.items.map((item) => (
          <div key={item.name} className="flex items-center justify-between">
            <span className="text-sm text-gray-600">
              {item.name} × {item.quantity}
            </span>
            <span className="text-sm font-medium text-gray-700">
              {formatRupiah(item.unitPrice * item.quantity)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="font-semibold text-gray-700">Total Tagihan</span>
          <span className="text-xl font-extrabold text-accent-600">{formatRupiah(order.totalAmount)}</span>
        </div>
      </div>

      <div className="card mt-4 p-5">
        <PayForm
          orderId={order.id}
          total={order.totalAmount}
          mock={mock}
          embed={useSnap}
          redirectUrl={snapRedirect}
          snapToken={useSnap ? order.snapToken : undefined}
          snapScriptUrl={useSnap ? snapScriptUrl() : undefined}
          clientKey={useSnap ? clientKey : undefined}
        />
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        🔒 Transaksi aman · Didukung oleh Midtrans
      </p>
    </div>
  );
}
