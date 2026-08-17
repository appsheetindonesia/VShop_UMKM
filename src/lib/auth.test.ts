/**
 * Unit test sesi & auth (src/lib/auth.ts): createSession (termasuk
 * penyimpanan refresh token terenkripsi), getSessionUser + rolling renewal,
 * destroySession, guard role (requireRole/redirectIfLoggedIn), guest.
 *
 * next/headers (cookies) & next/navigation (redirect) di-mock; db memakai
 * state in-memory; crypto di-stub.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canBrowseShop,
  createSession,
  currentUserOrNull,
  destroySession,
  getSessionUser,
  getStoredSbRefreshToken,
  isGuest,
  makeGuestId,
  newUserId,
  redirectIfLoggedIn,
  requireRole,
} from "./auth";
import { SESSION_COOKIE } from "./session-cookies";

const mocks = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  db: { users: [] as any[], sessions: [] as any[] } as any,
  encrypt: vi.fn(async (s: string) => `enc:${s}`),
  decrypt: vi.fn(async (s: string) => s.replace(/^enc:/, "")),
  redirect: vi.fn((_to: string) => {
    throw new Error("__REDIRECT__");
  }),
  isoNow: () => "2026-08-16T00:00:00.000Z",
  newId: (prefix: string) => `${prefix}_t1`,
}));

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = mocks.cookieStore.get(name);
      return v === undefined ? undefined : { name, value: v };
    },
    set: (name: string, value: string) => {
      mocks.cookieStore.set(name, value);
    },
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("./db", () => ({
  getDB: () => mocks.db,
  mutate: (fn: (d: any) => void) => fn(mocks.db),
  isoNow: mocks.isoNow,
  newId: mocks.newId,
}));
vi.mock("./crypto", () => ({
  encryptSecret: mocks.encrypt,
  decryptSecret: mocks.decrypt,
}));

function user(over: Partial<any> = {}): any {
  return {
    id: "u1",
    name: "Siti Aminah",
    phone: "081234567890",
    passwordHash: "x",
    role: "customer",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

function session(token: string, over: Partial<any> = {}) {
  return {
    token,
    userId: "u1",
    createdAt: "2026-08-16T00:00:00.000Z",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600_000).toISOString(),
    ...over,
  };
}

const days = (n: number) => n * 24 * 3600_000;

beforeEach(() => {
  mocks.cookieStore.clear();
  mocks.db.users = [user()];
  mocks.db.sessions = [];
  mocks.redirect.mockClear();
  mocks.encrypt.mockClear();
  mocks.decrypt.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSession", () => {
  it("membuat token baru + baris sesi (30 hari, refresh terenkripsi)", async () => {
    const token = await createSession("u1", { refreshToken: "rt-abc", authUserId: "auth-1" });
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    expect(mocks.encrypt).toHaveBeenCalledWith("rt-abc");
    const s = mocks.db.sessions.find((x: any) => x.token === token);
    expect(s.userId).toBe("u1");
    expect(s.sbRefreshEnc).toBe("enc:rt-abc");
    expect(s.sbUserId).toBe("auth-1");
  });

  it("tanpa sb → tidak menyimpan refresh token", async () => {
    const token = await createSession("u1");
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.db.sessions.find((x: any) => x.token === token).sbRefreshEnc).toBeUndefined();
  });

  it("gagal enkripsi → cookie-only (peringatan, sesi tetap dibuat)", async () => {
    mocks.encrypt.mockRejectedValueOnce(new Error("no key"));
    const token = await createSession("u1", { refreshToken: "rt-1" });
    const s = mocks.db.sessions.find((x: any) => x.token === token);
    expect(s.sbRefreshEnc).toBeUndefined();
    expect(s.token).toBe(token);
  });

  it("membersihkan sesi kedaluwarsa saat membuat sesi baru", async () => {
    mocks.db.sessions.push(session("old", { expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await createSession("u1");
    expect(mocks.db.sessions.some((x: any) => x.token === "old")).toBe(false);
  });
});

describe("getStoredSbRefreshToken", () => {
  it("mendekripsi refresh token dari baris sesi", async () => {
    mocks.db.sessions.push(session("tok", { sbRefreshEnc: "enc:rt-xyz" }));
    expect(await getStoredSbRefreshToken("tok")).toBe("rt-xyz");
    expect(mocks.decrypt).toHaveBeenCalledWith("enc:rt-xyz");
  });
  it("null bila sesi tidak ada / tanpa sbRefreshEnc", async () => {
    expect(await getStoredSbRefreshToken("nope")).toBeNull();
    mocks.db.sessions.push(session("tok2"));
    expect(await getStoredSbRefreshToken("tok2")).toBeNull();
  });
});

describe("destroySession", () => {
  it("menghapus baris sesi", async () => {
    mocks.db.sessions.push(session("tok"));
    destroySession("tok");
    expect(mocks.db.sessions).toHaveLength(0);
  });
});

describe("getSessionUser", () => {
  it("null tanpa cookie sesi", () => {
    expect(getSessionUser()).toBeNull();
  });
  it("null bila sesi kedaluwarsa", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok-exp");
    mocks.db.sessions.push(session("tok-exp", { expiresAt: new Date(Date.now() - 1).toISOString() }));
    expect(getSessionUser()).toBeNull();
  });
  it("mengembalikan user untuk sesi valid", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok-ok");
    mocks.db.sessions.push(session("tok-ok"));
    const u = getSessionUser();
    expect(u?.id).toBe("u1");
    expect(u?.name).toBe("Siti Aminah");
  });
  it("rolling renewal: sisa < 15 hari → expiresAt diperpanjang", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok-renew");
    mocks.db.sessions.push(
      session("tok-renew", { expiresAt: new Date(Date.now() + days(14)).toISOString() })
    );
    const before = mocks.db.sessions[0].expiresAt;
    getSessionUser();
    expect(new Date(mocks.db.sessions[0].expiresAt).getTime()).toBeGreaterThan(
      new Date(before).getTime()
    );
  });
});

describe("isGuest & canBrowseShop", () => {
  it("isGuest membaca cookie guest", () => {
    expect(isGuest()).toBe(false);
    mocks.cookieStore.set("vshop_guest", "1");
    expect(isGuest()).toBe(true);
  });
  it("canBrowseShop: user atau guest", () => {
    expect(canBrowseShop(user(), false)).toBe(true);
    expect(canBrowseShop(null, true)).toBe(true);
    expect(canBrowseShop(null, false)).toBe(false);
  });
});

describe("requireRole", () => {
  it("belum login → redirect ke /masuk", () => {
    expect(() => requireRole(["customer"])).toThrow("__REDIRECT__");
    expect(mocks.redirect).toHaveBeenCalledWith("/masuk?redirect=%2F");
  });
  it("role tidak berhak → redirect ke halaman role", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    mocks.db.users = [user({ role: "merchant" })];
    expect(() => requireRole(["customer"])).toThrow("__REDIRECT__");
    expect(mocks.redirect).toHaveBeenCalledWith("/merchant/dashboard");
  });
  it("admin → redirect ke /admin", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    mocks.db.users = [user({ role: "admin" })];
    expect(() => requireRole(["customer"])).toThrow("__REDIRECT__");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
  });
  it("role tidak berhak (customer, bukan admin/merchant) → redirect ke /beranda", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    mocks.db.users = [user({ role: "customer" })];
    expect(() => requireRole(["merchant"])).toThrow("__REDIRECT__");
    expect(mocks.redirect).toHaveBeenCalledWith("/beranda");
  });
  it("berhak → mengembalikan user tanpa redirect", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    const u = requireRole(["customer"]);
    expect(u.id).toBe("u1");
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("redirectIfLoggedIn & currentUserOrNull", () => {
  it("belum login → no-op", () => {
    redirectIfLoggedIn();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("login sebagai admin → redirect /admin", () => {
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    mocks.db.users = [user({ role: "admin" })];
    expect(() => redirectIfLoggedIn()).toThrow("__REDIRECT__");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
  });
  it("currentUserOrNull meneruskan getSessionUser", () => {
    expect(currentUserOrNull()).toBeNull();
    mocks.cookieStore.set(SESSION_COOKIE, "tok");
    mocks.db.sessions.push(session("tok"));
    expect(currentUserOrNull()?.id).toBe("u1");
  });
});

describe("makeGuestId & newUserId", () => {
  it("format id tamu & user", () => {
    expect(makeGuestId()).toMatch(/^guest_[0-9a-f]{10}$/);
    expect(newUserId()).toBe("usr_t1");
  });
});
