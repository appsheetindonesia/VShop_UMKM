import type { RegisterCustomerInput, RegisterMerchantInput } from "./service";
import { getDB, getStoreMode, isoNow, newId, upsertMerchant, upsertUser } from "./db";
import { getSupabaseAdmin } from "./supabase/server";
import type { Merchant, User } from "./types";

/**
 * Adapter Auth berbasis Supabase (dipakai saat Supabase dikonfigurasi).
 *
 * - Pelanggan: akun Auth dibuat dengan **nomor WhatsApp** (Supabase Auth
 *   phone, format E.164) — bukan email sintetis. Wajib mengaktifkan Phone
 *   provider + sign-in Password di dashboard Supabase (Authentication →
 *   Sign In / Up → Phone).
 * - Merchant/admin: tetap pakai email.
 * - Refresh token Supabase disimpan di cookie httpOnly (`vshop_sb_refresh`)
 *   DAN terenkripsi di baris sesi (migration 0002); pemulihan sesi tanpa
 *   login ulang ditangani **middleware** (`src/middleware.ts` +
 *   `src/lib/session-renew.ts`) sebelum halaman dirender — tanpa flash login.
 */

export interface SupabaseAuthResult {
  user: User;
  refreshToken?: string;
}

/** Ubah nomor lokal Indonesia ("0812…" / "+62…" / "812…") ke E.164. */
export function phoneToE164(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) digits = `62${digits.slice(1)}`;
  else if (!digits.startsWith("62")) digits = `62${digits}`;
  return `+${digits}`;
}

function phoneDigits(phone: string): string {
  return phone.replace(/[^0-9+]/g, "");
}

function profileToUser(profile: {
  id: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  password_hash?: unknown;
  role?: unknown;
  created_at?: unknown;
}): User {
  return {
    id: String(profile.id),
    name: String(profile.name ?? ""),
    phone: profile.phone ? String(profile.phone) : undefined,
    email: profile.email ? String(profile.email) : undefined,
    passwordHash: String(profile.password_hash ?? ""),
    role: (profile.role as User["role"]) ?? "customer",
    createdAt: String(profile.created_at ?? new Date().toISOString()),
  };
}

function userInCache(userId: string): User | undefined {
  return getDB().users.find((u) => u.id === userId);
}

export async function signUpCustomerSupabase(
  input: RegisterCustomerInput
): Promise<SupabaseAuthResult> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const phone = phoneDigits(input.phone);
  const e164 = phoneToE164(phone);

  // Cek duplikat di tabel profil (nomor lokal), lalu biarkan Supabase Auth
  // menolak nomor E.164 yang sudah terdaftar.
  const { data: dup } = await sb
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (dup) throw new Error("Nomor WhatsApp sudah terdaftar. Silakan login.");

  const { data, error } = await sb.auth.admin.createUser({
    phone: e164,
    password: input.password,
    phone_confirm: true,
    user_metadata: { name: input.name },
  });
  if (error) throw new Error(authErrorMessage(error));

  const user: User = {
    id: data.user!.id,
    name: input.name,
    phone,
    // Tidak ada email sintetis lagi — identitas via nomor WhatsApp.
    email: undefined,
    passwordHash: "",
    role: "customer",
    createdAt: isoNow(),
  };
  upsertUser(user);

  // Auto-login untuk mendapatkan refresh token (sesi tahan lama).
  let refreshToken: string | undefined;
  const { data: sess } = await sb.auth.signInWithPassword({
    phone: e164,
    password: input.password,
  });
  refreshToken = sess.session?.refresh_token;

  return { user, refreshToken };
}

export async function signUpMerchantSupabase(
  input: RegisterMerchantInput
): Promise<SupabaseAuthResult & { merchant: Merchant }> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const email = input.email.toLowerCase().trim();
  const phone = phoneDigits(input.noWAPemilik);

  const { data: dupEmail } = await sb
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (dupEmail) throw new Error("Email sudah terdaftar. Silakan login.");
  const { data: dupPhone } = await sb
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();
  if (dupPhone) throw new Error("Nomor WhatsApp pemilik sudah terdaftar.");

  const { data, error } = await sb.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.namaPemilik },
  });
  if (error) throw new Error(authErrorMessage(error));

  const user: User = {
    id: data.user!.id,
    name: input.namaPemilik,
    phone,
    email,
    passwordHash: "",
    role: "merchant",
    createdAt: isoNow(),
  };
  upsertUser(user);

  const merchant: Merchant = {
    id: newId("mch"),
    userId: user.id,
    namaUsaha: input.namaUsaha,
    kategoriUsaha: input.kategoriUsaha,
    noWAUsaha: input.noWAUsaha,
    alamatUsaha: input.alamatUsaha,
    googleMapsUrl: input.googleMapsUrl || undefined,
    fotoUsaha: input.fotoUsaha || undefined,
    logoUsaha: input.logoUsaha || undefined,
    namaPemilik: input.namaPemilik,
    noWAPemilik: input.noWAPemilik,
    email,
    deskripsi: input.deskripsi || undefined,
    jamOperasional: input.jamOperasional || undefined,
    status: "pending",
    createdAt: isoNow(),
  };
  upsertMerchant(merchant);

  let refreshToken: string | undefined;
  const { data: sess } = await sb.auth.signInWithPassword({
    email,
    password: input.password,
  });
  refreshToken = sess.session?.refresh_token;

  return { user, merchant, refreshToken };
}

