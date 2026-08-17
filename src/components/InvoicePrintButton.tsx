"use client";

/**
 * Tombol "Unduh Bukti / Invoice (PDF)" — memanggil window.print().
 * CSS `@media print` di globals.css menyembunyikan seluruh halaman kecuali
 * area `#invoice-print`, jadi hasil cetak / "Save as PDF" hanya berisi
 * invoice (tanpa dependensi library PDF).
 */
export default function InvoicePrintButton({
  label = "🖨️ Unduh Bukti / Invoice (PDF)",
  className = "btn-primary w-full",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {label}
    </button>
  );
}
