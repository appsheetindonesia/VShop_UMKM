#!/usr/bin/env node
/**
 * E2E POPUP onError SNAP.JS (stub lokal) — verifikasi overlay + metadata order.
 *
 * Alur:
 *   1. Spawn `scripts/snap-error-stub.mjs` (port 54400) — API Midtrans tiruan
 *      + snap.js lokal yang MEMICU `onError({ status_code: "216", … })`.
 *   2. Spawn dev server BARU di port 55952 dengan env:
 *        MIDTRANS_SERVER_KEY=SB-Mid-server-snapstub
 *        MIDTRANS_CLIENT_KEY=SB-Mid-client-snapstub
 *        MIDTRANS_API_BASE=http://127.0.0.1:54400
 *        MIDTRANS_SNAP_SCRIPT_URL=http://127.0.0.1:54400/snap.js
 *   3. Login pelanggan demo (API) → checkout → order (token asli-tiruan).
 *   4. Chrome (CDP mentah via WebSocket Node, tanpa agent-browser CLI): login
 *      via UI → buka /bayar/[orderId] → stub snap.js memicu onError → overlay
 *      muncul.
 *   5. Verifikasi OVERLAY (dialog "Pembayaran Gagal" + alasan + kode) dan
 *      METADATA order di Postgres (snapCallbacks error + paymentAudit failed
 *      + failureReason spesifik).
 *   6. KLIK "Coba Lagi" DI POPUP → retry API → re-embed token baru tanpa
 *      keluar halaman → popup muncul lagi (onError kedua) → nomor order baru
 *      + event retry di paymentAudit.
 *   7. Bersihkan: browser, dev server, stub, order & log uji.
 *
 * Prasyarat: Supabase lokal up + ter-seed (customer@vshop.id / customer123),
 * Chrome ter-install, port 55952/54400 kosong.
 *
 * Jalankan:  npm run test:e2e-snap-error   (atau: node scripts/e2e-snap-error.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

// ---------- Muat .env.local / .env ----------
for (const file of [".env.local", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        let v = m[2].replace(/\s+#.*$/, "").trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* file tidak ada */ }
}

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) {
  console.error("✗ Supabase lokal belum dikonfigurasi. Jalankan npm run db:setup dulu.");
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY);

const STUB_PORT = 54400;
const APP_PORT = 55952;
const APP_URL = `http://localhost:${APP_PORT}`;
const STUB_URL = `http://127.0.0.1:${STUB_PORT}`;
// Port CDP + profil Chrome UNIK per run → setiap run mulai dari browser
// bersih (tanpa cookie sisa dari run sebelumnya) sehingga login benar-benar
// diuji, dan tidak bentrok dengan chrome lain di port tetap.
const CDP_PORT = 9400 + Math.floor(Math.random() * 90);
const CHROME_PROFILE = path.join(process.env.TEMP ?? "/tmp", `ab-snap-error-${Date.now()}`);
const STATUS_CODE = "216";
const EXPECTED_REASON = "Saldo tidak mencukupi (QRIS)";

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label} ${extra}`); }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- spawn helpers ----------
const children = [];
function spawnDetached(cmd, args, env, logFile) {
  const log = fs.openSync(logFile, "a");
  const child = spawn(cmd, args, { env, stdio: ["ignore", log, log], windowsHide: true });
  child.on("error", (e) => {
    console.error(`  ✗ spawn ${cmd} error: ${e.message}`);
    try { fs.appendFileSync(logFile, `\n[spawn error] ${e.message}\n`); } catch { /* ignore */ }
  });
  children.push(child);
  return child;
}
async function waitHttp(url, timeoutMs = 150_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await sleep(2500);
  }
  return false;
}
async function waitPort(port, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/snap.js`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* belum siap */ }
    await sleep(500);
  }
  return false;
}

