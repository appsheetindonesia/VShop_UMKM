import { z } from "zod";

export const phoneSchema = z
  .string()
  .min(9, "Nomor WhatsApp tidak valid")
  .max(16, "Nomor WhatsApp tidak valid")
  .regex(/^[0-9+ ]+$/, "Nomor WhatsApp hanya boleh angka");

export const emailSchema = z.string().email("Email tidak valid").max(160);

export const passwordSchema = z
  .string()
  .min(6, "Password minimal 6 karakter")
  .max(72, "Password maksimal 72 karakter");

export const registerCustomerFields = z.object({
  name: z.string().min(3, "Nama lengkap minimal 3 karakter").max(160),
  phone: phoneSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
});

export const registerCustomerSchema = registerCustomerFields.refine(
  (d) => d.password === d.confirmPassword,
  { message: "Konfirmasi password tidak sama", path: ["confirmPassword"] }
);

export const registerMerchantFields = z.object({
  namaUsaha: z.string().min(3, "Nama usaha minimal 3 karakter").max(160),
  kategoriUsaha: z.string().min(2, "Kategori usaha wajib diisi"),
  noWAUsaha: phoneSchema,
  alamatUsaha: z.string().min(5, "Alamat usaha wajib diisi").max(300),
  googleMapsUrl: z.string().url("Tautan Google Maps tidak valid").or(z.literal("")).optional(),
  fotoUsaha: z.string().max(500).optional(),
  logoUsaha: z.string().max(500).optional(),
  namaPemilik: z.string().min(3, "Nama pemilik minimal 3 karakter").max(160),
  noWAPemilik: phoneSchema,
  email: emailSchema,
  password: passwordSchema,
  confirmPassword: z.string(),
  deskripsi: z.string().max(500).optional(),
  jamOperasional: z.string().max(100).optional(),
});

export const registerMerchantSchema = registerMerchantFields.refine(
  (d) => d.password === d.confirmPassword,
  { message: "Konfirmasi password tidak sama", path: ["confirmPassword"] }
);

export const loginSchema = z.object({
  identifier: z.string().min(3, "Masukkan email atau nomor WhatsApp").max(160),
  password: z.string().min(1, "Password wajib diisi"),
});

export const forgotSchema = z.object({
  identifier: z.string().min(3, "Masukkan email atau nomor WhatsApp"),
});

export const checkoutSchema = z.object({
  type: z.enum(["package", "topup", "merchandise"]),
  packageId: z.string().optional(),
  amount: z.coerce.number().int().positive().optional(),
  address: z
    .object({
      nama: z.string().min(3, "Nama wajib diisi"),
      phone: phoneSchema,
      alamat: z.string().min(5, "Alamat wajib diisi"),
      kota: z.string().min(2, "Kota wajib diisi"),
      kodePos: z.string().min(4, "Kode pos tidak valid").max(6),
    })
    .optional(),
});

export const paySchema = z.object({
  method: z.enum(["va-bca", "va-bni", "va-mandiri", "qris", "gopay", "ovo", "dana"]),
});

export const claimSchema = z.object({
  voucherId: z.string().min(1),
});

export const redeemSchema = z.object({
  kode: z.string().min(1, "Kode voucher wajib diisi").max(30),
  kodeKonfirmasi: z
    .string()
    .min(4, "Kode konfirmasi tidak valid")
    .max(10, "Kode konfirmasi tidak valid"),
});

export const promoFormSchema = z.object({
  promoName: z.string().min(3, "Nama promo minimal 3 karakter").max(160),
  jenisVoucher: z.string().min(2, "Jenis voucher wajib diisi"),
  startDate: z.string().min(1, "Periode mulai wajib diisi"),
  endDate: z.string().min(1, "Periode selesai wajib diisi"),
  jumlahPromo: z.coerce.number().int().min(1, "Jumlah promo minimal 1").max(10000),
  voucherName: z.string().min(3, "Nama voucher minimal 3 karakter").max(160),
  nilaiVoucher: z.coerce.number().int().min(1, "Nilai voucher wajib diisi"),
  minTransaksi: z.coerce.number().int().min(0),
  kuota: z.coerce.number().int().min(1, "Kuota minimal 1"),
  masaBerlaku: z.string().min(1, "Masa berlaku wajib diisi"),
  maksPenggunaan: z.coerce.number().int().min(1, "Maksimal penggunaan minimal 1"),
  syaratKetentuan: z.string().max(1000).optional(),
  jumlahVoucher: z.coerce.number().int().min(1, "Jumlah voucher minimal 1").max(100000),
});

export const merchantReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
});

export const merchandiseSchema = z.object({
  name: z.string().min(3, "Nama produk minimal 3 karakter").max(160),
  description: z.string().min(5, "Deskripsi wajib diisi").max(1000),
  price: z.coerce.number().int().positive("Harga harus lebih dari 0"),
  stock: z.coerce.number().int().min(0, "Stok tidak boleh negatif"),
  image: z.string().max(500).optional(),
  category: z.string().min(2, "Kategori wajib diisi"),
});

export const topupSchema = z.object({
  amount: z.coerce.number().int().min(10000, "Minimal top up Rp10.000").max(5_000_000, "Maksimal top up Rp5.000.000"),
});
