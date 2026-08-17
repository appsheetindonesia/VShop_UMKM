"use client";

import { useEffect } from "react";

/**
 * Memicu dialog cetak / "Save as PDF" secara otomatis saat halaman invoice
 * dibuka dengan `?print=1` (link "Invoice PDF" di notifikasi WhatsApp).
 * `#invoice-print` adalah satu-satunya area yang dicetak (lihat globals.css),
 * jadi hasilnya persis seperti tombol "Unduh Bukti / Invoice (PDF)".
 * Delay kecil agar layout invoice (termasuk QR) selesai dirender dulu.
 */
export default function AutoPrintInvoice() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);
  return null;
}
