import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, markOrderPaid } from "@/lib/service";
import { paySchema } from "@/lib/validation";
import { notifyOrderPayment } from "@/lib/whatsapp";

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
  if (order.paymentStatus === "paid") {
    return NextResponse.json({ ok: true, redirect: `/sukses?order=${order.id}` });
  }

  const parsed = paySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Metode pembayaran tidak valid" }, { status: 400 });
  }

  try {
    // Order dijamin belum paid di sini (early-return di atas) → transisi baru
    // selalu terjadi, aman kirim notifikasi (fire-and-forget).
    markOrderPaid(order.id, parsed.data.method, {
      source: "mock",
      orderNumber: order.orderNumber,
    });
    void notifyOrderPayment(order.id, "paid");
    return NextResponse.json({ ok: true, redirect: `/sukses?order=${order.id}` });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Pembayaran gagal" },
      { status: 400 }
    );
  }
}
