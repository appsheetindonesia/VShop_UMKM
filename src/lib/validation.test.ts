/**
 * Unit test skema validasi (src/lib/validation.ts) — kasus valid & invalid
 * per skema agar seluruh cabang zod ter-cover (pure, tanpa dependency).
 */
import { describe, expect, it } from "vitest";
import {
  checkoutSchema,
  claimSchema,
  emailSchema,
  forgotSchema,
  loginSchema,
  merchandiseSchema,
  merchantReviewSchema,
  passwordSchema,
  paySchema,
  phoneSchema,
  promoFormSchema,
  redeemSchema,
  registerCustomerSchema,
  registerMerchantSchema,
  topupSchema,
} from "./validation";

describe("phoneSchema", () => {
  it("menerima nomor lokal & internasional (angka, +, spasi)", () => {
    expect(phoneSchema.safeParse("081234567890").success).toBe(true);
    expect(phoneSchema.safeParse("+6281234567890").success).toBe(true);
    expect(phoneSchema.safeParse("0812 3456 7890").success).toBe(true);
  });
  it("menolak terlalu pendek / panjang / karakter non-nomor", () => {
    expect(phoneSchema.safeParse("08123").success).toBe(false);
    expect(phoneSchema.safeParse("0".repeat(20)).success).toBe(false);
    expect(phoneSchema.safeParse("08abc").success).toBe(false);
    expect(phoneSchema.safeParse("").success).toBe(false);
  });
});

describe("emailSchema & passwordSchema", () => {
  it("email valid/invalid", () => {
    expect(emailSchema.safeParse("a@b.co").success).toBe(true);
    expect(emailSchema.safeParse("bukan-email").success).toBe(false);
  });
  it("password min 6, max 72", () => {
    expect(passwordSchema.safeParse("123456").success).toBe(true);
    expect(passwordSchema.safeParse("12345").success).toBe(false);
    expect(passwordSchema.safeParse("x".repeat(73)).success).toBe(false);
  });
});

