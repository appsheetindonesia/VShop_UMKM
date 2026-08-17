import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, retryOrderPayment } from "@/lib/service";

/**
 * \"Coba Lagi\" dari layar Pembayaran Gagal: kembalikan order ke status
 * pending dan buat snap token baru (Midtrans sandbox / token demo).
 */
export async function POST(_req: Request, { params }: { params: { orderId: string } }) {
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

  try {
    const updated = await retryOrderPayment(order.id);
    // snapToken ikut dikirim agar UI (popup onError Snap) bisa re-embed
    // langsung tanpa keluar halaman; redirect tetap disediakan sebagai
    // fallback navigasi.
    return NextResponse.json({
      ok: true,
      redirect: `/bayar/${updated.id}`,
      snapToken: updated.snapToken ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal menyiapkan ulang" },
      { status: 400 }
    );
  }
}
