import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { getActiveMembership, getOrder, getWallet } from "@/lib/service";
import { formatDateLong, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pembayaran Berhasil",
};

export default function SuksesPage({ searchParams }: { searchParams?: { order?: string } }) {
  const user = getSessionUser();
  const order = searchParams?.order ? getOrder(searchParams.order) : undefined;

  if (!user || !order || order.userId !== user.id || order.paymentStatus !== "paid") {
    notFound();
  }

  const membership = getActiveMembership(user.id);
  const wallet = getWallet(user.id);

  return (
    <div className="mx-auto max-w-md">
      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-b from-emerald-500 to-emerald-600 p-8 text-center text-white">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-3xl" aria-hidden="true">
            ☑️
          </span>
          <h1 className="mt-3 text-xl font-bold">Pembayaran Anda Berhasil</h1>
          <p className="mt-1 text-sm text-emerald-50">
            No. Order: <strong>{order.orderNumber}</strong>
          </p>
        </div>

        <div className="space-y-3 p-6">
          {order.type === "package" && membership && (
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
              <p className="font-semibold">🎉 Selamat! {membership.packageName} aktif.</p>
              <p className="mt-1">
                Anda sekarang dapat mengklaim voucher di V Shop.
              </p>
              <p className="mt-2 text-xs text-brand-700">
                Masa aktif: {formatDateLong(membership.startDate)} — {formatDateLong(membership.endDate)}
              </p>
            </div>
          )}

          {order.type === "topup" && (
            <div className="rounded-xl bg-brand-50 p-4 text-sm text-brand-900">
              <p className="font-semibold">💰 Saldo V Shop bertambah!</p>
              <p className="mt-1 text-xs text-brand-700">
                Saldo saat ini: <strong>{formatRupiah(wallet.balance)}</strong>
              </p>
            </div>
          )}

          {order.type === "merchandise" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-gray-700">Pesanan Anda:</p>
              {order.items.map((item) => (
                <div key={item.name} className="flex justify-between text-sm">
                  <span className="text-gray-600">
                    {item.name} × {item.quantity}
                  </span>
                  <span className="font-medium">{formatRupiah(item.unitPrice * item.quantity)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between border-t border-gray-100 pt-3">
            <span className="text-sm text-gray-500">Metode pembayaran</span>
            <span className="text-sm font-semibold capitalize text-gray-700">
              {String(order.paymentMethod ?? "-").replace(/-/g, " ")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-gray-500">Total dibayar</span>
            <span className="font-extrabold text-accent-600">{formatRupiah(order.totalAmount)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {order.type === "package" ? (
          <>
            <Link href="/voucher-saya" className="btn-primary">Lihat Voucher</Link>
            <Link href="/beranda" className="btn-secondary">Ke Beranda</Link>
          </>
        ) : (
          <>
            <Link href="/status-member" className="btn-primary">Status Member</Link>
            <Link href="/beranda" className="btn-secondary">Ke Beranda</Link>
          </>
        )}
      </div>
    </div>
  );
}
