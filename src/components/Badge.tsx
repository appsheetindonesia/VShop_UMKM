const styles: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  blue: "bg-brand-100 text-brand-800",
  orange: "bg-accent-100 text-accent-800",
  red: "bg-red-100 text-red-800",
  gray: "bg-gray-100 text-gray-700",
  yellow: "bg-amber-100 text-amber-800",
};

export type BadgeColor = keyof typeof styles;

export default function Badge({
  children,
  color = "gray",
}: {
  children: React.ReactNode;
  color?: BadgeColor;
}) {
  return <span className={`chip ${styles[color]}`}>{children}</span>;
}

export function statusColor(status: string): BadgeColor {
  switch (status) {
    case "active":
    case "approved":
    case "paid":
    case "completed":
    case "success":
      return "green";
    case "pending":
    case "processing":
      return "yellow";
    case "used":
      return "orange";
    case "expired":
    case "failed":
    case "rejected":
    case "archived":
    case "cancelled":
      return "red";
    default:
      return "gray";
  }
}

/**
 * Badge untuk riwayat pembayaran: status + ALASAN GAGAL SPESIFIK sebagai
 * label berwarna. `reason` (dari `metadata.failureReason`, mis. "Pembayaran
 * ditolak oleh bank", "Saldo tidak mencukupi") dipakai langsung sebagai
 * label status gagal/kadaluarsa — merah untuk gagal, abu-abu untuk status
 * terminal netral (kadaluarsa, dibatalkan).
 */
export function paymentBadge(
  status: string,
  reason?: string
): { label: string; color: BadgeColor } {
  switch (status) {
    case "paid":
      return { label: "Berhasil", color: "green" };
    case "pending":
      return { label: "Menunggu", color: "yellow" };
    case "failed":
      return { label: reason || "Gagal", color: "red" };
    case "expired":
      return { label: reason || "Kadaluarsa", color: "gray" };
    case "cancelled":
      return { label: "Dibatalkan", color: "gray" };
    default:
      return { label: status, color: "gray" };
  }
}

/**
 * Badge untuk status klaim voucher (merchant dashboard/laporan): label
 * Bahasa Indonesia + warna, mengikuti pola paymentBadge agar konsisten di
 * semua tampilan (aktif → hijau, terpakai → oranye, kadaluarsa → abu-abu).
 */
export function claimBadge(status: string): { label: string; color: BadgeColor } {
  switch (status) {
    case "active":
      return { label: "Aktif", color: "green" };
    case "used":
      return { label: "Terpakai", color: "orange" };
    case "expired":
      return { label: "Kadaluarsa", color: "gray" };
    default:
      return { label: status, color: "gray" };
  }
}
