"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/beranda", label: "Beranda", icon: "🏠" },
  { href: "/promo", label: "Promo", icon: "🔥" },
  { href: "/umkm", label: "Merchant", icon: "🏬" },
  { href: "/voucher-saya", label: "Voucher", icon: "🎟️" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 backdrop-blur md:hidden"
      aria-label="Navigasi bawah"
    >
      <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
        {items.map((item) => {
          const active =
            pathname === item.href || (item.href !== "/beranda" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-semibold ${
                active ? "text-brand-600" : "text-gray-400"
              }`}
            >
              <span className="text-xl leading-none" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
