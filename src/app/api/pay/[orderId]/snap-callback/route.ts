import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, recordSnapCallback } from "@/lib/service";
import type { SnapCallbackEvent } from "@/lib/types";

const bodySchema = z.object({
  /** Callback yang dikirim Snap.js (lihat src/lib/types.ts). */
  event: z.enum(["success", "pending", "error", "close"]),
  /** Hasil transaksi mentah dari callback Snap (opsional; dipakai audit). */
  result: z.record(z.unknown()).optional(),
});

/**
 * Audit trail: simpan callback Snap.js (success / pending / error / close)
 * beserta hasil transaksinya ke `metadata.snapCallbacks` order. Tidak
 * mengubah status pembayaran — murni pencatatan, dipanggil fire-and-forget
 * dari halaman bayar. Hanya pemilik order yang bisa mencatat.
 */
export async function POST(req: Request, { params }: { params: { orderId: string } }) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Silakan login" }, { status: 401 });
  }
  const order = getOrder(params.orderId);
  if (!order) {
    return NextResponse.json({ ok: false, message: "Order tidak ditemukan" }, { status: 404 });
  }
  if (order.userId !== user.id) {
    return NextResponse.json({ ok: false, message: "Order bukan milik Anda" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Data callback tidak valid" }, { status: 400 });
  }
  const { event, result } = parsed.data;

  try {
    recordSnapCallback(order.id, event as SnapCallbackEvent, result);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal" },
      { status: 400 }
    );
  }
}
