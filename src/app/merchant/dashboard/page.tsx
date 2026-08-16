import type { Metadata } from "next";
import Link from "next/link";
import Badge, { statusColor } from "@/components/Badge";
import { requireRole } from "@/lib/auth";
import { getMerchantByUserId, getMerchantClaims, getMerchantStats } from "@/lib/service";
import { formatRupiah, merchantCode } from "@/lib/format";

export const metadata: Metadata = {
  title: "Dashboard Merchant",
};

export default function MerchantDashboardPage() {
  const user = requireRole(["merchant", "admin"]);
  const merchant = getMerchantByUserId(user.id);
  if (!merchant) {
    return <div className="card p-8 text-center text-sm text-gray-500">Data merchant tidak ditemukan.</div>;
  }

  const stats = getMerchantStats(merchant.id);
  const claims = getMerchantClaims(merchant.id).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-accent-500 p-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-accent-100">Dashboard</p>
            <h1 className="text-xl font-extrabold">{merchant.namaUsaha}</h1>
            <p className="mt-1 text-sm text-accent-50">
              {merchant.kategoriUsaha} · <span className="font-mono">{merchantCode(merchant.id)}</span>
            </p>
          </div>
          <span className="text-5xl" aria-hidden="true">🏪</span>
        </div>
      </div>

      {/* Menu tiles sesuai artifact */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MenuTile href="/merchant/promo/buat" icon="✚" bg="bg-accent-50" color="text-accent-600" label="Buat Promo" />
        <MenuTile href="/merchant/pengelolaan" icon="🎟️" bg="bg-brand-100" color="text-brand-600" label="Voucher" />
        <MenuTile href="/merchant/voucher/getken" icon="✔" bg="bg-emerald-50" color="text-emerald-700" label="Redeem" />
        <MenuTile href="/merchant/laporan" icon="📊" bg="bg-gray-100" color="text-gray-800" label="Laporan" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Promo Aktif" value={String(stats.promos)} icon="🔥" />
        <StatCard label="Total Voucher" value={String(stats.totalVouchers)} icon="🎟️" />
        <StatCard label="Voucher Diklaim" value={String(stats.claimed)} icon="🤝" />
        <StatCard label="Voucher Terpakai" value={String(stats.used)} icon="✅" />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Nilai Voucher Terklaim</h2>
          <span className="text-2xl font-extrabold text-accent-600">{formatRupiah(stats.claimedValue)}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Total nilai voucher yang diklaim pelanggan dari usaha Anda.
        </p>
      </div>


      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Klaim Terbaru</h2>
          <Link href="/merchant/laporan" className="text-sm font-semibold text-brand-600 hover:underline">
            Lihat laporan
          </Link>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-2">Voucher</th>
                <th className="px-3 py-2">Pelanggan</th>
                <th className="px-3 py-2">Kode</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="px-3 py-2.5 font-medium text-gray-900">{c.voucher?.name ?? "-"}</td>
                  <td className="px-3 py-2.5 text-gray-600">{c.user?.name ?? "-"}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-brand-700">{c.kode}</td>
                  <td className="px-3 py-2.5">
                    <Badge color={statusColor(c.status)}>{c.status}</Badge>
                  </td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                    Belum ada voucher yang diklaim.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card p-4">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <p className="mt-2 text-2xl font-extrabold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function MenuTile({
  href,
  icon,
  bg,
  color,
  label,
}: {
  href: string;
  icon: string;
  bg: string;
  color: string;
  label: string;
}) {
  return (
    <Link href={href} className="card flex flex-col items-center gap-1.5 p-4 text-center transition hover:shadow-md">
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold ${bg} ${color}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="text-xs font-bold text-gray-800">{label}</span>
    </Link>
  );
}
