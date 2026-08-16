import type { Metadata } from "next";
import Link from "next/link";
import PromoForm from "@/components/merchant/PromoForm";

export const metadata: Metadata = {
  title: "Buat Promo & Voucher",
};

export default function BuatPromoPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <span className="chip bg-accent-100 text-accent-800">✨ BUAT PROMO</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Buat Promo &amp; Voucher</h1>
          <p className="mt-1 text-sm text-gray-500">
            Buat promo baru beserta voucher yang bisa diklaim pelanggan.
          </p>
        </div>
        <Link href="/merchant/dashboard" className="btn-secondary !px-4 !py-2 text-sm">
          ← Dashboard
        </Link>
      </div>

      <div className="mt-6">
        <PromoForm />
      </div>
    </div>
  );
}
