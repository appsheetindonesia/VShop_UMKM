import type { Metadata } from "next";
import Badge, { statusColor } from "@/components/Badge";
import ArchiveButton from "@/components/merchant/ArchiveButton";
import { requireRole } from "@/lib/auth";
import { getMerchantByUserId, getMerchantPromos, getMerchantVouchers } from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Pengelolaan",
};

export default function PengelolaanPage() {
  const user = requireRole(["merchant", "admin"]);
  const merchant = getMerchantByUserId(user.id);
  if (!merchant) return null;

  const promos = getMerchantPromos(merchant.id);
  const vouchers = getMerchantVouchers(merchant.id);

  return (
    <div className="space-y-8">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🗂️ PENGELOLAAN</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Pengelolaan Promo &amp; Voucher</h1>
        <p className="mt-1 text-sm text-gray-500">
          Kelola status promo dan voucher Anda. Voucher yang diarsipkan tidak bisa diklaim pelanggan.
        </p>
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Promo ({promos.length})</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Nama Promo</th>
                <th className="px-4 py-3">Jenis</th>
                <th className="px-4 py-3">Periode</th>
                <th className="px-4 py-3">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {promos.map((p) => (
                <tr key={p.id} className="border-b border-gray-100">
                  <td className="px-4 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{p.jenisVoucher}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {new Date(p.startDate).toLocaleDateString("id-ID")} —{" "}
                    {new Date(p.endDate).toLocaleDateString("id-ID")}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{p.jumlah}</td>
                </tr>
              ))}
              {promos.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-500">
                    Belum ada promo.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Voucher ({vouchers.length})</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Voucher</th>
                <th className="px-4 py-3">Nilai</th>
                <th className="px-4 py-3">Min. Transaksi</th>
                <th className="px-4 py-3">Kuota</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.map((v) => (
                <tr key={v.id} className="border-b border-gray-100">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{v.name}</p>
                    <p className="text-xs text-gray-400">berlaku s/d {new Date(v.masaBerlaku).toLocaleDateString("id-ID")}</p>
                  </td>
                  <td className="px-4 py-3 font-semibold text-accent-600">{formatRupiah(v.nilai)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatRupiah(v.minTransaksi)}</td>
                  <td className="px-4 py-3 text-gray-600">{v.kuota}</td>
                  <td className="px-4 py-3">
                    <Badge color={statusColor(v.status)}>
                      {v.status === "active" ? "Aktif" : "Diarsipkan"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <ArchiveButton voucherId={v.id} archived={v.status === "archived"} />
                  </td>
                </tr>
              ))}
              {vouchers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Belum ada voucher.{" "}
                    <a href="/merchant/promo/buat" className="font-semibold text-brand-600">
                      Buat sekarang
                    </a>
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
