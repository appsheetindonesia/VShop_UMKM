import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getOrder, markOrderFailed } from "@/lib/service";
import { MIDTRANS_FAILURE_CODES } from "@/lib/midtrans";
import { notifyOrderPayment } from "@/lib/whatsapp";

const bodySchema = z.object({
  reason: z.enum(["failed", "expired"]),
  /** Kode status Midtrans dari Snap onError (mis. "202", "216"). */
  code: z.string().max(20).optional(),
  /** status_message mentah dari Snap (dipakai hanya sebagai fallback). */
  message: z.string().max(300).optional(),
});

/**
 * Tandai order sebagai gagal / kadaluarsa (dipanggil dari layar pembayaran,
 * mis. countdown QRIS habis di mode demo atau onError Snap.js di mode
 * Midtrans asli). Order yang sudah lunas tidak diubah.
 *
 * Alasan spesifik (ditolak bank, saldo tidak cukup, waktu habis, dsb.)
 * dihitung di server dari `code` status Midtrans lalu disimpan di
 * `metadata.failureReason` — halaman Pembayaran Gagal membacanya sebagai
 * sumber kebenaran (bukan dari query string yang bisa diubah client).
 *
 * Respons mengembalikan `reason` (alasan efektif yang tersimpan) supaya
 * popup Snap bisa menampilkannya LANGSUNG di onError, sebelum user memilih
 * "Lihat Detail" ke halaman Pembayaran Gagal.
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
    return NextResponse.json({ ok: false, message: "Alasan tidak valid" }, { status: 400 });
  }
  const { reason, code, message } = parsed.data;

  try {
    // Lewati notifikasi bila order sudah terminal (request berulang).
    const alreadyTerminal =
      order.paymentStatus === "failed" || order.paymentStatus === "expired";
    // Prioritas alasan: (1) kode status terpetakan di tabel, (2) status_message
    // mentah dari Snap, (3) fallback generik sesuai `reason`. (Tidak memakai
    // midtransFailureReason di sini karena route selalu meneruskan
    // transaction_status "failure"/"expire" sehingga pesan generiknya akan
    // menimpa status_message mentah dari Snap.)
    const trimmedCode = code?.trim();
    const codeReason = trimmedCode ? MIDTRANS_FAILURE_CODES[trimmedCode] : undefined;
    const detail =
      codeReason ??
      (message && message.length > 0 ? message.trim() : undefined) ??
      (reason === "expired" ? "Waktu pembayaran habis" : "Pembayaran gagal diproses");

    markOrderFailed(order.id, reason, detail, {
      source: "client-fail",
      statusCode: code,
      statusMessage: message,
      orderNumber: order.orderNumber,
    });
    if (!alreadyTerminal) void notifyOrderPayment(order.id, reason);
    return NextResponse.json({ ok: true, reason: detail, code: code ?? null });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal" },
      { status: 400 }
    );
  }
}
