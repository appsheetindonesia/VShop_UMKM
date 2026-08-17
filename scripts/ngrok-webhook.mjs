#!/usr/bin/env node
/**
 * `npm run webhook:ngrok` — jalankan ngrok ke dev server lokal agar webhook
 * Midtrans (`POST /api/midtrans/notification`) bisa menjangkau aplikasi
 * selama pengembangan lokal (localhost tidak bisa diakses dari internet).
 *
 * Alur:
 * 1. Deteksi port dev server: `--port <n>` > proses next dev yang berjalan
 *    (`-p <port>` di command line) > `APP_URL` di `.env.local` > 3000.
 * 2. Jalankan `ngrok http <port>` (biner dari `NGROK_BIN` env / PATH).
 * 3. Tunggu tunnel aktif (baca API lokal ngrok `127.0.0.1:4040`).
 * 4. Verifikasi tunnel menjangkau aplikasi (`GET /api/health`).
 * 5. Cetak URL webhook + langkah menempelnya ke Payment Notification URL
 *    di dashboard Midtrans. Tunnel tetap hidup sampai Ctrl+C.
 *
 * Prasyarat: ngrok ter-install (https://ngrok.com/download) dan sudah
 * login (`ngrok config add-authtoken <TOKEN>` — wajib di ngrok v3+).
 *
 * Contoh:
 *   node scripts/ngrok-webhook.mjs                  # port otomatis
 *   node scripts/ngrok-webhook.mjs --port 55951
 *   node scripts/ngrok-webhook.mjs --region ap-southeast-1
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
// existsSync dipakai findPortFromEnvFile; readFileSync membaca .env.local.
import { join } from "node:path";

const isWin = process.platform === "win32";
const NGROK_API = "http://127.0.0.1:4040/api/tunnels";

// ---------- Argumen ----------

function parseArgs(argv) {
  const args = { port: null, region: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--port" && argv[i + 1]) args.port = Number(argv[i + 1]) || null;
    if (argv[i] === "--region" && argv[i + 1]) args.region = argv[i + 1];
  }
  return args;
}

// ---------- Deteksi port dev server ----------

/** Daftar proses (Windows via PowerShell, POSIX via ps) — pola stop-dev.mjs. */
function psList() {
  if (isWin) {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|cmd' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
    const arr = JSON.parse(out.trim() || "[]");
    return (Array.isArray(arr) ? arr : [arr]).map((p) => String(p.CommandLine ?? ""));
  }
  const out = execFileSync("ps", ["-eo", "args="], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

/** Port dari command line next dev (`-p <port>` / `--port <port>`). */
function findRunningNextPort() {
  try {
    const cmds = psList();
    for (const cmd of cmds) {
      const m = cmd.match(/(?:^|\s)(?:-p|--port)\s+(\d{2,5})/);
      if (m && /next/i.test(cmd)) return Number(m[1]);
    }
  } catch {
    /* proses tidak bisa dibaca — lanjut ke fallback */
  }
  return null;
}

/** Port dari APP_URL di .env.local (bila ada). */
function findPortFromEnvFile() {
  const envPath = join(process.cwd(), ".env.local");
  if (!existsSync(envPath)) return null;
  try {
    const m = readFileSync(envPath, "utf8").match(/^APP_URL=https?:\/\/[^:]+:(\d{2,5})/m);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

function detectPort(explicit) {
  if (explicit) return explicit;
  const fromProc = findRunningNextPort();
  if (fromProc) return fromProc;
  const fromEnv = findPortFromEnvFile();
  if (fromEnv) return fromEnv;
  return 3000;
}

// ---------- ngrok ----------

function ngrokBin() {
  const override = process.env.NGROK_BIN;
  if (override) return override;
  // Windows: `ngrok` di PATH sudah cukup (ngrok.exe); cek via `where`.
  return "ngrok";
}

function ngrokAvailable(bin) {
  // Override eksplisit (NGROK_BIN): bisa jalur penuh atau perintah —
  // percaya; error spawn akan muncul di log. `which/where` hanya untuk
  // resolusi default dari PATH.
  if (process.env.NGROK_BIN) return true;
  try {
    execFileSync(isWin ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Baca URL publik dari API lokal ngrok (127.0.0.1:4040). */
async function fetchPublicUrl(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        const data = await res.json();
        const tunnel = (data.tunnels ?? []).find(
          (t) => t.public_url && t.public_url.startsWith("https://")
        );
        if (tunnel) return tunnel.public_url;
      }
    } catch (e) {
      lastErr = e;
    }
    await sleep(500);
  }
  throw new Error(
    `Tunnel tidak aktif dalam ${timeoutMs / 1000}s` +
      (lastErr ? ` (${lastErr.message})` : "") +
      " — pastikan ngrok masih berjalan (lihat log di atas)."
  );
}

function printMidtransSteps(publicUrl) {
  const webhookUrl = `${publicUrl}/api/midtrans/notification`;
  const box = (s) => s.split("\n").forEach((line) => console.log(`  ${line}`));

  console.log("\n" + "=".repeat(68));
  console.log("  LANGSUNG TEMPEL KE MIDTRANS (Payment Notification URL)");
  console.log("=".repeat(68));
  console.log(`  🌐 Webhook URL : ${webhookUrl}`);
  console.log("\n  Sandbox — https://dashboard.sandbox.midtrans.com → Settings → Configuration:");
  box(`1. Payment Notification URL  → ${webhookUrl}
2. (opsional) Finish Redirect URL → ${publicUrl}/sukses?order=ORDER_ID
3. (opsional) Unfinish Redirect URL → ${publicUrl}/bayar/ORDER_ID
4. (opsional) Error Redirect URL  → ${publicUrl}/bayar/gagal?order=ORDER_ID&reason=failed
5. Simpan (Save).
   (URL redirect memakai ORDER_ID — Midtrans menggantinya otomatis;
    aplikasi mengenali order via ?order= query, cocok dengan /sukses.)`);
  console.log("\n  Verifikasi:");
  box(`• Buka ${publicUrl}/api/health — harus 200 (tunnel → aplikasi OK).
• Jalankan pembayaran sandbox → Midtrans mengirim POST
  ${webhookUrl} → cek metadata.paymentAudit order
  (timeline di /transaksi/[orderId]) & log notifikasi /admin/notifikasi.
• Uji otomatis: npm run db:webhook (simulasi notifikasi signature asli).`);
  console.log("\n  Catatan:");
  box(`• Tunnel (subdomain ngrok) BERUBAH tiap restart pada paket gratis —
  perbarui Payment Notification URL setelah menjalankan ulang script.
• Laman peringatan ngrok gratis (browser interstitial) tidak memengaruhi
  webhook server-to-server — notifikasi tetap terkirim ke endpoint.
• Webhook memakai signature SHA-512 (order_id+status_code+gross_amount+
  ServerKey) — signature palsu ditolak 403 (teruji unit).`);
  console.log("=".repeat(68));
}

// ---------- Alur utama ----------

function log(msg) {
  console.log(`[ngrok] ${msg}`);
}

async function main() {
  const { port: portArg, region } = parseArgs(process.argv.slice(2));
  const port = detectPort(portArg);
  log(`Dev server port: ${port}${portArg ? " (dari --port)" : " (terdeteksi)"}`);

  const bin = ngrokBin();
  if (!ngrokAvailable(bin)) {
    console.error(`\n[ngrok] Biner "${bin}" tidak ditemukan.`);
    console.error("  Install ngrok dulu:");
    console.error("    Windows : winget install ngrok   (atau https://ngrok.com/download)");
    console.error("    macOS   : brew install ngrok");
    console.error("    Linux   : curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null && echo \"deb https://ngrok-agent.s3.amazonaws.com buster main\" | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok");
    console.error("  Lalu login: ngrok config add-authtoken <TOKEN>  (token di dashboard.ngrok.com)");
    console.error("  (Override biner: atur env NGROK_BIN=/path/ke/ngrok)");
    process.exitCode = 1;
    return;
  }
  log(`Biner ngrok: ${bin}`);

  // Pastikan server dev lokal hidup sebelum tunnel dibuat.
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    log(`Dev server lokal OK (HTTP ${res.status} di :${port}).`);
  } catch {
    log(`Peringatan: /api/health di :${port} tidak merespons — pastikan 'npm run dev -p ${port}' berjalan.`);
  }

  if (region && !/^[a-zA-Z0-9-]+$/.test(region)) {
    console.error(`[ngrok] Region tidak valid: "${region}"`);
    process.exitCode = 1;
    return;
  }
  const args = ["http", String(port)];
  if (region) args.push("--region", region);
  log(`Jalankan: ${bin} ${args.join(" ")}`);
  // NGROK_BIN bisa menunjuk ke .cmd/.bat (Windows) — spawn butuh shell utk itu.
  const needsShell = isWin && /\.(?:cmd|bat)$/i.test(bin);
  let shuttingDown = false;
  const child = spawn(bin, args, { stdio: "inherit", shell: needsShell });
  child.on("exit", (code) => {
    // Kode non-0 hanya mencurigakan bila BUKAN kita yang menghentikannya.
    if (code && code !== 0 && !shuttingDown) {
      console.error(`\n[ngrok] Proses keluar dengan kode ${code} — cek authtoken (ngrok config add-authtoken).`);
    }
  });

  let publicUrl;
  try {
    publicUrl = await fetchPublicUrl();
  } catch (e) {
    console.error(`\n[ngrok] ${e.message}`);
    child.kill();
    process.exitCode = 1;
    return;
  }

  log(`Tunnel aktif: ${publicUrl}`);
  log(`Webhook URL : ${publicUrl}/api/midtrans/notification`);

  // Verifikasi reachability end-to-end lewat tunnel.
  try {
    const res = await fetch(`${publicUrl}/api/health`, { signal: AbortSignal.timeout(8_000) });
    log(`Verifikasi tunnel → aplikasi: GET ${publicUrl}/api/health = HTTP ${res.status}`);
    if (res.status !== 200) {
      log("  Perhatian: health bukan 200 — cek log server dev di atas.");
    }
  } catch (e) {
    log(`Verifikasi tunnel gagal (${e.message}) — cek log server dev.`);
  }

  printMidtransSteps(publicUrl);

  console.log(`\n[ngrok] Tunnel berjalan. Dashboard lokal: http://127.0.0.1:4040`);
  console.log(`[ngrok] Tekan Ctrl+C untuk menghentikan tunnel & keluar.\n`);

  // Tetap hidup sampai Ctrl+C; bersihkan anak ngrok saat keluar.
  const shutdown = () => {
    shuttingDown = true;
    log("Menghentikan tunnel ngrok...");
    child.kill();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (isWin) {
    process.on("SIGBREAK", shutdown);
  }
}

await main();
