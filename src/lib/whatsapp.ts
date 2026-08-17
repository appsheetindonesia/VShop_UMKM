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
 * Mode kirim (`WHATSAPP_MESSAGE_MODE`):
 * - `auto` (default) — TEMPLATE MESSAGE yang disetujui Meta sebagai mode
 *   UTAMA (sesuai kebijakan WhatsApp untuk pesan di luar 24-hour session
 *   window), dengan fallback otomatis ke TEKS BEBAS bila template gagal
 *   (mis. sandbox tanpa template disetujui, atau masih dalam 24h window
 *   di mana teks bebas diizinkan).
 * - `text` — selalu teks bebas (sandbox / pengembangan; tidak butuh
 *   template disetujui).
 *
 * Template dikonfigurasi per jenis notifikasi lewat env
 * (`WHATSAPP_TEMPLATE_PAID` / `WHATSAPP_TEMPLATE_FAILED` /
 * `WHATSAPP_TEMPLATE_ORDER` + `WHATSAPP_TEMPLATE_LANG`). Body template
 * memakai placeholder {{1}}..{{n}} yang diisi URUT sesuai dokumentasi di
 * README; aplikasi mengirim komponen `body` dengan parameter teks.
 *
 * TOMBOL TEMPLATE (component `button`): template yang disetujui Meta bisa
 * memakai tombol `url` / `quick_reply` untuk aksi langsung — mis. "Lihat
 * detail pesanan" dan "Bayar ulang". Tombol mana yang dikirim dikonfigurasi
 * per jenis notifikasi lewat env `WHATSAPP_TEMPLATE_PAID_BUTTONS` /
 * `WHATSAPP_TEMPLATE_FAILED_BUTTONS` / `WHATSAPP_TEMPLATE_EXPIRING_BUTTONS`
 * (daftar peran dipisah koma, urut sesuai indeks tombol di template Meta):
 *   - `detail`    → url, suffix = order.id  → template URL berakhir
 *                  `{{1}}`: `<APP_URL>/transaksi/{{1}}`
 *   - `retry`     → url, suffix = order.id  → `<APP_URL>/bayar/{{1}}`
 *   - `dashboard` → url tetap (tanpa parameter) → `<APP_URL>/merchant/dashboard`
 *   - `vouchers`  → url tetap (tanpa parameter) → `<APP_URL>/voucher-saya`
 *   - Template EXPIRING hanya memakai `vouchers` (CTA "Gunakan Sekarang");
 *     peran ber-order (`detail`/`retry`) diabaikan dengan peringatan.
 * Kontrak: URL tombol (termasuk `{{1}}`) DIBUAT di dashboard Meta sesuai
 * template disetujui; aplikasi hanya mengirim suffix-nya. Bila template punya
 * tombol tapi env peran tidak diisi, Meta menolak → fallback teks bebas.
 *
 * Modul ini sengaja tidak pernah melempar error: kegagalan kirim hanya
 * dicatat (fire-and-forget) agar tidak mengganggu alur pembayaran.
 * Idempotensi (menghindari notifikasi ganda dari webhook duplikat)
 * ditangani pemanggil dengan guard transisi status.
 *
 * ANTRIAN KIRIM (in-memory) + RETRY BACKOFF: `sendMessage` dan semua
 * notifikasi tidak lagi mengirim sinkron di jalur pemanggil — tiap pesan
 * masuk antrian dan diproses di latar belakang dengan konkurrensi terbatas
 * (MAX_CONCURRENCY) sehingga puluhan notifikasi (mis. cron expiry) tidak
 * membebani request pembayaran. Kegagalan SEMENITARA (network, HTTP 5xx,
 * 429, response tanpa message id) diulang otomatis dengan exponential
 * backoff + jitter (maks MAX_ATTEMPTS). Kegagalan permanen (4xx, template
 * ditolak) TIDAK diulang. Antrian di-proses oleh proses yang sama (long-
 * running server); catatan: pada environment serverless yang membekukan
 * proses setelah response, kiriman yang masih mengantre saat response
 * selesai bisa hilang — pindahkan ke job broker (BullMQ/dsb) bila butuh
 * durability.
 */

import { getSetting } from "./settings";
import { getDB } from "./db";
import { getOrder, getMerchantById } from "./service";
import { getInvoiceNumber } from "./payment-history";
import { formatDateLong, formatRupiah } from "./format";
import { recordNotificationLog } from "./notif-log";
import { normalizeToE164 } from "./phone";

export { normalizeToE164 };
import type {
  ClaimedVoucher,
  Merchant,
  Order,
  PaymentStatus,
  User,
  Voucher,
} from "./types";

// ---------- Seam data lookup ----------

/**
 * SEAM lookup data untuk notifikasi berkonteks order. Implementasi produksi
 * memakai `defaultDeps` (service + db); test menyuntik stub sehingga
 * pemilihan penerima (pelanggan/merchant) diverifikasi TANPA mocking modul.
 * Interface kecil (3 lookup) — seluruh logika kirim tetap terkumpul di sini.
 */
export interface WaDeps {
  getOrder(id: string): Order | null;
  getMerchantById(id: string): Merchant | null;
  /** Cukup id/name/phone — modul ini hanya membaca itu dari user. */
  getUserById(id: string): Pick<User, "id" | "name" | "phone"> | null;
}

/**
 * Implementasi produksi: lookup langsung ke store (service + db). Service
 * mengembalikan `undefined` — di-normalisasi ke `null` agar satu konvensi
 * di seluruh modul (dan test).
 */
const defaultDeps: WaDeps = {
  getOrder: (id) => getOrder(id) ?? null,
  getMerchantById: (id) => getMerchantById(id) ?? null,
  getUserById: (id) => getDB().users.find((u) => u.id === id) ?? null,
};

// ---------- Konfigurasi ----------

