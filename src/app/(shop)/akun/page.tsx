import type { Metadata } from "next";
import Link from "next/link";
import Badge, { paymentBadge } from "@/components/Badge";
import LogoutButton from "@/components/LogoutButton";
import RetryPaymentButton from "@/components/RetryPaymentButton";
import { getSessionUser, isGuest } from "@/lib/auth";
import { getDB, getStoreMode } from "@/lib/db";
import { getOrdersByUser } from "@/lib/service";
import { formatDate, formatDateTime, formatRupiah } from "@/lib/format";
import type { Order, PaymentAuditEvent, SnapCallbackRecord } from "@/lib/types";

export const metadata: Metadata = {
  title: "Akun",
};

const TYPE_LABEL: Record<Order["type"], string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

export default function AkunPage() {
  const user = getSessionUser();
  const guest = isGuest();

  if (guest && !user) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <span className="text-5xl" aria-hidden="true">👤</span>
        <h1 className="mt-3 text-lg font-bold text-gray-900">Kamu sedang sebagai Tamu</h1>
        <p className="mt-1 text-sm text-gray-500">
          Masuk atau daftar untuk mengklaim voucher, melihat status member, dan berbelanja.
        </p>
        <Link href="/masuk" className="btn-primary mt-5 w-full">Masuk / Daftar</Link>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="card mx-auto max-w-md p-8 text-center">
        <span className="text-5xl" aria-hidden="true">👤</span>
        <h1 className="mt-3 text-lg font-bold text-gray-900">Belum masuk</h1>
        <Link href="/masuk" className="btn-primary mt-5 w-full">Masuk / Daftar</Link>
      </div>
    );
  }

  const orders = getOrdersByUser(user.id);

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="card flex items-center gap-4 p-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-xl font-bold text-white">
          {user.name.charAt(0).toUpperCase()}
        </span>
        <div>
          <p className="font-bold text-gray-900">{user.name}</p>
          <p className="text-sm text-gray-500">{user.email ?? user.phone}</p>
          <p className="mt-0.5 text-xs capitalize text-brand-600">
            {user.role === "customer" ? "Pelanggan" : user.role === "merchant" ? "Merchant" : "Admin"}
          </p>
        </div>
      </div>

      <nav className="card divide-y divide-gray-100" aria-label="Menu akun">
        <MenuLink href="/status-member" icon="⭐" label="Status Member" desc="Saldo, masa aktif, sisa akun" />
        <MenuLink href="/voucher-saya" icon="🎟️" label="Voucher Saya" desc="Kode & kode konfirmasi voucher" />
        <MenuLink href="/topup" icon="💰" label="Top Up Saldo" desc="Isi saldo V Shop" />
        <MenuLink href="/paket" icon="📦" label="Pilih Paket" desc="Perpanjang masa aktif" />
        <MenuLink href="/promo" icon="🔥" label="Promo" desc="Klaim voucher harian" />
        {user.role === "merchant" && (
          <MenuLink href="/merchant/dashboard" icon="🏪" label="Dashboard Merchant" desc="Kelola promo & voucher" />
        )}
        {user.role === "admin" && (
          <MenuLink href="/admin" icon="🛡️" label="Dashboard Admin" desc="Kelola platform" />
        )}
      </nav>

      <section aria-labelledby="riwayat-pembayaran">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 id="riwayat-pembayaran" className="text-sm font-bold text-gray-900">
            Riwayat Pembayaran
          </h2>
          {orders.length > 0 && (
            <span className="text-xs text-gray-400">{orders.length} transaksi</span>
          )}
        </div>

        {orders.length === 0 ? (
          <div className="card p-6 text-center">
            <span className="text-3xl" aria-hidden="true">🧾</span>
            <p className="mt-2 text-sm text-gray-500">
              Belum ada riwayat pembayaran. Yuk mulai belanja atau pilih paket!
            </p>
            <Link href="/paket" className="btn-primary mt-4 w-full">Lihat Paket</Link>
          </div>
        ) : (
          <div className="card divide-y divide-gray-100 p-0">
            {orders.slice(0, 10).map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </section>

      <LogoutButton className="btn-secondary w-full !text-red-600" />
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
          <Link href={`/sukses?order=${order.id}`} className="btn-secondary w-full py-2 text-sm">
            Lihat Detail
          </Link>
        ) : retryable ? (
          <RetryPaymentButton
            orderId={order.id}
            className="btn-primary w-full py-2 text-sm"
          />
        ) : (
          <Link href={`/bayar/${order.id}`} className="btn-secondary w-full py-2 text-sm">
            Lanjut Bayar
          </Link>
        )}
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

/**
 * Kronologi status pembayaran per order (metadata.paymentAudit): status_code /
 * status_message Midtrans dari webhook, Status API, callback Snap, retry,
 * dst. — terbaru di atas. Setiap kegagalan bisa ditelusuri urutannya.
 */
function PaymentAuditHistory({ events }: { events: PaymentAuditEvent[] }) {
  return (
    <details className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <summary className="cursor-pointer select-none text-xs font-semibold text-gray-600">
        Riwayat Status Pembayaran ({events.length})
      </summary>
      <ul className="mt-2 space-y-1.5">
        {[...events].reverse().map((ev, i) => (
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
            {(ev.statusMessage || ev.transactionStatus || ev.detail) && (
              <span className="mt-0.5 block font-mono text-[11px] text-gray-500">
                {ev.statusMessage ?? ev.transactionStatus ?? ev.detail}
              </span>
            )}
          </li>
        ))}
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

function MenuLink({
  href,
  icon,
  label,
  desc,
}: {
  href: string;
  icon: string;
  label: string;
  desc: string;
}) {
  return (
    <Link href={href} className="flex items-center gap-3 p-4 transition hover:bg-gray-50">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <span className="flex-1">
        <span className="block text-sm font-semibold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{desc}</span>
      </span>
      <span className="text-gray-300" aria-hidden="true">›</span>
    </Link>
  );
}
