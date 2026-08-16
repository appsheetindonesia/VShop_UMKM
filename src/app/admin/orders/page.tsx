import type { Metadata } from "next";
import Badge, { statusColor } from "@/components/Badge";
import { getDB } from "@/lib/db";
import { formatDateLong, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pesanan",
};

export default function AdminOrdersPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const db = getDB();
  const status = searchParams?.status;
  const orders = db.orders
    .filter((o) => (status ? o.paymentStatus === status : true))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const statuses = ["pending", "paid", "failed", "expired"];

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🧾 PESANAN</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Pesanan</h1>
        <p className="mt-1 text-sm text-gray-500">Semua transaksi di platform V Shop.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/admin/orders"
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            !status ? "bg-brand-600 text-white" : "border border-gray-200 bg-white text-gray-600"
          }`}
        >
          Semua
        </a>
        {statuses.map((s) => (
          <a
            key={s}
            href={`/admin/orders?status=${s}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize ${
              status === s ? "bg-brand-600 text-white" : "border border-gray-200 bg-white text-gray-600"
            }`}
          >
            {s}
          </a>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">No. Order</th>
              <th className="px-4 py-3">Pelanggan</th>
              <th className="px-4 py-3">Tipe</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Pembayaran</th>
              <th className="px-4 py-3">Tanggal</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const customer = db.users.find((u) => u.id === o.userId);
              return (
                <tr key={o.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-700">{o.orderNumber}</td>
                  <td className="px-4 py-3 text-gray-700">{customer?.name ?? "-"}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">
                    {o.type === "package" ? "Paket" : o.type === "topup" ? "Top Up" : "Merchandise"}
                  </td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{formatRupiah(o.totalAmount)}</td>
                  <td className="px-4 py-3">
                    <Badge color={statusColor(o.paymentStatus)}>{o.paymentStatus}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDateLong(o.createdAt)}</td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Tidak ada pesanan dengan status ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