interface WaConfig {
  enabled: boolean;
  token?: string;
  phoneNumberId?: string;
  /** Nomor tujuan notifikasi merchant bila order tidak terkait merchant. */
  businessTo?: string;
  apiBase: string;
  linkBase: string;
  /** auto = template dulu, fallback teks; text = selalu teks bebas. */
  messageMode: "auto" | "text";
  /** Nama template Meta yang DISETUJUI per jenis notifikasi. */
  templatePaid?: string;
  templateFailed?: string;
  templateOrder?: string;
  /** Template voucher diredeem (→ merchant) & voucher hampir kadaluarsa (→ pelanggan). */
  templateRedeemed?: string;
  templateExpiring?: string;
  /** Template "order siap dibayar ulang" (admin retry massal → pelanggan). */
  templateRetried?: string;
  /** Kode bahasa template (default: id). */
  templateLang: string;
  /** Peran tombol (component `button`) yang dipakai template paid/failed, urut indeks. */
  paidButtons: WaOrderButtonRole[];
  failedButtons: WaOrderButtonRole[];
  /** Peran tombol template expiring (CTA "Gunakan Sekarang" → /voucher-saya). */
  expiringButtons: WaOrderButtonRole[];
  /** Template ringkasan harian merchant (cron harian). */
  templateDailySummary: string | undefined;
}

function config(): WaConfig {
  // Setting admin (Configurasi) menang; fallback env var.
  const token = getSetting("wa_token");
  const phoneNumberId = getSetting("wa_phone_number_id");
  const mode = process.env.WHATSAPP_MESSAGE_MODE;
  return {
    enabled: Boolean(token && phoneNumberId),
    token: token ?? undefined,
    phoneNumberId: phoneNumberId ?? undefined,
    businessTo: getSetting("wa_business_to") ?? process.env.WHATSAPP_BUSINESS_TO,
    apiBase:
      getSetting("wa_api_base") ??
      process.env.WHATSAPP_API_BASE ??
      "https://graph.facebook.com/v20.0",
    // Domain untuk LINK di pesan: WA_LINK_BASE (Configurasi → WhatsApp
    // Gateway) TERPISAH dari APP_URL — mis. aplikasi di domain internal,
    // tapi link WhatsApp memakai domain publik (wa.vshop.id).
    linkBase:
      getSetting("wa_link_base") ??
      getSetting("app_url") ??
      process.env.APP_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      "http://localhost:3000",
    messageMode: mode === "text" ? "text" : "auto",
    templatePaid: process.env.WHATSAPP_TEMPLATE_PAID,
    templateFailed: process.env.WHATSAPP_TEMPLATE_FAILED,
    templateOrder: process.env.WHATSAPP_TEMPLATE_ORDER,
    templateRedeemed: process.env.WHATSAPP_TEMPLATE_REDEEMED,
    templateExpiring: process.env.WHATSAPP_TEMPLATE_EXPIRING,
    templateRetried: process.env.WHATSAPP_TEMPLATE_RETRIED,
    templateDailySummary: process.env.WHATSAPP_TEMPLATE_DAILY_SUMMARY,
    templateLang: process.env.WHATSAPP_TEMPLATE_LANG ?? "id",
    paidButtons: parseButtonRoles(process.env.WHATSAPP_TEMPLATE_PAID_BUTTONS),
    failedButtons: parseButtonRoles(process.env.WHATSAPP_TEMPLATE_FAILED_BUTTONS),
    expiringButtons: parseButtonRoles(process.env.WHATSAPP_TEMPLATE_EXPIRING_BUTTONS),
  };
}

/** True bila kredensial WhatsApp Cloud API tersedia. */
export function whatsappEnabled(): boolean {
  return config().enabled;
}

// ---------- Template message (mode kirim utama) ----------

/** Satu komponen template Meta (body / header / button). */
export interface WaTemplateComponent {
  type: "body" | "header" | "button";
  /** Parameter diisi urut sesuai placeholder {{1}}..{{n}} pada template. */
  parameters?: Array<{ type: "text"; text: string }>;
  /** Untuk komponen `button` (mis. "quick_reply" / "url"). */
  sub_type?: string;
  /** Index tombol (0-based) untuk parameter button. */
  index?: string | number;
}

/** Template message terverifikasi Meta. */
export interface WaTemplate {
  /** Nama template yang sudah disetujui Meta (case-sensitive). */
  name: string;
  /** Kode bahasa template, mis. "id". */
  language: string;
  /** Komponen template — default: body dengan parameter teks. */
  components?: WaTemplateComponent[];
}

/** Pesan yang dikirim: template (utama) + teks bebas (fallback). */
export interface WaMessage {
  template?: WaTemplate;
  /** Teks bebas — fallback (sandbox / 24h window) dan mode `text`. */
  text?: string;
}

/**
 * Helper template body-only: parameter diisi urut placeholder {{1}}..{{n}}.
 * Template dengan header/gambar/tombol tetap bisa dipakai via `components`
 * pada `WaTemplate` langsung.
 */
export function bodyTemplate(
  name: string,
  language: string,
  body: string[]
): WaTemplate {
  return {
    name,
    language,
    components: [
      { type: "body", parameters: body.map((text) => ({ type: "text", text })) },
    ],
  };
}

// ---------- Tombol template (component `button`: url / quick_reply) ----------

/** Peran tombol yang dikenali untuk pesan berkonteks order. */
export type WaOrderButtonRole =
  | "detail"
  | "retry"
  | "dashboard"
  | "vouchers"
  | "invoice";

/** Satu tombol (component `button`) pada template Meta. */
export interface WaButtonSpec {
  /** `url` (membuka tautan) atau `quick_reply` (balasan cepat). */
  subType: "quick_reply" | "url";
  /** Indeks tombol (0-based) — URUT sesuai posisi tombol di template Meta. */
  index: number;
  /**
   * `url`: suffix yang di-append ke URL template (template URL berakhir
   * `{{1}}`). `quick_reply`: teks reply payload saat tombol diketuk.
   * Kosong → komponen tanpa `parameters` (URL tombol tetap / quick_reply
   * memakai default template).
   */
  payload?: string;
}