describe("registerCustomerSchema", () => {
  const ok = {
    name: "Siti Aminah",
    phone: "081234567890",
    password: "rahasia123",
    confirmPassword: "rahasia123",
  };
  it("data valid", () => {
    expect(registerCustomerSchema.safeParse(ok).success).toBe(true);
  });
  it("nama terlalu pendek", () => {
    expect(registerCustomerSchema.safeParse({ ...ok, name: "Ab" }).success).toBe(false);
  });
  it("konfirmasi password tidak sama", () => {
    const r = registerCustomerSchema.safeParse({ ...ok, confirmPassword: "lain123" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("registerMerchantSchema", () => {
  const ok = {
    namaUsaha: "Kopi Nusantara",
    kategoriUsaha: "F&B",
    noWAUsaha: "0812987654321",
    alamatUsaha: "Jl. Melati No. 1",
    namaPemilik: "Budi Santoso",
    noWAPemilik: "0812987654321",
    email: "budi@kopi.id",
    password: "rahasia123",
    confirmPassword: "rahasia123",
  };
  it("data valid + field opsional (googleMapsUrl kosong, foto, deskripsi)", () => {
    expect(
      registerMerchantSchema.safeParse({
        ...ok,
        googleMapsUrl: "",
        fotoUsaha: "foto.jpg",
        logoUsaha: "logo.png",
        deskripsi: "Kopi spesial",
        jamOperasional: "08.00-21.00",
      }).success
    ).toBe(true);
  });
  it("googleMapsUrl harus URL bila diisi", () => {
    expect(
      registerMerchantSchema.safeParse({ ...ok, googleMapsUrl: "bukan-url" }).success
    ).toBe(false);
  });
  it("konfirmasi password tidak sama", () => {
    expect(
      registerMerchantSchema.safeParse({ ...ok, confirmPassword: "beda123" }).success
    ).toBe(false);
  });
});

describe("loginSchema & forgotSchema", () => {
  it("login valid & password kosong ditolak", () => {
    expect(loginSchema.safeParse({ identifier: "081234567890", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ identifier: "ab", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ identifier: "081234567890", password: "" }).success).toBe(false);
  });
  it("forgot minimal 3 karakter", () => {
    expect(forgotSchema.safeParse({ identifier: "081234567890" }).success).toBe(true);
    expect(forgotSchema.safeParse({ identifier: "ab" }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  it("type wajib enum package/topup/merchandise", () => {
    expect(checkoutSchema.safeParse({ type: "package" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ type: "topup", amount: "15000" }).success).toBe(true); // coerce
    expect(checkoutSchema.safeParse({ type: "lengkap" }).success).toBe(false);
  });
  it("address valid/invalid", () => {
    const addr = { nama: "Siti", phone: "081234567890", alamat: "Jl. Melati 1", kota: "Bandung", kodePos: "40111" };
    expect(checkoutSchema.safeParse({ type: "merchandise", address: addr }).success).toBe(true);
    expect(checkoutSchema.safeParse({ type: "merchandise", address: { ...addr, kodePos: "401" } }).success).toBe(false);
  });
  it("amount negatif ditolak", () => {
    expect(checkoutSchema.safeParse({ type: "topup", amount: -5 }).success).toBe(false);
  });
});

describe("paySchema & claimSchema & redeemSchema", () => {
  it("metode pembayaran enum", () => {
    expect(paySchema.safeParse({ method: "qris" }).success).toBe(true);
    expect(paySchema.safeParse({ method: "gopay" }).success).toBe(true);
    expect(paySchema.safeParse({ method: "cash" }).success).toBe(false);
  });
  it("claim butuh voucherId", () => {
    expect(claimSchema.safeParse({ voucherId: "v1" }).success).toBe(true);
    expect(claimSchema.safeParse({}).success).toBe(false);
  });
  it("redeem kode & kode konfirmasi", () => {
    expect(redeemSchema.safeParse({ kode: "VS-ABC-123", kodeKonfirmasi: "123456" }).success).toBe(true);
    expect(redeemSchema.safeParse({ kode: "", kodeKonfirmasi: "123456" }).success).toBe(false);
    expect(redeemSchema.safeParse({ kode: "VS-ABC", kodeKonfirmasi: "123" }).success).toBe(false);
  });
});

describe("promoFormSchema", () => {
  const ok = {
    promoName: "Promo Ramadhan",
    jenisVoucher: "diskon",
    startDate: "2026-03-01",
    endDate: "2026-03-31",
    jumlahPromo: "10",
    voucherName: "Diskon Kopi",
    nilaiVoucher: "5000",
    minTransaksi: "20000",
    kuota: "100",
    masaBerlaku: "2026-12-31",
    maksPenggunaan: "1",
    jumlahVoucher: "100",
  };
  it("valid (angka coerce dari string)", () => {
    expect(promoFormSchema.safeParse(ok).success).toBe(true);
  });
  it("jumlahPromo 0 / nama pendek ditolak", () => {
    expect(promoFormSchema.safeParse({ ...ok, jumlahPromo: "0" }).success).toBe(false);
    expect(promoFormSchema.safeParse({ ...ok, promoName: "ab" }).success).toBe(false);
  });
});

describe("merchantReviewSchema & merchandiseSchema & topupSchema", () => {
  it("review approved/rejected", () => {
    expect(merchantReviewSchema.safeParse({ decision: "approved" }).success).toBe(true);
    expect(merchantReviewSchema.safeParse({ decision: "maybe" }).success).toBe(false);
  });
  it("merchandise valid/invalid", () => {
    const ok = { name: "Mug V Shop", description: "Mug keramik", price: "25000", stock: "10", category: "Aksesoris" };
    expect(merchandiseSchema.safeParse(ok).success).toBe(true);
    expect(merchandiseSchema.safeParse({ ...ok, price: "0" }).success).toBe(false);
    expect(merchandiseSchema.safeParse({ ...ok, stock: "-1" }).success).toBe(false);
    expect(merchandiseSchema.safeParse({ ...ok, name: "ab" }).success).toBe(false);
  });
  it("topup minimal 10rb maks 5jt", () => {
    expect(topupSchema.safeParse({ amount: "15000" }).success).toBe(true);
    expect(topupSchema.safeParse({ amount: "5000" }).success).toBe(false);
    expect(topupSchema.safeParse({ amount: "6000000" }).success).toBe(false);
    expect(topupSchema.safeParse({ amount: "9999.5" }).success).toBe(false);
  });
});
