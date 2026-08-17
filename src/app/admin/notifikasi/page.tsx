import type { Metadata } from "next";
import {
  listNotificationLogs,
  summarizeNotificationLogs,
  NOTIFICATION_TYPE_LABEL,
} from "@/lib/notif-log";
import { getTierDeliveryMetrics } from "@/lib/service";
import { formatDateLong } from "@/lib/format";

export const metadata: Metadata = {
  title: "Log Notifikasi",
};

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  sent: { label: "Terkirim", color: "bg-green-100 text-green-800" },
  demo: { label: "Demo", color: "bg-yellow-100 text-yellow-800" },
  failed: { label: "Gagal", color: "bg-red-100 text-red-800" },
};

export default async function AdminNotificationLogPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string };
}) {
  const status = searchParams?.status;
  const q = searchParams?.q;
  const [result, summary, tierMetrics] = await Promise.all([
    listNotificationLogs({
      limit: 200,
      status,
      search: q,
    }),
    summarizeNotificationLogs(),
    Promise.resolve(getTierDeliveryMetrics()),
  ]);
  const { logs, total } = result;

  const statuses = ["sent", "demo", "failed"];
  const rateColor =
    summary.deliveryRate >= 90
      ? "text-green-700"
      : summary.deliveryRate >= 50
        ? "text-amber-600"
        : "text-red-600";

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">📣 LOG NOTIFIKASI</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Log Notifikasi</h1>
        <p className="mt-1 text-sm text-gray-500">
          Status pengiriman WhatsApp per notifikasi — delivered / error / demo, dari log terpusat
          (<code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">notification_logs</code>).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card !p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Total</div>
          <div className="mt-1 text-2xl font-bold text-gray-900">{summary.total}</div>
        </div>
        <div className="card !p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Delivered</div>
          <div className="mt-1 text-2xl font-bold text-green-700">{summary.delivered}</div>
          <div className={`mt-0.5 text-xs font-semibold ${rateColor}`}>
            tingkat kirim {summary.deliveryRate}%
          </div>
        </div>
        <div className="card !p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Error</div>
          <div className="mt-1 text-2xl font-bold text-red-600">{summary.error}</div>
          <div className="mt-0.5 text-xs text-gray-500">gagal kirim / ditolak</div>
        </div>
        <div className="card !p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">Demo</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">{summary.demo}</div>
          <div className="mt-0.5 text-xs text-gray-500">tanpa token (hanya dicatat)</div>
        </div>
      </div>

      <section aria-label="Metrik pengingat voucher per tier">
        <h2 className="text-lg font-bold text-gray-900">Pengingat Voucher per Tier</h2>
        <p className="mt-1 text-sm text-gray-500">
          Pelanggan yang diingatkan tiap tier (30 hari terakhir) dan berapa yang lalu
          membuat klaim baru setelah pengingatnya.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {tierMetrics.map((m) => {
            const rate =
              m.reminded > 0 ? Math.round((m.reclaimed / m.reminded) * 100) : 0;
            return (
              <div key={m.tier} className="card !p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium uppercase tracking-wide text-gray-400">
                    Tier {m.tier === "48-jam" ? "48 Jam" : "H-1 / 24 Jam"}
                  </div>
                  <code className="chip bg-brand-100 font-mono text-[11px] text-brand-800">
                    {m.tier === "48-jam" ? "expiring" : "expiring_24h"}
                  </code>
                </div>
                <div className="mt-2 flex items-end gap-6">
                  <div>
                    <div className="text-2xl font-extrabold text-gray-900">{m.reminded}</div>
                    <div className="text-xs text-gray-500">Pelanggan diingatkan</div>
                  </div>
                  <div>
                    <div className="text-2xl font-extrabold text-emerald-600">{m.reclaimed}</div>
                    <div className="text-xs text-gray-500">Mengklaim ulang</div>
                  </div>
                  <div className="ml-auto">
                    <div
                      className={`text-2xl font-extrabold ${
                        rate >= 20 ? "text-green-700" : rate > 0 ? "text-amber-600" : "text-gray-400"
                      }`}
                    >
                      {rate}%
                    </div>
                    <div className="text-xs text-gray-500">Tingkat klaim ulang</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap items-center gap-2" method="GET">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Cari penerima / nomor order…"
            className="input min-w-[220px] flex-1 !py-2 text-sm sm:max-w-xs"
          />
          <button type="submit" className="btn-primary !py-2 text-sm">
            Cari
          </button>
        </form>
        <a
          href={`/api/admin/notifications/export${status || q ? "?" : ""}${status ? `status=${status}` : ""}${status && q ? "&" : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`}
          className="btn-secondary !py-2 text-sm"
          title="Unduh CSV log notifikasi sesuai filter saat ini (untuk audit)"
        >
          ⬇️ Export CSV
        </a>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/admin/notifikasi"
          className={`rounded-full px-4 py-1.5 text-sm font-medium ${
            !status ? "bg-brand-600 text-white" : "border border-gray-200 bg-white text-gray-600"
          }`}
        >
          Semua
        </a>
        {statuses.map((s) => (
          <a
            key={s}
            href={`/admin/notifikasi${q ? `?q=${encodeURIComponent(q)}&` : "?"}status=${s}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium ${
              status === s ? "bg-brand-600 text-white" : "border border-gray-200 bg-white text-gray-600"
            }`}
          >
            {s === "sent" ? "Delivered" : STATUS_LABEL[s].label}
          </a>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Jenis</th>
              <th className="px-4 py-3">Penerima</th>
              <th className="px-4 py-3">No. Order</th>
              <th className="px-4 py-3">Hasil / Error</th>
              <th className="px-4 py-3">Waktu</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const st = STATUS_LABEL[l.status] ?? { label: l.status, color: "bg-gray-100 text-gray-700" };
              return (
                <tr key={l.id} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${st.color}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {NOTIFICATION_TYPE_LABEL[l.type] ?? l.type}
                    {l.templateName && (
                      <span className="mt-0.5 block font-mono text-[11px] text-gray-400">
                        template: {l.templateName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{l.recipient}</td>
                  <td className="px-4 py-3 font-mono text-xs font-semibold">
                    {l.orderNumber ? (
                      <a
                        href={`/admin/orders?q=${encodeURIComponent(l.orderNumber)}`}
                        className="text-brand-700 underline decoration-brand-200 underline-offset-2 hover:text-brand-800"
                      >
                        {l.orderNumber}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="max-w-[320px] px-4 py-3 text-xs text-gray-600">
                    {l.status === "sent" ? (
                      <span className="text-green-700">✓ Delivered</span>
                    ) : l.status === "failed" ? (
                      <span className="font-medium text-red-700">✗ {l.error ?? "Error"}</span>
                    ) : (
                      <span className="text-gray-500">Dicatat (demo, tanpa token)</span>
                    )}
                    {l.message && (
                      <span className="mt-1 block truncate text-[11px] text-gray-400" title={l.message}>
                        {l.message}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDateLong(l.createdAt)}
                  </td>
                </tr>
              );
            })}
            {logs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  Belum ada log notifikasi. Log muncul saat notifikasi WhatsApp dikirim
                  (pembayaran, order baru, voucher diredeem, atau voucher hampir kadaluarsa).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