/**
 * Helper template body + TOMBOL: parameter body diisi urut placeholder
 * {{1}}..{{n}}, lalu komponen `button` (sub_type url/quick_reply) sesuai
 * `buttons`. Untuk url ber-suffix, template Meta harus dibuat dengan URL
 * berakhir `{{1}}` — aplikasi mengirim suffix-nya di `parameters[0].text`.
 */
export function templateWithButtons(
  name: string,
  language: string,
  body: string[],
  buttons: WaButtonSpec[]
): WaTemplate {
  return {
    name,
    language,
    components: [
      { type: "body", parameters: body.map((text) => ({ type: "text", text })) },
      ...buttons.map((b) => {
        const comp: WaTemplateComponent = {
          type: "button",
          sub_type: b.subType,
          index: String(b.index),
        };
        if (b.payload) {
          comp.parameters = [{ type: "text", text: b.payload }];
        }
        return comp;
      }),
    ],
  };
}

/** Parse env `WHATSAPP_TEMPLATE_*_BUTTONS` (daftar peran, koma). */
function parseButtonRoles(raw?: string): WaOrderButtonRole[] {
  if (!raw) return [];
  const roles: WaOrderButtonRole[] = [];
  for (const part of raw.split(",")) {
    const role = part.trim() as WaOrderButtonRole;
    if (["detail", "retry", "dashboard", "vouchers", "invoice"].includes(role)) {
      roles.push(role);
    } else {
      console.warn(`[wa] peran tombol tidak dikenal diabaikan: "${part.trim()}"`);
    }
  }
  return roles;
}

/**
 * Map peran tombol → spec kirim untuk satu order. `detail`/`retry` memakai
 * suffix order.id (URL template berakhir `{{1}}`); `dashboard`/`vouchers`
 * URL tetap (tanpa parameter — URL lengkap sudah di template Meta).
 */
function orderButtonSpecs(
  order: Order,
  roles: WaOrderButtonRole[]
): WaButtonSpec[] {
  return roles.map((role, index) => {
    switch (role) {
      case "detail":
        // Template: <APP_URL>/transaksi/{{1}}
        return { subType: "url", index, payload: order.id };
      case "invoice":
        // Template: <APP_URL>/transaksi/{{1}}?print=1 — klik langsung membuka
        // invoice & memicu dialog cetak / "Save as PDF".
        return { subType: "url", index, payload: order.id };
      case "retry":
        // Template: <APP_URL>/bayar/{{1}}
        return { subType: "url", index, payload: order.id };
      case "dashboard":
        // Template: <APP_URL>/merchant/dashboard (URL tetap, tanpa suffix)
        return { subType: "url", index };
      case "vouchers":
        // Template: <APP_URL>/voucher-saya (URL tetap, tanpa suffix)
        return { subType: "url", index };
    }
  });
}

/**
 * Map peran tombol → spec untuk konteks KLAIM voucher (notifikasi hampir
 * kadaluarsa). Hanya `vouchers` (CTA "Gunakan Sekarang" → `<APP_URL>`/
 * `/voucher-saya`, URL tetap tanpa suffix) yang berlaku; `dashboard` juga
 * diterima (URL tetap merchant); peran ber-order (`detail`/`retry`) tidak
 * relevan untuk klaim → diabaikan dengan peringatan.
 */
function claimButtonSpecs(roles: WaOrderButtonRole[]): WaButtonSpec[] {
  const specs: WaButtonSpec[] = [];
  roles.forEach((role, index) => {
    if (role === "vouchers" || role === "dashboard") {
      // Template: <APP_URL>/voucher-saya (atau dashboard) — URL tetap.
      specs.push({ subType: "url", index });
    } else {
      console.warn(
        `[wa] peran tombol "${role}" tidak berlaku utk notifikasi voucher — diabaikan`
      );
    }
  });
  return specs;
}

// ---------- Kirim via Cloud API ----------

interface SendResult {
  ok: boolean;
  to?: string;
  /** true bila Cloud API menerima pesan (delivered ke WhatsApp). */
  delivered: boolean;
  error?: string;
  /** Kode HTTP dari Cloud API (bila ada) — dipakai logika retry. */
  httpStatus?: number;
}

/** Ringkasan payload untuk log mode demo. */
function summarizePayload(payload: Record<string, unknown>): string {
  const t = payload as { type?: string; text?: { body?: string }; template?: { name?: string; language?: { code?: string } } };
  if (t.type === "template" && t.template) {
    const params = (payload as { template?: { components?: Array<{ parameters?: Array<{ text?: string }> }> } })
      .template?.components?.[0]?.parameters?.map((p) => p.text)
      ?? [];
    return `template:${t.template.name} [${t.template.language?.code ?? ""}] params=${JSON.stringify(params.slice(0, 3))}${params.length > 3 ? "…" : ""}`;
  }
  return t.text?.body ?? JSON.stringify(payload).slice(0, 160);
}

/**
 * POST satu pesan ke Cloud API (shared): mode demo mencatat ke console;
 * mode asli mengirim + memverifikasi message id. Tidak melempar error.
 */
