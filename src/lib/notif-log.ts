/**
 * Log Notifikasi — riwayat PENGIRIMAN WhatsApp (bukan isi pesan).
 *
 * Append-only telemetry untuk pemantauan admin (halaman /admin/notifikasi):
 * setiap percobaan kirim dicatat dengan status (sent/failed/demo), penerima,
 * hasil (delivered / error), dan konteks (jenis + nomor order).
 *
 * - Mode Supabase: ditulis ke tabel `notification_logs` via service-role
 *   (fire-and-forget, tidak pernah melempar) dan dibaca LANGSUNG dari
 *   Postgres (log tidak ikut cache/write-through db.ts — telemetri murni).
 * - Mode demo (tanpa Supabase): disimpan di array in-memory (globalThis)
 *   agar halaman admin tetap berfungsi tanpa kredensial.
 */

import { getSupabaseAdmin } from "./supabase/server";

export interface NotificationLogEntry {
  id: string;
  /** Nomor order terkait (bila notifikasi berasosiasi dengan order). */
  orderNumber?: string;
  /** Penerima E.164. */
  recipient: string;
  /** Jenis notifikasi: paid / failed / expired / new_order / redeemed / expiring. */
  type: string;
  status: "sent" | "failed" | "demo";
  delivered: boolean;
  channel: "whatsapp";
  /** Nama template Meta bila kirim memakai template. */
  templateName?: string;
  /** Ringkasan isi (teks bebas) — potong agar ringkas. */
  message?: string;
  /** Pesan error (status != sent). */
  error?: string;
  createdAt: string;
  /** Berapa kali cron retry sudah mencoba kirim ulang entri gagal ini. */
  retryCount?: number;
  /** Waktu percobaan kirim ulang terakhir (null = belum pernah di-retry). */
  lastRetryAt?: string;
}

export type NotificationLogInput = Omit<NotificationLogEntry, "id" | "createdAt" | "channel">;

const MAX_DEMO_LOGS = 500;

declare global {
  // eslint-disable-next-line no-var
  var __vshopNotifLogs: NotificationLogEntry[] | undefined;
}

function demoLogs(): NotificationLogEntry[] {
  if (!globalThis.__vshopNotifLogs) globalThis.__vshopNotifLogs = [];
  return globalThis.__vshopNotifLogs;
}

/**
 * Catat satu percobaan kirim notifikasi. Fire-and-forget: kegagalan menulis
 * log tidak boleh mengganggu alur apa pun (mirip whatsapp.ts).
 */
