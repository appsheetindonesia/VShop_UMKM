import { auditDisplayText, type TimelineStep } from "@/lib/payment-history";
import { formatDateTime } from "@/lib/format";

const STATUS_DOT: Record<string, string> = {
  Berhasil: "bg-green-500",
  Gagal: "bg-red-500",
  Kadaluarsa: "bg-gray-400",
  Menunggu: "bg-yellow-400",
  "Coba Lagi": "bg-brand-500",
  "Konfigurasi Bermasalah": "bg-orange-400",
};

/**
 * Kronologi status pembayaran (dari `metadata.paymentAudit`) — tampilan
 * yang SAMA dipakai halaman `/transaksi/[orderId]` (pelanggan/admin) dan
 * tabel `/admin/orders` (audit tanpa login pelanggan). Server component
 * (murni render, tanpa hook).
 */
export default function PaymentTimeline({ timeline }: { timeline: TimelineStep[] }) {
  if (timeline.length === 0) {
    return (
      <p className="text-xs text-gray-500">
        Belum ada catatan status. Riwayat ini terisi saat status pembayaran berubah.
      </p>
    );
  }
  return (
    <ol className="space-y-0">
      {timeline.map((step, i) => {
        const text = auditDisplayText(step);
        return (
        <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
          {i < timeline.length - 1 && (
            <span className="absolute left-[5px] top-4 h-full w-px bg-gray-200" aria-hidden="true" />
          )}
          <span
            className={`relative mt-1 h-[11px] w-[11px] shrink-0 rounded-full ${
              STATUS_DOT[step.label] ?? "bg-gray-400"
            } ${step.isLatest ? "ring-2 ring-gray-200" : ""}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs">
              <span className={`font-bold ${step.isLatest ? "text-gray-900" : "text-gray-700"}`}>
                {step.label}
              </span>
              <span className="text-gray-400"> · {step.sourceLabel}</span>
            </p>
            <p className="text-[11px] text-gray-500">{formatDateTime(step.at)}</p>
            {text.primary && (
              <p className="mt-0.5 text-[11px] text-gray-500">{text.primary}</p>
            )}
            {text.raw && (
              <p className="mt-0.5 font-mono text-[11px] text-gray-400">
                pesan mentah: {text.raw}
              </p>
            )}
            {step.channelResponseCode && (
              <p className="font-mono text-[11px] text-gray-500">
                🔌 kanal {step.channelResponseCode}
                {step.channelResponseMessage ? ` — ${step.channelResponseMessage}` : ""}
              </p>
            )}
            {step.statusCode && (
              <p className="font-mono text-[11px] text-gray-400">
                kode {step.statusCode}
                {step.paymentType ? ` · ${step.paymentType}` : ""}
                {step.orderNumber ? ` · ${step.orderNumber}` : ""}
              </p>
            )}
          </div>
        </li>
        );
      })}
    </ol>
  );
}
