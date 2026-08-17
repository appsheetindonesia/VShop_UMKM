"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Badge, { paymentBadge } from "@/components/Badge";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { AUDIT_EVENT_LABEL, buildAuditTimeline } from "@/lib/payment-history";
import type { OrderItem, PaymentAuditEvent, SnapCallbackRecord } from "@/lib/types";

/**
 * Tabel riwayat pembayaran untuk dashboard admin — terbaru di atas, badge
 * status + alasan gagal spesifik, dan tombol **Retry** per baris untuk order
 * gagal/kadaluarsa (dari sisi admin, memakai endpoint admin yang sama dengan
 * halaman Order Kadaluarsa). Status non-terminal tidak punya tombol retry.
 *
 * Klik baris membuka **panel detail** di bawahnya: item order, kronologi
 * status pembayaran (paymentAudit), dan riwayat callback Snap.js — data
 * dibawa server (mapPaymentRow), tanpa request tambahan.
 */

const TYPE_LABEL: Record<string, string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

export interface AdminPaymentRow {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  type: "package" | "topup" | "merchandise";
  totalAmount: number;
  paymentStatus: string;
  status: string;
  createdAt: string;
  failureReason?: string;
  items?: OrderItem[];
  paymentAudit?: PaymentAuditEvent[];
  snapCallbacks?: SnapCallbackRecord[];
}

interface RetryResponse {
  ok: boolean;
  summary?: { total: number; ok: number; failed: number };
  results?: Array<{ orderId: string; ok: boolean; newOrderNumber?: string; error?: string }>;
  message?: string;
}

/** Ekstrak beberapa field hasil transaksi Snap untuk ringkasan baris callback. */
function snapResultSummary(result?: Record<string, unknown>): string[] {
  if (!result) return [];
  const pick = ["transaction_status", "status_code", "payment_type", "transaction_id"];
  return pick
    .map((k) => {
      const v = result[k];
      return typeof v === "string" && v.length > 0 ? `${k}: ${v}` : undefined;
    })
    .filter((x): x is string => x !== undefined);
}

