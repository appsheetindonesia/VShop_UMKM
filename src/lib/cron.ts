/**
 * Job terjadwal: auto-expire order pending > ORDER_EXPIRY_HOURS jam.
 *
 * Dua mekanisme (bukan keduanya wajib):
 * - **Vercel Cron** (produksi): `vercel.json` memanggil GET
 *   `/api/cron/expire-orders` tiap jam; endpoint melindungi diri dengan
 *   `CRON_SECRET`. Cocok untuk serverless (setInterval tidak bertahan).
 * - **Interval lokal** (dev / self-host `next start`): `startExpiryScheduler`
 *   menyalakan setInterval tiap jam di dalam proses (dimulai dari root
 *   layout; guard `globalThis` mencegah duplikat; `unref` agar tidak
 *   menahan proses Node).
 *
 * Konsistensi: batas waktu memakai ORDER_EXPIRY_HOURS dari `midtrans.ts`,
 * sumber yang sama dengan field `expiry` payload Snap Midtrans.
 */

import { ensureHydrated } from "./db";
import { expireStaleOrders } from "./service";
import { notifyOrderPayment } from "./whatsapp";

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 jam

/**
 * Jalankan job auto-expire sekali: expire order basi lalu kirim notifikasi
 * WhatsApp "kadaluarsa" ke pelanggan (fire-and-forget, hanya saat transisi
 * baru terjadi). Mengembalikan daftar id order yang di-expire.
 */
export async function runExpiryJob(): Promise<string[]> {
  await ensureHydrated();
  const expiredIds = expireStaleOrders();
  for (const id of expiredIds) {
    void notifyOrderPayment(id, "expired");
  }
  if (expiredIds.length > 0) {
    console.log(`[cron] auto-expire: ${expiredIds.length} order kadaluarsa (${expiredIds.join(", ")})`);
  }
  return expiredIds;
}

declare global {
  // eslint-disable-next-line no-var
  var __vshopCronStarted: boolean | undefined;
}

/** Nyalakan scheduler interval (sekali per proses; aman dipanggil berulang). */
export function startExpiryScheduler(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  if (globalThis.__vshopCronStarted) return;
  globalThis.__vshopCronStarted = true;
  const timer = setInterval(() => {
    void runExpiryJob().catch((err) => {
      console.error("[cron] auto-expire gagal:", err instanceof Error ? err.message : String(err));
    });
  }, intervalMs);
  // Jangan menahan proses Node (mis. saat build / tooling).
  timer.unref?.();
  console.log(`[cron] scheduler auto-expire aktif (tiap ${intervalMs / 60_000} menit)`);
}
