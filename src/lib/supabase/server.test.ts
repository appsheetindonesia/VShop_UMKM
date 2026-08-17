/**
 * Unit test factory client Supabase (src/lib/supabase/server.ts):
 * isSupabaseConfigured + getSupabaseAdmin/getSupabaseAnon dengan
 * @supabase/supabase-js di-mock (perilaku env & opsi persistSession).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseAdmin, getSupabaseAnon, isSupabaseConfigured } from "./server";

const sbMock = vi.hoisted(() => ({
  createClient: vi.fn((url: string, key: string, opts?: unknown) => ({
    __url: url,
    __key: key,
    __opts: opts,
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: sbMock.createClient,
}));

const saveEnv: Record<string, string | undefined> = {};
function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  setEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://db.test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "svc-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  });
  sbMock.createClient.mockClear();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saveEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

describe("isSupabaseConfigured", () => {
  it("true hanya bila URL + service role key terisi", () => {
    expect(isSupabaseConfigured()).toBe(true);
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined });
    expect(isSupabaseConfigured()).toBe(false);
    setEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(isSupabaseConfigured()).toBe(false);
  });
});

describe("getSupabaseAdmin", () => {
  it("membuat client service-role dengan NO_PERSIST + fetch no-store (anti fetch cache Next)", () => {
    const c = getSupabaseAdmin();
    expect(c).not.toBeNull();
    const opts = sbMock.createClient.mock.calls[0][2] as { auth: unknown; global?: { fetch?: unknown } };
    expect(opts.auth).toEqual({ persistSession: false, autoRefreshToken: false });
    // global.fetch memakai cache:"no-store" agar data Supabase tidak pernah
    // basi dari cache fetch Next.js (lihat header server.ts).
    expect(typeof opts.global?.fetch).toBe("function");
    expect(c).toMatchObject({ __url: "https://db.test.supabase.co", __key: "svc-key" });
  });
  it("null tanpa service role key", () => {
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined });
    expect(getSupabaseAdmin()).toBeNull();
    expect(sbMock.createClient).not.toHaveBeenCalled();
  });
});

describe("getSupabaseAnon", () => {
  it("membuat client anon", () => {
    const c = getSupabaseAnon();
    expect(c).not.toBeNull();
    expect(sbMock.createClient).toHaveBeenCalledWith(
      "https://db.test.supabase.co",
      "anon-key",
      expect.anything()
    );
  });
  it("null tanpa anon key", () => {
    setEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined });
    expect(getSupabaseAnon()).toBeNull();
  });
});
