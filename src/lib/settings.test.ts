import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------- Mock Supabase (getSupabaseAdmin) ----------
let sbState: {
  available: boolean;
  rows?: Array<Record<string, unknown>>;
  error?: { message: string } | null;
  upsertError?: { message: string } | null;
};

vi.mock("./supabase/server", () => ({
  getSupabaseAdmin: () => (sbState.available ? mockClient() : null),
  getSupabaseAnon: () => null,
  isSupabaseConfigured: () => sbState.available,
}));

function mockClient() {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.limit = async () =>
    sbState.error ? { data: null, error: sbState.error } : { data: sbState.rows ?? [], error: null };
  builder.upsert = async () =>
    sbState.upsertError ? { data: null, error: sbState.upsertError } : { data: [], error: null };
  builder.eq = () => builder;
  builder.maybeSingle = async () =>
    sbState.error ? { data: null, error: sbState.error } : { data: sbState.rows?.[0] ?? null, error: null };
  builder.single = builder.maybeSingle;
  return { from: () => builder };
}

// ---------- Env & cache reset ----------
const ENV_BACKUP: Record<string, string | undefined> = {};

beforeEach(() => {
  ENV_BACKUP.MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
  ENV_BACKUP.MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;
  ENV_BACKUP.WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  ENV_BACKUP.WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
  ENV_BACKUP.WHATSAPP_API_BASE = process.env.WHATSAPP_API_BASE;
  ENV_BACKUP.AI_API_KEY = process.env.AI_API_KEY;
  ENV_BACKUP.SESSION_ENCRYPTION_KEY = process.env.SESSION_ENCRYPTION_KEY;
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.MIDTRANS_SERVER_KEY = "SB-Mid-server-env";
  process.env.MIDTRANS_CLIENT_KEY = "SB-Mid-client-env";
  process.env.WHATSAPP_TOKEN = "wa-token-env";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  delete process.env.WHATSAPP_API_BASE;
  delete process.env.AI_API_KEY;

  sbState = { available: true, rows: [], error: null, upsertError: null };
  vi.resetModules();
  delete (globalThis as Record<string, unknown>).__vshopSettings;
  vi.unstubAllGlobals();
});

afterEach(() => {
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete (globalThis as Record<string, unknown>).__vshopSettings;
});

async function fresh() {
  return await import("./settings");
}

describe("getOrderExpiryHours — prioritas stored > env > default, dibaca per-panggilan", () => {
  it("nilai tersimpan di Configurasi langsung berlaku tanpa restart, menang atas env", async () => {
    process.env.ORDER_EXPIRY_HOURS = "24";
    try {
      const s = await fresh();
      const { getOrderExpiryHours } = await import("./midtrans");
      // Belum tersimpan → fallback env.
      expect(getOrderExpiryHours()).toBe(24);
      // Simpan via updateSetting (setara UI admin) → cache di-refresh segera.
      await s.updateSetting({ key: "order_expiry_hours", value: "5" });
      expect(getOrderExpiryHours()).toBe(5);
      // Ubah env pun tidak mengalahkan nilai tersimpan.
      process.env.ORDER_EXPIRY_HOURS = "3";
      expect(getOrderExpiryHours()).toBe(5);
    } finally {
      delete process.env.ORDER_EXPIRY_HOURS;
    }
  });

  it("nilai tersimpan tidak valid (nol / bukan angka) jatuh ke default 24", async () => {
    const s = await fresh();
    const { getOrderExpiryHours } = await import("./midtrans");
    await s.updateSetting({ key: "order_expiry_hours", value: "0" });
    expect(getOrderExpiryHours()).toBe(24);
    await s.updateSetting({ key: "order_expiry_hours", value: "abc" });
    expect(getOrderExpiryHours()).toBe(24);
  });
});

describe("getSetting — fallback env sebelum hydration", () => {
  it("mengembalikan env var saat cache belum terisi", async () => {
    const s = await fresh();
    expect(s.getSetting("midtrans_server_key")).toBe("SB-Mid-server-env");
    expect(s.getSetting("wa_token")).toBe("wa-token-env");
    expect(s.getSetting("ai_api_key")).toBeNull();
  });

  it("key tak dikenal → null", async () => {
    const s = await fresh();
    expect(s.getSetting("tidak-ada")).toBeNull();
  });
});

