import type { Metadata } from "next";
import Link from "next/link";
import TopupForm from "@/components/TopupForm";
import { requireRole } from "@/lib/auth";
import { getWallet } from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Top Up Saldo",
};

export default function TopupPage() {
  const user = requireRole(["customer"]);
  const wallet = getWallet(user.id);

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="text-center">
        <span className="chip bg-accent-100 text-accent-800">💰 TOP UP</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Top Up Saldo V Shop</h1>
        <p className="mt-1 text-sm text-gray-500">
          Saldo saat ini: <strong className="text-brand-700">{formatRupiah(wallet.balance)}</strong>
        </p>
      </div>

      <TopupForm />

      <div className="rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <p className="font-semibold text-gray-600">Catatan</p>
        <p>
          Top up dibayar melalui Midtrans (simulasi pada mode demo). Saldo dapat digunakan untuk
          berbagai keperluan V Shop di masa mendatang.
        </p>
      </div>

      <p className="text-center">
        <Link href="/status-member" className="text-sm font-semibold text-brand-600 hover:underline">
          ← Kembali ke Status Member
        </Link>
      </p>
    </div>
  );
}
