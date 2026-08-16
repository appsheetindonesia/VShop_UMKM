import type { Metadata } from "next";
import GetkenForm from "@/components/merchant/GetkenForm";

export const metadata: Metadata = {
  title: "Getken Voucher",
};

export default function GetkenPage() {
  return (
    <div className="mx-auto max-w-lg">
      <span className="chip bg-emerald-50 !text-emerald-700">✔ REDEEM</span>
      <h1 className="mt-2 text-2xl font-bold text-gray-900">Redeem Voucher</h1>
      <p className="mt-1 text-sm text-gray-500">
        Validasi kode voucher yang dibawa pelanggan Anda, lalu tandai sebagai terpakai.
      </p>
      <div className="mt-6">
        <GetkenForm />
      </div>
    </div>
  );
}
