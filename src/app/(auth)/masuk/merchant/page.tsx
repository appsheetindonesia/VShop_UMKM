import type { Metadata } from "next";
import Link from "next/link";
import LoginForm from "@/components/auth/LoginForm";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Login Merchant",
};

export default function LoginMerchantPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Masuk Merchant</h1>
        <p className="mt-1 text-sm text-gray-500">Untuk pemilik usaha yang sudah terdaftar sebagai partner V Shop</p>
      </div>
      <LoginForm role="merchant" merchant />

      <div className="mt-6 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <p className="font-semibold text-gray-600">Akun demo merchant</p>
        <p>
          Warung Nusantara: <code className="text-brand-700">merchant@vshop.id</code> /{" "}
          <code className="text-brand-700">merchant123</code>
        </p>
        <p className="mt-1">
          Kopi Nusantara: <code className="text-brand-700">kopi@vshop.id</code> /{" "}
          <code className="text-brand-700">kopi123</code>
        </p>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        <Link href="/masuk" className="hover:underline">
          ← Pilih jenis akun
        </Link>
      </p>
    </div>
  );
}
