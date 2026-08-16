/**
 * Adapter notifikasi WhatsApp (WhatsApp Cloud API Meta / demo).
 *
 * Mode DEMO (default): tanpa WHATSAPP_TOKEN — tidak mengirim apa pun,
 * hanya mencatat pesan ke console dengan prefix `[wa]` agar alur tetap
 * bisa diverifikasi tanpa kredensial.
 *
 * Mode ASLI: isi WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Pesan dikirim
 * via WhatsApp Cloud API (Graph API). Rahasia hanya dibaca di server.
 *
 * Modul ini sengaja tidak pernah melempar error: kegagalan kirim hanya
 * dicatat (fire-and-forget) agar tidak mengganggu alur pembayaran.
 * Idempotensi (menghindari notifikasi ganda dari webhook duplikat)
 * ditangani pemanggil dengan guard transisi status.
 */

import { getDB } from "./db";
import { getOrder, getMerchantById } from "./service";
import { formatRupiah } from "./format";
import type { Order, PaymentStatus } from "./types";

// ---------- Konfigurasi ----------

interface WaConfig {
  enabled: boolean;
  token?: string;
  phoneNumberId?: string;
  /** Nomor tujuan notifikasi merchant bila order tidak terkait merchant. */
  businessTo?: string;
  apiBase: string;
  appUrl: string;
}

function config(): WaConfig {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return {
    enabled: Boolean(token && phoneNumberId),
    token,
    phoneNumberId,
    businessTo: process.env.WHATSAPP_BUSINESS_TO,
    apiBase:
      process.env.WHATSAPP_API_BASE ??
      "https://graph.facebook.com/v20.0",
    appUrl: process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  };
}

/** True bila kredensial WhatsApp Cloud API tersedia. */
export function whatsappEnabled(): boolean {
  return config().enabled;
}

/**
 * Normalisasi nomor HP Indonesia / internasional → E.164 digit (tanpa "+"),
 * format yang dipakai WhatsApp Cloud API (mis. "6281234567890").
 * Mengembalikan null bila nomor tidak valid.
 */
export function normalizeToE164(phone?: string): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^0-9]/g, "");
  if (!d) return null;
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (!d.startsWith("62")) d = `62${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return d;
}

// ---------- Kirim via Cloud API ----------

interface SendResult {
  ok: boolean;
  to?: string;
  /** true bila Cloud API menerima pesan (delivered ke WhatsApp). */
  delivered: boolean;
  error?: string;
}

async function sendText(to: string, text: string): Promise<SendResult> {
  const cfg = config();
  if (!cfg.enabled || !cfg.token || !cfg.phoneNumberId) {
    console.log(`[wa] (demo) → ${to}: ${text}`);
    return { ok: true, to, delivered: false };
  }
  try {
    const res = await fetch(`${cfg.apiBase}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[wa] gagal kirim → ${to}: HTTP ${res.status} ${body.slice(0, 160)}`);
      return { ok: false, to, delivered: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
    const delivered = Boolean(data?.messages?.[0]?.id);
    if (!delivered) {
      console.error(`[wa] response tanpa message id → ${to}`);
      return { ok: false, to, delivered: false, error: "no message id" };
    }
    console.log(`[wa] terkirim → ${to} (${data!.messages![0].id})`);
    return { ok: true, to, delivered: true };
  } catch (err) {
    console.error(`[wa] error kirim → ${to}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, to, delivered: false, error: "network" };
  }
}

// ---------- Template pesan ----------

function itemSummary(order: Order): string {
  return order.items.map((i) => `${i.name}×${i.quantity}`).join(", ");
}

function paidCustomerMessage(order: Order, customerName: string): string {
  return (
    `Halo ${customerName}! ✅ Pembayaran order ${order.orderNumber} sebesar ` +
    `${formatRupiah(order.totalAmount)} berhasil. Terima kasih sudah berbelanja di V Shop. ` +
    `Detail: ${config().appUrl}/sukses?order=${order.id}`
  );
}

function failedCustomerMessage(order: Order, customerName: string): string {
  const reason =
    typeof order.metadata?.failureReason === "string" && order.metadata.failureReason
      ? order.metadata.failureReason
      : order.paymentStatus === "expired"
        ? "Waktu pembayaran habis"
        : "Pembayaran belum berhasil";
  return (
    `Halo ${customerName}, pembayaran order ${order.orderNumber} sebesar ` +
    `${formatRupiah(order.totalAmount)} belum berhasil: ${reason}. ` +
    `Silakan coba lagi atau pilih metode lain. ${config().appUrl}/bayar/${order.id}`
  );
}

function newOrderMerchantMessage(order: Order, merchantName: string): string {
  return (
    `Halo ${merchantName}! 🛍️ Ada pesanan baru: ${order.orderNumber} ` +
    `(${itemSummary(order)}) sebesar ${formatRupiah(order.totalAmount)}. ` +
    `Segera proses pesanan pelanggan. ${config().appUrl}/merchant/dashboard`
  );
}

// ---------- Notifikasi perubahan status order ----------

/** Jenis transisi yang memicu notifikasi. */
export type PaymentTransition = Extract<PaymentStatus, "paid" | "failed" | "expired">;

/**
 * Kirim notifikasi WhatsApp saat status pembayaran order berubah.
 * - Selalu: pelanggan pemilik order (sukses / gagal / kadaluarsa).
 * - Merchant: order merchandise → nomor bisnis (WHATSAPP_BUSINESS_TO), atau
 *   merchant dari `metadata.merchantId` bila ada.
 * Fire-and-forget: tidak melempar error, kegagalan hanya dicatat.
 */
export async function notifyOrderPayment(
  orderId: string,
  transition: PaymentTransition
): Promise<void> {
  const order = getOrder(orderId);
  if (!order) {
    console.error(`[wa] order ${orderId} tidak ditemukan — notifikasi dilewati`);
    return;
  }

  const user = getDB().users.find((u) => u.id === order.userId);
  const customerPhone = normalizeToE164(user?.phone);
  const customerName = user?.name ?? "Pelanggan";

  if (transition === "paid") {
    if (customerPhone) {
      await sendText(customerPhone, paidCustomerMessage(order, customerName));
    }
    // Merchant: pesanan merchandise perlu diproses penjual/bisnis.
    if (order.type === "merchandise") {
      const merchant = merchantTargetForOrder(order);
      if (merchant) {
        await sendText(
          merchant.phone,
          newOrderMerchantMessage(order, merchant.name)
        );
      }
    }
    return;
  }

  // failed / expired → notifikasi pelanggan (merchant tidak perlu tahu).
  if (customerPhone) {
    await sendText(customerPhone, failedCustomerMessage(order, customerName));
  }
}

function merchantTargetForOrder(order: Order): { phone: string; name: string } | null {
  const merchantId = order.metadata?.merchantId;
  if (typeof merchantId === "string") {
    const m = getMerchantById(merchantId);
    if (m) {
      const phone = normalizeToE164(m.noWAUsaha);
      if (phone) return { phone, name: m.namaUsaha };
    }
  }
  const businessTo = normalizeToE164(config().businessTo);
  if (businessTo) return { phone: businessTo, name: "Merchant V Shop" };
  console.log("[wa] tidak ada target merchant (atur WHATSAPP_BUSINESS_TO)");
  return null;
}
