/**
 * Unit test penyimpanan refresh token Supabase TERENKRIPSI di baris sesi
 * (migration 0002). Tanpa Supabase/Docker — kriptografi murni node:crypto
 * + store demo lokal.
 *
 * Cakupan:
 * 1. Round-trip encrypt → decrypt (AES-256-GCM).
 * 2. Anti-tamper: ciphertext diubah → null (autentikasi GCM gagal).
 * 3. Kunci salah → null.
 * 4. Tanpa SESSION_ENCRYPTION_KEY → encryptSecret melempar.
 * 5. createSession dengan `sb` → token tersimpan terenkripsi di baris sesi
 *    (bukan plaintext) dan `getStoredSbRefreshToken` mengembalikannya.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "./crypto";
import { createSession, destroySession, getStoredSbRefreshToken } from "./auth";
import { getDB } from "./db";

const KEY_32B = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").toString("base64");
const PREV_KEY = process.env.SESSION_ENCRYPTION_KEY;

beforeAll(() => {
  process.env.SESSION_ENCRYPTION_KEY = KEY_32B;
});

afterAll(() => {
  if (PREV_KEY === undefined) delete process.env.SESSION_ENCRYPTION_KEY;
  else process.env.SESSION_ENCRYPTION_KEY = PREV_KEY;
});

describe("crypto (AES-256-GCM, Web Crypto)", () => {
  it("round-trip encrypt → decrypt mengembalikan plaintext", async () => {
    expect(isEncryptionConfigured()).toBe(true);
    const enc = await encryptSecret("sb-refresh-token-abc123");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("sb-refresh-token-abc123");
    expect(await decryptSecret(enc)).toBe("sb-refresh-token-abc123");
  });

  it("ciphertext yang diubah → null (anti-tamper)", async () => {
    const enc = await encryptSecret("rahasia");
    const tampered = enc.slice(0, -4) + (enc.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await decryptSecret(tampered)).toBeNull();
  });

  it("kunci berbeda → null (GCM auth gagal)", async () => {
    const enc = await encryptSecret("rahasia");
    process.env.SESSION_ENCRYPTION_KEY = Buffer.from("fedcba9876543210fedcba9876543210", "utf8").toString("base64");
    try {
      expect(await decryptSecret(enc)).toBeNull();
    } finally {
      process.env.SESSION_ENCRYPTION_KEY = KEY_32B;
    }
  });

  it("tanpa kunci: isEncryptionConfigured false & encryptSecret melempar", async () => {
    const prev = process.env.SESSION_ENCRYPTION_KEY;
    delete process.env.SESSION_ENCRYPTION_KEY;
    try {
      expect(isEncryptionConfigured()).toBe(false);
      await expect(encryptSecret("x")).rejects.toThrow();
      // Payload lama tidak bisa didekripsi tanpa kunci.
      expect(await decryptSecret("v1:a:b:c")).toBeNull();
    } finally {
      process.env.SESSION_ENCRYPTION_KEY = prev;
    }
  });
});

describe("createSession menyimpan refresh token terenkripsi", () => {
  const tokens: string[] = [];

  afterAll(() => {
    for (const t of tokens) destroySession(t);
  });

  it("menyimpan sb_refresh_enc (bukan plaintext) dan bisa dibaca ulang", async () => {
    const token = await createSession("usr_crypto_test", {
      refreshToken: "sb-refresh-rotation-01",
      authUserId: "auth-uuid-0001",
    });
    tokens.push(token);

    const row = getDB().sessions.find((s) => s.token === token);
    expect(row).toBeDefined();
    expect(row!.sbUserId).toBe("auth-uuid-0001");
    expect(row!.sbRefreshEnc).toBeDefined();
    expect(row!.sbRefreshEnc).not.toContain("sb-refresh-rotation-01"); // terenkripsi
    expect(await getStoredSbRefreshToken(token)).toBe("sb-refresh-rotation-01"); // dapat didekripsi
  });

  it("tanpa `sb` → tidak ada kolom refresh tersimpan", async () => {
    const token = await createSession("usr_crypto_test");
    tokens.push(token);
    const row = getDB().sessions.find((s) => s.token === token);
    expect(row!.sbRefreshEnc).toBeUndefined();
    expect(await getStoredSbRefreshToken(token)).toBeNull();
  });
});
