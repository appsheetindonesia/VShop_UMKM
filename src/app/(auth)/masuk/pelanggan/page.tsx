import type { Metadata } from "next";
import Link from "next/link";
import LoginForm from "@/components/auth/LoginForm";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Login Pelanggan",
};

export default function LoginPelangganPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Masuk</h1>
        <p className="mt-1 text-sm text-gray-500">
          Masuk lewat kode OTP WhatsApp, atau pakai password akun kamu.
        </p>
      </div>
      <LoginForm role="customer" />

      <div className="mt-6 rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <p className="font-semibold text-gray-600">Akun demo</p>
        <p>
          Pelanggan: <code className="text-brand-700">081234567890</code> /{" "}
          <code className="text-brand-700">customer123</code> (atau OTP)
        </p>
        <p className="mt-1">
          Admin: <code className="text-brand-700">admin@vshop.id</code> /{" "}
          <code className="text-brand-700">admin123</code>
        </p>
        <p className="mt-2 text-amber-700">
          Mode demo: kode OTP ditampilkan di layar setelah tombol "Kirim Kode OTP" ditekan.
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
