import type { Metadata } from "next";
import RegisterCustomerForm from "@/components/auth/RegisterCustomerForm";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Daftar Akun Pelanggan",
};

export default function DaftarPelangganPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Daftar Pelanggan</h1>
        <p className="mt-1 text-sm text-gray-500">
          Mulai hemat belanja dengan voucher V Shop
        </p>
      </div>
      <RegisterCustomerForm />
    </div>
  );
}
