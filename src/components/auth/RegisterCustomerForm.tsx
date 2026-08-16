"use client";

import { useState } from "react";
import Link from "next/link";
import { postJson, useSubmit } from "@/lib/client";
import Field from "@/components/Field";

export default function RegisterCustomerForm() {
  // OTP WhatsApp adalah alur utama; password tetap tersedia (fallback).
  const [mode, setMode] = useState<"otp" | "password">("otp");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [demoCode, setDemoCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const { run, loading, error } = useSubmit();

  const sendCode = async () => {
    setSending(true);
    setSendError(null);
    setDemoCode(null);
    try {
      const res = await postJson<{ ok: boolean; message?: string; demoCode?: string }>(
        "/api/auth/otp/send",
        { phone }
      );
      if (!res.ok) {
        setSendError(res.message ?? "Gagal mengirim kode. Coba lagi.");
        return;
      }
      setOtpSent(true);
      if (res.demoCode) setDemoCode(res.demoCode);
    } catch {
      setSendError("Terjadi kesalahan koneksi. Coba lagi.");
    } finally {
      setSending(false);
    }
  };

  const resend = () => {
    setOtpSent(false);
    setDemoCode(null);
    void sendCode();
  };

  return (
    <>
      <div className="mt-6 grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setMode("otp")}
          className={`rounded-lg px-3 py-2 transition ${
            mode === "otp" ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          OTP WhatsApp
        </button>
        <button
          type="button"
          onClick={() => setMode("password")}
          className={`rounded-lg px-3 py-2 transition ${
            mode === "password" ? "bg-white text-brand-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          Password
        </button>
      </div>

      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          if (mode === "otp") {
            run(() =>
              postJson("/api/auth/otp/verify", {
                phone,
                otp: fd.get("otp"),
                purpose: "register",
                name,
              })
            );
          } else {
            run(() =>
              postJson("/api/auth/register", {
                type: "customer",
                name: fd.get("name"),
                phone: fd.get("phone"),
                password: fd.get("password"),
                confirmPassword: fd.get("confirmPassword"),
              })
            );
          }
        }}
      >
        {mode === "otp" ? (
          <>
            <Field
              label="Nama Lengkap"
              name="name"
              placeholder="Nama lengkap Anda"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Field
              label="No WhatsApp"
              name="phone"
              type="tel"
              placeholder="08xxxxxxxxxx"
              autoComplete="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              hint="Kode OTP akan dikirim ke nomor ini via WhatsApp."
            />

            {!otpSent ? (
              <>
                {sendError && (
                  <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
                    {sendError}
                  </div>
                )}
                <button
                  type="button"
                  disabled={sending || name.length < 2 || phone.length < 9}
                  onClick={() => void sendCode()}
                  className="btn-primary w-full"
                >
                  {sending ? "Mengirim kode..." : "Kirim Kode OTP"}
                </button>
              </>
            ) : (
              <>
                <div className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
                  Kode OTP dikirim ke <span className="font-semibold">{phone}</span> via WhatsApp.
                </div>
                {demoCode && (
                  <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <span className="font-semibold">Mode demo</span> (tanpa Supabase): kode OTP Anda
                    adalah <code className="rounded bg-amber-100 px-1.5 py-0.5 font-bold">{demoCode}</code>
                  </div>
                )}
                <Field
                  label="Kode OTP"
                  name="otp"
                  type="text"
                  inputMode="numeric"
                  placeholder="6 digit"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{4,8}"
                />
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? "Memverifikasi..." : "Verifikasi & Daftar"}
                </button>
                <button
                  type="button"
                  disabled={sending}
                  onClick={resend}
                  className="w-full text-center text-xs font-semibold text-brand-600 hover:underline"
                >
                  {sending ? "Mengirim ulang..." : "Kirim ulang kode"}
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <Field label="Nama Lengkap" name="name" placeholder="Nama lengkap Anda" autoComplete="name" required />
            <Field
              label="No WhatsApp"
              name="phone"
              type="tel"
              placeholder="08xxxxxxxxxx"
              autoComplete="tel"
              required
              hint="Gunakan nomor WhatsApp aktif untuk menerima kode voucher."
            />
            <Field label="Password" name="password" type="password" placeholder="Minimal 6 karakter" autoComplete="new-password" required />
            <Field label="Konfirmasi Password" name="confirmPassword" type="password" placeholder="Ulangi password" autoComplete="new-password" required />
          </>
        )}

        <label className="flex items-start gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            name="terms"
            required
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span>
            Saya setuju dengan{" "}
            <Link href="#" className="font-medium text-brand-600 hover:underline">
              Syarat &amp; Ketentuan
            </Link>{" "}
            V Shop
          </span>
        </label>

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {mode === "password" && (
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Mendaftar..." : "Daftar"}
          </button>
        )}

        <p className="pt-2 text-center text-sm text-gray-600">
          Sudah punya akun?{" "}
          <Link href="/masuk/pelanggan" className="font-semibold text-brand-600 hover:underline">
            Login
          </Link>
        </p>
      </form>
    </>
  );
}
