"use client";

import Link from "next/link";
import { postJson, useSubmit } from "@/lib/client";
import Field from "@/components/Field";
import ImageField from "@/components/ImageField";

export default function RegisterMerchantForm() {
  const { run, loading, error } = useSubmit();

  return (
    <form
      className="mt-6 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() =>
          postJson("/api/auth/register", {
            type: "merchant",
            namaUsaha: fd.get("namaUsaha"),
            kategoriUsaha: fd.get("kategoriUsaha"),
            noWAUsaha: fd.get("noWAUsaha"),
            alamatUsaha: fd.get("alamatUsaha"),
            googleMapsUrl: fd.get("googleMapsUrl") || "",
            fotoUsaha: fd.get("fotoUsaha") || "",
            logoUsaha: fd.get("logoUsaha") || "",
            namaPemilik: fd.get("namaPemilik"),
            noWAPemilik: fd.get("noWAPemilik"),
            email: fd.get("email"),
            password: fd.get("password"),
            confirmPassword: fd.get("confirmPassword"),
            deskripsi: fd.get("deskripsi") || "",
            jamOperasional: fd.get("jamOperasional") || "",
          })
        );
      }}
    >
      <div className="card p-4">
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-accent-600">Data Usaha</h3>
        <div className="space-y-4">
          <Field label="Nama Usaha" name="namaUsaha" placeholder="Nama toko / usaha Anda" required />
          <div>
            <label htmlFor="kategoriUsaha" className="label">Kategori Usaha</label>
            <select id="kategoriUsaha" name="kategoriUsaha" required className="input">
              <option value="">Pilih kategori usaha</option>
              <option>Makanan &amp; Minuman</option>
              <option>F&amp;B - Kopi</option>
              <option>Fashion</option>
              <option>Elektronik</option>
              <option>Kecantikan</option>
              <option>Kesehatan</option>
              <option>Rumah Tangga</option>
              <option>Jasa</option>
              <option>Lainnya</option>
            </select>
          </div>
          <Field label="Nomor WA Usaha" name="noWAUsaha" type="tel" placeholder="08xxxxxxxxxx" required />
          <Field label="Alamat Usaha" name="alamatUsaha" placeholder="Alamat lengkap usaha" required />
          <Field label="Lokasi Google Maps (tautan)" name="googleMapsUrl" type="url" placeholder="https://maps.google.com/..." />
          <div className="space-y-3">
            <ImageField
              name="fotoUsaha"
              label="Foto Usaha"
              hint="JPG/PNG maks 2MB — unggah ke Supabase Storage (opsional)"
              folder="usaha"
            />
            <ImageField
              name="logoUsaha"
              label="Logo Usaha"
              hint="JPG/PNG maks 2MB — unggah ke Supabase Storage (opsional)"
              folder="usaha"
            />
          </div>
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-accent-600">Data Pemilik</h3>
        <div className="space-y-4">
          <Field label="Nama Pemilik" name="namaPemilik" placeholder="Nama lengkap pemilik" required />
          <Field label="Nomor WA Pemilik" name="noWAPemilik" type="tel" placeholder="08xxxxxxxxxx" required />
          <Field label="Email" name="email" type="email" placeholder="email@usaha.com" required />
          <Field label="Password" name="password" type="password" placeholder="Minimal 6 karakter" autoComplete="new-password" required />
          <Field label="Konfirmasi Password" name="confirmPassword" type="password" placeholder="Ulangi password" autoComplete="new-password" required />
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-3 text-sm font-extrabold uppercase tracking-wide text-accent-600">Data Tambahan</h3>
        <div className="space-y-4">
          <div>
            <label htmlFor="deskripsi" className="label">Deskripsi Singkat Usaha</label>
            <textarea
              id="deskripsi"
              name="deskripsi"
              rows={3}
              className="input resize-none"
              placeholder="Ceritakan singkat tentang usaha Anda"
            />
          </div>
          <Field label="Jam Operasional" name="jamOperasional" placeholder="cth: 08.00 - 21.00" />
        </div>
      </div>

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
          V Shop Merchant
        </span>
      </label>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-accent w-full">
        {loading ? "Mengirim..." : "Ajukan Pendaftaran"}
      </button>

      <p className="pt-1 text-center text-sm text-gray-600">
        Sudah punya akun?{" "}
        <Link href="/masuk/merchant" className="font-semibold text-brand-600 hover:underline">
          Login Merchant
        </Link>
      </p>
    </form>
  );
}
