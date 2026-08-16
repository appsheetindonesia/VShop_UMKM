import type { Metadata } from "next";
import Link from "next/link";
import Badge, { paymentBadge } from "@/components/Badge";
import { requireRole } from "@/lib/auth";
import { getActiveMembership, getMyClaims, getOrdersByUser, getWallet } from "@/lib/service";
import { daysLeft, formatDateLong, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Status Member",
};

export default function StatusMemberPage() {
  const user = requireRole(["customer"]);
  const membership = getActiveMembership(user.id);
  const wallet = getWallet(user.id);
  const claims = getMyClaims(user.id);
  const orders = getOrdersByUser(user.id);
  const usedCount = claims.filter((c) => c.status === "used").length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-center">
        <span className="chip bg-brand-100 text-brand-800">⭐ STATUS MEMBER</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Status Member</h1>
      </div>

      {membership ? (
        <>
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-brand-600 to-brand-800 p-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-brand-100">Paket aktif</p>
                  <p className="text-xl font-bold">{membership.packageName}</p>
                </div>
                <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
                  {daysLeft(membership.endDate)} hari lagi
                </span>
              </div>
              <div className="mt-4 flex items-center gap-2 text-xs text-brand-100">
                <span>{formatDateLong(membership.startDate)}</span>
                <span aria-hidden="true">→</span>
                <span>{formatDateLong(membership.endDate)}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 divide-x divide-gray-100">
              <div className="p-4 text-center">
                <p className="text-lg font-extrabold text-gray-900">{formatRupiah(wallet.balance)}</p>
                <p className="text-xs text-gray-500">Total Saldo V Shop</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-lg font-extrabold text-gray-900">{usedCount}</p>
                <p className="text-xs text-gray-500">Voucher Terpakai</p>
              </div>
              <div className="p-4 text-center">
                <p className="text-lg font-extrabold text-gray-900">{claims.length}</p>
                <p className="text-xs text-gray-500">Total Voucher</p>
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <Link href="/topup" className="btn-primary flex-1">Top Up Saldo</Link>
            <Link href="/promo" className="btn-secondary flex-1">Klaim Voucher</Link>
          </div>
        </>
      ) : (
        <div className="card p-8 text-center">
          <span className="text-5xl" aria-hidden="true">⭐</span>
          <p className="mt-3 font-semibold text-gray-900">Belum ada paket aktif</p>
          <p className="mt-1 text-sm text-gray-500">Aktifkan paket untuk mengklaim voucher setiap hari.</p>
          <Link href="/paket" className="btn-primary mt-5">Pilih Paket</Link>
        </div>
      )}

      <section>
        <h2 className="text-lg font-bold text-gray-900">Riwayat Pesanan</h2>
        <div className="mt-3 space-y-3">
          {orders.map((o) => {
            const reason =
              typeof o.metadata?.failureReason === "string" ? o.metadata.failureReason : undefined;
            const status = paymentBadge(o.paymentStatus, reason);
            return (
              <div key={o.id} className="card flex items-center justify-between p-4">
                <div>
                  <p className="text-sm font-bold text-gray-900">{o.orderNumber}</p>
                  <p className="text-xs text-gray-500">
                    {o.type === "package"
                      ? "Paket langganan"
                      : o.type === "topup"
                        ? "Top up saldo"
                        : "Merchandise"}{" "}
                    · {formatDateLong(o.createdAt)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{formatRupiah(o.totalAmount)}</p>
                  <Badge color={status.color}>{status.label}</Badge>
                </div>
              </div>
            );
          })}
          {orders.length === 0 && (
            <div className="card p-6 text-center text-sm text-gray-500">Belum ada pesanan.</div>
          )}
        </div>
      </section>
    </div>
  );
}
