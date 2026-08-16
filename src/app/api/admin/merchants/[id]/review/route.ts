import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { reviewMerchant } from "@/lib/service";
import { merchantReviewSchema } from "@/lib/validation";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  const parsed = merchantReviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Keputusan tidak valid" }, { status: 400 });
  }

  try {
    const merchant = reviewMerchant(params.id, parsed.data.decision);
    return NextResponse.json({
      ok: true,
      status: merchant.status,
      message: parsed.data.decision === "approved" ? "Merchant disetujui" : "Merchant ditolak",
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal review" },
      { status: 400 }
    );
  }
}
