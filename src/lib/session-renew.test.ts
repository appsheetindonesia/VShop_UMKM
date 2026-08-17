/**
 * Unit test renewal sesi server-side (src/lib/session-renew.ts):
 * getStoredRefreshTokenFromDb (fallback lintas perangkat) dan
 * renewSessionForCookies (refreshSession Supabase → sesi baru + cookie).
 * Supabase server & crypto di-mock; tidak ada jaringan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStoredRefreshTokenFromDb,
  renewSessionForCookies,
  type RenewalOutcome,
} from "./session-renew";

const sbMock = vi.hoisted(() => ({
  adminFrom: vi.fn(),
  refreshSession: vi.fn(),
  adminAvailable: true,
}));

vi.mock("./supabase/server", () => ({
  getSupabaseAdmin: () =>
    sbMock.adminAvailable
      ? { from: sbMock.adminFrom }
      : null,
  getSupabaseAnon: () => ({
    auth: { refreshSession: sbMock.refreshSession },
  }),
}));

const cryptoMock = vi.hoisted(() => ({
  configured: false,
  isEncryptionConfigured: vi.fn(() => cryptoMock.configured),
  encryptSecret: vi.fn(async (s: string) => `enc:${s}`),
  decryptSecret: vi.fn(async (s: string) => s.replace(/^enc:/, "")),
}));

vi.mock("./crypto", () => ({
  isEncryptionConfigured: cryptoMock.isEncryptionConfigured,
  encryptSecret: cryptoMock.encryptSecret,
  decryptSecret: cryptoMock.decryptSecret,
}));

let sessionRow: { sb_refresh_enc?: string } | null = null;
let upsertCalls: Array<{ payload: Record<string, unknown>; opts?: unknown }> = [];

beforeEach(() => {
  sessionRow = null;
  upsertCalls = [];
  sbMock.adminAvailable = true;
  cryptoMock.configured = false;
  cryptoMock.encryptSecret.mockClear();
  cryptoMock.decryptSecret.mockClear();
  sbMock.adminFrom.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: sessionRow }) }) }),
    upsert: async (payload: Record<string, unknown>, opts?: unknown) => {
      upsertCalls.push({ payload, opts });
      return { error: null };
    },
  }));
  sbMock.refreshSession.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getStoredRefreshTokenFromDb", () => {
  it("null tanpa Supabase admin (getSupabaseAdmin null)", async () => {
    sbMock.adminAvailable = false;
    expect(await getStoredRefreshTokenFromDb("tok")).toBeNull();
    sbMock.adminAvailable = true;
  });
  it("null bila baris tanpa sb_refresh_enc", async () => {
    sessionRow = null;
    expect(await getStoredRefreshTokenFromDb("tok")).toBeNull();
    sessionRow = {};
    expect(await getStoredRefreshTokenFromDb("tok")).toBeNull();
  });
});

describe("renewSessionForCookies", () => {
  it("tanpa refresh token (cookie & tersimpan) → { ok:false }", async () => {
    const out = await renewSessionForCookies({});
    expect(out).toEqual({ ok: false });
    expect(sbMock.refreshSession).not.toHaveBeenCalled();
  });

  it("refresh dari cookie; error Supabase → { ok:false, clearRefresh:true }", async () => {
    sbMock.refreshSession.mockResolvedValueOnce({ data: null, error: { message: "invalid" } });
    const out = await renewSessionForCookies({ refreshCookie: "rt-cookie" });
    expect(out).toEqual({ ok: false, clearRefresh: true });
  });

  it("error tanpa cookie refresh → clearRefresh tidak diset", async () => {
    sessionRow = { sb_refresh_enc: "enc:rt-stored" };
    sbMock.refreshSession.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    const out = await renewSessionForCookies({ sessionToken: "tok" });
    // Boolean(input.refreshCookie) = false saat tidak ada cookie refresh.
    expect(out).toEqual({ ok: false, clearRefresh: false });
  });

  it("sukses: sesi baru + refresh ter-rotasi + upsert baris sesi", async () => {
    sbMock.refreshSession.mockResolvedValueOnce({
      data: {
        user: { id: "auth-1" },
        session: { refresh_token: "rt-baru" },
      },
      error: null,
    });
    const out = await renewSessionForCookies({ refreshCookie: "rt-lama" });
    expect(out.ok).toBe(true);
    expect(out.setSession?.value).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.setRefresh?.value).toBe("rt-baru");
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].payload).toMatchObject({
      user_id: "auth-1",
      sb_user_id: "auth-1",
      sb_refresh_enc: null, // tanpa SESSION_ENCRYPTION_KEY → cookie-only
    });
    expect(upsertCalls[0].opts).toEqual({ onConflict: "token" });
  });

  it("sukses dengan enkripsi refresh token", async () => {
    cryptoMock.configured = true;
    sbMock.refreshSession.mockResolvedValueOnce({
      data: { user: { id: "auth-1" }, session: null }, // session null → pakai token lama
      error: null,
    });
    const out = await renewSessionForCookies({ refreshCookie: "rt-lama" });
    expect(out.ok).toBe(true);
    expect(out.setRefresh?.value).toBe("rt-lama"); // tidak dirotasi
    expect(cryptoMock.encryptSecret).toHaveBeenCalledWith("rt-lama");
    expect(upsertCalls[0].payload.sb_refresh_enc).toBe("enc:rt-lama");
  });

  it("tidak pernah melempar — error internal → { ok:false }", async () => {
    sbMock.adminFrom.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    sbMock.refreshSession.mockResolvedValueOnce({
      data: { user: { id: "auth-1" }, session: { refresh_token: "rt-baru" } },
      error: null,
    });
    const out: RenewalOutcome = await renewSessionForCookies({ refreshCookie: "rt-1" });
    expect(out).toEqual({ ok: false });
  });
});
