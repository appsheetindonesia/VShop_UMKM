import type { Metadata } from "next";
import Link from "next/link";
import VoucherCard from "@/components/VoucherCard";
import MerchCard from "@/components/MerchCard";
import { getSessionUser, isGuest } from "@/lib/auth";
import {
  getActiveMembership,
  getMyClaims,
  getWallet,
  listActivePromos,
  listActiveVouchers,
  listMerchandise,
} from "@/lib/service";
import { daysLeft, formatDateLong, formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Beranda",
};

export default function BerandaPage() {
  const user = getSessionUser();
  const guest = isGuest();
  const promos = listActivePromos();
  const vouchers = listActiveVouchers();
  const merchandise = listMerchandise("active").slice(0, 8);
  const membership = user ? getActiveMembership(user.id) : null;
  const wallet = user ? getWallet(user.id) : null;
  const claimedIds = user
    ? new Set(getMyClaims(user.id).filter((c) => c.status === "active").map((c) => c.voucherId))
    : new Set<string>();

  const greeting = user
    ? `Halo, ${user.name.split(" ")[0]}! 👋`
    : guest
      ? "Halo, Tamu! 👋"
      : "Halo! 👋";

  return (
    <div className="space-y-10">
      {/* Sapaan + status member */}
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{greeting}</h1>
            <p className="mt-1 text-sm text-brand-100">
              {membership
                ? `Paket ${membership.packageName} aktif · sisa ${daysLeft(membership.endDate)} hari`
                : user
                  ? "Aktifkan paket untuk mulai mengklaim voucher"
                  : "Jelajahi promo & voucher dari merchant lokal"}
            </p>
          </div>
          <span className="text-4xl" aria-hidden="true">🛍️</span>
        </div>

        {membership && wallet ? (
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/15 px-2 py-3 backdrop-blur">
              <p className="text-[10px] font-medium text-brand-100">Saldo V Shop</p>
              <p className="text-sm font-bold">{formatRupiah(wallet.balance)}</p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-3 backdrop-blur">
              <p className="text-[10px] font-medium text-brand-100">Masa Aktif</p>
              <p className="text-sm font-bold">{formatDateLong(membership.endDate)}</p>
            </div>
            <div className="rounded-xl bg-white/15 px-2 py-3 backdrop-blur">
              <p className="text-[10px] font-medium text-brand-100">Sisa Akun</p>
              <p className="text-sm font-bold">{daysLeft(membership.endDate)} hari</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {user ? (
              <Link href="/paket" className="rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent-600">
                Pilih Paket Sekarang
              </Link>
            ) : (
              <Link href="/masuk" className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-brand-700 transition hover:bg-brand-50">
                Masuk / Daftar
              </Link>
            )}
            <Link href="/promo" className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25">
              Lihat Promo
            </Link>
          </div>
        )}
      </section>

      {/* Promo */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">🔥 Promo Hari Ini</h2>
          <Link href="/promo" className="text-sm font-semibold text-brand-600 hover:underline">
            Lihat semua
          </Link>
        </div>
        {promos.length > 0 ? (
          <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
            {promos.map((p) => (
              <Link
                key={p.id}
                href="/promo"
                className="card flex min-w-64 flex-col p-4 transition hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-2xl" aria-hidden="true">
                    🔥
                  </span>
                  <div>
                    <p className="font-bold text-gray-900">{p.name}</p>
                    <p className="text-xs text-gray-500">🏪 {p.merchantName}</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-gray-500">
                  Jenis: <span className="font-semibold capitalize">{p.jenisVoucher}</span> ·{" "}
                  {p.jumlah} voucher
                </p>
                <p className="mt-1 text-xs text-gray-400">Berakhir {formatDateLong(p.endDate)}</p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyNote text="Belum ada promo aktif saat ini." />
        )}
      </section>

      {/* Voucher bisa diklaim */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">🎟️ Voucher Bisa Diklaim</h2>
          <Link href="/voucher-saya" className="text-sm font-semibold text-brand-600 hover:underline">
            Voucher Saya
          </Link>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {vouchers.slice(0, 6).map((v) => (
            <VoucherCard
              key={v.id}
              voucher={v}
              canClaim={!!user && user.role === "customer"}
              claimed={claimedIds.has(v.id)}
            />
          ))}
          {vouchers.length === 0 && <EmptyNote text="Belum ada voucher tersedia." />}
        </div>
      </section>

      {/* Merchandise */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">🛍️ Merchandise V Shop</h2>
          <Link href="/merchandise" className="text-sm font-semibold text-brand-600 hover:underline">
            Lihat semua
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {merchandise.map((m) => (
            <MerchCard key={m.id} product={m} />
          ))}
          {merchandise.length === 0 && <EmptyNote text="Merchandise belum tersedia." />}
        </div>
      </section>
    </div>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="card mt-4 p-8 text-center text-sm text-gray-500">{text}</div>
  );
}
