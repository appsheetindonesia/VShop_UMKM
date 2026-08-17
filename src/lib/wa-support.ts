/**
 * Tautan support WhatsApp — modul MURNI untuk membangun link `wa.me`
 * dengan pesan terisi (mis. tombol "Lacak Pesanan" di halaman detail
 * transaksi saat status gagal/kadaluarsa).
 *
 * Nomor support dikonfigurasi di admin **Configurasi → WhatsApp Gateway**
 * (`wa_support_number`, fallback env `WHATSAPP_SUPPORT_NUMBER`) — jadi
 * nomor bisa diganti tanpa edit kode / restart.
 */
import { normalizeToE164 } from "./phone";
import { getSetting } from "./settings";

export interface WaSupportLinkOptions {
  /** Nomor order (VS-…). */
  orderNumber?: string;
  /** Nomor invoice stabil (VS-INV-…). */
  invoiceNumber?: string;
  /** Link absolut ke detail transaksi (opsional). */
  orderUrl?: string;
}

/**
 * Bangun tautan `https://wa.me/<E.164>?text=<pesan terisi>`. Mengembalikan
 * null bila nomor support tidak valid/kosong — pemanggil menyembunyikan
 * tombolnya dalam kasus itu.
 */
export function buildWaSupportLink(
  phone: string | null | undefined,
  opts: WaSupportLinkOptions = {}
): string | null {
  const digits = normalizeToE164(phone);
  if (!digits) return null;
  const lines = ["Halo V Shop! Saya butuh bantuan terkait pesanan saya."];
  if (opts.orderNumber) lines.push(`No. Order: ${opts.orderNumber}`);
  if (opts.invoiceNumber) lines.push(`No. Invoice: ${opts.invoiceNumber}`);
  if (opts.orderUrl) lines.push(`Detail pesanan: ${opts.orderUrl}`);
  return `https://wa.me/${digits}?text=${encodeURIComponent(lines.join("\n"))}`;
}

/** Nomor support aktif (Configurasi menang; fallback env WHATSAPP_SUPPORT_NUMBER). */
export function getSupportPhone(): string | null {
  return getSetting("wa_support_number");
}

/**
 * URL absolut untuk link di pesan — sumber yang SAMA dengan modul WhatsApp:
 * `wa_link_base` (WA_LINK_BASE, domain publik terpisah) → `app_url`
 * (Configurasi) → `APP_URL` → `NEXT_PUBLIC_APP_URL` → localhost.
 */
export function getSupportAppUrl(): string {
  return (
    getSetting("wa_link_base") ??
    getSetting("app_url") ??
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000"
  );
}