async function postMessage(to: string, payload: Record<string, unknown>): Promise<SendResult> {
  const cfg = config();
  if (!cfg.enabled || !cfg.token || !cfg.phoneNumberId) {
    console.log(`[wa] (demo) → ${to}: ${summarizePayload(payload)}`);
    return { ok: true, to, delivered: false };
  }
  try {
    const res = await fetch(`${cfg.apiBase}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[wa] gagal kirim → ${to}: HTTP ${res.status} ${body.slice(0, 160)}`);
      return { ok: false, to, delivered: false, error: `HTTP ${res.status}`, httpStatus: res.status };
    }
    const data = (await res.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
    const delivered = Boolean(data?.messages?.[0]?.id);
    if (!delivered) {
      console.error(`[wa] response tanpa message id → ${to}`);
      return { ok: false, to, delivered: false, error: "no message id", httpStatus: res.status };
    }
    console.log(`[wa] terkirim → ${to} (${data!.messages![0].id})`);
    return { ok: true, to, delivered: true };
  } catch (err) {
    console.error(`[wa] error kirim → ${to}: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, to, delivered: false, error: "network" };
  }
}

/** Kirim pesan teks bebas (mode `text` / fallback 24h window / sandbox). */
function sendText(to: string, text: string): Promise<SendResult> {
  return postMessage(to, { type: "text", text: { body: text } });
}

/** Kirim TEMPLATE MESSAGE terverifikasi Meta. */
function sendTemplate(to: string, template: WaTemplate): Promise<SendResult> {
  const payload: Record<string, unknown> = {
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(template.components && template.components.length > 0
        ? { components: template.components }
        : {}),
    },
  };
  return postMessage(to, payload);
}

/**
 * Kirim pesan sesuai mode — SATU pass, tanpa antrian:
 * - `auto` (default): template (utama) → gagal? fallback teks bebas.
 * - `text`: selalu teks bebas (sandbox / pengembangan).
 * Tanpa template terkonfigurasi → teks bebas langsung (log peringatan).
 */
async function sendMessageOnce(to: string, msg: WaMessage): Promise<SendResult> {
  const mode = config().messageMode;
  if (!msg.template) {
    if (mode === "auto") {
      console.warn("[wa] template tidak dikonfigurasi — kirim teks bebas");
    }
    return sendText(to, msg.text ?? "");
  }
  if (mode === "text") {
    return sendText(to, msg.text ?? "");
  }
  // auto: template dulu, fallback teks bebas (sandbox / 24h window).
  const result = await sendTemplate(to, msg.template);
  if (result.ok) return result;
  if (msg.text) {
    console.warn(
      `[wa] template ${msg.template.name} gagal (${result.error}) — fallback teks bebas`
    );
    return sendText(to, msg.text);
  }
  return result;
}

// ---------- Antrian kirim (in-memory) + retry backoff ----------

interface QueuedJob {
  to: string;
  msg: WaMessage;
  /** Selalu resolve (modul tidak pernah melempar). */
  resolve: (res: SendResult) => void;
}

interface WaQueueState {
  jobs: QueuedJob[];
  active: number;
  drainScheduled: boolean;
}

/** Konfigurasi antrian — dibaca LAZY (tiap pemakaian) agar bisa di-
 * override env saat pengujian (mis. WA_RETRY_BASE_MS=1 untuk backoff cepat). */
function queueConfig() {
  return {
    maxConcurrency: Number(process.env.WA_QUEUE_CONCURRENCY ?? 3),
    maxAttempts: Number(process.env.WA_RETRY_MAX_ATTEMPTS ?? 3),
    retryBaseMs: Number(process.env.WA_RETRY_BASE_MS ?? 800),
    retryMaxMs: 8000,
  };
}

// State antrian di globalThis (pola sama seperti db.ts): Next.js dev
// membuat satu instance modul per bundle — antrian harus dibagi lintas
// bundle agar kiriman tidak tersebar di beberapa antrian terpisah.
declare global {
  // eslint-disable-next-line no-var
  var __vshopWaQueue: WaQueueState | undefined;
}

function queueState(): WaQueueState {
  if (!globalThis.__vshopWaQueue) {
    globalThis.__vshopWaQueue = { jobs: [], active: 0, drainScheduled: false };
  }
  return globalThis.__vshopWaQueue;
}

/** Kegagalan SEMENITARA yang layak diulang (network / 5xx / 429 / tanpa id). */
function isTransient(res: SendResult): boolean {
  if (res.error === "network" || res.error === "no message id") return true;
  const code = res.httpStatus;
  return typeof code === "number" && (code >= 500 || code === 429);
}

/** Delay exponential backoff + jitter: base·2^(n-1), cap 8s, ±30%. */
function backoffDelay(attempt: number): number {
  const cfg = queueConfig();
  const exp = cfg.retryBaseMs * 2 ** (attempt - 1);
  const capped = Math.min(exp, cfg.retryMaxMs);
  const jitter = 0.7 + Math.random() * 0.6; // 0.7–1.3
  return Math.round(capped * jitter);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Proses satu job: kirim (max attempts) dengan backoff. */
async function runJob(job: QueuedJob): Promise<void> {
  const maxAttempts = queueConfig().maxAttempts;
  let res: SendResult;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    res = await sendMessageOnce(job.to, job.msg);
    if (res.ok || !isTransient(res) || attempt === maxAttempts) break;
    const delay = backoffDelay(attempt);
    console.warn(
      `[wa] kirim gagal sementara (${res.error}) — coba lagi #${attempt + 1} dalam ${Math.round(delay)}ms`
    );
    await sleep(delay);
  }
  job.resolve(res!);
}

/** Salurkan antrian: proses sampai konkurrensi penuh / antrian kosong. */
function drain(): void {
  const q = queueState();
  while (q.active < queueConfig().maxConcurrency && q.jobs.length > 0) {
    const job = q.jobs.shift()!;
    q.active++;
    void runJob(job).finally(() => {
      q.active--;
      scheduleDrain();
    });
  }
}

function scheduleDrain(): void {
  const q = queueState();
  if (q.drainScheduled) return;
  q.drainScheduled = true;
  setTimeout(() => {
    q.drainScheduled = false;
    drain();
  }, 0);
}

