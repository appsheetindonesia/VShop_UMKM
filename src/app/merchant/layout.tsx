import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getMerchantByUserId } from "@/lib/service";
import { merchantCode } from "@/lib/format";
import LogoutButton from "@/components/LogoutButton";
import RoleNavLink from "@/components/RoleNavLink";

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  const user = requireRole(["merchant", "admin"]);
  const merchant = getMerchantByUserId(user.id);

  const nav = [
    { href: "/merchant/dashboard", label: "Dashboard", icon: "📊" },
    { href: "/merchant/promo/buat", label: "Buat Promo", icon: "✚" },
    { href: "/merchant/pengelolaan", label: "Voucher", icon: "🎟️" },
    { href: "/merchant/voucher/getken", label: "Redeem Voucher", icon: "✔" },
    { href: "/merchant/laporan", label: "Laporan", icon: "📈" },
  ];

  if (user.role === "merchant" && merchant?.status !== "approved") {
    const rejected = merchant?.status === "rejected";
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
        <div className="flex flex-col items-center text-center">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl ${
              rejected ? "bg-red-50 text-red-600" : "bg-accent-50 text-accent-600"
            }`}
            aria-hidden="true"
          >
            {rejected ? "✕" : "⏳"}
          </span>
          <h1 className="mt-4 text-xl font-extrabold text-gray-900">
            {rejected ? "Pendaftaran Ditolak" : "Menunggu Verifikasi"}
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500">
            {rejected ? (
              "Data usaha belum lengkap/valid. Silakan periksa catatan admin dan ajukan ulang."
            ) : (
              <>
                Pendaftaran <b className="text-gray-800">{merchant?.namaUsaha}</b> sedang direview
                oleh admin V Shop. Prosesnya 1–2 hari kerja.
              </>
            )}
          </p>

          {!rejected && merchant && (
            <div className="card mt-6 w-full max-w-xs p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">Status</span>
                <span className="chip bg-accent-50 !text-accent-600">Menunggu Verifikasi</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-gray-500">Merchant ID</span>
                <span className="font-mono text-xs font-bold text-gray-800">{merchantCode(merchant.id)}</span>
              </div>
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <Link href="/beranda" className="btn-secondary">Kembali ke Beranda</Link>
            <LogoutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-gray-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:justify-start">
          <Link href="/" className="text-lg font-extrabold text-gray-900">
            V<span className="text-brand-600">SHOP</span>{" "}
            <span className="chip ml-1 bg-accent-100 text-accent-800">Merchant</span>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Navigasi merchant">
          {nav.map((item) => (
            <RoleNavLink key={item.href} href={item.href} label={item.label} icon={item.icon} />
          ))}
        </nav>
        <div className="hidden border-t border-gray-200 p-4 lg:block">
          <p className="truncate text-sm font-semibold text-gray-900">{merchant?.namaUsaha ?? user.name}</p>
          <p className="text-xs text-gray-500">{user.email ?? user.phone}</p>
          <LogoutButton className="btn-secondary mt-3 w-full !py-2 text-xs" />
        </div>
      </aside>
      <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
