import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, markOrderFailed, markOrderPaid, recordPaymentAudit } from "@/lib/service";
import {
  MidtransApiError,
  getMidtransStatus,
  isMidtransPaid,
  isMidtransConfigError,
  isMockSnapToken,
  midtransFailureReason,
  midtransTerminalFailure,
  paymentTypeToMethod,
} from "@/lib/midtrans";
import { notifyMerchantPaymentConfigIssue, notifyOrderPayment } from "@/lib/whatsapp";

/**
 * Cek status pembayaran order — dua mode, webhook sebagai SUMBER UTAMA:
 *
 * 1. `GET /api/pay/[orderId]/status` (default, TANPA param) → POLLING LOKAL:
 *    cukup baca status dari store (write-through cache yang diperbarui
 *    webhook `/api/midtrans/notification`). TIDAK PERNAH memanggil Midtrans.
 *    Dipakai polling interval di halaman bayar agar settlement terdeteksi
 *    murah, tanpa membebani Status API. Setiap observasi polling direkam ke
 *    `metadata.paymentAudit` (event "pending", source "poll", dedupe entri
 *    identik beruntun) agar riwayat polling bisa ditelusuri kronologinya
 *    bersama webhook & callback Snap.
 *
 * 2. `GET /api/pay/[orderId]/status?reconcile=1` → RECONCILE: baca store
 *    dulu (status terminal yang sudah diterapkan webhook → langsung return,
 *    tanpa Midtrans); hanya bila masih `pending` barulah tanya Status API
 *    Midtrans SEKALI sebagai fallback (webhook telat / tak bisa menjangkau
 *    aplikasi, mis. dev lokal tanpa tunnel). Dipakai saat page load, aksi
 *    user ("Cek Status"), dan callback Snap (onSuccess/onError).
 *
 * Mode demo (snap token tiruan): selalu "pending" — simulasi sukses lewat
 * POST /api/pay/[orderId].
 */
export async function GET(req: Request, { params }: { params: { orderId: string } }) {
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
  // Status terminal (paid/failed/expired) yang sudah diterapkan WEBHOOK cukup
  // dibaca dari store — tidak perlu memanggil Midtrans sama sekali.
  if (order.paymentStatus === "paid") {
    return NextResponse.json({ ok: true, status: "paid", redirect: `/sukses?order=${order.id}` });
  }
  if (order.paymentStatus === "failed" || order.paymentStatus === "expired") {
    return NextResponse.json({
      ok: true,
      status: order.paymentStatus,
      redirect: `/bayar/gagal?order=${order.id}&reason=${order.paymentStatus}`,
    });
  }

  if (isMockSnapToken(order.snapToken)) {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // POLLING LOKAL (tanpa ?reconcile=1): webhook = sumber utama — cukup
  // pantau store; jangan hubungi Midtrans. Observasi polling direkam ke
  // log audit (event "pending", source "poll") agar riwayat polling bisa
  // ditelusuri kronologinya bersama webhook & callback Snap — entri
  // identik beruntun dilewati (satu entri per perubahan status, bukan per
  // tick 5 detik), dan tanpa tulis tambahan saat tidak ada yang berubah.
  const reconcile = new URL(req.url).searchParams.get("reconcile") === "1";
  if (!reconcile) {
    const lastAudit = Array.isArray(order.metadata?.paymentAudit)
      ? (order.metadata.paymentAudit as Array<{
          source?: string;
          event?: string;
          paymentStatus?: string;
        }>)[order.metadata.paymentAudit.length - 1]
      : undefined;
    const sameAsLast =
      !!lastAudit &&
      lastAudit.source === "poll" &&
      lastAudit.event === "pending" &&
      lastAudit.paymentStatus === "pending";
    if (!sameAsLast) {
      recordPaymentAudit(order.id, {
        source: "poll",
        event: "pending",
        paymentStatus: "pending",
        orderNumber: order.orderNumber,
        detail: "Polling lokal — menunggu konfirmasi (webhook/status)",
      });
    }
    return NextResponse.json({ ok: true, status: "pending" });
  }

  try {
    const status = await getMidtransStatus(order.orderNumber);
    // Observasi status selalu direkam ke log audit (status_code / pesan asli
    // Midtrans, termasuk channel_response_code/message GoPay/OVO/VA) —
    // dedupe otomatis utk polling berulang (recordPaymentAudit).
    const audit = {
      source: "status-api" as const,
      statusCode: status.status_code,
      statusMessage: status.status_message,
      transactionStatus: status.transaction_status,
      transactionId: status.transaction_id,
      paymentType: status.payment_type,
      channelResponseCode: status.channel_response_code,
      channelResponseMessage: status.channel_response_message,
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
      // Di titik ini order PASTI masih `pending` (status terminal sudah
      // di-return lebih awal dari store) → selalu transisi baru, aman
      // kirim notifikasi. Simpan alasan spesifik (mis. "Saldo tidak
      // mencukupi") di metadata order; layar Gagal membacanya dari sana.
      markOrderFailed(order.id, terminal, midtransFailureReason(status)?.reason, audit);
      void notifyOrderPayment(order.id, terminal);
      return NextResponse.json({
        ok: true,
        status: terminal,
        redirect: `/bayar/gagal?order=${order.id}&reason=${terminal}`,
      });
    }
    // Masih berjalan — catat observasi "pending" (kronologi; dedupe otomatis).
    recordPaymentAudit(order.id, { ...audit, event: "pending", paymentStatus: "pending" });
    return NextResponse.json({ ok: true, status: "pending" });
  } catch (err) {
    // Error KONFIGURASI (401/402/403/410): catat ke log audit pembayaran
    // (bukan kegagalan pelanggan — paymentStatus TIDAK diubah) DAN kirim
    // notifikasi ke merchant bahwa setting pembayaran perlu diperbaiki.
    if (err instanceof MidtransApiError && isMidtransConfigError(err.statusCode)) {
      const reason =
        midtransFailureReason({ status_code: err.statusCode })?.reason ??
        "Konfigurasi pembayaran bermasalah";
      recordPaymentAudit(order.id, {
        source: "status-api",
        event: "config-error",
        paymentStatus: order.paymentStatus,
        statusCode: err.statusCode,
        statusMessage: err.body.slice(0, 200),
        detail: reason,
        orderNumber: order.orderNumber,
      });
      void notifyMerchantPaymentConfigIssue(order, err.statusCode, reason);
    }
    return NextResponse.json(
      { ok: false, message: "Gagal memeriksa status pembayaran" },
      { status: 502 }
    );
  }
}
