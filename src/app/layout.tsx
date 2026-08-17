import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { ensureHydrated, fetchSessionIntoCache, registerShutdownFlush } from "@/lib/db";
import { ensureSettingsHydrated } from "@/lib/settings";
import { SESSION_COOKIE } from "@/lib/session-cookies";
import {
  startDailySummaryScheduler,
  startExpiryScheduler,
  startNotificationRetryScheduler,
  startVoucher24hScheduler,
} from "@/lib/cron";

export const metadata: Metadata = {
  title: {
    default: "V Shop — Diskon UMKM di Sekitarmu",
    template: "%s · V Shop",
  },
  description:
    "V Shop adalah platform voucher belanja. Temukan promo, klaim voucher, dan hemat maksimal di UMKM terdekat.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Pastikan store siap (hydrate dari Supabase bila dikonfigurasi) sebelum
  // halaman dirender. No-op setelah proses pertama.
  await ensureHydrated();
  // Pengaturan koneksi (menu admin Configurasi) ikut di-hydrate agar nilai
  // tersimpan menang atas env var untuk request berikutnya.
  await ensureSettingsHydrated();

  // Middleware (Edge) memperbarui/membuat sesi di sisi server SEBELUM
  // render — baris sesinya tidak ada di cache proses Node ini, jadi
  // sinkronkan dulu agar guard/header melihat user sudah login (tanpa flash).
  // No-op bila sesi sudah ada di cache (hanya satu fetch saat renewal).
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    // Token prioritas: header `x-vshop-new-session` (di-set middleware saat
    // renewal — propagasi header ke server component lebih andal daripada
    // mutasi request cookie) → fallback cookie sesi biasa.
    const syncToken = headers().get("x-vshop-new-session") ?? cookies().get(SESSION_COOKIE)?.value;
    if (syncToken) await fetchSessionIntoCache(syncToken);
  }

  // Fallback lokal untuk job terjadwal (produksi memakai Vercel Cron lewat
  // vercel.json): auto-expire + pengingat voucher H-1/24 jam + retry
  // notifikasi WhatsApp gagal + ringkasan harian merchant. Guard global per
  // job mencegah timer ganda; tidak aktif selama proses build statis.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    startExpiryScheduler();
    startVoucher24hScheduler();
    startNotificationRetryScheduler();
    startDailySummaryScheduler();
    // Drain terakhir saat SIGTERM/SIGINT: flush snapshot terbaru yang masih
    // mengantre di persistChain sebelum proses keluar (guard globalThis).
    registerShutdownFlush();
  }

  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        {children}
        <footer className="mt-16 border-t border-gray-200 bg-white py-8">
          <div className="mx-auto max-w-7xl px-4 text-center text-sm text-gray-500">
            <p className="font-semibold text-gray-800">V Shop — Diskon UMKM di sekitarmu</p>
            <p className="mt-1">Hemat belanja setiap hari dengan voucher terbaik dari merchant lokal.</p>
            <p className="mt-3 text-xs text-gray-400">
              © {new Date().getFullYear()} V Shop · Open Source · Next.js + Supabase + Midtrans
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
