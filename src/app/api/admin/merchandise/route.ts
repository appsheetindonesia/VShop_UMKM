import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { createMerchandise } from "@/lib/service";
import { merchandiseSchema } from "@/lib/validation";

export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const parsed = merchandiseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  try {
    const item = createMerchandise(parsed.data);
    return NextResponse.json({ ok: true, id: item.id, redirect: "/admin/produk" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal menyimpan" },
      { status: 400 }
    );
  }
}
