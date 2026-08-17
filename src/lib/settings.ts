/**
 * Pengaturan koneksi aplikasi yang bisa diubah dari menu admin
 * **Configurasi** (`/admin/configurasi`) — tanpa edit file env / restart:
 *
 *   - **postgres**  — URL + service key Supabase (PostgreSQL + RLS).
 *   - **midtrans**  — Payment Gateway (server/client key, mode produksi).
 *   - **whatsapp**  — WhatsApp Cloud API (token, phone number id, base URL).
 *   - **ai**        — endpoint AI (OpenAI-compatible) — opsional.
 *   - **lainnya**   — APP_URL (link notifikasi), ORDER_EXPIRY_HOURS.
 *
 * Sumber nilai (urutan prioritas):
 *   1. Nilai tersimpan di tabel `app_settings` (dari UI admin);
 *   2. env var (fallback — lihat `SETTING_DEFS[].env`).
 *
 * Keamanan:
 *   - Nilai `isSecret` disimpan TERENKRIPSI (AES-256-GCM via crypto.ts,
 *     format `v1:iv:tag:ct`) di kolom `value_enc` — tidak pernah dikirim
 *     utuh ke browser (listSettings hanya mengembalikan `masked`).
 *   - Tabel hanya service_role (migration 0009: RLS tanpa policy + revoke
 *     anon/authenticated); halaman & API dibatasi role admin.
 *   - `getSetting` SYNC + globalThis cache (pola db.ts) sehingga modul
 *     runtime (midtrans/whatsapp) bisa memakainya tanpa await; bila cache
 *     belum ter-hydrate, kembali ke env var (perilaku lama).
 */
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "./crypto";
import { getSupabaseAdmin } from "./supabase/server";

// ---------- Registry (sumber tunggal definisi setting + fallback env) ----------

export type SettingCategory = "postgres" | "midtrans" | "whatsapp" | "ai" | "lainnya";

export interface SettingDef {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  isSecret: boolean;
  /** Env var fallback bila belum disimpan di app_settings. */
  env: string;
}

