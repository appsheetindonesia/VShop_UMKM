import type { Metadata } from "next";
import AdminConfigurasi from "@/components/admin/AdminConfigurasi";
import {
  categoryStatus,
  ensureSettingsHydrated,
  listSettings,
} from "@/lib/settings";

export const metadata: Metadata = {
  title: "Configurasi",
};

export const dynamic = "force-dynamic";

/**
 * Menu admin Configurasi — kelola koneksi data keluar aplikasi tanpa edit
 * env/restart: PostgreSQL (Supabase), Payment Gateway (Midtrans), WhatsApp
 * Gateway, AI, dan lainnya. Nilai rahasia disimpan terenkripsi di tabel
 * `app_settings` (migration 0009) dan TIDAK pernah dikirim utuh ke browser
 * (listSettings mengembalikan mask).
 */
export default async function AdminConfigurasiPage() {
  await ensureSettingsHydrated();
  const settings = await listSettings();
  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">⚙️ CONFIGURASI</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Configurasi</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">
          Kelola koneksi data keluar aplikasi — database PostgreSQL, payment
          gateway, WhatsApp gateway, dan AI. Nilai rahasia disimpan terenkripsi;
          perubahan berlaku untuk request berikutnya tanpa restart.
        </p>
      </div>
      <AdminConfigurasi initial={{ settings, statuses: categoryStatus(settings) }} />
    </div>
  );
}
