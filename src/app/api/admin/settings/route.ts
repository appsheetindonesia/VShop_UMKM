import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  categoryStatus,
  ensureSettingsHydrated,
  listSettings,
  updateSetting,
  type SettingCategory,
} from "@/lib/settings";

/**
 * GET /api/admin/settings — daftar pengaturan koneksi untuk halaman
 * Configurasi. Nilai rahasia di-mask server-side (tidak pernah dikirim
 * utuh ke browser).
 */
export async function GET() {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }
  await ensureSettingsHydrated();
  const settings = await listSettings();
  return NextResponse.json({ ok: true, settings, statuses: categoryStatus(settings) });
}

/**
 * POST /api/admin/settings — simpan pengaturan koneksi.
 * Body: { updates: { [key]: string | null } } — `null` berarti PERTAHANKAN
 * nilai lama (dipakai input rahasia yang dikosongkan di form).
 */
export async function POST(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  let body: { updates?: Record<string, string | null> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }
  const updates = body?.updates;
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    return NextResponse.json({ ok: false, message: "updates wajib objek" }, { status: 400 });
  }

  const saved: string[] = [];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "") continue; // kosong = pertahankan nilai lama
    try {
      await updateSetting({ key, value: String(value), updatedBy: user.id });
      saved.push(key);
    } catch (e) {
      errors.push(`${key}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (errors.length > 0 && saved.length === 0) {
    return NextResponse.json({ ok: false, message: errors.join("; ") }, { status: 400 });
  }
  const settings = await listSettings();
  return NextResponse.json({
    ok: true,
    saved,
    errors,
    settings,
    statuses: categoryStatus(settings),
  });
}
