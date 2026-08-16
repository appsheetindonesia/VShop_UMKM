import type { Metadata } from "next";
import Link from "next/link";
import CartEditor from "@/components/CartEditor";
import CheckoutAddressForm from "@/components/CheckoutAddressForm";
import { getSessionUser } from "@/lib/auth";
import { getCartDetailed, getPackages } from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Checkout",
};

export default function CheckoutPage({
  searchParams,
}: {
  searchParams?: { type?: string; pkg?: string; amount?: string };
}) {
  const user = getSessionUser();
  const isCustomer = !!user && user.role === "customer";

  if (!isCustomer) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <span className="text-5xl" aria-hidden="true">🔒</span>
        <h1 className="mt-3 text-lg font-bold text-gray-900">Login untuk Checkout</h1>
        <p className="mt-1 text-sm text-gray-500">
          {user?.role === "merchant"
            ? "Halaman ini untuk pelanggan."
            : "Masuk sebagai pelanggan untuk melanjutkan pembayaran."}
        </p>
        <Link href="/masuk/pelanggan" className="btn-primary mt-5 w-full">
          Masuk / Daftar
        </Link>
      </div>
    );
  }

  const type = searchParams?.type ?? "cart";
  const packages = getPackages();

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Checkout</h1>
      <p className="mt-1 text-sm text-gray-500">Periksa pesanan Anda lalu lanjutkan ke pembayaran.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {type === "cart" && <CartEditor items={getCartDetailed(user.id)} />}

          {type === "package" && (
            <PackageSummary packageId={searchParams?.pkg} packages={packages} />
          )}

          {type === "topup" && (
            <div className="card p-5">
              <h2 className="font-bold text-gray-900">Top Up Saldo V Shop</h2>
              <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-50 p-4">
                <span className="text-sm text-gray-600">Jumlah top up</span>
                <span className="text-xl font-extrabold text-brand-600">
                  {formatRupiah(Number(searchParams?.amount ?? 0))}
                </span>
              </div>
            </div>
          )}

          {!["cart", "package", "topup"].includes(type) && (
            <div className="card p-8 text-center text-sm text-gray-500">Jenis checkout tidak dikenal.</div>
          )}
        </div>

        <div className="lg:col-span-2">
          <CheckoutAddressForm
            type={type === "package" ? "package" : type === "topup" ? "topup" : "merchandise"}
            packageId={searchParams?.pkg}
            amount={searchParams?.amount ? Number(searchParams.amount) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function PackageSummary({
  packageId,
  packages,
}: {
  packageId?: string;
  packages: ReturnType<typeof getPackages>;
}) {
  const pkg = packages.find((p) => p.id === packageId);
  if (!pkg) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        Paket tidak ditemukan.{" "}
        <Link href="/paket" className="font-semibold text-brand-600">
          Lihat paket
        </Link>
      </div>
    );
  }
  return (
    <div className="card p-5">
      <h2 className="font-bold text-gray-900">Ringkasan Paket</h2>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{pkg.name}</span>
          <span className="font-bold text-gray-900">{formatRupiah(pkg.price)}</span>
        </div>
        <div className="flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="font-semibold text-gray-700">Total</span>
          <span className="text-lg font-extrabold text-accent-600">{formatRupiah(pkg.price)}</span>
        </div>
      </div>
    </div>
  );
}
