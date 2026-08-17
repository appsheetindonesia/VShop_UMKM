import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import PaymentHistoryList, {
  filterPaymentOrders,
  PaymentHistoryControls,
} from "@/components/PaymentHistoryList";
import { getSessionUser } from "@/lib/auth";
import { buildListHref, DEFAULT_PAGE_SIZE, parsePageNumber } from "@/lib/pagination";
import { getOrdersByUser } from "@/lib/service";

export const metadata: Metadata = {
  title: "Riwayat Pembayaran",
};

const BASE_PATH = "/akun/riwayat-pembayaran";

const TYPE_LABEL: Record<string, string> = {
  package: "Paket",
  topup: "Top Up",
  merchandise: "Merchandise",
};

/**
 * Daftar LENGKAP riwayat pembayaran (halaman terpisah dari /akun — tombol
 * "Lihat Semua"). Filter tab Semua/Berhasil/Gagal + pencarian nomor order
 * lewat searchParams (server component, tanpa state client) dan PAGINATION
 * nyata: `?page=N` membagi daftar per `DEFAULT_PAGE_SIZE` (20) dengan tombol
 * "Sebelumnya/Berikutnya" (filter dipertahankan; ganti filter kembali ke
 * halaman 1).
 */
export default function RiwayatPembayaranPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; type?: string; page?: string };
}) {
  const user = getSessionUser();
  if (!user) redirect("/masuk");

  const status = searchParams?.status;
  const q = searchParams?.q;
  const type = searchParams?.type;
  const orders = getOrdersByUser(user.id);
  const filtered = filterPaymentOrders(orders, status, q, type);

  const page = parsePageNumber(searchParams?.page, filtered.length, DEFAULT_PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / DEFAULT_PAGE_SIZE));
  const start = (page - 1) * DEFAULT_PAGE_SIZE;
  const shown = filtered.slice(start, start + DEFAULT_PAGE_SIZE);
  const end = start + shown.length;

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div>
        <Link href="/akun" className="text-sm text-gray-500 hover:text-gray-800">
          ← Kembali ke Akun
        </Link>
        <h1 className="mt-1 text-xl font-bold text-gray-900">Riwayat Pembayaran</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          {filtered.length} transaksi
          {status === "paid" ? " · berhasil" : status === "failed" ? " · gagal/kadaluarsa" : ""}
          {type ? ` · ${TYPE_LABEL[type] ?? type}` : ""}
          {q ? ` · cari "${q}"` : ""}
          {filtered.length > DEFAULT_PAGE_SIZE
            ? ` (menampilkan ${start + 1}–${end} dari ${filtered.length})`
            : ""}
        </p>
      </div>

      <PaymentHistoryControls basePath={BASE_PATH} status={status} type={type} q={q} />

      {filtered.length > 0 && (
        <div className="flex justify-end">
          <a
            href={buildListHref("/api/akun/riwayat-csv", { status, type, q })}
            className="btn-secondary !py-2 text-sm"
          >
            ⬇️ Unduh CSV
          </a>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="card p-6 text-center">
          <span className="text-3xl" aria-hidden="true">🧾</span>
          <p className="mt-2 text-sm text-gray-500">
            {orders.length === 0
              ? "Belum ada riwayat pembayaran. Yuk mulai belanja atau pilih paket!"
              : "Tidak ada riwayat dengan filter ini."}
          </p>
          {orders.length === 0 ? (
            <Link href="/paket" className="btn-primary mt-4 w-full">
              Lihat Paket
            </Link>
          ) : (
            <Link href={BASE_PATH} className="btn-secondary mt-3 w-full">
              Reset Filter
            </Link>
          )}
        </div>
      ) : (
        <>
          <PaymentHistoryList orders={shown} />

          {totalPages > 1 && (
            <nav
              aria-label="Paginasi riwayat pembayaran"
              className="flex items-center justify-between gap-3"
            >
              {page > 1 ? (
                <Link
                  href={buildListHref(BASE_PATH, { status, type, q, page: page - 1 })}
                  className="btn-secondary !py-2 text-sm"
                >
                  ← Sebelumnya
                </Link>
              ) : (
                <span aria-disabled="true" className="btn-secondary !py-2 text-sm opacity-40">
                  ← Sebelumnya
                </span>
              )}
              <span className="text-xs text-gray-500">
                Halaman {page} dari {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={buildListHref(BASE_PATH, { status, type, q, page: page + 1 })}
                  className="btn-secondary !py-2 text-sm"
                >
                  Berikutnya →
                </Link>
              ) : (
                <span aria-disabled="true" className="btn-secondary !py-2 text-sm opacity-40">
                  Berikutnya →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
