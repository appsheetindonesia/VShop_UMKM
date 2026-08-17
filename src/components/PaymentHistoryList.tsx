import Link from "next/link";
import Badge, { paymentBadge } from "@/components/Badge";
import RetryPaymentButton from "@/components/RetryPaymentButton";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import { buildListHref } from "@/lib/pagination";
import { auditDisplayText, filterPaymentOrders } from "@/lib/payment-history";
import type { Order, PaymentAuditEvent, SnapCallbackRecord } from "@/lib/types";

export { filterPaymentOrders };

/**
 * Riwayat pembayaran — komponen BERSAMA untuk halaman akun (pratinjau 5
 * terakhir + filter) dan halaman lengkap /akun/riwayat-pembayaran.
 * Server component: tidak ada state client; filter lewat searchParams
 * (tab = link, pencarian = form GET) — konsisten dengan halaman admin.
 */

const TYPE_LABEL: Record<Order["type"], string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};



/** Tab Semua/Berhasil/Gagal + tab jenis transaksi + form pencarian nomor order (GET, status/type dipertahankan). */
export function PaymentHistoryControls({
  basePath,
  status,
  type,
  q,
}: {
  basePath: string;
  status?: string;
  type?: string;
  q?: string;
}) {
  const statusTabs = [
    { key: "", label: "Semua" },
    { key: "paid", label: "Berhasil" },
    { key: "failed", label: "Gagal" },
  ];
  const typeTabs = [
    { key: "", label: "Semua Jenis" },
    { key: "package", label: "Paket" },
    { key: "topup", label: "Top Up" },
    { key: "merchandise", label: "Merchandise" },
  ];
  const statusHref = (key: string) =>
    buildListHref(basePath, { status: key || undefined, type, q });
  const typeHref = (key: string) =>
    buildListHref(basePath, { status, type: key || undefined, q });
  const resetHref = buildListHref(basePath, { status, type });

  const tab = (
    t: { key: string; label: string },
    activeKey: string | undefined,
    makeHref: (key: string) => string
  ) => {
    const active = (t.key === "" && !activeKey) || t.key === activeKey;
    return (
      <a
        key={t.key}
        href={makeHref(t.key)}
        role="tab"
        aria-selected={active}
        className={`rounded-full px-4 py-1.5 text-sm font-medium ${
          active
            ? "bg-brand-600 text-white"
            : "border border-gray-200 bg-white text-gray-600 hover:border-brand-300"
        }`}
      >
        {t.label}
      </a>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter status pembayaran">
        {statusTabs.map((t) => tab(t, status, statusHref))}
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter jenis transaksi">
        {typeTabs.map((t) => tab(t, type, typeHref))}
      </div>
      <form method="GET" action={basePath} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="status" value={status ?? ""} />
        <input type="hidden" name="type" value={type ?? ""} />
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Cari nomor order…"
          className="input min-w-[180px] flex-1 !py-2 text-sm sm:max-w-xs"
          aria-label="Cari nomor order"
        />
        <button type="submit" className="btn-primary !py-2 text-sm">
          Cari
        </button>
        {q && (
          <a href={resetHref} className="btn-secondary !py-2 text-sm">
            Reset
          </a>
        )}
      </form>
    </div>
  );
}

/** Daftar kartu riwayat pembayaran (satu OrderRow per order). */
export default function PaymentHistoryList({ orders }: { orders: Order[] }) {
  return (
    <div className="card divide-y divide-gray-100 p-0">
      {orders.map((order) => (
        <OrderRow key={order.id} order={order} />
      ))}
    </div>
  );
}

/** Satu baris riwayat pembayaran + aksi sesuai status. */
function OrderRow({ order }: { order: Order }) {
  const reason =
    typeof order.metadata?.failureReason === "string" ? order.metadata.failureReason : undefined;
  const retryable = order.paymentStatus === "failed" || order.paymentStatus === "expired";
  const callbacks = Array.isArray(order.metadata?.snapCallbacks)
    ? (order.metadata.snapCallbacks as SnapCallbackRecord[])
    : [];
  const audit = Array.isArray(order.metadata?.paymentAudit)
    ? (order.metadata.paymentAudit as PaymentAuditEvent[])
    : [];
  const status = paymentBadge(order.paymentStatus, reason);

  return (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-gray-900">{order.orderNumber}</p>
            <Badge color={status.color}>{status.label}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {TYPE_LABEL[order.type]} · {formatDate(order.createdAt)}
            {order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
          </p>
        </div>
        <p className="shrink-0 text-sm font-extrabold text-gray-900">
          {formatRupiah(order.totalAmount)}
        </p>
      </div>

      {audit.length > 0 && <PaymentAuditHistory events={audit} />}

      {callbacks.length > 0 && <SnapCallbackHistory callbacks={callbacks} />}

      <div className="mt-2">
        {order.paymentStatus === "paid" ? (
          <Link href={`/transaksi/${order.id}`} className="btn-secondary w-full py-2 text-sm">
            Lihat Detail
          </Link>
        ) : retryable ? (
          <RetryPaymentButton orderId={order.id} className="btn-primary w-full py-2 text-sm" />
        ) : (
          <Link href={`/bayar/${order.id}`} className="btn-secondary w-full py-2 text-sm">
            Lanjut Bayar
          </Link>
        )}
        <Link
          href={`/transaksi/${order.id}`}
          className="mt-1.5 block text-center text-xs font-medium text-brand-600 hover:text-brand-700"
        >
          Detail transaksi
        </Link>
      </div>
    </div>
  );
}

const AUDIT_EVENT_LABEL: Record<string, string> = {
  created: "Dibuat",
  paid: "Berhasil",
  failed: "Gagal",
  expired: "Kadaluarsa",
  pending: "Menunggu",
  retry: "Coba Lagi",
  success: "Snap Berhasil",
  error: "Snap Error",
  close: "Snap Ditutup",
};

const AUDIT_SOURCE_LABEL: Record<string, string> = {
  create: "Order",
  snap: "Snap",
  "status-api": "Status API",
  webhook: "Webhook",
  "client-fail": "Layar bayar",
  cron: "Auto-expire",
  retry: "Coba Lagi",
  mock: "Demo",
};

/** Kronologi status pembayaran per order (metadata.paymentAudit) — terbaru di atas. */
function PaymentAuditHistory({ events }: { events: PaymentAuditEvent[] }) {
  return (
    <details className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-gray-600">
        Riwayat Status Pembayaran ({events.length})
      </summary>
      <ul className="mt-2 space-y-1.5">
        {[...events].reverse().map((ev, i) => {
          const text = auditDisplayText(ev);
          return (
          <li key={i} className="text-xs text-gray-600">
            <span className="font-semibold text-gray-800">
              {AUDIT_EVENT_LABEL[ev.event] ?? ev.event}
            </span>
            <span className="text-gray-400">
              {" "}· {AUDIT_SOURCE_LABEL[ev.source] ?? ev.source}
              {ev.orderNumber ? ` · ${ev.orderNumber}` : ""}
              {ev.statusCode ? ` · kode ${ev.statusCode}` : ""}
              {" "}· {formatDateTime(ev.at)}
            </span>
            {text.primary && (
              <span className="mt-0.5 block text-[11px] text-gray-600">{text.primary}</span>
            )}
            {text.raw && (
              <span className="mt-0.5 block font-mono text-[11px] text-gray-400">
                pesan mentah: {text.raw}
              </span>
            )}
          </li>
          );
        })}
      </ul>
    </details>
  );
}

const SNAP_EVENT: Record<string, { label: string; dot: string }> = {
  success: { label: "Berhasil", dot: "bg-green-500" },
  pending: { label: "Menunggu", dot: "bg-yellow-400" },
  error: { label: "Error", dot: "bg-red-500" },
  close: { label: "Ditutup", dot: "bg-gray-400" },
};

/** Ringkasan satu baris dari hasil transaksi Snap (audit). */
function snapResultLine(result?: Record<string, unknown>): string {
  if (!result) return "";
  const bits: string[] = [];
  if (typeof result.transaction_status === "string") bits.push(result.transaction_status);
  if (typeof result.status_code === "string") bits.push(`kode ${result.status_code}`);
  if (typeof result.payment_type === "string") bits.push(result.payment_type);
  if (typeof result.transaction_id === "string") bits.push(`#${result.transaction_id.slice(0, 12)}`);
  return bits.join(" · ");
}

/** Riwayat callback Snap.js order (dari metadata.snapCallbacks), paling baru di atas. */
function SnapCallbackHistory({ callbacks }: { callbacks: SnapCallbackRecord[] }) {
  const latest = callbacks[callbacks.length - 1];
  return (
    <details className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-gray-600">
        Riwayat callback Snap ({callbacks.length})
        {latest && ` · terakhir: ${SNAP_EVENT[latest.event]?.label ?? latest.event}`}
      </summary>
      <ul className="mt-2 space-y-1.5">
        {[...callbacks].reverse().map((cb, i) => (
          <li key={i} className="text-xs text-gray-600">
            <span className="flex items-center gap-1.5 font-semibold text-gray-800">
              <span
                className={`inline-block h-2 w-2 rounded-full ${SNAP_EVENT[cb.event]?.dot ?? "bg-gray-400"}`}
                aria-hidden="true"
              />
              {SNAP_EVENT[cb.event]?.label ?? cb.event}
              <span className="font-normal text-gray-400">· {formatDateTime(cb.at)}</span>
            </span>
            {snapResultLine(cb.result) && (
              <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                {snapResultLine(cb.result)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
