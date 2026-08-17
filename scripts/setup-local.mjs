#!/usr/bin/env node
/**
 * setup-local.mjs — setup Supabase LOKAL sekali perintah.
 *
 *   node scripts/setup-local.mjs            # semua langkah
 *   node scripts/setup-local.mjs --reset    # + supabase db reset (migration + seed.sql dari nol)
 *   node scripts/setup-local.mjs --no-seed  # lewati seed data demo (dan verifikasi keamanan)
 *   node scripts/setup-local.mjs --no-rls   # lewati verifikasi keamanan e2e-rls
 *   node scripts/setup-local.mjs --skip-start  # stack sudah jalan; hanya baca kredensial + tulis .env.local
 *
 * Yang dilakukan secara otomatis:
 *   1. Cek Docker daemon (dan tambahkan bin Docker Desktop ke PATH bila
 *      belum ada — supabase CLI memanggil binary `docker`).
 *   2. `supabase start` (pull image saat pertama kali; idempotent — bila
 *      stack sudah jalan, langsung lanjut).
 *   3. Baca kredensial lokal dari `supabase status -o env`.
 *   4. Tulis `.env.local` (MERGE — kunci lain seperti MIDTRANS / WHATSAPP
 *      yang sudah Anda isi TIDAK diubah; SESSION_ENCRYPTION_KEY digenerate
 *      bila belum ada).
 *   5. Seed data demo (`scripts/seed-supabase.mjs`).
 *   6. Verifikasi keamanan `scripts/e2e-rls.mjs` (RLS + Storage + Auth phone)
 *      — otomatis setiap setup; lewati dengan `--no-rls`.
 *
 * Butuh Docker berjalan; tanpa Docker, keluar dengan pesan jelas.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const args = process.argv.slice(2);
const FLAGS = {
  reset: args.includes("--reset"),
  noSeed: args.includes("--no-seed"),
  noRls: args.includes("--no-rls"),
  skipStart: args.includes("--skip-start"),
};

const ROOT = process.cwd();
const ENV_FILE = path.join(ROOT, ".env.local");
const CONFIG_TOML = path.join(ROOT, "supabase", "config.toml");
const SEED_SCRIPT = path.join(ROOT, "scripts", "seed-supabase.mjs");
const RLS_SCRIPT = path.join(ROOT, "scripts", "e2e-rls.mjs");

const SH = process.platform === "win32"; // npm/npx.cmd butuh shell di Windows
const SEP = process.platform === "win32" ? ";" : ":";

// Lokasi umum binary Docker Desktop bila belum ada di PATH.
const DOCKER_BIN_DIRS = {
  win32: ["C:\\Program Files\\Docker\\Docker\\resources\\bin"],
  darwin: ["/Applications/Docker.app/Contents/Resources/bin"],
  linux: [],
}[process.platform] ?? [];

const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => console.warn(`  ! ${msg}`);
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

/** PATH yang memastikan binary Docker bisa ditemukan (prepend dir Docker Desktop). */
function dockerPath() {
  const extra = DOCKER_BIN_DIRS.filter((d) => fs.existsSync(d));
  return extra.length ? `${extra.join(SEP)}${SEP}${process.env.PATH ?? ""}` : (process.env.PATH ?? "");
}

/** Jalankan perintah; `capture` → kembalikan stdout+stderr, selain itu inherit ke terminal. */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, {
      shell: SH,
      stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...(opts.env ?? {}), PATH: dockerPath() },
    });
    let out = "";
    if (opts.capture) {
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
    }
    child.on("error", (err) => resolve({ code: -1, out: String(err) }));
    child.on("close", (code) => resolve({ code, out }));
  });
}

/** `npx --yes supabase <args>` — tanpa install global, binary otomatis diunduh. */
const supabase = (supabaseArgs, opts = {}) => run("npx", ["--yes", "supabase", ...supabaseArgs], opts);