/**
 * Antrikan satu pengiriman; selesai (termasuk retry) → resolve hasil.
 * Pemanggil boleh `await` (mis. cron yang butuh hasil untuk dedupe) atau
 * mengabaikan promise-nya (fire-and-forget) — jalur pembayaran memakai
 * yang terakhir agar request tidak terbebani puluhan kiriman.
 */
export function enqueueSend(to: string, msg: WaMessage): Promise<SendResult> {
  return new Promise((resolve) => {
    queueState().jobs.push({ to, msg, resolve });
    scheduleDrain();
  });
}

/** Kirim via antrian (retry backoff otomatis). Seam yang dipakai pemanggil. */
export function sendMessage(to: string, msg: WaMessage): Promise<SendResult> {
  return enqueueSend(to, msg);
}

// ---------- Log notifikasi (riwayat pengiriman untuk admin) ----------

/**
 * Catat satu percobaan kirim ke tabel `notification_logs` (fire-and-forget,
 * tidak pernah melempar). Status:
 * - `sent`   — Cloud API menerima pesan (delivered).
 * - `demo`   — mode demo (tanpa token): hanya dicatat, tidak dikirim.
 * - `failed` — kirim gagal / nomor tidak valid / template & fallback gagal.
 */
function logSendAttempt(
  type: string,
  recipient: string,
  res: SendResult,
  msg: WaMessage,
  orderNumber?: string
): void {
  recordNotificationLog({
    orderNumber,
    recipient,
    type,
    status: !res.ok ? "failed" : res.delivered ? "sent" : "demo",
    delivered: res.delivered,
    templateName: msg.template?.name,
    message: msg.text,
    error: res.error,
  });
}

/** Catat kiriman yang dilewati karena nomor penerima tidak valid. */
function logSkipped(
  type: string,
  recipient: string,
  reason: string,
  orderNumber?: string
): void {
  recordNotificationLog({
    orderNumber,
    recipient,
    type,
    status: "failed",
    delivered: false,
    error: reason,
  });
}

/**
 * Antrikan kirim + catat log SAAT JOB SELESAI (fire-and-forget). Jalur
 * pembayaran memakai ini: request tidak menunggu pengiriman sama sekali —
 * log ditulis dengan hasil akhir (termasuk retry) dari proses latar.
 */
function enqueueLogged(
  type: string,
  to: string,
  msg: WaMessage,
  orderNumber?: string
): void {
  void enqueueSend(to, msg).then((res) => logSendAttempt(type, to, res, msg, orderNumber));
}

// ---------- Pembangun pesan ----------

function itemSummary(order: Order): string {
  return order.items.map((i) => `${i.name}×${i.quantity}`).join(", ");
}

function paidCustomerMessage(order: Order, customerName: string): string {
  // Link invoice PDF: `?print=1` memicu dialog cetak / "Save as PDF" di
  // halaman invoice — pelanggan langsung bisa mengunduh buktinya.
  return (
    `Halo ${customerName}! ✅ Pembayaran order ${order.orderNumber} sebesar ` +
    `${formatRupiah(order.totalAmount)} berhasil. No. Invoice: ` +
    `${getInvoiceNumber(order)}. Lihat & unduh invoice (PDF): ` +
    `${config().linkBase}/transaksi/${order.id}?print=1`
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
    `Coba lagi: ${config().linkBase}/bayar/${order.id} · ` +
    `Detail transaksi: ${config().linkBase}/transaksi/${order.id}`
  );
}

function retriedCustomerMessage(order: Order, customerName: string): string {
  return (
    `Halo ${customerName}! 🔄 Order ${order.orderNumber} sebesar ` +
    `${formatRupiah(order.totalAmount)} siap dibayar ulang. Klik link ini untuk ` +
    `melanjutkan pembayaran: ${config().linkBase}/bayar/${order.id}`
  );
}

/**
 * WaMessage "order siap dibayar ulang" (admin retry massal → pelanggan):
 * template `WHATSAPP_TEMPLATE_RETRIED` (utama) + teks bebas (fallback).
 * Body template yang diharapkan (placeholder urut):
 * "Halo {{1}}, order {{2}} sebesar {{3}} siap dibayar ulang. Bayar di: {{4}}"
 * {{4}} = link /bayar/[orderId] — pelanggan langsung melanjutkan pembayaran.
 */
export function retriedWaMessage(order: Order, customerName: string): WaMessage {
  const cfg = config();
  return {
    template: cfg.templateRetried
      ? bodyTemplate(cfg.templateRetried, cfg.templateLang, [
          customerName,
          order.orderNumber,
          formatRupiah(order.totalAmount),
          `${cfg.linkBase}/bayar/${order.id}`,
        ])
      : undefined,
    text: retriedCustomerMessage(order, customerName),
  };
}

function newOrderMerchantMessage(order: Order, merchantName: string): string {
  return (
    `Halo ${merchantName}! 🛍️ Ada pesanan baru: ${order.orderNumber} ` +
    `(${itemSummary(order)}) sebesar ${formatRupiah(order.totalAmount)}. ` +
    `Lihat detail pesanan: ${config().linkBase}/transaksi/${order.id} · ` +
    `Proses di dashboard: ${config().linkBase}/merchant/dashboard`
  );
}

/**
 * WaMessage sukses pelanggan: template `WHATSAPP_TEMPLATE_PAID` (utama) +
 * teks bebas (fallback). Body template yang diharapkan (placeholder urut):
 * "Halo {{1}}, pembayaran order {{2}} sebesar {{3}} berhasil. Detail: {{4}}"
 * {{4}} = link INVOICE (/transaksi/[orderId]) — notifikasi bisa langsung
 * diklik menuju detail order & unduh invoice.
 *
 * TOMBOL (opsional, `WHATSAPP_TEMPLATE_PAID_BUTTONS`): template disetujui
 * bisa memakai tombol url "Lihat detail pesanan" → `<APP_URL>/transaksi/{{1}}`
 * dan "Lihat Invoice PDF" → `<APP_URL>/transaksi/{{1}}?print=1` (peran
 * `invoice`; aplikasi mengirim suffix = order.id). Peran lain (`retry`/
 * `dashboard`/`vouchers`) ikut didukung bila template dibuat dengan tombol tsb.
 * Teks bebas (fallback) menyertakan No. Invoice + link `?print=1`.
 */
