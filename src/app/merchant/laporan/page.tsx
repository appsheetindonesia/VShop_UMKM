import type { Metadata } from "next";
import Badge, { claimBadge } from "@/components/Badge";
import { requireRole } from "@/lib/auth";
import {
  getMerchantByUserId,
  getMerchantClaims,
  getMerchantPromos,
  getMerchantStats,
  getMerchantVouchers,
} from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Laporan",
};

export default function LaporanPage() {
  const user = requireRole(["merchant", "admin"]);
  const merchant = getMerchantByUserId(user.id);
  if (!merchant) return null;

  const stats = getMerchantStats(merchant.id);
  const promos = getMerchantPromos(merchant.id);
  const vouchers = getMerchantVouchers(merchant.id);
  const claims = getMerchantClaims(merchant.id);

  const performa = promos.map((p) => {
    const vch = vouchers.filter((v) => v.promoId === p.id);
    const ids = new Set(vch.map((v) => v.id));
    const claimed = claims.filter((c) => ids.has(c.voucherId)).length;
    return {
      promo: p,
      totalVoucher: vch.length,
      kuota: vch.reduce((s, v) => s + v.kuota, 0),
      claimed,
      claimedValue: claims
        .filter((c) => ids.has(c.voucherId))
        .reduce((s, c) => s + (vouchers.find((v) => v.id === c.voucherId)?.nilai ?? 0), 0),
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <span className="chip bg-brand-100 text-brand-800">📈 LAPORAN</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Laporan {merchant.namaUsaha}</h1>
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Ringkasan</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500">Total Voucher</p>
            <p className="text-2xl font-extrabold text-gray-900">{stats.totalVouchers}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Voucher Diklaim</p>
            <p className="text-2xl font-extrabold text-brand-600">{stats.claimed}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Voucher Terpakai</p>
            <p className="text-2xl font-extrabold text-emerald-600">{stats.used}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500">Nilai Diklaim</p>
            <p className="text-2xl font-extrabold text-accent-600">{formatRupiah(stats.claimedValue)}</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Performa Promo</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Promo</th>
                <th className="px-4 py-3">Jenis</th>
                <th className="px-4 py-3">Kuota</th>
                <th className="px-4 py-3">Diklaim</th>
                <th className="px-4 py-3">Nilai Klaim</th>
              </tr>
            </thead>
            <tbody>
              {performa.map((row) => (
                <tr key={row.promo.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.promo.name}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{row.promo.jenisVoucher}</td>
                  <td className="px-4 py-3 text-gray-600">{row.kuota}</td>
                  <td className="px-4 py-3 font-semibold text-brand-700">{row.claimed}</td>
                  <td className="px-4 py-3 text-gray-700">{formatRupiah(row.claimedValue)}</td>
                </tr>
              ))}
              {performa.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Belum ada promo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Voucher Klaim</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Pelanggan</th>
                <th className="px-4 py-3">Kode</th>
                <th className="px-4 py-3">Konfirmasi</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.voucher?.name ?? "-"}</td>
                  <td className="px-4 py-3 text-gray-600">{c.user?.name ?? "-"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-700">{c.kode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-accent-600">{c.kodeKonfirmasi}</td>
                  <td className="px-4 py-3">
                    <ClaimStatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-gray-500">
                    Belum ada voucher yang diklaim.
                  </td>
                </tr>
              )}          </tbody>
        </table>
      </div>
    </section>
    </div>
  );
}

/** Badge status klaim — label Bahasa Indonesia, konsisten dgn tampilan klaim lain. */
function ClaimStatusBadge({ status }: { status: string }) {
  const badge = claimBadge(status);
  return <Badge color={badge.color}>{badge.label}</Badge>;
}
