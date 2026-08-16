import type { Metadata } from "next";
import UmkmSearch from "@/components/UmkmSearch";
import { listMerchants } from "@/lib/service";

export const metadata: Metadata = {
  title: "UMKM Partner",
};

export default function UmkmPage() {
  const merchants = listMerchants("approved");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="text-center">
        <span className="chip bg-accent-50 !text-accent-600">🏬 MERCHANT</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">UMKM Partner Terdekat</h1>
        <p className="mt-1 text-sm text-gray-500">
          Temukan merchant partner dan klaim vouchernya
        </p>
      </div>

      <div className="mt-6">
        <UmkmSearch merchants={merchants} />
      </div>
    </div>
  );
}