export function paidWaMessage(order: Order, customerName: string): WaMessage {
  const cfg = config();
  const body = [
    customerName,
    order.orderNumber,
    formatRupiah(order.totalAmount),
    `${cfg.linkBase}/transaksi/${order.id}`,
  ];
  return {
    template: cfg.templatePaid
      ? cfg.paidButtons.length > 0
        ? templateWithButtons(
            cfg.templatePaid,
            cfg.templateLang,
            body,
            orderButtonSpecs(order, cfg.paidButtons)
          )
        : bodyTemplate(cfg.templatePaid, cfg.templateLang, body)
      : undefined,
    text: paidCustomerMessage(order, customerName),
  };
}

/**
 * WaMessage gagal pelanggan: template `WHATSAPP_TEMPLATE_FAILED` (utama) +
 * teks bebas (fallback). Body template yang diharapkan (placeholder urut):
 * "Halo {{1}}, pembayaran order {{2}} sebesar {{3}} belum berhasil: {{4}}. {{5}}"
 * {{5}} = link DETAIL TRANSAKSI (/transaksi/[orderId]) — notifikasi gagal
 * langsung menuju detail order; teks bebas (fallback) menyertakan dua link
 * (Coba Lagi → /bayar/[orderId] · Detail transaksi → /transaksi/[orderId]).
 *
 * TOMBOL (opsional, `WHATSAPP_TEMPLATE_FAILED_BUTTONS`): template disetujui
 * bisa memakai tombol url "Bayar ulang" → `<APP_URL>/bayar/{{1}}` dan
 * "Lihat detail pesanan" → `<APP_URL>/transaksi/{{1}}` (suffix = order.id),
 * urut sesuai indeks tombol di template.
 */
export function failedWaMessage(order: Order, customerName: string): WaMessage {
  const cfg = config();
  const reason =
    typeof order.metadata?.failureReason === "string" && order.metadata.failureReason
      ? order.metadata.failureReason
      : order.paymentStatus === "expired"
        ? "Waktu pembayaran habis"
        : "Pembayaran belum berhasil";
  const body = [
    customerName,
    order.orderNumber,
    formatRupiah(order.totalAmount),
    reason,
    `${cfg.linkBase}/transaksi/${order.id}`,
  ];
  return {
    template: cfg.templateFailed
      ? cfg.failedButtons.length > 0
        ? templateWithButtons(
            cfg.templateFailed,
            cfg.templateLang,
            body,
            orderButtonSpecs(order, cfg.failedButtons)
          )
        : bodyTemplate(cfg.templateFailed, cfg.templateLang, body)
      : undefined,
    text: failedCustomerMessage(order, customerName),
  };
}

/**
 * WaMessage pesanan baru merchant: template `WHATSAPP_TEMPLATE_ORDER`
 * (utama) + teks bebas (fallback). Body template yang diharapkan:
 * "Halo {{1}}, ada pesanan baru {{2}} ({{3}}) sebesar {{4}}. {{5}}"
 * {{5}} = link DETAIL TRANSAKSI (/transaksi/[orderId]) — penjual langsung
 * membuka detail pesanan masuk (timeline, item, alamat, tombol unduh bukti);
 * teks bebas (fallback) menyertakan dua link: detail transaksi + dashboard.
 */
function newOrderMerchantWaMessage(order: Order, merchantName: string): WaMessage {
  const cfg = config();
  return {
    template: cfg.templateOrder
      ? bodyTemplate(cfg.templateOrder, cfg.templateLang, [
          merchantName,
          order.orderNumber,
          itemSummary(order),
          formatRupiah(order.totalAmount),
          `${cfg.linkBase}/transaksi/${order.id}`,
        ])
      : undefined,
    text: newOrderMerchantMessage(order, merchantName),
  };
}

// ---------- Notifikasi perubahan status order ----------

/** Jenis transisi yang memicu notifikasi. */
export type PaymentTransition = Extract<PaymentStatus, "paid" | "failed" | "expired">;

/**
 * Kirim notifikasi WhatsApp saat status pembayaran order berubah.
 * - Selalu: pelanggan pemilik order (sukses / gagal / kadaluarsa).
 * - Merchant: order merchandise → nomor bisnis (WHATSAPP_BUSINESS_TO), atau
 *   merchant dari `metadata.merchantId` bila ada.
 * Mode kirim: template Meta (utama) → fallback teks bebas (lihat README).
 * Fire-and-forget: tidak melempar error, kegagalan hanya dicatat.
 * Dependency `deps` (seam `WaDeps`): lookup order/merchant/user — produksi
 * memakai default (store nyata); test menyuntik stub tanpa mocking modul.
 */
export async function notifyOrderPayment(
  orderId: string,
  transition: PaymentTransition,
  deps: WaDeps = defaultDeps
): Promise<void> {
  const order = deps.getOrder(orderId);
  if (!order) {
    console.error(`[wa] order ${orderId} tidak ditemukan — notifikasi dilewati`);
    return;
  }

  const user = deps.getUserById(order.userId);
  const customerPhone = normalizeToE164(user?.phone);
  const customerName = user?.name ?? "Pelanggan";

  if (transition === "paid") {
    if (customerPhone) {
      enqueueLogged("paid", customerPhone, paidWaMessage(order, customerName), order.orderNumber);
    } else {
      logSkipped("paid", user?.phone ?? "-", "nomor pelanggan tidak valid", order.orderNumber);
    }
    // Merchant: pesanan merchandise perlu diproses penjual/bisnis.
    if (order.type === "merchandise") {
      const merchant = merchantTargetForOrder(order, deps);
      if (merchant) {
        enqueueLogged("new_order", merchant.phone, newOrderMerchantWaMessage(order, merchant.name), order.orderNumber);
      } else {
        logSkipped("new_order", "-", "tidak ada target merchant (atur WHATSAPP_BUSINESS_TO)", order.orderNumber);
      }
    }
    return;
  }

  // failed / expired → notifikasi pelanggan (merchant tidak perlu tahu).
  const type = transition === "expired" ? "expired" : "failed";
  if (customerPhone) {
    enqueueLogged(type, customerPhone, failedWaMessage(order, customerName), order.orderNumber);
  } else {
    logSkipped(type, user?.phone ?? "-", "nomor pelanggan tidak valid", order.orderNumber);
  }
}

