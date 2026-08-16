import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { archiveVoucher, getMerchantByUserId } from "@/lib/service";

export async function POST(_req: Request, { params }: { params: { voucherId: string } }) {
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
  try {
    archiveVoucher(merchant.id, params.voucherId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal" },
      { status: 400 }
    );
  }
}