// ==================== 1. Docker ====================
async function checkDocker() {
  console.log("1/6 Memeriksa Docker…");
  const { code, out } = await run("docker", ["version", "--format", "{{.Server.Version}}"], { capture: true });
  if (code === 0) {
    ok(`Docker engine siap (server v${out.trim()})`);
    return;
  }
  if (process.platform === "win32" || process.platform === "darwin") {
    console.error("✗ Docker daemon tidak terjangkau.");
    console.error(
      "  Pastikan Docker Desktop sudah DIBUKA dan engine-nya hijau (indikator di\n" +
        "  system tray). Di Windows, instalasi pertama biasanya perlu satu kali\n" +
        "  restart Windows agar virtualisasi aktif."
    );
  } else {
    console.error("✗ Docker daemon tidak terjangkau — pastikan Docker Engine berjalan (`sudo systemctl start docker`).");
  }
  process.exit(1);
}

// ==================== 2. supabase start ====================
async function startStack() {
  if (FLAGS.skipStart) {
    console.log("2/6 (--skip-start) Melewati `supabase start`…");
    return;
  }
  console.log("2/6 Menjalankan `supabase start` (pertama kali mengunduh image — bisa beberapa menit)…");
  const { code } = await supabase(["start"]);
  if (code !== 0) {
    fail(
      "`supabase start` gagal. Lihat log di atas. Kemungkinan: image belum bisa diunduh " +
        "(butuh koneksi internet) atau migration supabase/migrations/ bermasalah."
    );
  }
  ok("Stack Supabase lokal aktif (Postgres + Auth + PostgREST + Storage + Studio)");
}

// ==================== 3. Kredensial ====================
async function readCredentials() {
  console.log("3/6 Membaca kredensial dari `supabase status -o env`…");
  const { code, out } = await supabase(["status", "-o", "env"], { capture: true });
  if (code !== 0) {
    fail(`\`supabase status\` gagal:\n${out.slice(-500)}`);
  }
  const env = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/);
    if (m && m[1] !== "PATH") env[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  const creds = {
    NEXT_PUBLIC_SUPABASE_URL: env.API_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    SUPABASE_SERVICE_ROLE_KEY: env.SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  };
  if (!creds.NEXT_PUBLIC_SUPABASE_URL || !creds.ANON && !creds.NEXT_PUBLIC_SUPABASE_ANON_KEY || !creds.SUPABASE_SERVICE_ROLE_KEY) {
    fail(`Kredensial tidak lengkap dari supabase status. Output mentah:\n${out.slice(0, 600)}`);
  }
  return { env, creds };
}

// ==================== 4. .env.local (merge) ====================
function readEnvLines() {
  if (!fs.existsSync(ENV_FILE)) return [];
  return fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/);
}

function writeEnvLocal(creds) {
  console.log("4/6 Menulis .env.local (merge — kunci lain dipertahankan)…");
  const lines = readEnvLines();
  const updates = {
    NEXT_PUBLIC_SUPABASE_URL: creds.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: creds.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: creds.SUPABASE_SERVICE_ROLE_KEY,
  };

  // SESSION_ENCRYPTION_KEY: pertahankan bila sudah ada, generate bila belum.
  const hasSessionKey = lines.some((l) => /^\s*(?:export\s+)?SESSION_ENCRYPTION_KEY=/.test(l));
  if (!hasSessionKey) {
    updates.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    ok("SESSION_ENCRYPTION_KEY digenerate (AES-256-GCM untuk refresh token)");
  }

  const written = new Set();
  const out = [];
  let headerAdded = false;
  for (const line of lines) {
    const m = line.match(/^\s*(export\s+)?([A-Z0-9_]+)=.*$/);
    if (m && m[2] in updates) {
      if (!headerAdded && out.length > 0) out.push(""); // jeda sebelum blok kredensial
      headerAdded = true;
      out.push(`${m[1] ?? ""}${m[2]}=${updates[m[2]]}`);
      written.add(m[2]);
    } else {
      out.push(line);
    }
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!written.has(k)) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV_FILE, out.join("\n") + "\n", "utf8");
  ok(`.env.local ditulis (${Object.keys(updates).length} kunci dikelola)`);
}

