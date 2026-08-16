import type { Metadata } from "next";
import Link from "next/link";
import PackageCard from "@/components/PackageCard";
import { getPackages } from "@/lib/service";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Pilih Paket",
};

export default function PaketPage() {
  const user = getSessionUser();
  const packages = getPackages();
  const canSubscribe = !!user && user.role === "customer";

  return (
    <div className="mx-auto max-w-4xl">
      <div className="text-center">
        <span className="chip bg-brand-100 text-brand-600">PAKET AKSES</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Pilih Paket Akses</h1>
        <p className="mt-1 text-sm text-gray-500">
          Akses promo &amp; voucher 7, 14, atau 30 hari. Klaim setiap hari, hemat maksimal.
        </p>
        {user && !canSubscribe && (
          <p className="mt-2 text-sm font-medium text-accent-600">
            Akun merchant menggunakan halaman ini. Silakan gunakan akun pelanggan.
          </p>
        )}
        {!user && (
          <p className="mt-3">
            <Link href="/masuk/pelanggan" className="text-sm font-semibold text-brand-600 hover:underline">
              Masuk dulu untuk memilih paket →
            </Link>
          </p>
        )}
      </div>

      <div className="mt-8 grid gap-5 sm:grid-cols-3">
        {packages.map((pkg) => (
          <PackageCard key={pkg.id} pkg={pkg} canSubscribe={canSubscribe} />
        ))}
      </div>

      <div className="mt-8 rounded-2xl bg-brand-50 p-5 text-sm text-brand-900">
        <p className="font-semibold">💡 Cara kerja V Shop</p>
        <ol className="mt-2 list-inside list-decimal space-y-1 text-brand-800">
          <li>Daftar akun pelanggan (gratis)</li>
          <li>Pilih paket &amp; bayar via Midtrans</li>
          <li>Klaim voucher setiap hari dari merchant favorit</li>
          <li>Tunjukkan kode voucher saat transaksi</li>
        </ol>
      </div>
    </div>
  );
}
