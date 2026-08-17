import { NextResponse } from "next/server";
import { readdir } from "node:fs/promises";
import path from "node:path";
import {
  ensureHydrated,
  getPersistQueueInfo,
  getStoreMode,
} from "@/lib/db";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic"; // health harus real-time, jangan di-cache

interface PingResult {
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
}

/**
 * Ping Postgres lewat round-trip PostgREST sungguhan (SELECT limit 1 ke
 * `app_settings` — migration 0009). Ini memvalidasi seluruh tumpukan
 * Kong → PostgREST → PostgreSQL, bukan sekadar port terbuka.
 */
async function pingPostgres(): Promise<PingResult> {
  const sb = getSupabaseAdmin();
  if (!sb) {
    return {
      ok: false,
      latencyMs: null,
      error: "Supabase tidak dikonfigurasi (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    };
  }
  const t0 = Date.now();
  try {
    const { error } = await sb.from("app_settings").select("key").limit(1);
    return { ok: !error, latencyMs: Date.now() - t0, error: error ? error.message : null };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Versi migration terakhir dari folder supabase/migrations (diurutkan). */
async function readMigrations(): Promise<{
  last: string | null;
  count: number;
  error: string | null;
}> {
  try {
    const dir = path.join(process.cwd(), "supabase", "migrations");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    return {
      last: files.length > 0 ? files[files.length - 1] : null,
      count: files.length,
      error: null,
    };
  } catch (e) {
    // Folder tidak ada di runtime (mis. deploy tanpa supabase/migrations) —
    // laporkan, jangan menggagalkan health.
    return {
      last: null,
      count: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * GET /api/health — status operasional:
 * - supabase: konfigurasi + ping Postgres (ok / latency / error);
 * - migrations: versi migration terakhir + jumlah file;
 * - persist: antrean tulis (storeMode, batch pending, koleksi menunggu,
 *   drain shutdown terdaftar?, waktu & durasi flush terakhir) — untuk
 *   memantau drain saat shutdown agar tidak ada snapshot yang hilang.
 *
 * HTTP 200 bila sehat; 503 bila Supabase dikonfigurasi tapi ping gagal
 * (degradasi nyata). Mode demo (tanpa env) tetap 200 dengan status jelas.
 */
export async function GET() {
  const [postgres, migrations] = await Promise.all([
    pingPostgres(),
    readMigrations(),
  ]);

  // Inisialisasi store dulu agar storeMode mencerminkan keadaan nyata
  // (fallback ke demo bila Supabase tidak terjangkau).
  await ensureHydrated();
  const persist = getPersistQueueInfo();

  const configured = isSupabaseConfigured();
  const healthy = !configured || postgres.ok;
  const status = !configured
    ? "demo"
    : postgres.ok
      ? "healthy"
      : "degraded";

  const storeMode = getStoreMode();
  const body = {
    ok: healthy,
    status,
    timestamp: new Date().toISOString(),
    storeMode,
    // Ringkasan mode demo untuk observability cepat: "demo JSON — N tulis
    // sejak start" (jumlah tulis file data/db.json seumur proses).
    ...(storeMode === "json"
      ? { demo: { file: "data/db.json", jsonWrites: persist.jsonWriteCount } }
      : {}),
    supabase: {
      configured,
      postgres,
    },
    migrations,
    persist,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
