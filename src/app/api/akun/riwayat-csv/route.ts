import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { filterPaymentOrders, paymentHistoryToCsv } from "@/lib/payment-history";
import { getOrdersByUser } from "@/lib/service";

export const dynamic = "force-dynamic";

/**
 * Ekspor CSV riwayat pembayaran pelanggan — order TERFILTER sama seperti
 * halaman `/akun/riwayat-pembayaran` (status/type/q dari searchParams).
 * Tombol "Unduh CSV" di halaman menautkan ke sini. Hanya pemilik akun;
 * BOM UTF-8 agar Excel membaca dengan benar.
 */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json({ ok: false, message: "Silakan masuk sebagai pelanggan" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const filtered = filterPaymentOrders(getOrdersByUser(user.id), status, q, type);
  const csv = paymentHistoryToCsv(filtered);
  const date = new Date().toISOString().slice(0, 10);

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="riwayat-pembayaran-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
