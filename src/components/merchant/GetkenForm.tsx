"use client";

import { useState } from "react";
import { postJson } from "@/lib/client";
import Field from "@/components/Field";
import Badge from "@/components/Badge";
import { formatRupiah } from "@/lib/format";

type RedeemResponse = {
  ok: boolean;
  message?: string;
  claim?: {
    kode: string;
    status: string;
    useCount: number;
    user?: { name: string; phone?: string };
    voucher?: { name: string; nilai: number; minTransaksi: number; maksPenggunaan: number };
  };
};

export default function GetkenForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedeemResponse["claim"] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setSuccess(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await postJson<RedeemResponse>("/api/merchant/vouchers/validate", {
        kode: fd.get("kode"),
        kodeKonfirmasi: fd.get("kodeKonfirmasi"),
      });
      if (res.ok && res.claim) {
        setResult(res.claim);
        setSuccess("Voucher berhasil divalidasi dan ditandai terpakai.");
      } else {
        setError(res.message ?? "Validasi gagal");
      }
    } catch {
      setError("Terjadi kesalahan koneksi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="card space-y-4 p-5">
        <h2 className="font-bold text-gray-900">Validasi Voucher Pelanggan</h2>
        <Field
          label="Kode Voucher"
          name="kode"
          placeholder="cth: VS-8F3A-21KQ"
          autoCapitalize="characters"
          required
        />
        <Field
          label="Kode Konfirmasi"
          name="kodeKonfirmasi"
          placeholder="6 digit kode konfirmasi"
          inputMode="numeric"
          maxLength={10}
          required
        />

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {success}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Memvalidasi..." : "Validasi Voucher"}
        </button>
      </div>

      {result && (
        <div className="card space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900">{result.voucher?.name}</h3>
            <Badge color="green">✓ Tervalidasi</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Pelanggan</p>
              <p className="font-semibold text-gray-900">{result.user?.name ?? "-"}</p>
              <p className="text-xs text-gray-400">{result.user?.phone}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Nilai Voucher</p>
              <p className="font-semibold text-accent-600">{formatRupiah(result.voucher?.nilai ?? 0)}</p>
              <p className="text-xs text-gray-400">
                Min. transaksi {formatRupiah(result.voucher?.minTransaksi ?? 0)}
              </p>
            </div>
          </div>
          <p className="rounded-xl bg-gray-50 px-4 py-3 text-xs text-gray-500">
            Kode <strong className="font-mono">{result.kode}</strong> · pemakaian ke-{result.useCount}/
            {result.voucher?.maksPenggunaan}
          </p>
          <p className="text-xs text-gray-400">
            ⚠️ Verifikasi identitas pelanggan (nama / KTP) sesuai ketentuan sebelum melayani transaksi.
          </p>
        </div>
      )}
    </form>
  );
}
