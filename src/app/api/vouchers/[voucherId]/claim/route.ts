import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { claimVoucher } from "@/lib/service";

export async function POST(_req: Request, { params }: { params: { voucherId: string } }) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json(
      { ok: false, message: "Silakan login sebagai pelanggan", redirect: "/masuk/pelanggan" },
      { status: 401 }
    );
  }
  const result = claimVoucher(user.id, params.voucherId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message ?? "Gagal mengklaim" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
