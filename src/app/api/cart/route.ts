import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { addToCart } from "@/lib/service";

const bodySchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1),
});

export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json(
      { ok: false, message: "Silakan login sebagai pelanggan untuk belanja", redirect: "/masuk/pelanggan" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  try {
    addToCart(user.id, parsed.data.productId, parsed.data.quantity);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal menambah ke keranjang" },
      { status: 400 }
    );
  }
}