// ---------- Browser (CDP langsung — tanpa agent-browser CLI) ----------
// agent-browser `connect` intermitten hang di mesin ini; browser di-drive
// via protokol CDP mentah (WebSocket bawaan Node 22). Port & profil unik
// per run → browser selalu bersih, tanpa cookie sisa dari run sebelumnya.
let chromePid = 0;
let pageWs = null;
let cdpId = 0;
const cdpPending = new Map();
const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : null,
].filter(Boolean);

function cdpSend(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++cdpId;
    const t = setTimeout(() => { cdpPending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30_000);
    cdpPending.set(id, (msg) => { clearTimeout(t); msg.error ? reject(new Error(method + ": " + JSON.stringify(msg.error))) : resolve(msg.result); });
    pageWs.send(JSON.stringify({ id, method, params }));
  });
}

async function cdpEval(expression) {
  const r = await cdpSend("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.value;
}

async function ensureBrowser() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("Chrome tidak ditemukan (periksa CHROME_CANDIDATES)");
  const child = spawn(
    exe,
    [
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${CHROME_PROFILE}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true, detached: true }
  );
  chromePid = child.pid;
  child.unref();
  let up = false;
  for (let i = 0; i < 20 && !up; i++) {
    try {
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1500) });
      up = true;
    } catch {
      await sleep(800);
    }
  }
  if (!up) throw new Error("Chrome CDP tidak mau up (port " + CDP_PORT + ")");
  // Ambil target halaman (tab) lalu buka koneksi WebSocket-nya.
  const tabs = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
  const page = tabs.find((t) => t.type === "page") ?? tabs[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("Tidak ada target halaman CDP");
  pageWs = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { pageWs.onopen = res; pageWs.onerror = () => rej(new Error("CDP WebSocket gagal")); });
  pageWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && cdpPending.has(msg.id)) { cdpPending.get(msg.id)(msg); cdpPending.delete(msg.id); }
  };
  await cdpSend("Page.enable");
  await cdpSend("Runtime.enable");
}

async function cdpNav(url) {
  await cdpSend("Page.navigate", { url });
  // Tunggu sampai halaman benar-benar dimuat (readyState complete).
  for (let i = 0; i < 80; i++) {
    await sleep(500);
    try {
      const state = await cdpEval("document.readyState");
      if (state === "complete") return;
    } catch { /* belum siap */ }
  }
}

/** Tunggu dialog `role="dialog"` berjudul "Pembayaran Gagal" MUNCUL (show=true) / HILANG (false). */
async function waitDialog(show, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const text = String(await cdpEval(`(document.querySelector('[role="dialog"]')||{}).innerText || ''`));
      if (/Pembayaran Gagal/.test(text) === show) return true;
    } catch { /* halaman masih sibuk */ }
    await sleep(400);
  }
  return false;
}

