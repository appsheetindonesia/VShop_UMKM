import { formatRupiah } from "@/lib/format";
import type { Voucher } from "@/lib/types";
import ClaimButton from "@/components/ClaimButton";

export default function VoucherCard({
  voucher,
  canClaim,
  claimed = false,
}: {
  voucher: Voucher;
  canClaim: boolean;
  claimed?: boolean;
}) {
  return (
    <article className="card overflow-hidden">
      <div className="flex items-stretch">
        <div className="flex w-16 flex-col items-center justify-center gap-1 bg-gradient-to-b from-brand-600 to-brand-700 p-2 text-center text-white">
          <span className="text-2xl" aria-hidden="true">🎟️</span>
          <span className="text-[10px] font-bold uppercase leading-tight">{voucher.jenisVoucher}</span>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-bold text-gray-900">{voucher.name}</h3>
            <span className="chip bg-accent-100 text-accent-800">{formatRupiah(voucher.nilai)}</span>
          </div>
          <p className="mt-1 text-xs text-gray-500">🏪 {voucher.merchantName}</p>
          <p className="mt-1 text-xs text-gray-500">
            Min. transaksi {formatRupiah(voucher.minTransaksi)} · Maks {voucher.maksPenggunaan}x
          </p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-gray-400">Kuota tersisa {Math.max(0, voucher.kuota)}</p>
            {claimed ? (
              <span className="chip bg-emerald-100 text-emerald-800">✓ Sudah diklaim</span>
            ) : canClaim ? (
              <ClaimButton voucherId={voucher.id} label="Klaim" />
            ) : (
              <span className="text-xs font-medium text-gray-400">Login untuk klaim</span>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