export const SETTING_DEFS: SettingDef[] = [
  // PostgreSQL / Supabase
  { key: "postgres_url", category: "postgres", label: "URL PostgreSQL (Supabase)", description: "Base URL API Supabase, mis. https://xxxx.supabase.co (atau http://127.0.0.1:54321 lokal).", isSecret: false, env: "NEXT_PUBLIC_SUPABASE_URL" },
  { key: "postgres_service_key", category: "postgres", label: "Service Role Key", description: "Kunci service_role (bypass RLS) — rahasia, hanya di server.", isSecret: true, env: "SUPABASE_SERVICE_ROLE_KEY" },
  // Payment Gateway (Midtrans)
  { key: "midtrans_server_key", category: "midtrans", label: "Server Key", description: "SB-Mid-server-… (sandbox) / Mid-server-… (produksi).", isSecret: true, env: "MIDTRANS_SERVER_KEY" },
  { key: "midtrans_client_key", category: "midtrans", label: "Client Key", description: "SB-Mid-client-… — dipakai Snap.js di halaman bayar.", isSecret: true, env: "MIDTRANS_CLIENT_KEY" },
  { key: "midtrans_is_production", category: "midtrans", label: "Mode Produksi", description: "true = transaksi nyata (hati-hati!), false = sandbox.", isSecret: false, env: "MIDTRANS_IS_PRODUCTION" },
  { key: "midtrans_api_base", category: "midtrans", label: "Base URL API", description: "Default sandbox/produksi Midtrans — ganti hanya untuk proxy/simulator lokal.", isSecret: false, env: "MIDTRANS_API_BASE" },
  // WhatsApp Cloud API
  { key: "wa_token", category: "whatsapp", label: "Token (System User)", description: "Access token Meta / WhatsApp Cloud API.", isSecret: true, env: "WHATSAPP_TOKEN" },
  { key: "wa_phone_number_id", category: "whatsapp", label: "Phone Number ID", description: "ID nomor pengirim (dari Meta Business / WhatsApp).", isSecret: false, env: "WHATSAPP_PHONE_NUMBER_ID" },
  { key: "wa_api_base", category: "whatsapp", label: "Base URL API", description: "Default https://graph.facebook.com — hanya ganti bila proxy.", isSecret: false, env: "WHATSAPP_API_BASE" },
  { key: "wa_business_to", category: "whatsapp", label: "Nomor Merchant (uji)", description: "Nomor tujuan untuk notifikasi merchant (E.164).", isSecret: false, env: "WHATSAPP_BUSINESS_TO" },
  { key: "wa_support_number", category: "whatsapp", label: "Nomor Support (Lacak Pesanan)", description: "Nomor WhatsApp layanan bantuan — tombol 'Lacak Pesanan' di detail transaksi gagal membuka chat wa.me ke nomor ini.", isSecret: false, env: "WHATSAPP_SUPPORT_NUMBER" },
  { key: "wa_link_base", category: "whatsapp", label: "Link Base (WA_LINK_BASE)", description: "Domain PUBLIK untuk link di pesan WhatsApp (mis. https://wa.vshop.id) — terpisah dari APP_URL bila domain aplikasi internal berbeda.", isSecret: false, env: "WA_LINK_BASE" },
  // AI
  { key: "ai_api_base", category: "ai", label: "Base URL AI", description: "Mis. https://api.openai.com — endpoint OpenAI-compatible (/v1/models dipakai uji koneksi).", isSecret: false, env: "AI_API_BASE" },
  { key: "ai_api_key", category: "ai", label: "API Key AI", description: "Kunci akses AI — rahasia.", isSecret: true, env: "AI_API_KEY" },
  { key: "ai_model", category: "ai", label: "Model", description: "Mis. gpt-4o-mini / gemini-2.0-flash.", isSecret: false, env: "AI_MODEL" },
  // Lainnya
  { key: "app_url", category: "lainnya", label: "URL Aplikasi (APP_URL)", description: "Dipakai link notifikasi WhatsApp ke halaman riwayat/detail.", isSecret: false, env: "APP_URL" },
  { key: "order_expiry_hours", category: "lainnya", label: "Order Expiry (jam)", description: "Batas pending order & kadaluarsa transaksi Midtrans (default 24).", isSecret: false, env: "ORDER_EXPIRY_HOURS" },
];

export const SETTING_CATEGORIES: Array<{ id: SettingCategory; label: string; icon: string; hint: string }> = [
  { id: "postgres", label: "Database PostgreSQL", icon: "🗄️", hint: "Koneksi ke PostgreSQL / Supabase (REST + service role)." },
  { id: "midtrans", label: "Payment Gateway", icon: "💳", hint: "Koneksi Midtrans (Snap + Status API) — sandbox/produksi." },
  { id: "whatsapp", label: "WhatsApp Gateway", icon: "💬", hint: "Koneksi WhatsApp Cloud API untuk notifikasi." },
  { id: "ai", label: "AI / Integrasi", icon: "🤖", hint: "Endpoint AI (opsional) — OpenAI-compatible." },
  { id: "lainnya", label: "Lainnya", icon: "🧩", hint: "Pengaturan umum aplikasi." },
];

const defByKey = new Map(SETTING_DEFS.map((d) => [d.key, d]));

// ---------- Cache (globalThis — pola db.ts) ----------

interface SettingsState {
  hydrated: boolean;
  /** key → nilai dekripsi (hanya untuk isSecret yang sudah dibuka). */
  map: Map<string, string>;
}

const holder = (): SettingsState => {
  const g = globalThis as unknown as { __vshopSettings?: SettingsState };
  return (g.__vshopSettings ??= { hydrated: false, map: new Map() });
};

/** Fallback env untuk sebuah key (dari registry). */
function envOf(key: string): string | null {
  const def = defByKey.get(key);
  const v = def ? process.env[def.env] : undefined;
  return v ? v : null;
}

/**
 * Hydrate pengaturan dari tabel `app_settings` (service-role). Memanggil
 * dekripsi untuk nilai rahasia. No-op bila Supabase belum dikonfigurasi
 * (mode demo: nilai hanya dari env var). Idempotent (memoized).
 */