export function recordNotificationLog(input: NotificationLogInput): void {
  const entry: NotificationLogEntry = {
    id: `log_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    channel: "whatsapp",
    createdAt: new Date().toISOString(),
    ...input,
  };

  const sb = getSupabaseAdmin();
  if (sb) {
    // Insert langsung ke tabel (append-only); demo/real mode keduanya dicatat.
    void (async () => {
      try {
        await sb.from("notification_logs").insert({
          id: entry.id,
          order_id: entry.orderNumber ?? null,
          recipient: entry.recipient,
          type: entry.type,
          status: entry.status,
          delivered: entry.delivered,
          channel: entry.channel,
          template_name: entry.templateName ?? null,
          message: entry.message ? entry.message.slice(0, 500) : null,
          error: entry.error ? entry.error.slice(0, 300) : null,
          created_at: entry.createdAt,
          retry_count: entry.retryCount ?? 0,
          last_retry_at: entry.lastRetryAt ?? null,
        });
      } catch (err) {
        console.error(
          "[notif-log] gagal menulis log ke Supabase:",
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
    return;
  }

  // Mode demo: simpan di memori proses.
  const logs = demoLogs();
  logs.push(entry);
  if (logs.length > MAX_DEMO_LOGS) logs.splice(0, logs.length - MAX_DEMO_LOGS);
}

export interface NotificationLogQuery {
  limit?: number;
  /** Filter nomor order (orderNumber). */
  orderNumber?: string;
  /** Filter sekumpulan nomor order (mis. semua order milik satu pelanggan). */
  orderNumbers?: string[];
  /** Filter status: sent / failed / demo. */
  status?: string;
  /** Filter jenis notifikasi (mis. "daily_summary" untuk dedupe cron harian). */
  type?: string;
  /** Filter penerima E.164 persis (dedupe per merchant/pelanggan). */
  recipient?: string;
  /** Hanya log yang dibuat sejak ISO ini (dedupe "sudah dikirim hari ini?"). */
  since?: string;
  /** Filter substring penerima / order. */
  search?: string;
}

/** Label Indonesia untuk jenis notifikasi (dipakai halaman admin). */
export const NOTIFICATION_TYPE_LABEL: Record<string, string> = {
  paid: "Pembayaran Berhasil",
  failed: "Pembayaran Gagal",
  expired: "Order Kadaluarsa",
  new_order: "Pesanan Baru (Merchant)",
  retried: "Order Siap Dibayar Ulang",
  redeemed: "Voucher Diredeem",
  expiring: "Voucher Hampir Kadaluarsa",
  expiring_24h: "Voucher Kadaluarsa Besok (H-1)",
  daily_summary: "Ringkasan Harian Merchant",
};

/**
 * Ambil riwayat log (terbaru dulu). Supabase: query live service-role.
 * Demo: array in-memory.
 */
export async function listNotificationLogs(
  query: NotificationLogQuery = {}
): Promise<{ logs: NotificationLogEntry[]; total: number }> {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      let q = sb
        .from("notification_logs")
        .select(
          "id,order_id,recipient,type,status,delivered,channel,template_name,message,error,created_at,retry_count,last_retry_at",
          { count: "exact" }
        );
      if (query.orderNumber) q = q.eq("order_id", query.orderNumber);
      if (query.orderNumbers && query.orderNumbers.length > 0) {
        q = q.in("order_id", query.orderNumbers);
      }
      if (query.status) q = q.eq("status", query.status);
      if (query.type) q = q.eq("type", query.type);
      if (query.recipient) q = q.eq("recipient", query.recipient);
      if (query.since) q = q.gte("created_at", query.since);
      if (query.search) {
        const s = `%${query.search.toLowerCase()}%`;
        q = q.or(
          `recipient.ilike.${s},order_id.ilike.${s},type.ilike.${s},error.ilike.${s}`
        );
      }
      q = q.order("created_at", { ascending: false }).limit(query.limit ?? 100);
      const { data, error, count } = await q;
      if (error) {
        console.error("[notif-log] gagal baca log:", error.message);
        return { logs: [], total: 0 };
      }
      const logs: NotificationLogEntry[] = (data ?? []).map((r) => ({
        id: String(r.id),
        orderNumber: r.order_id ? String(r.order_id) : undefined,
        recipient: String(r.recipient),
        type: String(r.type),
        status: r.status as NotificationLogEntry["status"],
        delivered: Boolean(r.delivered),
        channel: "whatsapp",
        templateName: r.template_name ? String(r.template_name) : undefined,
        message: r.message ? String(r.message) : undefined,
        error: r.error ? String(r.error) : undefined,
        createdAt: String(r.created_at),
        retryCount: typeof r.retry_count === "number" ? r.retry_count : 0,
        lastRetryAt: r.last_retry_at ? String(r.last_retry_at) : undefined,
      }));
      return { logs, total: count ?? logs.length };
    } catch (err) {
      console.error("[notif-log] error baca log:", err instanceof Error ? err.message : String(err));
      return { logs: [], total: 0 };
    }
  }

  // Demo: in-memory, dengan filter sederhana.
  let logs = [...demoLogs()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  if (query.orderNumber) logs = logs.filter((l) => l.orderNumber === query.orderNumber);
  if (query.orderNumbers && query.orderNumbers.length > 0) {
    const set = new Set(query.orderNumbers);
    logs = logs.filter((l) => l.orderNumber !== undefined && set.has(l.orderNumber));
  }
  if (query.status) logs = logs.filter((l) => l.status === query.status);
  if (query.type) logs = logs.filter((l) => l.type === query.type);
  if (query.recipient) logs = logs.filter((l) => l.recipient === query.recipient);
  if (query.since) {
    const sinceMs = new Date(query.since).getTime();
    logs = logs.filter((l) => new Date(l.createdAt).getTime() >= sinceMs);
  }
  if (query.search) {
    const s = query.search.toLowerCase();
    logs = logs.filter(
      (l) =>
        l.recipient.toLowerCase().includes(s) ||
        (l.orderNumber ?? "").toLowerCase().includes(s) ||
        l.type.toLowerCase().includes(s)
    );
  }
  const total = logs.length;
  return { logs: logs.slice(0, query.limit ?? 100), total };
}

/**
 * Escape satu nilai CSV (RFC 4180): nilai berisi koma, kutip, atau newline
 * dibungkus kutip; kutip dalam nilai digandakan.
 */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

/**
 * Bangun CSV log notifikasi untuk AUDIT (export admin). Kolom: waktu,
 * status, delivered, jenis, penerima, nomor order, template, retry_count,
 * last_retry_at, pesan, error. Baris dipisah CRLF (standar CSV/Excel).
 * Murni & sinkron — BOM UTF-8 ditambahkan pemanggil (route).
 */
export function notificationsToCsv(logs: NotificationLogEntry[]): string {
  const header = [
    "waktu",
    "status",
    "delivered",
    "jenis",
    "penerima",
    "nomor_order",
    "template",
    "retry_count",
    "last_retry_at",
    "pesan",
    "error",
  ];
  const rows = logs.map((l) => [
    l.createdAt,
    l.status,
    l.delivered ? "ya" : "tidak",
    NOTIFICATION_TYPE_LABEL[l.type] ?? l.type,
    l.recipient,
    l.orderNumber ?? "",
    l.templateName ?? "",
    l.retryCount ?? 0,
    l.lastRetryAt ?? "",
    l.message ?? "",
    l.error ?? "",
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\n";
}

/** Ringkasan hasil pengiriman (untuk header halaman admin). */
export interface NotificationLogSummary {
  total: number;
  /** status=sent (Cloud API menerima pesan). */
  delivered: number;
  /** status=failed (gagal kirim / error). */
  error: number;
  /** status=demo (tanpa token — hanya dicatat). */
  demo: number;
  /** Rasio terkirim terhadap total (0–100, NaN bila total 0). */
  deliveryRate: number;
}

/**
 * Ringkasan hasil pengiriman per status. Supabase: empat hitungan head
 * (exact count, tanpa mengambil baris); demo: hitung dari buffer in-memory.
 */
export async function summarizeNotificationLogs(): Promise<NotificationLogSummary> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const count = async (status: string): Promise<number> => {
      try {
        const { count } = await sb
          .from("notification_logs")
          .select("id", { count: "exact", head: true })
          .eq("status", status);
        return count ?? 0;
      } catch (err) {
        console.error(
          "[notif-log] gagal hitung summary:",
          err instanceof Error ? err.message : String(err)
        );
        return 0;
      }
    };
    let total = 0;
    try {
      const totalRes = await sb
        .from("notification_logs")
        .select("id", { count: "exact", head: true });
      total = totalRes.count ?? 0;
    } catch (err) {
      console.error(
        "[notif-log] gagal hitung total:",
        err instanceof Error ? err.message : String(err)
      );
    }
    const [, delivered, error, demo] = await Promise.all([
      Promise.resolve(),
      count("sent"),
      count("failed"),
      count("demo"),
    ]);
    return {
      total,
      delivered,
      error,
      demo,
      deliveryRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
    };
  }

  const logs = demoLogs();
  const total = logs.length;
  const delivered = logs.filter((l) => l.status === "sent").length;
  const error = logs.filter((l) => l.status === "failed").length;
  const demo = logs.filter((l) => l.status === "demo").length;
  return {
    total,
    delivered,
    error,
    demo,
    deliveryRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
  };
}

// ---------- Retry otomatis notifikasi gagal (cron) ----------

export interface NotificationRetryConfig {
  /** Maks percobaan kirim ulang per entri (backoff TERBATAS). */
  maxAttempts: number;
  /** Jarak minimal antar percobaan ulang entri yang sama. */
  backoffMs: number;
  /** Umur minimal entri sebelum layak di-retry (hindari balapan kirim awal). */
  minAgeMs: number;
  /** Maks entri yang diproses per run cron. */
  limit: number;
}

/**
 * Ambil entri status=failed yang LAYAK di-retry (tertua dulu):
 * - `retryCount < maxAttempts` (belum melewati batas backoff).
 * - `lastRetryAt` null ATAU lebih tua dari `backoffMs` (jarak antar retry).
 * - `createdAt` lebih tua dari `minAgeMs` (bukan kiriman yang baru gagal
 *   — antrian in-memory whatsapp.ts sudah menangani retry cepat; cron ini
 *   untuk resilience lintas restart/proses).
 */
export async function listFailedNotificationsForRetry(
  cfg: NotificationRetryConfig
): Promise<{ logs: NotificationLogEntry[] }> {
  const sb = getSupabaseAdmin();
  if (sb) {
    try {
      const oldestAllowed = new Date(Date.now() - cfg.minAgeMs).toISOString();
      const retryAllowedAfter = new Date(Date.now() - cfg.backoffMs).toISOString();
      const { data, error } = await sb
        .from("notification_logs")
        .select(
          "id,order_id,recipient,type,status,delivered,channel,template_name,message,error,created_at,retry_count,last_retry_at"
        )
        .eq("status", "failed")
        .lt("retry_count", cfg.maxAttempts)
        .or(`last_retry_at.is.null,last_retry_at.lt.${retryAllowedAfter}`)
        .lt("created_at", oldestAllowed)
        .order("created_at", { ascending: true })
        .limit(cfg.limit);
      if (error) {
        console.error("[notif-log] gagal ambil antrean retry:", error.message);
        return { logs: [] };
      }
      const logs: NotificationLogEntry[] = (data ?? []).map((r) => ({
        id: String(r.id),
        orderNumber: r.order_id ? String(r.order_id) : undefined,
        recipient: String(r.recipient),
        type: String(r.type),
        status: r.status as NotificationLogEntry["status"],
        delivered: Boolean(r.delivered),
        channel: "whatsapp",
        templateName: r.template_name ? String(r.template_name) : undefined,
        message: r.message ? String(r.message) : undefined,
        error: r.error ? String(r.error) : undefined,
        createdAt: String(r.created_at),
        retryCount: typeof r.retry_count === "number" ? r.retry_count : 0,
        lastRetryAt: r.last_retry_at ? String(r.last_retry_at) : undefined,
      }));
      return { logs };
    } catch (err) {
      console.error(
        "[notif-log] error antrean retry:",
        err instanceof Error ? err.message : String(err)
      );
      return { logs: [] };
    }
  }

  // Demo: filter in-memory (tertua dulu).
  const now = Date.now();
  const logs = demoLogs()
    .filter((l) => {
      if (l.status !== "failed") return false;
      if ((l.retryCount ?? 0) >= cfg.maxAttempts) return false;
      if (new Date(l.createdAt).getTime() >= now - cfg.minAgeMs) return false;
      if (l.lastRetryAt && new Date(l.lastRetryAt).getTime() >= now - cfg.backoffMs) return false;
      return true;
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, cfg.limit);
  return { logs };
}

/**
 * Catat hasil satu percobaan kirim ulang: retry_count +1, last_retry_at
 * sekarang, dan status entri mengikuti hasil (sukses terkirim → sent,
 * sukses dicatat tanpa token → demo, gagal → tetap failed + error
 * diperbarui). Fire-and-forget (tidak pernah melempar); mode demo memutasi
 * buffer in-memory.
 */
export function recordRetryResult(
  id: string,
  res: { ok: boolean; delivered: boolean; error?: string }
): void {
  const now = new Date().toISOString();
  const sb = getSupabaseAdmin();
  if (sb) {
    void (async () => {
      try {
        // read-modify-write retry_count (cron satu-satunya penulis kolom ini).
        const { data } = await sb
          .from("notification_logs")
          .select("retry_count")
          .eq("id", id)
          .single();
        const count = (data?.retry_count as number | undefined) ?? 0;
        await sb
          .from("notification_logs")
          .update({
            retry_count: count + 1,
            last_retry_at: now,
            status: res.ok ? (res.delivered ? "sent" : "demo") : "failed",
            delivered: res.delivered,
            error: res.ok ? null : (res.error ?? "gagal kirim ulang").slice(0, 300),
          })
          .eq("id", id);
      } catch (err) {
        console.error(
          "[notif-log] gagal catat hasil retry:",
          err instanceof Error ? err.message : String(err)
        );
      }
    })();
    return;
  }

  const e = demoLogs().find((x) => x.id === id);
  if (!e) return;
  e.retryCount = (e.retryCount ?? 0) + 1;
  e.lastRetryAt = now;
  e.status = res.ok ? (res.delivered ? "sent" : "demo") : "failed";
  e.delivered = res.delivered;
  e.error = res.ok ? undefined : (res.error ?? "gagal kirim ulang");
}
