/**
 * Unit test OTP (src/lib/otp.ts): mode demo (store globalThis, kode 6 digit)
 * dan jalur Supabase (sendOtpSupabase/verifyOtpSupabase di-mock).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendOtp, verifyOtp } from "./otp";

const authMock = vi.hoisted(() => ({
  enabled: false,
  sendOtpSupabase: vi.fn(async () => {}),
  verifyOtpSupabase: vi.fn(
    async (): Promise<{ authId: string; refreshToken?: string } | null> => ({
      authId: "auth-1",
      refreshToken: "rt-1",
    })
  ),
  isSupabaseAuthEnabled: vi.fn(() => authMock.enabled),
}));

vi.mock("./supabase-auth", () => ({
  isSupabaseAuthEnabled: authMock.isSupabaseAuthEnabled,
  sendOtpSupabase: authMock.sendOtpSupabase,
  verifyOtpSupabase: authMock.verifyOtpSupabase,
}));

function otpStore(): Map<string, { code: string; expiresAt: number }> {
  const g = globalThis as unknown as { __vshopOtpStore?: Map<string, { code: string; expiresAt: number }> };
  return (g.__vshopOtpStore ??= new Map());
}

beforeEach(() => {
  otpStore().clear();
  authMock.enabled = false;
  authMock.sendOtpSupabase.mockClear();
  authMock.verifyOtpSupabase.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  otpStore().clear();
});

describe("mode demo", () => {
  it("sendOtp membuat kode 6 digit dan menyimpannya (dinormalisasi)", async () => {
    const { demoCode } = await sendOtp("0812-3456-7890");
    expect(demoCode).toMatch(/^\d{6}$/);
    const entry = otpStore().get("081234567890");
    expect(entry?.code).toBe(demoCode);
    expect(entry?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("verifyOtp sukses dan sekali pakai", async () => {
    const { demoCode } = await sendOtp("081234567890");
    expect(await verifyOtp("081234567890", demoCode!)).toEqual({ ok: true });
    // Kedua kalinya — sudah terhapus → minta kirim ulang.
    expect(await verifyOtp("081234567890", demoCode!)).toEqual({
      ok: false,
      message: "Kirim kode OTP terlebih dahulu",
    });
  });

  it("kode salah", async () => {
    await sendOtp("081234567890");
    expect(await verifyOtp("081234567890", "000000")).toEqual({
      ok: false,
      message: "Kode OTP salah. Periksa kembali.",
    });
  });

  it("kode kedaluwarsa → ditolak & dihapus", async () => {
    await sendOtp("081234567890");
    const entry = otpStore().get("081234567890")!;
    entry.expiresAt = Date.now() - 1;
    expect(await verifyOtp("081234567890", entry.code)).toEqual({
      ok: false,
      message: "Kode OTP kedaluwarsa. Kirim ulang.",
    });
    expect(otpStore().has("081234567890")).toBe(false);
  });
});

describe("mode Supabase", () => {
  it("sendOtp memanggil sendOtpSupabase tanpa demoCode", async () => {
    authMock.enabled = true;
    const res = await sendOtp("+6281234567890");
    expect(res).toEqual({});
    expect(authMock.sendOtpSupabase).toHaveBeenCalledWith("+6281234567890");
  });

  it("verifyOtp meneruskan hasil Supabase", async () => {
    authMock.enabled = true;
    const res = await verifyOtp("081234567890", "123456");
    expect(res).toEqual({ ok: true, supabaseUserId: "auth-1", refreshToken: "rt-1" });
    expect(authMock.verifyOtpSupabase).toHaveBeenCalledWith("081234567890", "123456");
  });

  it("verifyOtp gagal saat Supabase mengembalikan null", async () => {
    authMock.enabled = true;
    authMock.verifyOtpSupabase.mockResolvedValueOnce(null);
    const res = await verifyOtp("081234567890", "000000");
    expect(res).toEqual({ ok: false, message: "Kode OTP salah atau kedaluwarsa" });
  });
});