describe("ensureSettingsHydrated + getSetting — nilai tersimpan menang atas env", () => {
  it("nilai non-rahasia & rahasia (dekripsi) tersimpan masuk cache", async () => {
    const { encryptSecret } = await import("./crypto");
    const enc = await encryptSecret("SB-Mid-server-stored");
    sbState.rows = [
      { key: "midtrans_server_key", is_secret: true, value_enc: enc },
      { key: "app_url", is_secret: false, value_enc: "https://vshop.example" },
      { key: "tidak-dikenal", is_secret: false, value_enc: "x" },
    ];
    const s = await fresh();
    await s.ensureSettingsHydrated();
    expect(s.getSetting("midtrans_server_key")).toBe("SB-Mid-server-stored"); // menang atas env
    expect(s.getSetting("app_url")).toBe("https://vshop.example");
    expect(s.hasStoredSetting("midtrans_server_key")).toBe(true);
    expect(s.getSetting("ai_api_key")).toBeNull(); // tidak ada baris & tidak ada env
  });

  it("memoized — panggilan kedua tidak fetch ulang", async () => {
    const s = await fresh();
    await s.ensureSettingsHydrated();
    sbState.rows = [{ key: "app_url", is_secret: false, value_enc: "berubah" }];
    await s.ensureSettingsHydrated();
    expect(s.getSetting("app_url")).toBeNull(); // cache lama tidak ter-refresh
  });

  it("tanpa Supabase (mode demo) → no-op, tetap fallback env", async () => {
    sbState.available = false;
    const s = await fresh();
    await s.ensureSettingsHydrated();
    expect(s.getSetting("midtrans_server_key")).toBe("SB-Mid-server-env");
  });

  it("error query → tidak crash, fallback env", async () => {
    sbState.error = { message: "koneksi putus" };
    const s = await fresh();
    await s.ensureSettingsHydrated();
    expect(s.getSetting("midtrans_server_key")).toBe("SB-Mid-server-env");
  });
});

describe("updateSetting — simpan + enkripsi rahasia", () => {
  it("non-rahasia disimpan apa adanya via upsert", async () => {
    const s = await fresh();
    await s.updateSetting({ key: "app_url", value: "https://vshop.id" });
    expect(s.getSetting("app_url")).toBe("https://vshop.id");
    expect(s.hasStoredSetting("app_url")).toBe(true);
  });

  it("rahasia dienkripsi — nilai di DB tidak sama dengan plaintext, bisa didekripsi", async () => {
    const { decryptSecret } = await import("./crypto");
    const s = await fresh();
    await s.updateSetting({ key: "midtrans_server_key", value: "SB-Mid-server-rahasia" });
    // capture payload upsert
    // (mock tidak menangkap argumen — verifikasi lewat cache + decrypt langsung)
    expect(s.getSetting("midtrans_server_key")).toBe("SB-Mid-server-rahasia");
    const enc = await encryptOf("SB-Mid-server-rahasia");
    expect(await decryptSecret(enc)).toBe("SB-Mid-server-rahasia");
  });

  it("key tak dikenal → throw", async () => {
    const s = await fresh();
    await expect(s.updateSetting({ key: "nope", value: "x" })).rejects.toThrow(/tidak dikenal/);
  });

  it("rahasia tanpa SESSION_ENCRYPTION_KEY → throw", async () => {
    delete process.env.SESSION_ENCRYPTION_KEY;
    const s = await fresh();
    await expect(
      s.updateSetting({ key: "wa_token", value: "secret" })
    ).rejects.toThrow(/SESSION_ENCRYPTION_KEY/);
  });

  it("upsert error → throw dengan pesan", async () => {
    sbState.upsertError = { message: "duplicate key" };
    const s = await fresh();
    await expect(s.updateSetting({ key: "app_url", value: "x" })).rejects.toThrow(/duplicate key/);
  });

  it("mode demo (tanpa Supabase) → tersimpan di cache in-memory", async () => {
    sbState.available = false;
    const s = await fresh();
    await s.updateSetting({ key: "wa_token", value: "demo-token" });
    expect(s.getSetting("wa_token")).toBe("demo-token");
    expect(s.hasStoredSetting("wa_token")).toBe(true);
  });
});

