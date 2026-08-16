import type { Metadata } from "next";
import RegisterMerchantForm from "@/components/auth/RegisterMerchantForm";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Daftar Akun Merchant",
};

export default function DaftarMerchantPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Daftar Usaha</h1>
        <p className="mt-1 text-sm text-gray-500">
          Daftarkan usaha Anda sebagai partner V Shop
        </p>
      </div>
      <p className="mt-4 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-600">
        ⏳ Pendaftaran Anda akan ditinjau oleh admin sebelum akun merchant aktif.
      </p>
      <RegisterMerchantForm />
    </div>
  );
}
