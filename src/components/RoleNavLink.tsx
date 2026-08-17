"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Item navigasi role (admin/merchant) dengan pill aktif — konsisten dengan
 * BottomNav toko: item aktif berbentuk pill oval dengan background BIRU SOFT
 * (brand-100) + teks biru tua, item lain abu-abu. Dipakai di layout server
 * component.
 *
 * Aturan aktif: item root (2 segmen, mis. "/admin") aktif hanya saat persis;
 * item beranak (mis. "/admin/orders") aktif saat pathname dimulai href-nya.
 */
export default function RoleNavLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: string;
}) {
  const pathname = usePathname();
  const active =
    href.split("/").length === 2 ? pathname === href : pathname.startsWith(href);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2.5 rounded-full px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-out ${
        // Warna pill aktif (soft/solid) dipilih admin lewat Configurasi —
        // class nav-pill-active di globals.css (data-nav-pill di <html>).
        active
          ? "scale-[1.02] nav-pill-active"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </Link>
  );
}
