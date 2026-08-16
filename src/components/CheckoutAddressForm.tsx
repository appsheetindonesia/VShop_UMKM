"use client";

import { postJson, useSubmit } from "@/lib/client";
import Field from "@/components/Field";

export default function CheckoutAddressForm({
  type,
  packageId,
  amount,
  submitLabel = "Lanjut ke Pembayaran",
}: {
  type: "package" | "topup" | "merchandise";
  packageId?: string;
  amount?: number;
  submitLabel?: string;
}) {
  const { run, loading, error } = useSubmit();

  return (
    <form
      className="card space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() =>
          postJson("/api/checkout", {
            type,
            packageId,
            amount,
            address: {
              nama: fd.get("nama"),
              phone: fd.get("phone"),
              alamat: fd.get("alamat"),
              kota: fd.get("kota"),
              kodePos: fd.get("kodePos"),
            },
          })
        );
      }}
    >
      <h2 className="font-bold text-gray-900">Informasi Pengiriman</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama lengkap" name="nama" placeholder="Nama penerima" autoComplete="name" required />
        <Field label="No. telepon" name="phone" type="tel" placeholder="08xxxxxxxxxx" autoComplete="tel" required />
        <div className="sm:col-span-2">
          <Field label="Alamat" name="alamat" placeholder="Alamat lengkap" autoComplete="street-address" required />
        </div>
        <Field label="Kota" name="kota" placeholder="Kota / Kabupaten" autoComplete="address-level2" required />
        <Field label="Kode Pos" name="kodePos" inputMode="numeric" placeholder="12345" autoComplete="postal-code" required />
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Menyiapkan pembayaran..." : submitLabel}
      </button>
      <p className="text-center text-xs text-gray-400">
        Harga akhir dihitung ulang oleh server saat checkout.
      </p>
    </form>
  );
}