// ==================== 5. Seed ====================
async function seed(creds) {
  if (FLAGS.noSeed) {
    console.log("5/6 (--no-seed) Melewati seed data demo.");
    return;
  }
  console.log("5/6 Menjalankan seed data demo…");
  const { code } = await run("node", [SEED_SCRIPT], {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: creds.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: creds.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (code !== 0) fail("Seed data demo gagal — lihat log di atas.");
  ok("Seed data demo selesai");
}

// ==================== 6. Verifikasi keamanan (e2e-rls) ====================
async function runRls(creds) {
  if (FLAGS.noRls) {
    console.log("6/6 (--no-rls) Melewati verifikasi keamanan.");
    return;
  }
  if (FLAGS.noSeed) {
    console.log("6/6 (--no-seed) Melewati verifikasi keamanan (butuh user demo dari seed).");
    return;
  }
  console.log("6/6 Verifikasi keamanan (RLS + Storage + Auth phone — scripts/e2e-rls.mjs)…");
  const { code } = await run("node", [RLS_SCRIPT], {
    env: {
      NEXT_PUBLIC_SUPABASE_URL: creds.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: creds.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: creds.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  if (code !== 0) {
    fail(
      "Verifikasi keamanan GAGAL — perbaiki policy/ekspektasi lalu jalankan ulang\n" +
        "  `node scripts/e2e-rls.mjs` (atau lewati sementara dengan `--no-rls`)."
    );
  }
  ok("Verifikasi keamanan lolos (RLS + Storage + Auth phone)");
}

// ==================== Main ====================
function hintConfigToml() {
  try {
    const cfg = fs.readFileSync(CONFIG_TOML, "utf8");
    const hasTestOtp = /^\s*\[auth\.sms\.test_otp\]\s*$/m.test(cfg);
    const smsSignup = /\[auth\.sms\]\s*[\s\S]*?enable_signup\s*=\s*true/.test(cfg);
    if (!hasTestOtp) warn("config.toml belum punya [auth.sms.test_otp] — OTP WhatsApp lokal tidak bisa diuji.");
    if (!smsSignup) warn("config.toml: [auth.sms] enable_signup = false — daftar nomor baru via OTP akan ditolak.");
  } catch {
    // abaikan bila config tidak ada
  }
}

console.log("▶ Setup Supabase lokal (V Shop)\n");
await checkDocker();
await startStack();

if (FLAGS.reset) {
  console.log("\n(--reset) Menjalankan `supabase db reset` — migration + seed.sql dari nol…");
  const { code } = await supabase(["db", "reset"]);
  if (code !== 0) fail("`supabase db reset` gagal — lihat log di atas.");
  ok("Database di-reset (migration + seed.sql diterapkan)");
}

const { creds } = await readCredentials();
writeEnvLocal(creds);
await seed(creds);
hintConfigToml();
await runRls(creds);

console.log(`
=== Setup selesai ✅ ===
  API URL   : ${creds.NEXT_PUBLIC_SUPABASE_URL}
  Studio    : http://127.0.0.1:54323
  Postgres  : postgresql://postgres:postgres@127.0.0.1:54322/postgres
  anon key  : ${creds.NEXT_PUBLIC_SUPABASE_ANON_KEY.slice(0, 20)}… (tersimpan di .env.local)
  service   : ${creds.SUPABASE_SERVICE_ROLE_KEY.slice(0, 20)}… (tersimpan di .env.local)
  keamanan  : RLS + Storage + Auth phone terverifikasi (scripts/e2e-rls.mjs)

Langkah berikutnya:
  npm run dev          # jalankan aplikasi — log [db] menandakan mode Supabase aktif
  # Akun demo: admin@vshop.id/admin123 · customer@vshop.id/customer123 · merchant@vshop.id/merchant123
  # OTP test (config.toml): 081234567890 → 123456 · 081298765432 → 654321
  # Verifikasi ulang keamanan kapan saja: npm run db:rls
`);
