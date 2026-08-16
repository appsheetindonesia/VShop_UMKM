import type { Metadata } from "next";
import VoucherCard from "@/components/VoucherCard";
import { getSessionUser, isGuest } from "@/lib/auth";
import { getMyClaims, listActivePromos, listActiveVouchers } from "@/lib/service";
import { formatDateLong } from "@/lib/format";

export const metadata: Metadata = {
  title: "Promo",
};

export default function PromoPage() {
  const user = getSessionUser();
  const guest = isGuest();
  const promos = listActivePromos();
  const vouchers = listActiveVouchers();
  const claimedIds = user
    ? new Set(getMyClaims(user.id).filter((c) => c.status === "active").map((c) => c.voucherId))
    : new Set<string>();
  const canClaim = !!user && user.role === "customer";

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div className="text-center">
        <span className="chip bg-accent-100 text-accent-800">🔥 PROMO</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Promo &amp; Voucher</h1>
        <p className="mt-1 text-sm text-gray-500">
          {guest
            ? "Anda melihat sebagai tamu. Masuk untuk mengklaim voucher."
            : "Klaim voucher sebelum kuota habis!"}
        </p>
      </div>

      {promos.map((promo) => {
        const promoVouchers = vouchers.filter((v) => v.promoId === promo.id);
        if (promoVouchers.length === 0) return null;
        return (
          <section key={promo.id}>
            <div className="card flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-2xl" aria-hidden="true">
                  🔥
                </span>
                <div>
                  <h2 className="font-bold text-gray-900">{promo.name}</h2>
                  <p className="text-xs text-gray-500">
                    🏪 {promo.merchantName} · sampai {formatDateLong(promo.endDate)}
                  </p>
                </div>
              </div>
              <span className="chip bg-brand-100 text-brand-800 capitalize">{promo.jenisVoucher}</span>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {promoVouchers.map((v) => (
                <VoucherCard key={v.id} voucher={v} canClaim={canClaim} claimed={claimedIds.has(v.id)} />
              ))}
            </div>
          </section>
        );
      })}

      {promos.length === 0 && (
        <div className="card p-10 text-center text-sm text-gray-500">
          Belum ada promo aktif. Cek kembali nanti!
        </div>
      )}
    </div>
  );
}
