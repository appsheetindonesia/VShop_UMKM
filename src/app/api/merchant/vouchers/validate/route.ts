import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMerchantByUserId, redeemVoucher } from "@/lib/service";
import { redeemSchema } from "@/lib/validation";

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
  const parsed = redeemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  const result = redeemVoucher(merchant.id, parsed.data.kode, parsed.data.kodeKonfirmasi);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message ?? "Validasi gagal" }, { status: 400 });
  }
  const claim = result.claim;
  return NextResponse.json({
    ok: true,
    claim: {
      kode: claim?.kode,
      status: claim?.status,
      useCount: claim?.useCount,
      user: claim?.user
        ? { name: claim.user.name, phone: claim.user.phone }
        : undefined,
      voucher: claim?.voucher
        ? {
            name: claim.voucher.name,
            nilai: claim.voucher.nilai,
            minTransaksi: claim.voucher.minTransaksi,
            maksPenggunaan: claim.voucher.maksPenggunaan,
          }
        : undefined,
    },
  });
}
