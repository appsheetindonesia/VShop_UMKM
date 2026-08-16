import Link from "next/link";
import Logo from "@/components/Logo";
import type { User } from "@/lib/types";
import { getCart } from "@/lib/service";

export default function Header({ user }: { user: User | null }) {
  const cartCount = user ? getCart(user.id).reduce((s, c) => s + c.quantity, 0) : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-6">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Navigasi utama">
            <NavLink href="/beranda">Beranda</NavLink>
            <NavLink href="/promo">Promo</NavLink>
            <NavLink href="/merchandise">Merchandise</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/checkout?type=cart"
            className="relative rounded-xl p-2.5 text-gray-600 transition hover:bg-gray-100"
            aria-label={`Keranjang belanja, ${cartCount} item`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            {cartCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1 text-[11px] font-bold text-white">
                {cartCount}
              </span>
            )}
          </Link>

          {user ? (
            <Link
              href="/akun"
              className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                {user.name.charAt(0).toUpperCase()}
              </span>
              <span className="hidden max-w-28 truncate sm:block">{user.name.split(" ")[0]}</span>
            </Link>
          ) : (
            <Link href="/masuk" className="btn-primary !px-4 !py-2">
              Masuk / Daftar
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900">
      {children}
    </Link>
  );
}
