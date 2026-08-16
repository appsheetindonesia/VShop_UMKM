"use client";

import { postJson, useSubmit } from "@/lib/client";

/**
 * Tombol \"Coba Lagi\" di layar Pembayaran Gagal: memanggil API retry
 * (order dikembalikan ke pending + snap token baru), lalu kembali ke
 * halaman bayar order tersebut.
 */
export default function RetryPaymentButton({
  orderId,
  className = "btn-primary w-full",
}: {
  orderId: string;
  /** Kelas tombol (default tombol primary penuh). */
  className?: string;
}) {
  const { run, loading, error } = useSubmit();

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={loading}
        onClick={() => run(() => postJson(`/api/pay/${orderId}/retry`, {}))}
        className={className}
      >
        {loading ? "Menyiapkan ulang..." : "Coba Lagi"}
      </button>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
