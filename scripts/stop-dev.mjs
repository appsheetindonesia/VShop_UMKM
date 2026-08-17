#!/usr/bin/env node
/**
 * `npm run stop:dev` — hentikan dev server (next dev) secara GRACEFUL,
 * TANPA taskkill /F, sehingga drain terakhir `registerShutdownFlush`
 * benar-benar dijalankan saat pengembang mematikan server secara normal.
 *
 * Cara kerja:
 * 1. Temukan proses next-server yang asli (node .../next/dist/server/...)
 *    dan port-nya dari command line next CLI (`-p <port>` / `--port`).
 * 2. POSIX:  kirim SIGTERM → handler `registerShutdownFlush` menjalankan
 *    `flushNow` lalu `process.exit(0)`.
 *    Windows: SIGTERM tidak bisa ditangkap oleh proses Node yang detached
 *    (libuv = TerminateProcess; sudah diverifikasi eksperimen) — jadi
 *    panggil `POST /api/dev/shutdown` yang mengeksekusi jalur drain yang
 *    SAMA (`drainAndExit`), lalu proses keluar sendiri.
 * 3. Tunggu proses benar-benar keluar (grace period); bila masih hidup,
 *    hentikan paksa SELURUH pohon proses (npm/cmd/CLI/server) sebagai
 *    langkah terakhir, dengan peringatan.
 *
 * Tanpa argumen. PID hint opsional: `node scripts/stop-dev.mjs <pid>`
 * (pid dari `.freebuff/preview.pid`) — kalau diberikan, dipakai sebagai
 * akar pohon proses bila pencarian otomatis gagal.
 */
import { execFileSync } from "node:child_process";

const isWin = process.platform === "win32";
const GRACE_MS = 15_000;
const POLL_MS = 300;

// ---------- Daftar proses ----------

function psList() {
  if (isWin) {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|cmd' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }
    );
    const arr = JSON.parse(out.trim() || "[]");
    return (Array.isArray(arr) ? arr : [arr]).map((p) => ({
      pid: Number(p.ProcessId),
      ppid: Number(p.ParentProcessId),
      name: String(p.Name),
      cmd: String(p.CommandLine ?? ""),
    }));
  }
  const out = execFileSync("ps", ["-eo", "pid=,ppid=,comm=,args="], {
    encoding: "utf8",
  });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
      return m
        ? { pid: +m[1], ppid: +m[2], name: m[3], cmd: m[4] }
        : null;
    })
    .filter(Boolean);
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killForce(pid) {
  try {
    if (isWin) {
      execFileSync("taskkill", ["/F", "/PID", String(pid), "/T"], {
        stdio: "ignore",
      });
    } else {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    /* sudah mati */
  }
}

// ---------- Pencarian proses dev server ----------

/** Proses next-server asli: node .../next/dist/server/... (pemilik persist queue). */
function findServer(procs) {
  return procs.find((p) => /next[\\/]dist[\\/]server/i.test(p.cmd)) ?? null;
}

/** Port dari command line next CLI: `-p 55951` / `--port 55951`. */
function findPort(procs) {
  for (const p of procs) {
    const m = p.cmd.match(/(?:^|\s)(?:-p|--port)\s+(\d{2,5})/);
    if (m) return Number(m[1]);
  }
  return 3000;
}

/** Akar pohon proses (pid + semua nenek moyang + semua keturunan). */
function buildTree(procs, rootPid) {
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const tree = new Set();
  const addUp = (pid) => {
    let cur = pid;
    let guard = 0;
    while (cur && guard++ < 20) {
      tree.add(cur);
      cur = byPid.get(cur)?.ppid ?? 0;
    }
  };
  const addDown = (pid) => {
    for (const p of procs) {
      if (p.ppid === pid && !tree.has(p.pid)) {
        tree.add(p.pid);
        addDown(p.pid);
      }
    }
  };
  addUp(rootPid);
  addDown(rootPid);
  return [...tree];
}

// ---------- Alur ----------

function log(msg) {
  console.log(`[stop:dev] ${msg}`);
}

async function main() {
  const hintPid = Number(process.argv[2] ?? 0) || null;
  let procs;
  try {
    procs = psList();
  } catch (e) {
    console.error(`[stop:dev] Gagal membaca daftar proses: ${e.message}`);
    process.exit(1);
  }

  let server = findServer(procs);
  // Fallback: pid hint dari .freebuff/preview.pid — cari server di pohonnya.
  if (!server && hintPid) {
    const tree = new Set(buildTree(procs, hintPid));
    server = procs.find((p) => tree.has(p.pid) && /next/i.test(p.cmd)) ?? null;
  }
  if (!server) {
    console.error(
      "[stop:dev] Tidak menemukan proses next-server yang berjalan.\n" +
        "  Pastikan server dev berjalan (npm run dev), atau berikan PID: node scripts/stop-dev.mjs <pid>"
    );
    process.exit(1);
  }

  const port = findPort(procs);
  const serverPid = server.pid;
  log(`next-server ditemukan: PID ${serverPid} (port ${port})`);

  if (!isWin) {
    // POSIX: SIGTERM asli → handler registerShutdownFlush menjalankan drain.
    try {
      process.kill(serverPid, "SIGTERM");
      log(`SIGTERM terkirim ke ${serverPid} — drain terakhir (flushNow) dijalankan sebelum exit.`);
    } catch (e) {
      log(`SIGTERM gagal: ${e.message}`);
    }
  } else {
    // Windows: SIGTERM tidak bisa ditangkap proses detached → minta server
    // menjalankan jalur drain yang SAMA lewat endpoint dev.
    const url = `http://127.0.0.1:${port}/api/dev/shutdown`;
    try {
      const res = await fetch(url, { method: "POST", signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        log(`POST ${url} → drain dijalankan di dalam server (flushNow lalu exit).`);
      } else {
        log(`POST ${url} → HTTP ${res.status} (${(await res.text().catch(() => "")) || ""})`);
        log("  Endpoint dev tidak tersedia (kode lama?) — tunggu grace, lalu paksa.");
      }
    } catch (e) {
      // Response boleh terpotong: process.exit di server bisa mendahului
      // penulisan response padahal drain SUDAH berjalan — itu bukan kegagalan.
      log(`POST ${url} tidak mendapat response (${e.message}) — server sedang drain & exit sendiri.`);
    }
  }

  // Tunggu keluar graceful (drain ≤ DB_FLUSH_MAX_WAIT_MS + margin). JANGAN
  // paksa hentikan di tengah grace walau fetch gagal — drain butuh waktu.
  const deadline = Date.now() + GRACE_MS;
  while (isAlive(serverPid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  if (!isAlive(serverPid)) {
    log(`Server keluar dengan graceful (PID ${serverPid}).`);
    return;
  }
  log(`PID ${serverPid} masih hidup setelah ${GRACE_MS}ms — hentikan paksa pohon proses.`);
  fallbackForce(procs, serverPid, hintPid);
}

function fallbackForce(procs, serverPid, hintPid) {
  const tree = buildTree(procs, serverPid);
  if (hintPid) for (const p of buildTree(procs, hintPid)) tree.add(p);
  for (const pid of tree) {
    if (isAlive(pid)) {
      log(`  paksa hentikan PID ${pid}`);
      killForce(pid);
    }
  }
  log("Catatan: penghentian paksa TIDAK menjalankan drain (sama seperti taskkill /F).");
}

await main();
