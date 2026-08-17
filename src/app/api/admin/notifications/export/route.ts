import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listNotificationLogs, notificationsToCsv } from "@/lib/notif-log";

export const dynamic = "force-dynamic";

/** Batas baris export (hindari CSV raksasa dari cron yang berjalan lama). */
const MAX_EXPORT_ROWS = 10_000;

/**
 * Export CSV log notifikasi WhatsApp untuk AUDIT (hanya admin). Menghormati
 * filter yang sama dengan halaman (/admin/notifikasi?status=&q=). Dipakai
 * tombol "Export CSV" — unduhan langsung dengan BOM UTF-8 agar Excel
 * membaca karakter Indonesia dengan benar.
 */
export async function GET(req: Request) {
  const user = getSessionUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ ok: false, message: "Akses ditolak" }, { status: 403 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;

  const { logs } = await listNotificationLogs({
    status,
    search: q,
    limit: MAX_EXPORT_ROWS,
  });

  const filename = `notifikasi-vshop-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
  return new NextResponse(`\uFEFF${notificationsToCsv(logs)}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
