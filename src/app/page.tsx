import Link from "next/link";
import type { Metadata } from "next";
import Logo from "@/components/Logo";
import GuestButton from "@/components/GuestButton";
import { getSessionUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Selamat Datang",
};

export default function HomePage() {
  const user = getSessionUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-8">
      {/* Logo gradien sesuai artifact */}
      <div className="flex flex-col items-center gap-6">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "linear-gradient(135deg,#1D4ED8,#F97316)" }}
          aria-hidden="true"
        >
          <Logo size={40} withText={false} />
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-800">V Shop</h1>
          <p className="mt-1.5 text-sm font-medium text-gray-500">
            Diskon UMKM di sekitarmu
          </p>
        </div>
      </div>

      {/* Pilihan peran sesuai artifact */}
      <div className="mt-10 space-y-3">
        <Link href="/masuk/pelanggan" className="btn-primary w-full">
          Masuk sebagai Pelanggan
        </Link>
        <Link href="/masuk/merchant" className="btn-secondary w-full">
          Masuk sebagai Merchant
        </Link>
        <div className="pt-1 text-center">
          <GuestButton
            label={user ? `Lanjut sebagai ${user.name.split(" ")[0]}` : "Lanjut sebagai Tamu"}
            className="text-sm font-semibold text-brand-600 hover:underline"
          />
        </div>
      </div>

      <p className="mt-8 text-center text-xs leading-relaxed text-gray-400">
        Belanja hemat dengan voucher dari merchant lokal.
        <br />
        Aktifkan paket untuk mulai mengklaim voucher setiap hari.
      </p>
    </main>
  );
}