function merchantTargetForOrder(
  order: Order,
  deps: WaDeps
): { phone: string; name: string } | null {
  const merchantId = order.metadata?.merchantId;
  if (typeof merchantId === "string") {
    const m = deps.getMerchantById(merchantId);
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

/**
 * Notifikasi "ORDER SIAP DIBAYAR ULANG" → WhatsApp PELANGGAN. Dipanggil
 * saat ADMIN melakukan retry massal (order gagal/kadaluarsa dikembalikan ke
 * pending + token baru) — pelanggan diingatkan agar bisa membayar ulang.
 * Template `WHATSAPP_TEMPLATE_RETRIED` (utama) + teks bebas (fallback);
 * fire-and-forget, tidak pernah melempar (modul kontrak). Dependency
 * `deps` (seam `WaDeps`) untuk lookup user — sama seperti notifyOrderPayment.
 */
export function notifyOrderRetried(order: Order, deps: WaDeps = defaultDeps): void {
  const user = deps.getUserById(order.userId);
  const phone = normalizeToE164(user?.phone);
  if (!phone) {
    logSkipped("retried", user?.phone ?? "-", "nomor pelanggan tidak valid", order.orderNumber);
    return;
  }
  enqueueLogged(
    "retried",
    phone,
    retriedWaMessage(order, user?.name ?? "Pelanggan"),
    order.orderNumber
  );
}

/**
 * Notifikasi KONFIGURASI PEMBAYARAN BERMASALAH → WhatsApp MERCHANT.
 * Dipicu saat Status API Midtrans menolak dengan kode konfigurasi
 * (401/402/403/410 — lihat `isMidtransConfigError`): ini bukan kegagalan
 * pelanggan, melainkan masalah setting merchant (key salah / metode tidak
 * aktif / akun nonaktif) yang perlu diperbaiki di menu Configurasi.
 * Fire-and-forget (antrian in-memory + retry backoff). Dependency `deps`
 * (seam `WaDeps`) untuk lookup merchant — sama seperti notifyOrderPayment.
 */
export function notifyMerchantPaymentConfigIssue(
  order: Order,
  statusCode: string,
  reason: string,
  deps: WaDeps = defaultDeps
): boolean {
  const target = merchantTargetForOrder(order, deps);
  if (!target) {
    logSkipped("config_alert", "-", "tidak ada target merchant (atur WHATSAPP_BUSINESS_TO)", order.orderNumber);
    return false;
  }
  const text =
    `⚠️ Konfigurasi pembayaran BERMASALAH! Status API Midtrans menolak ` +
    `(kode ${statusCode}: ${reason}). Periksa & perbaiki pengaturan pembayaran ` +
    `di ${config().linkBase}/admin/configurasi (order ${order.orderNumber}).`;
  const m: WaMessage = { text };
  enqueueLogged("config_alert", target.phone, m, order.orderNumber);
  return true;
}

// ---------- Ringkasan harian merchant (cron) ----------

/**
 * WaMessage ringkasan harian merchant: template
 * `WHATSAPP_TEMPLATE_DAILY_SUMMARY` (utama) + teks bebas (fallback). Body
 * template yang diharapkan: "Halo {{1}}, ringkasan V Shop hari ini:
 * {{2}} voucher terklaim, pendapatan {{3}}, {{4}} order pending. Lihat
 * laporan: {{5}}"
 */
export function dailySummaryWaMessage(
  merchantName: string,
  summary: { claimedToday: number; revenueToday: number; pendingOrders: number }
): WaMessage {
  const cfg = config();
  const revenue = formatRupiah(summary.revenueToday);
  return {
    template: cfg.templateDailySummary
      ? bodyTemplate(cfg.templateDailySummary, cfg.templateLang, [
          merchantName,
          String(summary.claimedToday),
          revenue,
          String(summary.pendingOrders),
          `${cfg.linkBase}/merchant/laporan`,
        ])
      : undefined,
    text:
      `Halo ${merchantName}! 📊 Ringkasan V Shop hari ini: ` +
      `${summary.claimedToday} voucher terklaim, pendapatan ${revenue}, ` +
      `${summary.pendingOrders} order pending. Lihat laporan lengkap: ` +
      `${cfg.linkBase}/merchant/laporan`,
  };
}

/**
 * Kirim ringkasan harian → WhatsApp MERCHANT (cron harian). Penerima dari
 * `noWAUsaha` merchant (E.164). Mengembalikan true bila pesan diterima
 * (atau dicatat di mode demo) — pemanggil (cron) memakai ini + log untuk
 * dedupe "sudah terkirim hari ini".
 */
export async function notifyMerchantDailySummary(
  merchant: Merchant,
  summary: { claimedToday: number; revenueToday: number; pendingOrders: number }
): Promise<boolean> {
  const phone = normalizeToE164(merchant.noWAUsaha);
  if (!phone) {
    console.error("[wa] nomor merchant tidak valid — ringkasan harian dilewati");
    logSkipped("daily_summary", merchant.noWAUsaha, "nomor merchant tidak valid");
    return false;
  }
  const msg = dailySummaryWaMessage(merchant.namaUsaha, summary);
  const res = await enqueueSend(phone, msg);
  logSendAttempt("daily_summary", phone, res, msg);
  return res.ok;
}

// ---------- Notifikasi voucher ----------

type RedeemNotificationContext = ClaimedVoucher & {
  voucher?: Voucher;
  user?: User;
};

/**
 * Notifikasi voucher BERHASIL DIREEDEM → WhatsApp MERCHANT (alur getken).
 * Template `WHATSAPP_TEMPLATE_REDEEMED` (utama) + teks bebas (fallback).
 * Body template yang diharapkan (placeholder urut):
 * "Halo {{1}}, voucher {{2}} senilai {{3}} berhasil diredeem oleh {{4}}
 * (kode {{5}}). Terima kasih!"
 * Mengembalikan true bila pesan diterima (atau dicatat di mode demo).
 */
export async function notifyVoucherRedeemed(
  merchantPhone: string,
  merchantName: string,
  claim: RedeemNotificationContext
): Promise<boolean> {
  const phone = normalizeToE164(merchantPhone);
  if (!phone) {
    console.error("[wa] nomor merchant tidak valid — notifikasi redeem dilewati");
    logSkipped("redeemed", merchantPhone, "nomor merchant tidak valid");
    return false;
  }
  const cfg = config();
  const voucherName = claim.voucher?.name ?? "Voucher";
  const nilai = claim.voucher ? formatRupiah(claim.voucher.nilai) : "";
  const customerName = claim.user?.name ?? "Pelanggan";
  const msg: WaMessage = {
    template: cfg.templateRedeemed
      ? bodyTemplate(cfg.templateRedeemed, cfg.templateLang, [
          merchantName,
          voucherName,
          nilai,
          customerName,
          claim.kode,
        ])
      : undefined,
    text:
      `Halo ${merchantName}! ✅ Voucher ${voucherName}${nilai ? ` senilai ${nilai}` : ""} ` +
      `berhasil diredeem oleh ${customerName} (kode ${claim.kode}). ` +
      `Terima kasih sudah melayani pelanggan V Shop.`,
  };
  const res = await enqueueSend(phone, msg);
  logSendAttempt("redeemed", phone, res, msg);
  return res.ok;
}

/**
 * Notifikasi voucher HAMPIR KADALUARSA → WhatsApp PELANGGAN (intisari
 * bersama untuk dua tier cron: 48 jam & H-1/24 jam). Template
 * `WHATSAPP_TEMPLATE_EXPIRING` (utama) + teks bebas (fallback). Body
 * template yang diharapkan: "Halo {{1}}, voucher {{2}} senilai {{3}}
 * akan kadaluarsa pada {{4}}. Segera gunakan: {{5}}"
 * Mengembalikan true bila pesan diterima (pemanggil menandai klaim agar
 * tidak dinotifikasi ulang — dedupe per tier via kolom terpisah).
 */
async function notifyExpiringTier(
  claim: RedeemNotificationContext,
  tier: "expiring" | "expiring_24h"
): Promise<boolean> {
  const phone = normalizeToE164(claim.user?.phone);
  if (!phone) {
    console.error(`[wa] nomor pelanggan tidak valid — notifikasi ${tier} dilewati`);
    logSkipped(tier, claim.user?.phone ?? "-", "nomor pelanggan tidak valid");
    return false;
  }
  const cfg = config();
  const voucherName = claim.voucher?.name ?? "Voucher";
  const nilai = claim.voucher ? formatRupiah(claim.voucher.nilai) : "";
  const customerName = claim.user?.name ?? "Pelanggan";
  const dueDate = claim.voucher ? formatDateLong(claim.voucher.masaBerlaku) : "";
  const body = [
    customerName,
    voucherName,
    nilai,
    dueDate,
    `${cfg.linkBase}/voucher-saya`,
  ];
  const msg: WaMessage = {
    template: cfg.templateExpiring
      ? cfg.expiringButtons.length > 0
        ? templateWithButtons(
            cfg.templateExpiring,
            cfg.templateLang,
            body,
            claimButtonSpecs(cfg.expiringButtons)
          )
        : bodyTemplate(cfg.templateExpiring, cfg.templateLang, body)
      : undefined,
    text:
      tier === "expiring_24h"
        ? `Halo ${customerName}! ⚠️ Voucher ${voucherName}${nilai ? ` senilai ${nilai}` : ""} ` +
          `akan KADALUARSA BESOK (${dueDate}). Gunakan hari ini sebelum masa berlakunya habis! ` +
          `${cfg.linkBase}/voucher-saya`
        : `Halo ${customerName}! ⏰ Voucher ${voucherName}${nilai ? ` senilai ${nilai}` : ""} ` +
          `akan kadaluarsa pada ${dueDate}. Segera gunakan sebelum masa berlakunya habis! ` +
          `${cfg.linkBase}/voucher-saya`,
  };
  const res = await enqueueSend(phone, msg);
  logSendAttempt(tier, phone, res, msg);
  return res.ok;
}

/**
 * Tier 48 jam: notifikasi voucher hampir kadaluarsa (cron
 * /api/cron/expire-orders). Dedupe: pemanggil menandai via
 * `markClaimExpiringNotified` setelah true.
 */
export async function notifyClaimExpiringSoon(
  claim: RedeemNotificationContext
): Promise<boolean> {
  return notifyExpiringTier(claim, "expiring");
}

/**
 * Tier H-1 (24 jam): pengingat voucher kadaluarsa besok (cron
 * /api/cron/voucher-expiring-24h). Dedupe independen: pemanggil menandai
 * via `markClaimExpiring24hNotified` setelah true.
 */
export async function notifyClaimExpiringSoon24h(
  claim: RedeemNotificationContext
): Promise<boolean> {
  return notifyExpiringTier(claim, "expiring_24h");
}