function DetailPanel({ o }: { o: AdminPaymentRow }) {
  const items = o.items ?? [];
  const timeline = buildAuditTimeline(o.paymentAudit ?? []);
  const callbacks = o.snapCallbacks ?? [];

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-3">
      {/* Item order */}
      <section aria-label="Item pesanan">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
          🧾 Item Pesanan
        </h3>
        {items.length === 0 ? (
          <p className="text-sm text-gray-400">Tidak ada item.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((it, i) => (
              <li
                key={i}
                className="flex items-baseline justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="text-gray-700">
                  {it.name}
                  <span className="text-xs text-gray-400"> ×{it.quantity}</span>
                </span>
                <span className="whitespace-nowrap font-semibold text-gray-900">
                  {formatRupiah(it.unitPrice * it.quantity)}
                </span>
              </li>
            ))}
            <li className="flex items-baseline justify-between gap-2 px-1 pt-1 text-sm font-bold text-gray-900">
              <span>Total</span>
              <span>{formatRupiah(o.totalAmount)}</span>
            </li>
          </ul>
        )}
      </section>

      {/* Kronologi status pembayaran */}
      <section aria-label="Riwayat status pembayaran">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
          🕒 Riwayat Status Pembayaran
        </h3>
        {timeline.length === 0 ? (
          <p className="text-sm text-gray-400">Belum ada riwayat audit.</p>
        ) : (
          <ol className="space-y-2">
            {timeline.map((step, i) => (
              <li key={i} className="relative pl-4 text-sm">
                <span
                  className={`absolute left-0 top-1.5 h-2 w-2 rounded-full ${
                    step.isLatest ? "bg-brand-600" : "bg-gray-300"
                  }`}
                  aria-hidden="true"
                />
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold text-gray-800">{step.label}</span>
                  {step.isLatest && (
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-700">
                      saat ini
                    </span>
                  )}
                  <span className="text-xs text-gray-400">
                    {step.sourceLabel} · {formatDateTime(step.at)}
                  </span>
                </div>
                {(step.statusCode ||
                  step.transactionStatus ||
                  step.paymentType ||
                  step.orderNumber) && (
                  <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                    {[step.transactionStatus, step.statusCode, step.paymentType]
                      .filter(Boolean)
                      .join(" · ")}
                    {step.orderNumber ? ` · ${step.orderNumber}` : ""}
                  </p>
                )}
                {step.detail && <p className="text-xs text-gray-500">{step.detail}</p>}
                {step.statusMessage && (
                  <p className="text-xs text-gray-400">“{step.statusMessage}”</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Callback Snap.js */}
      <section aria-label="Riwayat callback Snap">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">
          ⚡ Callback Snap
        </h3>
        {callbacks.length === 0 ? (
          <p className="text-sm text-gray-400">Belum ada callback Snap.</p>
        ) : (
          <ul className="space-y-1.5">
            {callbacks.map((cb, i) => (
              <li key={i} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-gray-800">
                    {AUDIT_EVENT_LABEL[cb.event] ?? cb.event}
                  </span>
                  <span className="text-xs text-gray-400">{formatDateTime(cb.at)}</span>
                </div>
                {snapResultSummary(cb.result).length > 0 && (
                  <p className="mt-1 font-mono text-[11px] leading-relaxed text-gray-500">
                    {snapResultSummary(cb.result).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function AdminPaymentHistory({ orders }: { orders: AdminPaymentRow[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resultById, setResultById] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  async function retry(order: AdminPaymentRow) {
    if (busyId) return;
    setBusyId(order.id);
    try {
      const res = await fetch("/api/admin/retry-expired", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds: [order.id] }),
      });
      const data = (await res.json().catch(() => null)) as RetryResponse | null;
      const item = data?.results?.[0];
      if (item?.ok) {
        setResultById((prev) => ({
          ...prev,
          [order.id]: { ok: true, text: `✓ ${item.newOrderNumber ?? "disiapkan ulang"}` },
        }));
      } else {
        setResultById((prev) => ({
          ...prev,
          [order.id]: { ok: false, text: item?.error ?? data?.message ?? "Gagal menyiapkan ulang" },
        }));
      }
      router.refresh();
    } catch {
      setResultById((prev) => ({
        ...prev,
        [order.id]: { ok: false, text: "Gagal terhubung ke server" },
      }));
    } finally {
      setBusyId(null);
    }
  }

  if (orders.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-gray-500">
        Belum ada transaksi. Riwayat pembayaran akan tampil di sini setelah ada order.
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
            <th className="px-4 py-3">No. Order</th>
            <th className="px-4 py-3">Pelanggan</th>
            <th className="px-4 py-3">Tipe</th>
            <th className="px-4 py-3">Total</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Waktu</th>
            <th className="px-4 py-3">Aksi</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const badge = paymentBadge(o.paymentStatus, o.failureReason);
            const res = resultById[o.id];
            const retryable = o.paymentStatus === "failed" || o.paymentStatus === "expired";
            const expanded = expandedId === o.id;
            const hasDetail =
              (o.items?.length ?? 0) > 0 ||
              (o.paymentAudit?.length ?? 0) > 0 ||
              (o.snapCallbacks?.length ?? 0) > 0;
            return (
              <FragmentRow
                key={o.id}
                o={o}
                badgeColor={badge.color}
                badgeLabel={badge.label}
                res={res}
                retryable={retryable}
                busyId={busyId}
                busy={busyId === o.id}
                expanded={expanded}
                hasDetail={hasDetail}
                onToggle={() => setExpandedId(expanded ? null : o.id)}
                onRetry={() => retry(o)}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  o,
  badgeColor,
  badgeLabel,
  res,
  retryable,
  busyId,
  busy,
  expanded,
  hasDetail,
  onToggle,
  onRetry,
}: {
  o: AdminPaymentRow;
  badgeColor: string;
  badgeLabel: string;
  res?: { ok: boolean; text: string };
  retryable: boolean;
  /** id order yang sedang diproses retry (null = tidak ada). */
  busyId: string | null;
  /** true bila baris INI sedang memproses retry. */
  busy: boolean;
  expanded: boolean;
  hasDetail: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  return (
    <>
      <tr
        onClick={hasDetail ? onToggle : undefined}
        className={`border-b border-gray-100 align-top ${
          hasDetail ? "cursor-pointer hover:bg-gray-50" : ""
        }`}
      >
        <td className="whitespace-nowrap px-4 py-3">
          <span className="inline-flex items-center gap-1.5">
            {hasDetail && (
              <span
                className={`text-[10px] text-gray-400 transition-transform ${
                  expanded ? "rotate-90" : ""
                }`}
                aria-hidden="true"
              >
                ▶
              </span>
            )}
            <span className="font-mono text-xs font-semibold text-brand-700">
              {o.orderNumber}
            </span>
          </span>
        </td>
        <td className="px-4 py-3 text-gray-700">{o.customerName}</td>
        <td className="px-4 py-3 text-gray-600">{TYPE_LABEL[o.type] ?? o.type}</td>
        <td className="whitespace-nowrap px-4 py-3 font-semibold text-gray-900">
          {formatRupiah(o.totalAmount)}
        </td>
        <td className="px-4 py-3">
          <Badge color={badgeColor}>{badgeLabel}</Badge>
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
          {formatDateTime(o.createdAt)}
        </td>
        <td className="whitespace-nowrap px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {res ? (
            <span
              className={`text-xs font-semibold ${res.ok ? "text-green-700" : "text-red-700"}`}
            >
              {res.text}
            </span>
          ) : retryable ? (
            <button
              type="button"
              disabled={busyId !== null}
              onClick={onRetry}
              className="btn-secondary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Memproses…" : "Retry"}
            </button>
          ) : (
            <span className="text-xs text-gray-300">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td colSpan={7} className="p-0">
            <DetailPanel o={o} />
          </td>
        </tr>
      )}
    </>
  );
}