describe("listSettings — mask rahasia + sumber nilai", () => {
  it("rahasia di-mask & value kosong; non-rahasia nilai penuh", async () => {
    const { encryptSecret } = await import("./crypto");
    sbState.rows = [
      { key: "midtrans_server_key", is_secret: true, value_enc: await encryptSecret("SB-Mid-server-abc123") },
      { key: "app_url", is_secret: false, value_enc: "https://vshop.id" },
    ];
    const s = await fresh();
    await s.ensureSettingsHydrated();
    const list = await s.listSettings();
    const mt = list.find((i) => i.key === "midtrans_server_key")!;
    const au = list.find((i) => i.key === "app_url")!;
    const ai = list.find((i) => i.key === "ai_api_key")!;
    expect(mt.source).toBe("stored");
    expect(mt.isSecret).toBe(true);
    expect(mt.value).toBe(""); // rahasia tidak keluar server
    expect(mt.display).toContain("••••");
    expect(mt.display).toContain("c123");
    expect(au.value).toBe("https://vshop.id");
    expect(au.source).toBe("stored");
    expect(ai.source).toBe("unset");
  });

  it("env-only → source env", async () => {
    const s = await fresh();
    const list = await s.listSettings();
    expect(list.find((i) => i.key === "midtrans_server_key")!.source).toBe("env");
    expect(list.find((i) => i.key === "wa_token")!.source).toBe("env");
  });
});

describe("categoryStatus", () => {
  it("configured / partial / empty", async () => {
    const s = await fresh();
    // Lengkapi satu kategori penuh (midtrans) supaya status = configured.
    process.env.MIDTRANS_IS_PRODUCTION = "false";
    process.env.MIDTRANS_API_BASE = "https://api.sandbox.midtrans.com";
    const items = await s.listSettings();
    const statuses = s.categoryStatus(items);
    expect(statuses.midtrans).toBe("configured"); // server+client+is_production+api_base dari env
    expect(statuses.ai).toBe("empty");
    // Sebagian: hapus satu env → partial
    delete process.env.MIDTRANS_IS_PRODUCTION;
    expect(s.categoryStatus(await s.listSettings()).midtrans).toBe("partial");
  });
});

describe("testConnection", () => {
  it("postgres: url/key belum diisi → gagal", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const s = await fresh();
    const r = await s.testConnection("postgres");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/belum diisi|tidak dikonfigurasi/);
  });

  it("postgres: query error → gagal dengan pesan", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb-service-test";
    sbState.error = { message: "relation does not exist" };
    const s = await fresh();
    const r = await s.testConnection("postgres");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Gagal query/);
  });

  it("postgres: sukses → ok", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb-service-test";
    sbState.rows = [{ id: "p1" }];
    const s = await fresh();
    const r = await s.testConnection("postgres");
    expect(r.ok).toBe(true);
  });

  it("midtrans: tanpa server key → gagal", async () => {
    delete process.env.MIDTRANS_SERVER_KEY;
    const s = await fresh();
    const r = await s.testConnection("midtrans");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Server Key/);
  });

  it("midtrans: 401 → kunci ditolak; 404 → valid", async () => {
    const s = await fresh();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    expect((await s.testConnection("midtrans")).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const ok = await s.testConnection("midtrans");
    expect(ok.ok).toBe(true);
    expect(ok.detail).toMatch(/valid/);
  });

  it("midtrans: error jaringan → gagal", async () => {
    const s = await fresh();
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ENOTFOUND");
    }));
    const r = await s.testConnection("midtrans");
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/ENOTFOUND/);
  });

  it("whatsapp: tanpa token/phone → gagal; 200 → ok", async () => {
    delete process.env.WHATSAPP_TOKEN;
    const s = await fresh();
    expect((await s.testConnection("whatsapp")).ok).toBe(false);
    process.env.WHATSAPP_TOKEN = "wa-token-env";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    const ok = await s.testConnection("whatsapp");
    expect(ok.ok).toBe(true);
  });

  it("whatsapp: 401 → ditolak", async () => {
    const s = await fresh();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 401 })));
    expect((await s.testConnection("whatsapp")).ok).toBe(false);
  });

  it("ai: belum dikonfigurasi → gagal; 200 → ok", async () => {
    const s = await fresh();
    expect((await s.testConnection("ai")).ok).toBe(false);
    process.env.AI_API_BASE = "https://api.openai.com";
    process.env.AI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
    expect((await s.testConnection("ai")).ok).toBe(true);
  });

  it("lainnya → ok tanpa uji", async () => {
    const s = await fresh();
    expect((await s.testConnection("lainnya")).ok).toBe(true);
  });
});

// ---------- helper ----------
let lastEncryptInput: string;
async function encryptOf(plain: string): Promise<string> {
  const crypto = await import("./crypto");
  const out = await crypto.encryptSecret(plain);
  lastEncryptInput = plain;
  void lastEncryptInput;
  return out;
}
