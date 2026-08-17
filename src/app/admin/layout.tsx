import Link from "next/link";
import { requireRole } from "@/lib/auth";
import LogoutButton from "@/components/LogoutButton";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = requireRole(["admin"]);

  const nav = [
    { href: "/admin", label: "Dashboard", icon: "📊" },
    { href: "/admin/merchants", label: "Merchant", icon: "🏪" },
    { href: "/admin/produk", label: "Produk", icon: "🛍️" },
    { href: "/admin/orders", label: "Pesanan", icon: "🧾" },
    { href: "/admin/notifikasi", label: "Log Notifikasi", icon: "📣" },
    { href: "/admin/kadaluarsa", label: "Order Kadaluarsa", icon: "⏰" },
    { href: "/admin/cron", label: "Cron Jobs", icon: "⏱️" },
    { href: "/admin/configurasi", label: "Configurasi", icon: "⚙️" },
  ];

  return (
    <div className="min-h-screen lg:flex">
      <aside className="border-b border-gray-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:justify-start">
          <Link href="/" className="text-lg font-extrabold text-gray-900">
            V<span className="text-brand-600">SHOP</span>{" "}
            <span className="chip ml-1 bg-brand-100 text-brand-800">Admin</span>
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-1 lg:flex-col lg:overflow-visible lg:pb-0" aria-label="Navigasi admin">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-gray-200 p-4 lg:block">
          <p className="truncate text-sm font-semibold text-gray-900">{user.name}</p>
          <p className="text-xs text-gray-500">{user.email}</p>
          <LogoutButton className="btn-secondary mt-3 w-full !py-2 text-xs" />
        </div>
      </aside>
      <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
    </div>
  );
}
