import { NextResponse } from "next/server";
import { drainAndExit } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POST /api/dev/shutdown — shutdown GRACEFUL untuk `npm run stop:dev`.
 *
 * Di POSIX, `stop:dev` mengirim SIGTERM ke next-server dan drain
 * (`registerShutdownFlush`) berjalan lewat handler sinyal. Di WINDOWS,
 * proses Node yang detached tidak bisa menerima sinyal yang bisa ditangkap
 * (SIGTERM/SIGINT = TerminateProcess tanpa handler), jadi stop script
 * memanggil endpoint ini — yang mengeksekusi jalur drain yang SAMA
 * (`drainAndExit` → `flushNow` → `process.exit`), sehingga drain terakhir
 * benar-benar diuji saat server dimatikan secara normal.
 *
 * HANYA aktif di development (NODE_ENV !== "production"); di produksi
 * selalu 403. Tidak ada token — bind localhost + guard NODE_ENV dianggap
 * cukup untuk proses pengembangan lokal.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, message: "Nonaktif di produksi" },
      { status: 403 }
    );
  }
  console.log("[dev] /api/dev/shutdown: shutdown graceful diminta");
  // Beri waktu response 200 terkirim dulu, BARU drain lalu exit — kalau
  // drainAndExit dipanggil sinkron, `process.exit` bisa memotong response
  // di tengah (fetch stop script dapat connection reset padahal drain sudah
  // berjalan). Stop script memantau PID, bukan response.
  setTimeout(() => drainAndExit(), 300);
  return NextResponse.json({ ok: true, message: "Shutdown graceful dimulai" });
}
