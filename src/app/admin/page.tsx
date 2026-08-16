import type { Metadata } from "next";
import Link from "next/link";
import { getAdminStats } from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Dashboard Admin",
};

export default function AdminDashboardPage() {
  const stats = getAdminStats();

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🛡️ ADMIN</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Dashboard Admin</h1>
        <p className="mt-1 text-sm text-gray-500">Ringkasan aktivitas platform V Shop</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pengguna Total" value={String(stats.totalUsers)} icon="👥" />
        <StatCard label="Pelanggan" value={String(stats.totalCustomers)} icon="🛍️" />
        <StatCard label="Merchant" value={String(stats.totalMerchants)} icon="🏪" />
        <StatCard label="Pending Review" value={String(stats.pendingMerchants)} icon="⏳" />
        <StatCard label="Membership Aktif" value={String(stats.activeMemberships)} icon="⭐" />
        <StatCard label="Voucher Diklaim" value={String(stats.claimedVouchers)} icon="🎟️" />
        <StatCard label="Pesanan" value={String(stats.totalOrders)} icon="🧾" />
        <StatCard label="Pendapatan" value={formatRupiah(stats.revenue)} icon="💰" />
      </div>

      {stats.pendingMerchants > 0 && (
        <Link
          href="/admin/merchants"
          className="flex items-center gap-3 rounded-2xl border-2 border-accent-200 bg-accent-50 p-4 transition hover:border-accent-400"
        >
          <span className="text-3xl" aria-hidden="true">⏳</span>
          <span className="flex-1">
            <span className="block font-bold text-accent-800">
              {stats.pendingMerchants} pendaftaran merchant menunggu review
            </span>
            <span className="block text-sm text-accent-700">Klik untuk meninjau →</span>
          </span>
        </Link>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card p-4">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <p className="mt-2 text-xl font-extrabold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
