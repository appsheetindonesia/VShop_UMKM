import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getOrderByNumber, markOrderFailed, markOrderPaid } from "@/lib/service";
import {
  isMidtransPaid,
  midtransFailureReason,
  midtransTerminalFailure,
  paymentTypeToMethod,
  verifyMidtransSignature,
} from "@/lib/midtrans";
import { notifyOrderPayment } from "@/lib/whatsapp";

/**
 * Webhook notifikasi Midtrans (Payment Notification).
 * Signature diverifikasi: SHA512(order_id + status_code + gross_amount + ServerKey).
 * Transaksi yang dibayar (capture/settlement) langsung ditandai lunas.
 */
export async function POST(req: Request) {
  await ensureHydrated();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const orderId = body.order_id;
  const statusCode = body.status_code;
  const grossAmount = body.gross_amount;
  const signatureKey = body.signature_key;

  if (
    typeof orderId !== "string" ||
    typeof statusCode !== "string" ||
    typeof grossAmount !== "string" ||
    typeof signatureKey !== "string"
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!verifyMidtransSignature(orderId, statusCode, grossAmount, signatureKey)) {
    return NextResponse.json({ ok: false, message: "Invalid signature" }, { status: 403 });
  }

  const order = getOrderByNumber(orderId);

  // Data mentah notifikasi ikut direkam ke log audit pembayaran order —
  // termasuk channel_response_code/message (kode spesifik GoPay/OVO/VA).
  const channelResponseCode =
    typeof body.channel_response_code === "string" ? body.channel_response_code : undefined;
  const channelResponseMessage =
    typeof body.channel_response_message === "string" ? body.channel_response_message : undefined;
  const paymentType = typeof body.payment_type === "string" ? body.payment_type : undefined;
  const audit = {
    source: "webhook" as const,
    statusCode: statusCode,
    statusMessage: typeof body.status_message === "string" ? body.status_message : undefined,
    transactionStatus:
      typeof body.transaction_status === "string" ? body.transaction_status : undefined,
    transactionId: typeof body.transaction_id === "string" ? body.transaction_id : undefined,
    paymentType,
    channelResponseCode,
    channelResponseMessage,
    orderNumber: orderId,
  };

  const paid = isMidtransPaid({
    transaction_status:
      typeof body.transaction_status === "string" ? body.transaction_status : undefined,
    fraud_status: typeof body.fraud_status === "string" ? body.fraud_status : undefined,
  });

  if (paid && order) {
    const wasPaid = order.paymentStatus === "paid";
    markOrderPaid(
      order.id,
      paymentTypeToMethod(typeof body.payment_type === "string" ? body.payment_type : undefined),
      audit
    );
    // Notifikasi hanya saat transisi baru (webhook duplikat dilewati).
    if (!wasPaid) void notifyOrderPayment(order.id, "paid");
  } else if (order) {
    // Status terminal gagal (expire / deny / cancel / failure).
    const terminal = midtransTerminalFailure({
      transaction_status:
        typeof body.transaction_status === "string" ? body.transaction_status : undefined,
    });
    if (terminal) {
      const alreadyTerminal =
        order.paymentStatus === "failed" || order.paymentStatus === "expired";
      // Simpan alasan spesifik (kode status bank/QRIS) di metadata order.
      markOrderFailed(
        order.id,
        terminal,
        midtransFailureReason({
          status_code: typeof body.status_code === "string" ? body.status_code : undefined,
          transaction_status:
            typeof body.transaction_status === "string" ? body.transaction_status : undefined,
          payment_type: paymentType,
          channel_response_code: channelResponseCode,
          channel_response_message: channelResponseMessage,
        })?.reason,
        audit
      );
      // Notifikasi hanya saat transisi baru.
      if (!alreadyTerminal) void notifyOrderPayment(order.id, terminal);
    }
  }

  // Selalu balas 200 agar Midtrans tidak mengulang notifikasi.
  return NextResponse.json({ status_code: 200 });
}
