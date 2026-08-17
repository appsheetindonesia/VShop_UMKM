import type { Metadata } from "next";
import Link from "next/link";
import AdminPaymentHistory from "@/components/admin/AdminPaymentHistory";
import {
  getAdminPaymentSummary,
  getAdminStats,
  getRetryMetrics,
  type PaymentRange,
} from "@/lib/service";
import { expiryStaleInfo, getExpiryRunSummary } from "@/lib/cron-log";
import { formatDateTime, formatRupiah } from "@/lib/format";

/** Tab rentang waktu ringkasan pembayaran (lewat `?range=` di URL). */
const RANGE_TABS: { key: PaymentRange; label: string; caption: string }[] = [
  { key: "today", label: "Hari Ini", caption: "hari ini" },
  { key: "7d", label: "7 Hari", caption: "7 hari terakhir" },
  { key: "30d", label: "30 Hari", caption: "30 hari terakhir" },
];

export const metadata: Metadata = {
  title: "Dashboard Admin",
};

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const raw = searchParams?.range;
  const range: PaymentRange = raw === "7d" || raw === "30d" ? raw : "today";
  const stats = getAdminStats();
  const pay = getAdminPaymentSummary(range);
  const retry = getRetryMetrics(7);
  const expiry = await getExpiryRunSummary(7);
  const expiryHealth = expiryStaleInfo(expiry.lastRunAt);

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🛡️ ADMIN</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Dashboard Admin</h1>
        <p className="mt-1 text-sm text-gray-500">Ringkasan aktivitas platform V Shop</p>
      </div>

      {expiryHealth.stale && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4"
        >
          <span className="text-3xl" aria-hidden="true">⏰</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-amber-900">
              Auto-expire tidak berjalan{" "}
              {expiryHealth.hoursSince === null
                ? "(belum pernah tercatat)"
                : `dalam ${Math.round(expiryHealth.hoursSince)} jam terakhir`}
            </p>
            <p className="text-xs text-amber-800">
              Job expire seharusnya jalan tiap jam — kemungkinan scheduler mati
              atau Supabase lokal tidak tersedia. Periksa di{" "}
              <Link href="/admin/cron" className="font-semibold underline">
                Cron Jobs
              </Link>{" "}
              atau jalankan ulang.
            </p>
          </div>
          <Link href="/admin/cron" className="btn-secondary !py-2 text-xs">
            ⏱️ Cek Cron Jobs
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pengguna Total" value={String(stats.totalUsers)} icon="👥" />
        <StatCard label="Pelanggan" value={String(stats.totalCustomers)} icon="🛍️" />
        <StatCard label="Merchant" value={String(stats.totalMerchants)} icon="🏪" />
        <StatCard label="Pending Review" value={String(stats.pendingMerchants)} icon="⏳" />
        <StatCard label="Membership Aktif" value={String(stats.activeMemberships)} icon="⭐" />
        <StatCard label="Voucher Diklaim" value={String(stats.claimedVouchers)} icon="🎟️" />
        <StatCard label="Pesanan" value={String(stats.totalOrders)} icon="🧾" />
        <StatCard label="Pendapatan" value={formatRupiah(stats.revenue)} icon="💰" />
      </div>

      {stats.pendingMerchants > 0 && (
        <Link
          href="/admin/merchants"
          className="flex items-center gap-3 rounded-2xl border-2 border-accent-200 bg-accent-50 p-4 transition hover:border-accent-400"
        >
          <span className="text-3xl" aria-hidden="true">⏳</span>
          <span className="flex-1">
            <span className="block font-bold text-accent-800">
              {stats.pendingMerchants} pendaftaran merchant menunggu review
            </span>
            <span className="block text-sm text-accent-700">Klik untuk meninjau →</span>
          </span>
        </Link>
      )}

      <section aria-labelledby="riwayat-pembayaran-admin">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="riwayat-pembayaran-admin" className="text-lg font-bold text-gray-900">
              💳 Riwayat Pembayaran
            </h2>
            <p className="text-xs text-gray-500">
              Transaksi{" "}
              {RANGE_TABS.find((t) => t.key === range)!.caption} ({pay.period.total}) ·
              pendapatan {formatRupiah(pay.period.revenue)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/api/admin/riwayat-csv?range=${range}`}
              className="btn-secondary !py-2 text-xs"
            >
              ⬇️ Unduh CSV
            </a>
            <Link href="/admin/kadaluarsa" className="btn-secondary !py-2 text-xs">
              Order Kadaluarsa
            </Link>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Rentang waktu ringkasan pembayaran"
          className="mb-4 flex w-fit items-center gap-1 rounded-xl bg-gray-100 p-1"
        >
          {RANGE_TABS.map((t) => {
            const active = t.key === range;
            return (
              <Link
                key={t.key}
                role="tab"
                aria-selected={active}
                href={`/admin?range=${t.key}`}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-white text-brand-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCard label="Berhasil" value={pay.period.paid} icon="✅" tone="green" />
          <StatusCard label="Gagal" value={pay.period.failed} icon="❌" tone="red" />
          <StatusCard label="Kadaluarsa" value={pay.period.expired} icon="⏰" tone="gray" />
          <StatusCard label="Menunggu" value={pay.period.pending} icon="⏳" tone="yellow" />
        </div>

        <AdminPaymentHistory orders={pay.recent} />
      </section>

      <section aria-labelledby="cron-admin">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="cron-admin" className="text-lg font-bold text-gray-900">
              ⏰ Cron Auto-Expire
            </h2>
            <p className="text-xs text-gray-500">
              Ringkasan job terjadwal (dari tabel cron_runs) — jadwal & eksekusi manual di{" "}
              <Link href="/admin/cron" className="font-semibold text-brand-700 underline">
                Cron Jobs
              </Link>
              .
            </p>
          </div>
          <Link href="/admin/cron" className="btn-secondary !py-2 text-xs">
            ⏱️ Cron Jobs
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCard
            label="Run Terakhir"
            value={expiry.lastRunAt ? formatDateTime(expiry.lastRunAt) : "—"}
            icon="🕒"
            tone={expiry.lastRunAt ? "green" : "gray"}
            suffix={expiry.lastRunAt ? "(job expire)" : "belum pernah jalan"}
          />
          <StatusCard
            label="Order Di-Expire"
            value={expiry.expiredTotal}
            icon="📉"
            tone={expiry.expiredTotal > 0 ? "yellow" : "gray"}
            suffix="(7 hari)"
          />
          <StatusCard
            label="Pengingat Terkirim"
            value={expiry.notifiedTotal}
            icon="🔔"
            tone={expiry.notifiedTotal > 0 ? "blue" : "gray"}
            suffix="(7 hari · 48 jam + H-1)"
          />
        </div>
      </section>

      <section aria-labelledby="retry-admin">
        <div className="mb-3">
          <h2 id="retry-admin" className="text-lg font-bold text-gray-900">
            🔁 Retry Massal
          </h2>
          <p className="text-xs text-gray-500">
            Percobaan "Coba Lagi" pembayaran per hari ({retry.daily.length} hari terakhir) · tingkat
            sukses dihitung dari retry yang sudah tuntas (sukses + gagal).
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusCard label="Retry" value={retry.todayAttempts} icon="🔁" tone="brand" />
          <StatusCard label="Berhasil" value={retry.success} icon="✅" tone="green" suffix="(7 hari)" />
          <StatusCard label="Gagal" value={retry.failed} icon="❌" tone="red" suffix="(7 hari)" />
          <StatusCard label="Tingkat Sukses" value={`${retry.successRate}%`} icon="📈" tone={retry.successRate >= 50 ? "green" : "yellow"} suffix="(7 hari)" />
        </div>

        <div className="card divide-y divide-gray-100">
          {retry.daily.map((d) => {
            const dayTotal = d.attempts;
            const rate =
              dayTotal - d.pending > 0
                ? Math.round((d.success / (dayTotal - d.pending)) * 100)
                : 0;
            return (
              <div key={d.date} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-24 shrink-0 font-mono text-xs text-gray-600">{d.date}</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-green-500"
                    style={{ width: `${rate}%` }}
                    title={`${rate}% berhasil`}
                  />
                </div>
                <span className="w-28 shrink-0 text-right text-xs text-gray-500">
                  {d.success}✅ · {d.failed}❌ · {d.pending}⏳ ({d.attempts} retry)
                </span>
              </div>
            );
          })}
          {retry.totalAttempts === 0 && (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              Belum ada retry pembayaran dalam {retry.daily.length} hari terakhir.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="card p-4">
      <span className="text-2xl" aria-hidden="true">{icon}</span>
      <p className="mt-2 text-xl font-extrabold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

const TONE_CLASS: Record<string, string> = {
  brand: "bg-brand-50 text-brand-800",
  green: "bg-emerald-50 text-emerald-800",
  red: "bg-red-50 text-red-800",
  gray: "bg-gray-100 text-gray-700",
  yellow: "bg-amber-50 text-amber-800",
  blue: "bg-sky-50 text-sky-800",
};

function StatusCard({
  label,
  value,
  icon,
  tone,
  suffix = "hari ini",
}: {
  label: string;
  value: number | string;
  icon: string;
  tone: keyof typeof TONE_CLASS;
  suffix?: string;
}) {
  return (
    <div className={`rounded-2xl p-4 ${TONE_CLASS[tone]}`}>
      <span className="text-xl" aria-hidden="true">{icon}</span>
      <p className="mt-1 text-lg font-extrabold">{value}</p>
      <p className="text-xs font-medium opacity-80">{label} {suffix}</p>
    </div>
  );
}
