"use client";

import { useState } from "react";
import Link from "next/link";
import { postJson } from "@/lib/client";
import Field from "@/components/Field";

export default function ForgotForm() {
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        const fd = new FormData(e.currentTarget);
        try {
          await postJson("/api/auth/forgot", { identifier: fd.get("identifier") });
          setSent(true);
        } catch {
          setError("Terjadi kesalahan. Coba lagi.");
        } finally {
          setLoading(false);
        }
      }}
    >
      {sent ? (
        <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Jika email / nomor WhatsApp terdaftar, tautan reset password telah kami kirim. Periksa
          kotak masuk Anda.
        </div>
      ) : (
        <>
          <p className="text-sm text-gray-600">
            Masukkan email atau nomor WhatsApp yang terdaftar. Kami akan mengirimkan tautan untuk
            mengatur ulang password.
          </p>
          <Field label="Email / No WhatsApp" name="identifier" placeholder="0812xxxx atau email" required />

          {error && (
            <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Mengirim..." : "Kirim Tautan Reset"}
          </button>
        </>
      )}

      <p className="pt-2 text-center text-sm text-gray-600">
        Ingat password?{" "}
        <Link href="/masuk" className="font-semibold text-brand-600 hover:underline">
          Kembali ke Login
        </Link>
      </p>
    </form>
  );
}
