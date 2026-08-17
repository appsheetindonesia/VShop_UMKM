import type { Metadata } from "next";
import Link from "next/link";
import LogoutButton from "@/components/LogoutButton";
import PaymentHistoryList, {
  filterPaymentOrders,
  PaymentHistoryControls,
} from "@/components/PaymentHistoryList";
import { getSessionUser, isGuest } from "@/lib/auth";
import { getDB, getStoreMode } from "@/lib/db";
import { buildListHref } from "@/lib/pagination";
import { formatDateLong } from "@/lib/format";
import {
  listNotificationLogs,
  NOTIFICATION_TYPE_LABEL,
  type NotificationLogEntry,
} from "@/lib/notif-log";
import { getOrdersByUser } from "@/lib/service";

export const metadata: Metadata = {
  title: "Akun",
};

const NOTIF_STATUS_LABEL: Record<string, { label: string; color: string }> = {
  sent: { label: "Terkirim", color: "bg-green-100 text-green-700" },
  demo: { label: "Demo", color: "bg-yellow-100 text-yellow-700" },
  failed: { label: "Gagal", color: "bg-red-100 text-red-700" },
};

export default async function AkunPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; type?: string };
}) {
  const status = searchParams?.status;
  const q = searchParams?.q;
  const type = searchParams?.type;
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
  const filtered = filterPaymentOrders(orders, status, q, type);

  // Riwayat notifikasi WhatsApp per order milik pelanggan ini (log terpusat).
  const orderNumbers = orders.map((o) => o.orderNumber);
  const { logs: notifLogs } =
    orderNumbers.length > 0
      ? await listNotificationLogs({ orderNumbers, limit: 50 })
      : { logs: [] as NotificationLogEntry[] };
  const orderByNumber = new Map(orders.map((o) => [o.orderNumber, o]));
  const notifGroups = new Map<string, NotificationLogEntry[]>();
  for (const l of notifLogs) {
    if (!l.orderNumber) continue;
    const arr = notifGroups.get(l.orderNumber) ?? [];
    arr.push(l);
    notifGroups.set(l.orderNumber, arr);
  }
  const notifGroupsOrdered = Array.from(notifGroups.entries()).sort(
    (a, b) =>
      new Date(b[1][0].createdAt).getTime() - new Date(a[1][0].createdAt).getTime()
  );

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
          <div className="space-y-3">
            <PaymentHistoryControls basePath="/akun" status={status} type={type} q={q} />
            {filtered.length === 0 ? (
              <div className="card p-6 text-center">
                <p className="text-sm text-gray-500">
                  Tidak ada riwayat dengan filter ini.
                </p>
                <Link href="/akun" className="btn-secondary mt-3 w-full !py-2 text-sm">
                  Reset Filter
                </Link>
              </div>
            ) : (
              <PaymentHistoryList orders={filtered.slice(0, 5)} />
            )}
            {filtered.length > 0 && (
              <Link
                href={buildListHref("/akun/riwayat-pembayaran", { status, type, q })}
                className="btn-secondary w-full !py-2.5 text-sm"
              >
                Lihat Semua ({filtered.length})
              </Link>
            )}
          </div>
        )}
      </section>

      {notifGroupsOrdered.length > 0 && (
        <section aria-labelledby="riwayat-notifikasi">
          <div className="mb-2 px-1">
            <h2 id="riwayat-notifikasi" className="text-sm font-bold text-gray-900">
              Notifikasi Order
            </h2>
            <p className="text-xs text-gray-400">Riwayat WhatsApp per pesananmu</p>
          </div>
          <div className="space-y-3">
            {notifGroupsOrdered.map(([orderNumber, entries]) => {
              const order = orderByNumber.get(orderNumber);
              return (
                <div key={orderNumber} className="card overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50/60 px-4 py-2">
                    <span className="font-mono text-xs font-bold text-brand-700">
                      {orderNumber}
                    </span>
                    {order && (
                      <Link
                        href={`/transaksi/${order.id}`}
                        className="text-xs font-medium text-brand-600 hover:underline"
                      >
                        Detail transaksi ›
                      </Link>
                    )}
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {entries.map((l) => {
                      const st =
                        NOTIF_STATUS_LABEL[l.status] ?? {
                          label: l.status,
                          color: "bg-gray-100 text-gray-600",
                        };
                      return (
                        <li key={l.id} className="flex items-start gap-3 px-4 py-2.5">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold text-gray-800">
                                {NOTIFICATION_TYPE_LABEL[l.type] ?? l.type}
                              </span>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${st.color}`}
                              >
                                {st.label}
                              </span>
                            </div>
                            {l.error && (
                              <p className="mt-0.5 text-[11px] text-red-600">{l.error}</p>
                            )}
                            {l.templateName && (
                              <p className="mt-0.5 truncate font-mono text-[10px] text-gray-400">
                                template: {l.templateName}
                              </p>
                            )}
                          </div>
                          <span className="whitespace-nowrap text-[10px] text-gray-400">
                            {formatDateLong(l.createdAt)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <LogoutButton className="btn-secondary w-full !text-red-600" />
    </div>
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
