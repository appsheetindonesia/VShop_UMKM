import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  testConnection,
  type SettingCategory,
} from "@/lib/settings";

const CATEGORIES = new Set<SettingCategory>([
  "postgres",
  "midtrans",
  "whatsapp",
  "ai",
  "lainnya",
]);

/** POST /api/admin/settings/test — uji koneksi NYATA ke sistem luar per kategori. */
export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }
  let body: { category?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const category = body?.category as SettingCategory;
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ ok: false, message: "Kategori tidak dikenal" }, { status: 400 });
  }
  const result = await testConnection(category);
  return NextResponse.json({ ok: result.ok, category, detail: result.detail });
}