export async function ensureSettingsHydrated(): Promise<void> {
  const s = holder();
  if (s.hydrated) return;
  s.hydrated = true; // hindari re-entrancy; gagal hydration tidak fatal
  const sb = getSupabaseAdmin();
  if (!sb) return;
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("key,is_secret,value_enc")
      .limit(500);
    if (error) return;
    for (const row of data ?? []) {
      const def = defByKey.get(String(row.key));
      const enc = row.value_enc;
      if (!def || typeof enc !== "string") continue;
      let value: string | null = enc;
      if (def.isSecret) value = await decryptSecret(enc);
      if (value) s.map.set(def.key, value);
    }
  } catch {
    // hydration gagal → tetap fallback env; jangan crash aplikasi.
  }
}

/** Nilai tersimpan/aktif untuk sebuah key — SYNC; fallback env bila belum disimpan. */
export function getSetting(key: string): string | null {
  const cached = holder().map.get(key);
  return cached ?? envOf(key);
}

/** True bila nilai tersimpan (bukan hanya fallback env). */
export function hasStoredSetting(key: string): boolean {
  return holder().map.has(key);
}

/** Simpan/ubah satu pengaturan; rahasia dienkripsi sebelum masuk DB. */
export async function updateSetting(input: {
  key: string;
  value: string;
  updatedBy?: string;
}): Promise<void> {
  const def = defByKey.get(input.key);
  if (!def) throw new Error(`Setting tidak dikenal: ${input.key}`);

  let valueEnc: string | null = input.value;
  if (def.isSecret) {
    if (!isEncryptionConfigured()) {
      throw new Error("SESSION_ENCRYPTION_KEY belum diatur — rahasia tidak bisa disimpan");
    }
    valueEnc = await encryptSecret(input.value);
  }

  const sb = getSupabaseAdmin();
  if (sb) {
    const { error } = await sb.from("app_settings").upsert(
      {
        key: input.key,
        category: def.category,
        label: def.label,
        description: def.description,
        is_secret: def.isSecret,
        value_enc: def.isSecret ? valueEnc : input.value,
        updated_by: input.updatedBy ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" }
    );
    if (error) throw new Error(`Gagal menyimpan ${input.key}: ${error.message}`);
  }
  // Cache (juga untuk mode demo — tersimpan hanya seumur proses).
  holder().map.set(input.key, input.value);
}

export interface SettingListItem {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  isSecret: boolean;
  /** Nilai aktif (server-side); untuk isSecret TIDAK dikirim ke client. */
  value: string;
  /** Nilai untuk tampilan: mask untuk rahasia (mis. "••••abcd"), nilai penuh untuk non-rahasia. */
  display: string;
  source: "stored" | "env" | "unset";
}

function mask(v: string): string {
  if (!v) return "";
  return v.length <= 8 ? "••••" : `••••${v.slice(-4)}`;
}

/** Daftar pengaturan untuk halaman admin (rahasia di-mask). */
export async function listSettings(): Promise<SettingListItem[]> {
  await ensureSettingsHydrated();
  const items: SettingListItem[] = [];
  for (const def of SETTING_DEFS) {
    const stored = holder().map.get(def.key);
    const env = envOf(def.key);
    const value = stored ?? env ?? "";
    items.push({
      key: def.key,
      category: def.category,
      label: def.label,
      description: def.description,
      isSecret: def.isSecret,
      value: def.isSecret ? "" : value, // rahasia: nilai penuh TIDAK keluar server
      display: value ? (def.isSecret ? mask(value) : value) : "",
      source: stored !== undefined ? "stored" : env ? "env" : "unset",
    });
  }
  return items;
}

/** Ringkasan status per kategori (untuk badge halaman admin). */
export function categoryStatus(items: SettingListItem[]): Record<
  SettingCategory,
  "configured" | "partial" | "empty"
> {
  const out = {} as Record<SettingCategory, "configured" | "partial" | "empty">;
  for (const c of SETTING_CATEGORIES) {
    const rows = items.filter((i) => i.category === c.id);
    const filled = rows.filter((r) => r.source !== "unset").length;
    out[c.id] = filled === 0 ? "empty" : filled === rows.length ? "configured" : "partial";
  }
  return out;
}

// ---------- Uji koneksi nyata ke sistem luar ----------

export interface ConnectionTestResult {
  ok: boolean;
  detail: string;
}

const WA_DEFAULT_API_BASE = "https://graph.facebook.com";

/** Uji koneksi per kategori terhadap sistem luar yang sebenarnya. */
export async function testConnection(category: SettingCategory): Promise<ConnectionTestResult> {
  await ensureSettingsHydrated();
  switch (category) {
    case "postgres":
      return testPostgres();
    case "midtrans":
      return testMidtrans();
    case "whatsapp":
      return testWhatsapp();
    case "ai":
      return testAi();
    default:
      return { ok: true, detail: "Tidak ada uji koneksi untuk kategori ini." };
  }
}

async function testPostgres(): Promise<ConnectionTestResult> {
  const url = getSetting("postgres_url");
  const key = getSetting("postgres_service_key");
  if (!url || !key) return { ok: false, detail: "URL / service key belum diisi." };
  const sb = getSupabaseAdmin();
  if (!sb) return { ok: false, detail: "Supabase tidak dikonfigurasi (env kosong)." };
  try {
    const { data, error } = await sb.from("packages").select("id").limit(1);
    if (error) return { ok: false, detail: `Gagal query: ${error.message}` };
    return { ok: true, detail: `Terhubung — tabel packages terbaca (${data?.length ?? 0} baris).` };
  } catch (e) {
    return { ok: false, detail: `Timeout/error jaringan: ${e instanceof Error ? e.message : e}` };
  }
}

async function testMidtrans(): Promise<ConnectionTestResult> {
  const serverKey = getSetting("midtrans_server_key");
  const base = getSetting("midtrans_api_base") ?? "https://api.sandbox.midtrans.com";
  if (!serverKey) return { ok: false, detail: "Server Key belum diisi." };
  try {
    const r = await fetch(`${base}/v2/vshop-health-check/status`, {
      headers: { Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString("base64")}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 || r.status === 403) {
      return { ok: false, detail: "Server Key ditolak (401/403) — periksa kunci & mode sandbox/produksi." };
    }
    // 404 = transaksi tidak ditemukan tetapi AUTH OK (kunci valid).
    if (r.status === 404) return { ok: true, detail: "Server Key valid (auth OK, transaksi uji tidak ditemukan)." };
    return { ok: r.ok, detail: `Status API menjawab HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, detail: `Timeout/error jaringan: ${e instanceof Error ? e.message : e}` };
  }
}

async function testWhatsapp(): Promise<ConnectionTestResult> {
  const token = getSetting("wa_token");
  const phoneId = getSetting("wa_phone_number_id");
  const base = getSetting("wa_api_base") ?? WA_DEFAULT_API_BASE;
  if (!token || !phoneId) return { ok: false, detail: "Token / Phone Number ID belum diisi." };
  try {
    const r = await fetch(`${base}/v21.0/${phoneId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (r.status === 401 || r.status === 403) {
      return { ok: false, detail: "Token ditolak (401/403) — periksa token & izin WhatsApp." };
    }
    if (!r.ok) return { ok: false, detail: `Graph API menjawab HTTP ${r.status}.` };
    return { ok: true, detail: "Token & Phone Number ID valid." };
  } catch (e) {
    return { ok: false, detail: `Timeout/error jaringan: ${e instanceof Error ? e.message : e}` };
  }
}

async function testAi(): Promise<ConnectionTestResult> {
  const base = getSetting("ai_api_base");
  const key = getSetting("ai_api_key");
  if (!base || !key) return { ok: false, detail: "Base URL / API key AI belum diisi." };
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}/v1/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false, detail: `Endpoint AI menjawab HTTP ${r.status}.` };
    return { ok: true, detail: "Endpoint AI dapat diakses (models list OK)." };
  } catch (e) {
    return { ok: false, detail: `Timeout/error jaringan: ${e instanceof Error ? e.message : e}` };
  }
}
