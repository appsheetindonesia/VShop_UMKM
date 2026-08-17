import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  filterPaymentOrders,
  paymentHistoryRowsToCsv,
  type CsvPaymentRow,
} from "@/lib/payment-history";
import {
  getAllAdminPaymentRows,
  type PaymentRange,
} from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * Ekspor CSV riwayat pembayaran ADMIN — SEMUA order platform yang
 * TERFILTER (status/type/q dari searchParams, sama seperti halaman
 * pelanggan), dengan kolom tambahan **Pelanggan**. Tombol "Unduh CSV" di
 * seksi Riwayat Pembayaran dashboard admin menautkan ke sini. BOM UTF-8
 * agar Excel membaca dengan benar.
 */
export async function GET(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const rawRange = url.searchParams.get("range");
  const range: PaymentRange | undefined =
    rawRange === "today" || rawRange === "7d" || rawRange === "30d"
      ? rawRange
      : undefined;

  const rows = getAllAdminPaymentRows(range);
  const filtered = filterPaymentOrders(rows, status, q, type);
  const csvRows: CsvPaymentRow[] = filtered.map((r) => ({
    orderNumber: r.orderNumber,
    customerName: r.customerName,
    type: r.type,
    totalAmount: r.totalAmount,
    paymentStatus: r.paymentStatus,
    failureReason: r.failureReason,
    createdAt: r.createdAt,
  }));
  const csv = paymentHistoryRowsToCsv(csvRows);
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="riwayat-pembayaran-admin-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
