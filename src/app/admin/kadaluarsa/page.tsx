import type { Metadata } from "next";
import { getDB } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getCronRunHistory, getLastCronRun } from "@/lib/cron-log";
import type { PaymentAuditEvent } from "@/lib/types";
import RetryExpiredTable from "@/components/admin/RetryExpiredTable";

export const metadata: Metadata = {
  title: "Order Kadaluarsa",
};

export const dynamic = "force-dynamic";

/** Serialisasi entri audit yang relevan (expired / retry / sumber lain) utk UI. */
function auditTimeline(order: {
  metadata: Record<string, unknown>;
}): Array<{ at: string; source: string; event: string; orderNumber?: string; detail?: string }> {
  const audit = Array.isArray(order.metadata.paymentAudit)
    ? (order.metadata.paymentAudit as PaymentAuditEvent[])
    : [];
  return audit
    .filter((a) => a.event === "expired" || a.source === "retry" || a.source === "cron")
    .slice(-12)
    .reverse()
    .map((a) => ({
      at: a.at,
      source: a.source,
      event: a.event,
      orderNumber: a.orderNumber,
      detail: a.detail,
    }));
}

/** Waktu order di-expire: dari entri audit event "expired" (terbaru), fallback createdAt. */
function expiredAtOf(order: {
  metadata: Record<string, unknown>;
  createdAt: string;
}): string {
  const audit = Array.isArray(order.metadata.paymentAudit)
    ? (order.metadata.paymentAudit as PaymentAuditEvent[])
    : [];
  const ev = [...audit].reverse().find((a) => a.event === "expired");
  return ev?.at ?? order.createdAt;
}

const TYPE_LABEL: Record<string, string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

export default async function AdminExpiredOrdersPage({
  searchParams,
}: {
  searchParams?: { q?: string };
}) {
  const db = getDB();
  const q = searchParams?.q?.toLowerCase().trim();

  // Riwayat run job auto-expire (tabel cron_runs) — kapan terakhir berjalan
  // & berapa order yang di-expire per periode.
  const lastRun = await getLastCronRun("expire");
  const runHistory = await getCronRunHistory("expire", 14);

  const rows = db.orders
    .filter((o) => o.paymentStatus === "expired")
    .map((o) => {
      const customer = db.users.find((u) => u.id === o.userId);
      const meta = o.metadata as Record<string, unknown>;
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        originalOrderNumber:
          typeof meta.originalOrderNumber === "string" ? meta.originalOrderNumber : undefined,
        previousOrderNumbers: Array.isArray(meta.previousOrderNumbers)
          ? (meta.previousOrderNumbers as string[])
          : [],
        customerName: customer?.name ?? "Pelanggan",
        typeLabel: TYPE_LABEL[o.type] ?? o.type,
        totalAmount: o.totalAmount,
        expiredAt: expiredAtOf(o),
        audit: auditTimeline(o),
      };
    })
    .filter((r) =>
      q
        ? r.orderNumber.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          (r.originalOrderNumber ?? "").toLowerCase().includes(q)
        : true
    )
    .sort((a, b) => new Date(b.expiredAt).getTime() - new Date(a.expiredAt).getTime());

  const totalExpired = db.orders.filter((o) => o.paymentStatus === "expired").length;

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">⏰ ORDER KADALUARSA</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Order Kadaluarsa</h1>
        <p className="mt-1 text-sm text-gray-500">
          Riwayat auto-expire ({totalExpired} order) dari log metadata — retry massal untuk order
          yang masih bisa dibayar ulang (snap token & nomor order baru).
        </p>
      </div>

      <form className="flex flex-wrap items-center gap-2" method="GET">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari nomor order / pelanggan…"
          className="input min-w-[220px] flex-1 !py-2 text-sm sm:max-w-xs"
        />
        <button type="submit" className="btn-primary !py-2 text-sm">
          Cari
        </button>
      </form>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
            🕰️ Job Auto-Expire Terakhir
          </p>
          {lastRun ? (
            <>
              <p className="mt-2 text-lg font-extrabold text-gray-900">
                {formatDateTime(lastRun.ranAt)}
              </p>
              <p className="mt-1 text-sm text-gray-600">
                {lastRun.expiredCount} order di-expire pada run ini.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">
              Job auto-expire belum pernah tercatat. Jalankan cron{" "}
              <code className="rounded bg-gray-100 px-1 py-0.5">/api/cron/expire-orders</code>{" "}
              atau tunggu scheduler lokal/jadwal Vercel.
            </p>
          )}
        </div>
        <div className="card overflow-hidden lg:col-span-2">
          <p className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-gray-400">
            📊 Riwayat per Periode (run terakhir)
          </p>
          {runHistory.length > 0 ? (
            <table className="mt-2 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2">Waktu Run</th>
                  <th className="px-4 py-2">Order Di-Expire</th>
                  <th className="px-4 py-2">Notifikasi</th>
                </tr>
              </thead>
              <tbody>
                {runHistory.map((r) => (
                  <tr key={r.id} className="border-b border-gray-100">
                    <td className="px-4 py-2 text-gray-700">{formatDateTime(r.ranAt)}</td>
                    <td className="px-4 py-2 font-semibold text-gray-900">{r.expiredCount}</td>
                    <td className="px-4 py-2 text-gray-600">{r.notifiedCount ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 pb-4 pt-2 text-sm text-gray-500">
              Belum ada riwayat run.
            </p>
          )}
        </div>
      </div>

      <RetryExpiredTable orders={rows} />
    </div>
  );
}