// ---------- API helpers ----------
const jarOf = () => ({ cookies: new Map() });
const cookieHeader = (jar) => [...jar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
async function api(urlPath, { method = "GET", body, jar } = {}) {
  const res = await fetch(`${APP_URL}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...(jar ? { Cookie: cookieHeader(jar) } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  for (const sc of res.headers.getSetCookie?.() ?? []) {
    const pair = sc.split(";")[0];
    const eq = pair.indexOf("=");
    if (jar && eq > 0) jar.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, data };
}

// ---------- main ----------
async function main() {
  console.log(`[e2e] App  : ${APP_URL}`);
  console.log(`[e2e] Stub : ${STUB_URL}`);
  let orderId = "";
  let orderNumber = "";

  try {
    // ---------- 0. Preflight: port uji harus kosong (hindari mengetes server basi) ----------
    console.log("\n[0/6] Spawn stub snap.js & dev server (env MIDTRANS_* stub)...");
    for (const [label, port] of [["stub", STUB_PORT], ["app", APP_PORT]]) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200) });
        if (r.ok || r.status !== 502) {
          console.error(`  ✗ Port ${port} (${label}) sudah terpakai — matikan proses basi dulu\n    (taskkill //PID <pid> //T //F) lalu jalankan ulang.`);
          process.exit(2);
        }
      } catch { /* port kosong — lanjut */ }
    }
    spawnDetached(
      process.execPath,
      ["scripts/snap-error-stub.mjs"],
      { ...process.env, SNAP_STUB_PORT: String(STUB_PORT) },
      path.join(process.cwd(), ".freebuff", "snap-stub.log")
    );
    const stubUp = await waitPort(STUB_PORT);
    ok(stubUp, "stub snap.js/API up", "(port 54400)");

    // Spawn Next CLI via node.exe langsung (spawn npm.cmd tanpa shell → EINVAL di Windows).
    spawnDetached(
      process.execPath,
      ["node_modules/next/dist/bin/next", "dev", "-p", String(APP_PORT)],
      {
        ...process.env,
        MIDTRANS_SERVER_KEY: "SB-Mid-server-snapstub",
        MIDTRANS_CLIENT_KEY: "SB-Mid-client-snapstub",
        MIDTRANS_API_BASE: STUB_URL,
        MIDTRANS_SNAP_SCRIPT_URL: `${STUB_URL}/snap.js`,
      },
      path.join(process.cwd(), ".freebuff", "snap-error-server.log")
    );
    const appUp = await waitHttp(APP_URL);
    ok(appUp, "dev server up", `(${APP_URL})`);
    await ensureBrowser();
    ok(true, "Chrome CDP terhubung (port " + CDP_PORT + ")");

    // ---------- 1. Checkout via API (order mode asli) ----------
    console.log("\n[1/6] Login pelanggan demo → checkout paket...");
    const jar = jarOf();
    const login = await api("/api/auth/login", {
      method: "POST",
      body: { identifier: "customer@vshop.id", password: "customer123" },
      jar,
    });
    ok(login.data?.ok, "login customer");
    const co = await api("/api/checkout", { method: "POST", body: { type: "package", packageId: "pkg_7hari" }, jar });
    orderId = co.data?.orderId ?? "";
    ok(Boolean(orderId), "order dibuat (token asli-tiruan)");
    if (!orderId) throw new Error("checkout gagal");

    // ---------- 2. Browser (CDP): login UI + buka halaman bayar ----------
    // Login di-drive via evaluasi (native setter + event) karena klik sintetis
    // tidak memicu React; interaksi eval ini sudah terbukti andal.
    console.log("\n[2/6] Browser (CDP): login via UI → buka /bayar/[orderId]...");
    await cdpNav(`${APP_URL}/masuk/pelanggan`);
    // Tunggu form login ter-render (kompilasi dev pertama bisa lambat).
    let formReady = false;
    for (let i = 0; i < 30 && !formReady; i++) {
      await sleep(1000);
      formReady = Boolean(
        await cdpEval(
          `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Password'); return !!b; })()`
        )
      );
    }
    ok(formReady, "form login tampil (tab Password ada)");
    const tabClicked = Boolean(
      await cdpEval(
        `(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Password'); if (b) b.click(); return !!b; })()`
      )
    );
    ok(tabClicked, "tab Password diklik");
    const submitted = await cdpEval(
      `(() => { const set = (n, v) => { const el = document.querySelector('input[name=' + n + ']'); const p = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; set('identifier', 'customer@vshop.id'); set('password', 'customer123'); document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); return 'submitted'; })()`
    );
    ok(submitted === "submitted", "form login di-submit");
    let loggedIn = false;
    for (let i = 0; i < 15 && !loggedIn; i++) {
      await sleep(700);
      loggedIn = String(await cdpEval("location.pathname")).includes("/beranda");
    }
    ok(loggedIn, "login UI berhasil (redirect /beranda)");

    await cdpNav(`${APP_URL}/bayar/${orderId}`);
    await sleep(4000); // stub memicu onError ~400ms setelah embed

    // ---------- 3. Verifikasi OVERLAY ----------
    console.log("\n[3/6] Verifikasi overlay Pembayaran Gagal...");
    const ov = await cdpEval(
      `({dialog: (document.querySelector('[role="dialog"]')||{}).innerText || null, url: location.href})`
    );
    const overlay = String(ov?.dialog ?? "");
    console.log(`  overlay text: ${overlay.slice(0, 160).replace(/\n/g, " | ")}`);
    ok(/Pembayaran Gagal/.test(overlay), "judul overlay 'Pembayaran Gagal'");
    ok(overlay.includes(EXPECTED_REASON), `alasan spesifik "${EXPECTED_REASON}" di overlay`);
    ok(/Kode 216/.test(overlay), "overlay menampilkan 'Kode 216'");
    // Screenshot via CDP (best-effort).
    try {
      const shot = await cdpSend("Page.captureScreenshot", { format: "png" });
      if (shot?.data) fs.writeFileSync(path.join(process.cwd(), ".freebuff", "snap-error-overlay.png"), Buffer.from(shot.data, "base64"));
    } catch {
      console.log("  (screenshot CDP gagal — dilewati)");
    }

    // ---------- 3b. "Coba Lagi" DI POPUP: retry tanpa keluar halaman ----------
    console.log("\n[3b/6] Tombol 'Coba Lagi' di popup → retry API → re-embed token baru...");
    const firstToken = String(await cdpEval("window.__snapStubToken || ''"));
    ok(Boolean(firstToken), `token embed pertama terekam (${firstToken.slice(0, 20)}...)`);
    const clickedRetry = Boolean(
      await cdpEval(
        `(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find(x => x.textContent.trim() === 'Coba Lagi'); if (b) b.click(); return !!b; })()`
      )
    );
    ok(clickedRetry, "tombol 'Coba Lagi' ada & diklik di popup");
    // 1) Tunggu popup TERTUTUP (retry menyelesaikan → setSnapError(null)).
    const popupClosed = await waitDialog(false);
    ok(popupClosed, "popup tertutup setelah klik Coba Lagi");
    // 2) Re-embed token baru → stub memicu onError kedua → popup muncul lagi.
    const popupBack = await waitDialog(true);
    ok(popupBack, "popup muncul KEMBALI setelah retry (embed ulang + onError kedua)");
    const secondToken = String(await cdpEval("window.__snapStubToken || ''"));
    ok(Boolean(secondToken) && secondToken !== firstToken, "token embed BARU (re-embed in-place)", `(pertama ${firstToken.slice(0, 18)} → kedua ${secondToken.slice(0, 18)})`);
    const popupAgain = String(await cdpEval(`(document.querySelector('[role="dialog"]')||{}).innerText || ''`));
    ok(popupAgain.includes(EXPECTED_REASON), "alasan spesifik tetap tampil di popup kedua");

    // ---------- 4. Verifikasi METADATA di Postgres ----------
    console.log("\n[4/6] Verifikasi metadata order di PostgreSQL...");
    // Tunggu state TERAKHIR di Postgres: order failed LAGI (onError kedua)
    // — write-through db.ts ber-debounce, jadi polling sampai stabil.
    let row = null;
    for (let t = 0; t < 30 && (!row || row.payment_status !== "failed"); t++) {
      const { data } = await sb.from("orders").select("id,order_number,payment_status,status,metadata").eq("id", orderId).maybeSingle();
      row = data ?? null;
      if (!row || row.payment_status !== "failed") await sleep(700);
    }
    ok(Boolean(row) && row.payment_status === "failed", "order ter-flush & kembali failed setelah onError kedua", `(dapat: ${row?.payment_status})`);
    if (row) {
      orderNumber = row.order_number;
      ok(row.payment_status === "failed", "payment_status = failed", `(dapat: ${row.payment_status})`);
      ok(row.metadata?.failureReason === EXPECTED_REASON, `failureReason = "${EXPECTED_REASON}"`, `(dapat: ${row.metadata?.failureReason})`);
      const callbacks = Array.isArray(row.metadata?.snapCallbacks) ? row.metadata.snapCallbacks : [];
      const errCb = callbacks[callbacks.length - 1];
      ok(errCb?.event === "error", "snapCallbacks punya event=error terakhir", `(dapat: ${errCb?.event})`);
      ok(String(errCb?.result?.status_code) === STATUS_CODE, `callback error menyimpan status_code=${STATUS_CODE}`, `(dapat: ${errCb?.result?.status_code})`);
      const audit = Array.isArray(row.metadata?.paymentAudit) ? row.metadata.paymentAudit : [];
      const failEv = audit.find((e) => e.source === "client-fail" && e.event === "failed");
      ok(Boolean(failEv), "paymentAudit memuat event failed (source=client-fail)");
      ok(String(failEv?.statusCode) === STATUS_CODE, `paymentAudit failed menyimpan statusCode=${STATUS_CODE}`);
      const lastEv = audit[audit.length - 1];
      ok(String(lastEv?.statusCode) === STATUS_CODE, `paymentAudit terakhir menyimpan statusCode=${STATUS_CODE}`, `(dapat: ${lastEv?.statusCode})`);
      ok(lastEv?.statusMessage === EXPECTED_REASON, "paymentAudit terakhir menyimpan statusMessage spesifik");
      // ---- Hasil "Coba Lagi": nomor order baru + riwayat + event retry ----
      const retryEv = audit.find((e) => e.source === "retry" && e.event === "retry");
      ok(Boolean(retryEv), "paymentAudit memuat event retry (source=retry)");
      const prevNums = Array.isArray(row.metadata?.previousOrderNumbers)
        ? row.metadata.previousOrderNumbers
        : [];
      ok(prevNums.length >= 1, "previousOrderNumbers menyimpan nomor lama", `(dapat: ${prevNums.join(", ")})`);
      ok(row.order_number !== prevNums[prevNums.length - 1], "order_number sekarang ≠ nomor lama (berubah)");
      ok(row.payment_status === "failed", "setelah onError kedua order kembali failed");
    }

    // ---------- 5. Laporan ----------
    console.log("\n[5/6] Ringkasan:");
    console.log(`  Overlay  : ${APP_URL}/bayar/${orderId}`);
    console.log(`  Screenshot: .freebuff/snap-error-overlay.png`);
    console.log("  Metadata : snapCallbacks error + paymentAudit failed (client-fail) + failureReason spesifik ✓");
    console.log("  Coba Lagi: re-embed token baru + nomor order baru + event retry di audit ✓");
  } finally {
    // ---------- 6. Bersihkan ----------
    console.log("\n[6/6] Bersihkan...");
    try { pageWs?.close(); } catch { /* ignore */ }
    await sleep(500);
    // Windows: taskkill pohon proses (node dev server punya child worker).
    const killTree = (pid) => {
      if (!pid) return;
      try {
        if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        else { try { process.kill(pid, "SIGKILL"); } catch { /* mati */ } }
      } catch { /* sudah mati */ }
    };
    for (const c of children) killTree(c.pid);
    if (chromePid) killTree(chromePid);
    await sleep(1200);
    if (orderId) {
      const r1 = await sb.from("orders").delete().eq("id", orderId);
      const r2 = orderNumber ? await sb.from("notification_logs").delete().eq("order_id", orderNumber) : { error: null };
      console.log(`  order uji & log dihapus (${r1.error ? "ERR" : "OK"}/${r2.error ? "ERR" : "OK"})`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`HASIL E2E SNAP onError (stub lokal): ${pass} lolos, ${fail} gagal`);
  console.log("=".repeat(60));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ error:", e.message);
  process.exit(1);
});