/**
 * Kirim OTP (one-time password) via WhatsApp — Supabase Auth phone.
 * Bila nomor belum terdaftar, Supabase membuat user baru saat OTP
 * diverifikasi (register-by-OTP); `name` masuk ke user_metadata (dipakai
 * trigger `handle_new_user` untuk mengisi kolom `name` di profil).
 */
export async function sendOtpSupabase(phone: string, name?: string): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const { error } = await sb.auth.signInWithOtp({
    phone: phoneToE164(phone),
    options: name ? { data: { name } } : undefined,
  });
  if (error) throw new Error(authErrorMessage(error));
}

/** Verifikasi OTP SMS/WhatsApp (type "sms") → user Auth + session. */
export async function verifyOtpSupabase(
  phone: string,
  token: string
): Promise<{ authId: string; refreshToken?: string } | null> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");
  const { data, error } = await sb.auth.verifyOtp({
    phone: phoneToE164(phone),
    token,
    type: "sms",
  });
  if (error || !data.user) return null;
  return { authId: data.user.id, refreshToken: data.session?.refresh_token };
}

/**
 * Sinkronkan user aplikasi dari profil Supabase (sumber kebenaran) ke cache
 * lokal; buat cache bila belum ada. Dipakai setelah OTP diverifikasi.
 */
export async function syncUserFromSupabase(
  authId: string,
  fallbackName?: string
): Promise<User | null> {
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  let user = userInCache(authId);
  if (!user) {
    const { data: profile } = await sb
      .from("profiles")
      .select("id,name,phone,email,password_hash,role,created_at")
      .eq("id", authId)
      .maybeSingle();
    if (!profile) return null;
    user = profileToUser(profile);
    if (fallbackName && !user.name) user = { ...user, name: fallbackName };
    upsertUser(user);
  }
  return user;
}

/** Login via Supabase Auth — email ATAU nomor WhatsApp (phone E.164). */
export async function signInSupabase(
  identifier: string,
  password: string
): Promise<SupabaseAuthResult | null> {
  const sb = getSupabaseAdmin();
  if (!sb) throw new Error("Supabase tidak dikonfigurasi");

  const id = identifier.trim();
  const { data, error } = id.includes("@")
    ? await sb.auth.signInWithPassword({ email: id.toLowerCase(), password })
    : await sb.auth.signInWithPassword({ phone: phoneToE164(id), password });
  if (error || !data.user) return null;

  const authId = data.user.id;
  // Profil aplikasi — baca dari Supabase (sumber kebenaran), lalu sinkron cache.
  let user = userInCache(authId);
  if (!user) {
    const { data: profile, error: profileError } = await sb
      .from("profiles")
      .select("id,name,phone,email,password_hash,role,created_at")
      .eq("id", authId)
      .maybeSingle();
    if (profileError || !profile) return null;
    user = profileToUser(profile);
    upsertUser(user);
  }

  return { user, refreshToken: data.session?.refresh_token };
}

/** Kirim email reset password (kalau identifier berupa email). */
export async function resetPasswordSupabase(identifier: string): Promise<void> {
  const sb = getSupabaseAdmin();
  if (!sb) return;
  const id = identifier.trim();
  if (!id.includes("@")) return;
  await sb.auth.resetPasswordForEmail(id.toLowerCase());
}

function authErrorMessage(error: { message?: string; code?: string }): string {
  const msg = error.message ?? "Terjadi kesalahan";
  if (/already registered|already been registered|phone_exists|email_exists/i.test(msg)) {
    if (/phone/i.test(msg)) return "Nomor WhatsApp sudah terdaftar. Silakan login.";
    return "Email sudah terdaftar. Silakan login.";
  }
  return msg;
}

/**
 * True bila mode Supabase AKTIF (hydrate berhasil). Auth hanya lewat
 * Supabase saat store benar-benar berjalan di Supabase; bila hydration gagal
 * dan aplikasi fallback ke demo, auth demo (password hash lokal) yang dipakai
 * agar perilaku tetap konsisten.
 */
export function isSupabaseAuthEnabled(): boolean {
  return getStoreMode() === "supabase";
}
