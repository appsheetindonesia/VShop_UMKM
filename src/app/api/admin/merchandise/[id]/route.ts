import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { setMerchandiseStatus, updateMerchandise } from "@/lib/service";
import { merchandiseSchema } from "@/lib/validation";

const actionSchema = z.object({ action: z.enum(["archive", "activate"]) });

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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

  const action = actionSchema.safeParse(body);
  if (action.success) {
    try {
      setMerchandiseStatus(params.id, action.data.action === "archive" ? "archived" : "active");
      return NextResponse.json({ ok: true });
    } catch (err) {
      return NextResponse.json(
        { ok: false, message: err instanceof Error ? err.message : "Gagal" },
        { status: 400 }
      );
    }
  }

  const parsed = merchandiseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }

  try {
    updateMerchandise(params.id, parsed.data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : "Gagal menyimpan" },
      { status: 400 }
    );
  }
}
