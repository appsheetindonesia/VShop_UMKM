import type { Metadata } from "next";
import Link from "next/link";
import Badge, { statusColor } from "@/components/Badge";
import { requireRole } from "@/lib/auth";
import { getMyClaims } from "@/lib/service";
import { formatDateLong, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Voucher Saya",
};

export default function VoucherSayaPage() {
  const user = requireRole(["customer"]);
  const claims = getMyClaims(user.id);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="text-center">
        <span className="chip bg-brand-100 text-brand-800">🎟️ VOUCHER SAYA</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Voucher Saya</h1>
        <p className="mt-1 text-sm text-gray-500">
          {claims.length} voucher · tunjukkan kode saat transaksi
        </p>
      </div>

      <div className="mt-6 space-y-4">
        {claims.map((claim) => (
          <div key={claim.id} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-dashed border-gray-200 bg-gray-50/60 px-5 py-3">
              <div>
                <p className="font-semibold text-gray-900">{claim.voucher?.name ?? "Voucher"}</p>
                {claim.voucher && (
                  <p className="text-xs text-gray-400">
                    Berlaku s.d {formatDateLong(claim.voucher.masaBerlaku)}
                  </p>
                )}
              </div>
              <Badge color={statusColor(claim.status)}>
                {claim.status === "active"
                  ? "Aktif"
                  : claim.status === "used"
                    ? "Terpakai"
                    : "Hangus"}
              </Badge>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs text-gray-500">Kode Voucher</p>
                <p className="mt-0.5 font-mono text-lg font-extrabold tracking-wider text-brand-700">
                  {claim.kode}
                </p>
                <p className="text-xs text-gray-400">ditunjukkan ke kasir merchant</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Kode Konfirmasi</p>
                <p className="mt-0.5 font-mono text-lg font-extrabold tracking-widest text-accent-600">
                  {claim.kodeKonfirmasi}
                </p>
                <p className="text-xs text-gray-400">untuk verifikasi saat pemakaian</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Nilai</p>
                <p className="text-sm font-bold text-gray-900">
                  {formatRupiah(claim.voucher?.nilai ?? 0)}
                  <span className="ml-1 text-xs font-normal text-gray-400">
                    (min. {formatRupiah(claim.voucher?.minTransaksi ?? 0)})
                  </span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Detail</p>
                <p className="text-sm text-gray-700">
                  🏪 {claim.voucher?.merchantName ?? "-"} · klaim {formatDateLong(claim.claimedAt)}
                </p>
                {claim.usedAt && (
                  <p className="text-xs text-gray-400">dipakai {formatDateLong(claim.usedAt)}</p>
                )}
              </div>
            </div>
            {claim.status === "active" && (
              <div className="border-t border-gray-100 bg-brand-50 px-5 py-3 text-xs text-brand-800">
                Tunjukkan kode <strong className="font-mono">{claim.kode}</strong> + konfirmasi{" "}
                <strong className="font-mono">{claim.kodeKonfirmasi}</strong> ke kasir merchant saat transaksi.
              </div>
            )}
          </div>
        ))}

        {claims.length === 0 && (
          <div className="card p-10 text-center">
            <span className="text-5xl" aria-hidden="true">🎟️</span>
            <p className="mt-3 text-sm text-gray-500">
              Kamu belum punya voucher. Yuk klaim dari halaman Promo!
            </p>
            <Link href="/promo" className="btn-primary mt-5">
              Lihat Promo
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
