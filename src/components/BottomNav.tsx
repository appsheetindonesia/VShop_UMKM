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
    // Posisi mengambang (floating pill): ujung kiri & kanan berbentuk oval
    // (rounded-full) dengan jarak dari tepi layar. Safe-area iPhone:
    // bottom = 0.75rem + env(safe-area-inset-bottom) agar tidak tertutup
    // gesture bar (home indicator); di browser non-iOS inset = 0.
    <nav
      className="fixed inset-x-3 bottom-[calc(0.75rem_+_env(safe-area-inset-bottom))] z-40 rounded-full border border-gray-200 bg-white/95 shadow-lg shadow-gray-200/60 backdrop-blur md:hidden"
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
              aria-current={active ? "page" : undefined}
              className="flex flex-1 items-center justify-center py-1"
            >
              {/* Item aktif: pill oval tersendiri. Warna (soft/solid) dipilih
                  admin lewat Configurasi — class nav-pill-active di globals.css. */}
              <span
                className={`flex flex-col items-center gap-0.5 rounded-full px-4 py-1.5 text-[11px] font-semibold transition-all duration-150 ease-out ${
                  active ? "scale-105 nav-pill-active" : "text-gray-400"
                }`}
              >
                <span className="text-xl leading-none" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
