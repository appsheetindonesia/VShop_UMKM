/**
 * Unit test adapter Auth Supabase (src/lib/supabase-auth.ts): daftar
 * pelanggan via nomor WhatsApp (E.164) & merchant via email, login phone/
 * email, OTP, sinkronisasi profil, reset password. Supabase client & db
 * di-mock (tanpa jaringan).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSupabaseAuthEnabled,
  phoneToE164,
  resetPasswordSupabase,
  sendOtpSupabase,
  signInSupabase,
  signUpCustomerSupabase,
  signUpMerchantSupabase,
  syncUserFromSupabase,
  verifyOtpSupabase,
} from "./supabase-auth";
import type { RegisterCustomerInput, RegisterMerchantInput } from "./service";

// ---------- Mocks ----------

const sbMock = vi.hoisted(() => ({
  available: true,
  fromRow: null as unknown,
  fromError: null as unknown,
  from: vi.fn(),
  createUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("./supabase/server", () => ({
  getSupabaseAdmin: () =>
    sbMock.available
      ? {
          from: sbMock.from,
          auth: {
            admin: { createUser: sbMock.createUser },
            signInWithPassword: sbMock.signInWithPassword,
            signInWithOtp: sbMock.signInWithOtp,
            verifyOtp: sbMock.verifyOtp,
            resetPasswordForEmail: sbMock.resetPasswordForEmail,
          },
        }
      : null,
}));

const dbMock = vi.hoisted(() => ({
  mode: "supabase" as string,
  users: [] as Array<{ id: string; name: string; phone?: string; email?: string }>,
  upsertUser: vi.fn((u: unknown) => {
    const user = u as { id: string; name: string; phone?: string; email?: string };
    const idx = dbMock.users.findIndex((x) => x.id === user.id);
    if (idx >= 0) dbMock.users[idx] = user;
    else dbMock.users.push(user);
  }),
  upsertMerchant: vi.fn(),
  isoNow: () => "2026-08-16T00:00:00.000Z",
  newId: (prefix: string) => `${prefix}_n1`,
  getDB: () => ({ users: dbMock.users }),
  getStoreMode: () => dbMock.mode,
}));

vi.mock("./db", () => ({
  getDB: dbMock.getDB,
  getStoreMode: dbMock.getStoreMode,
  isoNow: dbMock.isoNow,
  newId: dbMock.newId,
  upsertUser: dbMock.upsertUser,
  upsertMerchant: dbMock.upsertMerchant,
}));

// ---------- Helper ----------

function stubFromRow(row: unknown) {
  sbMock.fromRow = row;
  sbMock.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: sbMock.fromRow, error: sbMock.fromError }),
      }),
    }),
  }));
}

const customerInput: RegisterCustomerInput = {
  name: "Siti Aminah",
  phone: "081234567890",
  password: "rahasia123",
};

const merchantInput: RegisterMerchantInput = {
  namaUsaha: "Kopi Nusantara",
  kategoriUsaha: "F&B",
  noWAUsaha: "0812987654321",
  alamatUsaha: "Jl. Melati No. 1",
  namaPemilik: "Budi Santoso",
  noWAPemilik: "0812987654321",
  email: "budi@kopi.id",
  password: "rahasia123",
};

beforeEach(() => {
  sbMock.available = true;
  sbMock.fromRow = null;
  sbMock.fromError = null;
  dbMock.mode = "supabase";
  dbMock.users.length = 0;
  dbMock.upsertUser.mockClear();
  dbMock.upsertMerchant.mockClear();
  sbMock.from.mockClear();
  sbMock.createUser.mockReset();
  sbMock.signInWithPassword.mockReset();
  sbMock.signInWithOtp.mockReset();
  sbMock.verifyOtp.mockReset();
  sbMock.resetPasswordForEmail.mockReset();
  sbMock.createUser.mockResolvedValue({
    data: { user: { id: "auth-1" } },
    error: null,
  });
  sbMock.signInWithPassword.mockResolvedValue({
    data: { user: { id: "auth-1" }, session: { refresh_token: "rt-1" } },
    error: null,
  });
  sbMock.signInWithOtp.mockResolvedValue({ data: null, error: null });
  sbMock.verifyOtp.mockResolvedValue({
    data: { user: { id: "auth-1" }, session: { refresh_token: "rt-1" } },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("phoneToE164", () => {
  it("08xx → +628xx; +62 & 62 dipertahankan; 8xx ditambah 62", () => {
    expect(phoneToE164("081234567890")).toBe("+6281234567890");
    expect(phoneToE164("+6281234567890")).toBe("+6281234567890");
    expect(phoneToE164("6281234567890")).toBe("+6281234567890");
    expect(phoneToE164("81234567890")).toBe("+6281234567890");
    expect(phoneToE164("0812-3456-7890")).toBe("+6281234567890");
  });
});

describe("isSupabaseAuthEnabled", () => {
  it("mengikuti store mode", () => {
    expect(isSupabaseAuthEnabled()).toBe(true);
    dbMock.mode = "json";
    expect(isSupabaseAuthEnabled()).toBe(false);
  });
});

describe("signUpCustomerSupabase (daftar via nomor WhatsApp)", () => {
  it("membuat user Auth dengan phone E.164 + profil + auto-login refresh token", async () => {
    stubFromRow(null); // tidak ada duplikat
    const res = await signUpCustomerSupabase(customerInput);
    expect(res.user).toMatchObject({ id: "auth-1", name: "Siti Aminah", phone: "081234567890", role: "customer" });
    expect(res.refreshToken).toBe("rt-1");
    expect(sbMock.createUser).toHaveBeenCalledWith({
      phone: "+6281234567890",
      password: "rahasia123",
      phone_confirm: true,
      user_metadata: { name: "Siti Aminah" },
    });
    expect(sbMock.signInWithPassword).toHaveBeenCalledWith({
      phone: "+6281234567890",
      password: "rahasia123",
    });
    expect(dbMock.upsertUser).toHaveBeenCalled();
  });

  it("nomor sudah terdaftar (baris profil) → throw", async () => {
    stubFromRow({ id: "auth-x" });
    await expect(signUpCustomerSupabase(customerInput)).rejects.toThrow(
      "Nomor WhatsApp sudah terdaftar"
    );
    expect(sbMock.createUser).not.toHaveBeenCalled();
  });

  it("error createUser (sudah terdaftar) → pesan terpetakan", async () => {
    stubFromRow(null);
    sbMock.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "Phone already registered" },
    });
    await expect(signUpCustomerSupabase(customerInput)).rejects.toThrow(
      "Nomor WhatsApp sudah terdaftar"
    );
  });

  it("tanpa Supabase admin → throw", async () => {
    sbMock.available = false;
    await expect(signUpCustomerSupabase(customerInput)).rejects.toThrow(
      "Supabase tidak dikonfigurasi"
    );
  });
});

describe("signUpMerchantSupabase (daftar merchant via email)", () => {
  it("membuat user + merchant + refresh token", async () => {
    stubFromRow(null);
    const res = await signUpMerchantSupabase(merchantInput);
    expect(res.user.role).toBe("merchant");
    expect(res.user.email).toBe("budi@kopi.id");
    expect(res.merchant).toMatchObject({ namaUsaha: "Kopi Nusantara", status: "pending", userId: "auth-1" });
    expect(res.refreshToken).toBe("rt-1");
    expect(sbMock.createUser).toHaveBeenCalledWith({
      email: "budi@kopi.id",
      password: "rahasia123",
      email_confirm: true,
      user_metadata: { name: "Budi Santoso" },
    });
    expect(dbMock.upsertMerchant).toHaveBeenCalled();
  });

  it("email duplikat → throw", async () => {
    stubFromRow({ id: "auth-x" });
    await expect(signUpMerchantSupabase(merchantInput)).rejects.toThrow(
      "Email sudah terdaftar"
    );
  });

  it("email di-normalisasi lowercase", async () => {
    stubFromRow(null);
    await signUpMerchantSupabase({ ...merchantInput, email: "Budi@Kopi.ID " });
    expect(sbMock.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "budi@kopi.id" })
    );
  });

  it("error createUser 'email already been registered' → pesan terpetakan", async () => {
    stubFromRow(null);
    sbMock.createUser.mockResolvedValueOnce({
      data: null,
      error: { message: "Email already been registered" },
    });
    await expect(signUpMerchantSupabase(merchantInput)).rejects.toThrow(
      "Email sudah terdaftar"
    );
  });
});

describe("sendOtpSupabase & verifyOtpSupabase", () => {
  it("sendOtp memakai phone E.164 + metadata nama", async () => {
    await sendOtpSupabase("081234567890", "Siti");
    expect(sbMock.signInWithOtp).toHaveBeenCalledWith({
      phone: "+6281234567890",
      options: { data: { name: "Siti" } },
    });
  });
  it("sendOtp tanpa nama → tanpa options.data", async () => {
    await sendOtpSupabase("081234567890");
    expect(sbMock.signInWithOtp).toHaveBeenCalledWith({
      phone: "+6281234567890",
      options: undefined,
    });
  });
  it("sendOtp error → throw; tanpa admin → throw", async () => {
    sbMock.signInWithOtp.mockResolvedValueOnce({ data: null, error: { message: "sms quota" } });
    await expect(sendOtpSupabase("081234567890")).rejects.toThrow("sms quota");
    sbMock.available = false;
    await expect(sendOtpSupabase("081234567890")).rejects.toThrow("Supabase tidak dikonfigurasi");
  });
  it("verifyOtp sukses → authId + refresh token", async () => {
    const res = await verifyOtpSupabase("081234567890", "123456");
    expect(res).toEqual({ authId: "auth-1", refreshToken: "rt-1" });
    expect(sbMock.verifyOtp).toHaveBeenCalledWith({
      phone: "+6281234567890",
      token: "123456",
      type: "sms",
    });
  });
  it("verifyOtp error / tanpa user → null", async () => {
    sbMock.verifyOtp.mockResolvedValueOnce({ data: null, error: { message: "invalid" } });
    expect(await verifyOtpSupabase("081234567890", "000000")).toBeNull();
    sbMock.verifyOtp.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(await verifyOtpSupabase("081234567890", "000000")).toBeNull();
  });
});

describe("syncUserFromSupabase", () => {
  it("user sudah di cache → dikembalikan tanpa query", async () => {
    dbMock.users.push({ id: "auth-1", name: "Siti", phone: "081234567890" });
    const u = await syncUserFromSupabase("auth-1");
    expect(u?.id).toBe("auth-1");
    expect(sbMock.from).not.toHaveBeenCalled();
  });
  it("profil dibaca dari Supabase + upsert ke cache; fallbackName dipakai bila nama kosong", async () => {
    stubFromRow({ id: "auth-9", name: "", phone: "081234567890", role: "customer", created_at: "2026-08-01" });
    const u = await syncUserFromSupabase("auth-9", "Nama OTP");
    expect(u?.name).toBe("Nama OTP");
    expect(dbMock.upsertUser).toHaveBeenCalled();
  });
  it("profil tidak ada → null", async () => {
    stubFromRow(null);
    expect(await syncUserFromSupabase("auth-9")).toBeNull();
  });
  it("tanpa admin → null", async () => {
    sbMock.available = false;
    expect(await syncUserFromSupabase("auth-9")).toBeNull();
  });
});

describe("signInSupabase (login phone / email)", () => {
  it("identifier berisi @ → login email (lowercase)", async () => {
    stubFromRow({ id: "auth-1", name: "Siti", role: "customer", created_at: "2026-08-01" });
    const res = await signInSupabase("Budi@Kopi.ID", "rahasia123");
    expect(res?.refreshToken).toBe("rt-1");
    expect(sbMock.signInWithPassword).toHaveBeenCalledWith({
      email: "budi@kopi.id",
      password: "rahasia123",
    });
  });
  it("nomor → login phone E.164", async () => {
    stubFromRow({ id: "auth-1", name: "Siti", role: "customer", created_at: "2026-08-01" });
    const res = await signInSupabase("081234567890", "rahasia123");
    expect(res?.user.id).toBe("auth-1");
    expect(sbMock.signInWithPassword).toHaveBeenCalledWith({
      phone: "+6281234567890",
      password: "rahasia123",
    });
  });
  it("user sudah di cache → tanpa query profil", async () => {
    dbMock.users.push({ id: "auth-1", name: "Siti", phone: "081234567890" });
    const res = await signInSupabase("081234567890", "rahasia123");
    expect(res?.user.id).toBe("auth-1");
    expect(sbMock.from).not.toHaveBeenCalled();
  });
  it("error / tanpa user → null", async () => {
    sbMock.signInWithPassword.mockResolvedValueOnce({ data: null, error: { message: "bad" } });
    expect(await signInSupabase("081234567890", "x")).toBeNull();
  });
  it("profil tidak ditemukan → null", async () => {
    stubFromRow(null);
    expect(await signInSupabase("081234567890", "x")).toBeNull();
  });
});

describe("resetPasswordSupabase", () => {
  it("email → resetPasswordForEmail dipanggil (lowercase)", async () => {
    await resetPasswordSupabase("Budi@Kopi.ID ");
    expect(sbMock.resetPasswordForEmail).toHaveBeenCalledWith("budi@kopi.id");
  });
  it("nomor → no-op; tanpa admin → no-op", async () => {
    await resetPasswordSupabase("081234567890");
    expect(sbMock.resetPasswordForEmail).not.toHaveBeenCalled();
    sbMock.available = false;
    await resetPasswordSupabase("budi@kopi.id");
    expect(sbMock.resetPasswordForEmail).not.toHaveBeenCalled();
  });
});
