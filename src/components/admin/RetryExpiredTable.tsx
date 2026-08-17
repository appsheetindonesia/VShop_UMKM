"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime, formatRupiah } from "@/lib/format";

export interface ExpiredOrderRow {
  id: string;
  orderNumber: string;
  originalOrderNumber?: string;
  previousOrderNumbers: string[];
  customerName: string;
  typeLabel: string;
  totalAmount: number;
  expiredAt: string;
  audit: Array<{ at: string; source: string; event: string; orderNumber?: string; detail?: string }>;
}

interface BulkItemResult {
  orderId: string;
  ok: boolean;
  newOrderNumber?: string;
  redirect?: string;
  error?: string;
}

interface BulkResult {
  ok: boolean;
  summary?: { total: number; ok: number; failed: number };
  results?: BulkItemResult[];
  message?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  cron: "Auto-expire",
  retry: "Coba lagi",
  webhook: "Webhook",
  "status-api": "Status API",
  "client-fail": "Gagal (klien)",
  create: "Dibuat",
  snap: "Snap",
  mock: "Simulasi",
};

export default function RetryExpiredTable({ orders }: { orders: ExpiredOrderRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const allIds = useMemo(() => orders.map((o) => o.id), [orders]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setResult(null);
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
    setResult(null);
  }

  async function retry(orderIds: string[]) {
    if (orderIds.length === 0 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/retry-expired", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      });
      const data = (await res.json().catch(() => null)) as BulkResult | null;
      setResult(data ?? { ok: false, message: "Respons tidak valid" });
      if (data?.ok) setSelected(new Set());
      router.refresh();
    } catch {
      setResult({ ok: false, message: "Gagal terhubung ke server" });
    } finally {
      setBusy(false);
    }
  }

  const resultById = useMemo(() => {
    const map = new Map<string, BulkItemResult>();
    for (const r of result?.results ?? []) map.set(r.orderId, r);
    return map;
  }, [result]);

  return (
    <div className="space-y-4">
      {result && (
        <div
          className={`rounded-2xl border-2 p-4 text-sm ${
            result.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {result.ok && result.summary ? (
            <p className="font-semibold">
              {result.summary.ok} dari {result.summary.total} order disiapkan ulang.{" "}
              {result.summary.failed > 0 && `${result.summary.failed} gagal — lihat detail di tabel.`}
            </p>
          ) : (
            <p className="font-semibold">{result.message ?? "Proses gagal"}</p>
          )}
          {result.results && result.results.filter((r) => !r.ok).length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {result.results
                .filter((r) => !r.ok)
                .map((r) => (
                  <li key={r.orderId}>
                    {r.error} {r.orderId ? `(${r.orderId.slice(0, 12)}…)` : ""}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => retry(Array.from(selected))}
          disabled={busy || selected.size === 0}
          className="btn-primary !py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Memproses…" : `Retry Massal (${selected.size})`}
        </button>
        <button
          type="button"
          onClick={toggleAll}
          className="btn-secondary !py-2 text-sm"
        >
          {allSelected ? "Batalkan semua" : "Pilih semua"}
        </button>
        <span className="text-xs text-gray-500">
          Order yang sudah dipilih akan dibuatkan ulang snap token + nomor order baru dan bisa
          langsung dibayar pelanggan.
        </span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Pilih semua"
                  className="accent-brand-600"
                />
              </th>
              <th className="px-4 py-3">No. Order</th>
              <th className="px-4 py-3">Pelanggan</th>
              <th className="px-4 py-3">Tipe</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Kadaluarsa</th>
              <th className="px-4 py-3">Riwayat Auto-Expire</th>
              <th className="px-4 py-3">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const r = resultById.get(o.id);
              return (
                <tr key={o.id} className="border-b border-gray-100 align-top">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                      aria-label={`Pilih ${o.orderNumber}`}
                      className="accent-brand-600"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-semibold text-brand-700">
                      {o.orderNumber}
                    </span>
                    {o.originalOrderNumber && (
                      <span className="mt-0.5 block font-mono text-[11px] text-gray-400">
                        asal: {o.originalOrderNumber}
                      </span>
                    )}
                    {o.previousOrderNumbers.length > 0 && (
                      <span className="block font-mono text-[11px] text-gray-400">
                        riwayat: {o.previousOrderNumbers.join(", ")}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{o.customerName}</td>
                  <td className="px-4 py-3 text-gray-600">{o.typeLabel}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">
                    {formatRupiah(o.totalAmount)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                    {formatDateTime(o.expiredAt)}
                  </td>
                  <td className="max-w-[280px] px-4 py-3">
                    <ul className="space-y-1">
                      {o.audit.map((a, i) => (
                        <li key={i} className="text-[11px] text-gray-600">
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                            {SOURCE_LABEL[a.source] ?? a.source}
                          </span>{" "}
                          {a.event === "expired" ? "kadaluarsa" : a.event} · {formatDateTime(a.at)}
                          {a.orderNumber && (
                            <span className="font-mono text-gray-400"> · {a.orderNumber}</span>
                          )}
                          {a.detail && <span className="block text-gray-400">{a.detail}</span>}
                        </li>
                      ))}
                      {o.audit.length === 0 && (
                        <li className="text-[11px] text-gray-400">Tanpa catatan audit</li>
                      )}
                    </ul>
                  </td>
                  <td className="px-4 py-3">
                    {r?.ok ? (
                      <span className="text-xs font-semibold text-green-700">
                        ✓ {r.newOrderNumber}
                      </span>
                    ) : r && !r.ok ? (
                      <span className="text-xs font-semibold text-red-700">{r.error}</span>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => retry([o.id])}
                        className="btn-secondary !py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                  Tidak ada order kadaluarsa. Order pending yang melewati{" "}
                  <code className="rounded bg-gray-100 px-1 py-0.5">ORDER_EXPIRY_HOURS</code> jam
                  akan tampil di sini setelah cron auto-expire berjalan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
