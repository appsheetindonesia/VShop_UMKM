import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, markOrderFailed, markOrderPaid, recordPaymentAudit } from "@/lib/service";
import {
  getMidtransStatus,
  isMidtransPaid,
  isMockSnapToken,
  midtransFailureReason,
  midtransTerminalFailure,
  paymentTypeToMethod,
} from "@/lib/midtrans";
import { notifyOrderPayment } from "@/lib/whatsapp";

/**
 * Cek status pembayaran order.
 * - Mode demo (snap token tiruan): selalu "pending" — simulasi sukses lewat
 *   POST /api/pay/[orderId].
 * - Mode Midtrans asli: tanya Status API Midtrans; bila lunas, order langsung
 *   ditandai paid dan kembalikan redirect ke halaman sukses.
 */
export async function GET(_req: Request, { params }: { params: { orderId: string } }) {
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
    return NextResponse.json({ ok: true, status: "paid", redirect: `/sukses?order=${order.id}` });
  }

  if (isMockSnapToken(order.snapToken)) {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  try {
    const status = await getMidtransStatus(order.orderNumber);
    // Observasi status selalu direkam ke log audit (status_code / pesan asli
    // Midtrans) — dedupe otomatis utk polling berulang (recordPaymentAudit).
    const audit = {
      source: "status-api" as const,
      statusCode: status.status_code,
      statusMessage: status.status_message,
      transactionStatus: status.transaction_status,
      transactionId: status.transaction_id,
      paymentType: status.payment_type,
      orderNumber: order.orderNumber,
    };
    if (isMidtransPaid(status)) {
      markOrderPaid(order.id, paymentTypeToMethod(status.payment_type), audit);
      void notifyOrderPayment(order.id, "paid");
      return NextResponse.json({
        ok: true,
        status: "paid",
        redirect: `/sukses?order=${order.id}`,
      });
    }
    const terminal = midtransTerminalFailure(status);
    if (terminal) {
      const alreadyTerminal =
        order.paymentStatus === "failed" || order.paymentStatus === "expired";
      // Simpan alasan spesifik (mis. "Saldo tidak mencukupi") di metadata
      // order; layar Pembayaran Gagal membacanya dari sana.
      markOrderFailed(order.id, terminal, midtransFailureReason(status)?.reason, audit);
      // Notifikasi hanya saat transisi baru (webhook/status bisa berulang).
      if (!alreadyTerminal) void notifyOrderPayment(order.id, terminal);
      return NextResponse.json({
        ok: true,
        status: terminal,
        redirect: `/bayar/gagal?order=${order.id}&reason=${terminal}`,
      });
    }
    // Masih berjalan — catat observasi "pending" (kronologi; dedupe otomatis).
    recordPaymentAudit(order.id, { ...audit, event: "pending", paymentStatus: "pending" });
    return NextResponse.json({ ok: true, status: "pending" });
  } catch {
    return NextResponse.json(
      { ok: false, message: "Gagal memeriksa status pembayaran" },
      { status: 502 }
    );
  }
}
