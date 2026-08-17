/**
 * Normalisasi nomor telepon — modul MURNI (tanpa dependency) agar bisa
 * dipakai oleh adapter WhatsApp (`whatsapp.ts`) maupun modul lain seperti
 * tautan support (`wa-support.ts`) tanpa menarik rantai dependency berat.
 *
 * Format: E.164 digit tanpa "+" (mis. "6281234567890") — format yang
 * dipakai WhatsApp Cloud API dan tautan wa.me.
 */

/**
 * Normalisasi nomor HP Indonesia / internasional → E.164 digit (tanpa "+").
 * Mengembalikan null bila nomor tidak valid (kosong, terlalu pendek/panjang,
 * atau tidak berupa angka).
 */
export function normalizeToE164(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (!d.startsWith("62")) d = `62${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}
