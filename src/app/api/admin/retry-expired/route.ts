import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, retryOrderPayment } from "@/lib/service";
import { notifyOrderRetried } from "@/lib/whatsapp";

const MAX_BULK = 50;

/**
 * Retry MASSAL order gagal/kadaluarsa — dipakai halaman /admin/kadaluarsa
 * (retry massal) DAN dashboard admin (tombol retry per order, juga untuk
 * order `failed`). Setiap order dikembalikan ke `pending` + dibuatkan snap
 * token baru (nomor order baru via `nextRetryOrderNumber` — order_id
 * terminal bisa ditolak Midtrans bila dipakai ulang). Hanya order dengan
 * `paymentStatus` terminal yang bisa di-retry ("failed" | "expired");
 * sisanya dilaporkan sebagai skip.
 */
export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  let body: { orderIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const orderIds = Array.isArray(body?.orderIds)
    ? body.orderIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (orderIds.length === 0) {
    return NextResponse.json({ ok: false, message: "Pilih minimal 1 order" }, { status: 400 });
  }
  if (orderIds.length > MAX_BULK) {
    return NextResponse.json(
      { ok: false, message: `Maksimal ${MAX_BULK} order per proses` },
      { status: 400 }
    );
  }

  interface ItemResult {
    orderId: string;
    orderNumber?: string;
    ok: boolean;
    newOrderNumber?: string;
    redirect?: string;
    error?: string;
  }

  const results: ItemResult[] = [];
  for (const id of orderIds) {
    const order = getOrder(id);
    if (!order) {
      results.push({ orderId: id, ok: false, error: "Order tidak ditemukan" });
      continue;
    }
    const oldNumber = order.orderNumber;
    if (order.paymentStatus !== "expired" && order.paymentStatus !== "failed") {
      results.push({
        orderId: id,
        orderNumber: oldNumber,
        ok: false,
        error: `Status ${order.paymentStatus} — hanya order gagal/kadaluarsa yang bisa di-retry`,
      });
      continue;
    }
    try {
      const updated = await retryOrderPayment(id);
      // Beri tahu pelanggan bahwa ordernya siap dibayar ulang (fire-and-forget
      // via antrian whatsapp — tidak menambah latensi respons retry massal).
      notifyOrderRetried(updated);
      results.push({
        orderId: id,
        orderNumber: oldNumber,
        ok: true,
        newOrderNumber: updated.orderNumber,
        redirect: `/bayar/${updated.id}`,
      });
    } catch (err) {
      results.push({
        orderId: id,
        orderNumber: oldNumber,
        ok: false,
        error: err instanceof Error ? err.message : "Gagal menyiapkan ulang",
      });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: okCount > 0,
    summary: { total: orderIds.length, ok: okCount, failed: orderIds.length - okCount },
    results,
  });
}
