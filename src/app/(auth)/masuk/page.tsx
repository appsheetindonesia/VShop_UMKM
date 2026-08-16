import Link from "next/link";
import type { Metadata } from "next";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Masuk",
};

export default function MasukPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Masuk ke V Shop</h1>
        <p className="mt-1 text-sm text-gray-500">Pilih jenis akun Anda</p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link
          href="/masuk/pelanggan"
          className="group rounded-2xl border-2 border-gray-200 bg-white p-4 text-center transition hover:border-brand-500 hover:shadow-md"
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-3xl transition group-hover:bg-brand-100">
            🛍️
          </span>
          <span className="mt-3 block font-bold text-gray-900">Pelanggan</span>
          <span className="mt-1 block text-xs leading-relaxed text-gray-500">
            Belanja &amp; investasi voucher
          </span>
        </Link>
        <Link
          href="/masuk/merchant"
          className="group rounded-2xl border-2 border-gray-200 bg-white p-4 text-center transition hover:border-accent-500 hover:shadow-md"
        >
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-50 text-3xl transition group-hover:bg-accent-100">
            🏪
          </span>
          <span className="mt-3 block font-bold text-gray-900">Merchant</span>
          <span className="mt-1 block text-xs leading-relaxed text-gray-500">
            Kelola promo &amp; voucher
          </span>
        </Link>
      </div>

      <p className="mt-6 text-center text-sm text-gray-600">
        Belum punya akun?{" "}
        <Link href="/daftar/pelanggan" className="font-semibold text-brand-600 hover:underline">
          Daftar sekarang
        </Link>
      </p>
    </div>
  );
}
