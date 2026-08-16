import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { removeCartItem, updateCartItem } from "@/lib/service";

export async function PUT(
  req: Request,
  { params }: { params: { productId: string } }
) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json({ ok: false, message: "Silakan login" }, { status: 401 });
  }
  const parsed = z.object({ quantity: z.coerce.number().int().min(1) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Kuantitas tidak valid" }, { status: 400 });
  }
  try {
    updateCartItem(user.id, params.productId, parsed.data.quantity);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal memperbarui" },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: { productId: string } }) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json({ ok: false, message: "Silakan login" }, { status: 401 });
  }
  removeCartItem(user.id, params.productId);
  return NextResponse.json({ ok: true });
}
