import type { Metadata } from "next";
import Link from "next/link";
import RetryPaymentButton from "@/components/RetryPaymentButton";
import { getSessionUser } from "@/lib/auth";
import { countOrderRetries, getOrder, MAX_ORDER_RETRIES } from "@/lib/service";

export const metadata: Metadata = {
  title: "Pembayaran Gagal",
};

/**
 * Layar "Pembayaran Gagal" (wireframe stage 5b): ditampilkan saat
 * pembayaran gagal atau kadaluarsa, dengan opsi Coba Lagi (kembali ke
 * halaman bayar dengan snap token baru) dan Kembali ke Beranda.
 *
 * Alasan spesifik (mis. "Pembayaran ditolak oleh bank", "Saldo tidak
 * mencukupi", "Waktu pembayaran habis") dibaca dari `metadata.failureReason`
 * order di server — sumber kebenaran, bukan query string yang bisa diubah
 * client. Bila order tidak ditemukan / bukan milik pengguna, ditampilkan
 * pesan generik sesuai `reason`.
 */
export default function GagalPage({
  searchParams,
}: {
  searchParams?: { order?: string; reason?: string };
}) {
  const orderId = searchParams?.order;
  const reason = searchParams?.reason === "expired" ? "expired" : "failed";

  // Alasan spesifik + sisa percobaan retry (jika order milik pengguna yang login).
  let specificReason: string | null = null;
  let retriesLeft: number | null = null;
  if (orderId) {
    const user = getSessionUser();
    const order = getOrder(orderId);
    if (order && user && order.userId === user.id) {
      const stored = order.metadata?.failureReason;
      if (typeof stored === "string" && stored.trim()) {
        specificReason = stored.trim();
      }
      retriesLeft = Math.max(0, MAX_ORDER_RETRIES - countOrderRetries(order));
    }
  }

  // Default per jenis kegagalan (bila belum ada alasan spesifik).
  const fallback =
    reason === "expired"
      ? "Pembayaran kadaluarsa. Silakan ulangi pembayaran atau pilih metode lain."
      : "Pembayaran belum berhasil. Silakan ulangi pembayaran atau pilih metode lain.";

  return (
    <div className="mx-auto max-w-md">
      <div className="card overflow-hidden p-0">
        <div className="bg-gradient-to-b from-red-500 to-red-600 p-8 text-center text-white">
          <span
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/20 text-3xl"
            aria-hidden="true"
          >
            ✕
          </span>
          <h1 className="mt-3 text-xl font-bold">Pembayaran Gagal</h1>
        </div>

        <div className="space-y-3 p-6">
          <p className="text-center text-sm leading-relaxed text-gray-600">
            {specificReason ? (
              <>
                <span className="block text-base font-semibold text-gray-900">
                  {specificReason}
                </span>
                <span className="mt-2 block">
                  {reason === "expired"
                    ? "Silakan ulangi pembayaran atau pilih metode lain sebelum waktu habis."
                    : "Silakan periksa metode pembayaran, lalu ulangi atau pilih metode lain."}
                </span>
              </>
            ) : (
              fallback
            )}
          </p>
        </div>

        <div className="space-y-3 p-6 pt-0">
          {orderId ? (
            retriesLeft === null || retriesLeft > 0 ? (
              <RetryPaymentButton orderId={orderId} />
            ) : (
              <div
                role="alert"
                className="rounded-xl bg-gray-100 px-4 py-3 text-center text-sm text-gray-600"
              >
                Batas percobaan pembayaran ulang tercapai (maks {MAX_ORDER_RETRIES}x).
                Silakan hubungi admin atau gunakan metode pembayaran lain.
              </div>
            )
          ) : (
            <Link href="/beranda" className="btn-primary w-full">
              Coba Lagi
            </Link>
          )}
          <Link href="/beranda" className="btn-secondary w-full">
            Kembali ke Beranda
          </Link>
        </div>
      </div>
    </div>
  );
}
