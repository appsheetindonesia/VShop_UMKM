/**
 * Unit test konstanta & opsi cookie sesi (src/lib/session-cookies.ts) —
 * modul murni yang dipakai auth.ts & middleware Edge.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GUEST_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_MAX_AGE,
  SESSION_COOKIE,
  SESSION_COOKIE_MAX_AGE,
  SESSION_TTL_MS,
  sessionCookieOptions,
} from "./session-cookies";

const saveNodeEnv = process.env.NODE_ENV;
const env = process.env as Record<string, string | undefined>;

afterEach(() => {
  env.NODE_ENV = saveNodeEnv;
  vi.restoreAllMocks();
});

describe("konstanta cookie", () => {
  it("nama cookie & masa berlaku", () => {
    expect(SESSION_COOKIE).toBe("vshop_session");
    expect(REFRESH_COOKIE).toBe("vshop_sb_refresh");
    expect(GUEST_COOKIE).toBe("vshop_guest");
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600_000);
    expect(SESSION_COOKIE_MAX_AGE).toBe(Math.floor(SESSION_TTL_MS / 1000));
    expect(REFRESH_COOKIE_MAX_AGE).toBe(Math.floor((365 * 24 * 3600_000) / 1000));
  });
});

describe("sessionCookieOptions", () => {
  it("httpOnly + lax + path / + maxAge; secure=false di luar produksi", () => {
    env.NODE_ENV = "development";
    expect(sessionCookieOptions(3600)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3600,
    });
  });
  it("secure=true saat NODE_ENV=production", () => {
    env.NODE_ENV = "production";
    expect(sessionCookieOptions(3600).secure).toBe(true);
  });
});
