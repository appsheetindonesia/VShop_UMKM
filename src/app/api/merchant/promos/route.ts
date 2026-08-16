import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { createPromoWithVouchers, getMerchantByUserId } from "@/lib/service";
import { promoFormSchema } from "@/lib/validation";

export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "merchant") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }
  const merchant = getMerchantByUserId(user.id);
  if (!merchant || merchant.status !== "approved") {
    return NextResponse.json(
      { ok: false, message: "Akun merchant belum disetujui admin" },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const parsed = promoFormSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  try {
    const { promo, vouchers } = createPromoWithVouchers({
      merchantId: merchant.id,
      merchantName: merchant.namaUsaha,
      promoName: parsed.data.promoName,
      jenisVoucher: parsed.data.jenisVoucher,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
      jumlahPromo: parsed.data.jumlahPromo,
      voucherName: parsed.data.voucherName,
      nilaiVoucher: parsed.data.nilaiVoucher,
      minTransaksi: parsed.data.minTransaksi,
      kuota: parsed.data.kuota,
      masaBerlaku: parsed.data.masaBerlaku,
      maksPenggunaan: parsed.data.maksPenggunaan,
      syaratKetentuan: parsed.data.syaratKetentuan ?? "",
      jumlahVoucher: parsed.data.jumlahVoucher,
    });
    return NextResponse.json({
      ok: true,
      redirect: "/merchant/pengelolaan",
      promoId: promo.id,
      voucherCount: vouchers.length,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal membuat promo" },
      { status: 400 }
    );
  }
}
