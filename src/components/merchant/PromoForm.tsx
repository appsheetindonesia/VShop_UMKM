"use client";

import { postJson, useSubmit } from "@/lib/client";
import Field from "@/components/Field";

export default function PromoForm() {
  const { run, loading, error } = useSubmit();

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        run(() =>
          postJson("/api/merchant/promos", {
            promoName: fd.get("promoName"),
            jenisVoucher: fd.get("jenisVoucher"),
            startDate: fd.get("startDate"),
            endDate: fd.get("endDate"),
            jumlahPromo: fd.get("jumlahPromo"),
            voucherName: fd.get("voucherName"),
            nilaiVoucher: fd.get("nilaiVoucher"),
            minTransaksi: fd.get("minTransaksi") || 0,
            kuota: fd.get("kuota"),
            masaBerlaku: fd.get("masaBerlaku"),
            maksPenggunaan: fd.get("maksPenggunaan"),
            syaratKetentuan: fd.get("syaratKetentuan") || "",
            jumlahVoucher: fd.get("jumlahVoucher"),
          })
        );
      }}
    >
      {/* Formulir Promo */}
      <div className="card space-y-4 p-5">
        <h2 className="font-bold text-gray-900">Formulir Promo</h2>
        <Field label="Nama Promo" name="promoName" placeholder="Buatlah Nama Promo" required />
        <div>
          <label htmlFor="jenisVoucher" className="label">Jenis Voucher</label>
          <select id="jenisVoucher" name="jenisVoucher" className="input" required>
            <option value="">Pilihan jenis voucher</option>
            <option value="diskon">Diskon</option>
            <option value="cashback">Cashback</option>
            <option value="gratis-ongkir">Gratis Ongkir</option>
            <option value="bundling">Bundling</option>
            <option value="lainnya">Lainnya</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Periode Mulai" name="startDate" type="date" required />
          <Field label="Periode Selesai" name="endDate" type="date" required />
        </div>
        <Field label="Jumlah Promo" name="jumlahPromo" type="number" min={1} placeholder="100" required />
      </div>

      {/* Formulir Voucher */}
      <div className="card space-y-4 p-5">
        <h2 className="font-bold text-gray-900">Formulir Voucher</h2>
        <Field label="Nama Voucher" name="voucherName" placeholder="Buatlah Nama" required />
        <div>
          <label htmlFor="jenisVoucherVch" className="label">Jenis Voucher</label>
          <select id="jenisVoucherVch" name="jenisVoucher" className="input" required>
            <option value="">Pilihan Voucher</option>
            <option value="diskon">Diskon</option>
            <option value="cashback">Cashback</option>
            <option value="gratis-ongkir">Gratis Ongkir</option>
            <option value="bundling">Bundling</option>
            <option value="lainnya">Lainnya</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nilai Voucher (Rp)" name="nilaiVoucher" type="number" min={1} placeholder="100.000" required />
          <Field label="Minimal Transaksi (Rp)" name="minTransaksi" type="number" min={0} placeholder="Rp25k-50k" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kuota Voucher" name="kuota" type="number" min={1} placeholder="100" required />
          <Field label="Maksimal Penggunaan / Pelanggan" name="maksPenggunaan" type="number" min={1} placeholder="2" required />
        </div>
        <Field label="Masa Berlaku (sampai)" name="masaBerlaku" type="date" required />
        <div>
          <label htmlFor="syaratKetentuan" className="label">Syarat &amp; Ketentuan</label>
          <textarea
            id="syaratKetentuan"
            name="syaratKetentuan"
            rows={3}
            className="input resize-none"
            placeholder="Berlaku untuk semua jenis..."
          />
        </div>
        <Field label="Jumlah Voucher" name="jumlahVoucher" type="number" min={1} placeholder="100" required />
      </div>

      <div className="rounded-xl bg-gray-50 p-4 text-xs leading-relaxed text-gray-500">
        <p className="font-semibold text-gray-600">Ketentuan / Syarat / T&amp;C:</p>
        <ul className="mt-1 list-inside list-disc space-y-0.5">
          <li>Voucher divalidasi melalui menu <strong>Getken Voucher</strong> menggunakan kode &amp; kode konfirmasi.</li>
          <li>Kasir memverifikasi identitas (nama / KTP) pelanggan saat pemakaian.</li>
          <li>Kuota voucher dihitung dari jumlah klaim pelanggan.</li>
        </ul>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button type="submit" disabled={loading} className="btn-primary w-full">
        {loading ? "Membuat..." : "Buat Promo & Voucher"}
      </button>
    </form>
  );
}
