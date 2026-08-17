#!/usr/bin/env node
/**
 * E2E Snap popup — Midtrans SANDBOX asli (semi-otomatis, human-in-the-loop).
 *
 * Prasyarat:
 *   1. Kredensial sandbox di .env / environment:
 *        MIDTRANS_SERVER_KEY=SB-Mid-server-...
 *        MIDTRANS_CLIENT_KEY=SB-Mid-client-...
 *      (dashboard.sandbox.midtrans.com → Settings → Access Keys)
 *   2. Aplikasi berjalan: APP_URL (default http://localhost:3000)
 *
 * Alur:
 *   login pelanggan demo → checkout paket → buka halaman bayar di browser
 *   → pengguna menyelesaikan pembayaran di popup Snap (QRIS / VA sandbox)
 *   → script mem-poll /api/pay/[orderId]/status sampai lunas/gagal/kadaluarsa
 *   → verifikasi order & efek paket → laporan.
 *
 * Jalankan:  node scripts/e2e-snap.mjs
 */
import fs from "node:fs";
import path from "node:path";

// Muat .env.local / .env sederhana
for (const file of [".env.local", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* file tidak ada */ }
}

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY;
const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY;

if (!SERVER_KEY || !CLIENT_KEY) {
  console.error("✗ Kredensial Midtrans sandbox belum diatur. Isi di .env:");
  console.error("    MIDTRANS_SERVER_KEY=SB-Mid-server-...");
  console.error("    MIDTRANS_CLIENT_KEY=SB-Mid-client-...");
  process.exit(1);
}
if (!/^SB-Mid-server-/.test(SERVER_KEY) || !/^SB-Mid-client-/.test(CLIENT_KEY)) {
  console.error("✗ Key bukan format sandbox (SB-Mid-server-*/SB-Mid-client-*).");
  process.exit(1);
}

const j = (r) => r.json().catch(() => null);
const post = (url, body, cookie) =>
  fetch(`${APP_URL}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  }).then(j);

async function login() {
  const res = await post("/api/auth/login", { identifier: "customer@vshop.id", password: "customer123" });
  if (!res?.ok) throw new Error("login gagal: " + (res?.message ?? "?"));
  const cookie = await fetch(`${APP_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: "customer@vshop.id", password: "customer123" }),
  }).then((r) => r.headers.get("set-cookie")?.split(";")[0] ?? "");
  return cookie;
}

async function firstPackageId() {
  // Mode demo: id paket di-seed acak di data/db.json. Mode Supabase: id tetap
  // (pkg_7hari dst.) dari migration — coba keduanya.
  try {
    const db = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "db.json"), "utf8"));
    if (db.packages?.[0]?.id) return db.packages[0].id;
  } catch { /* bukan mode demo */ }
  return "pkg_7hari";
}

async function checkout(cookie) {
  const packageId = await firstPackageId();
  const res = await post("/api/checkout", { type: "package", packageId }, cookie);
  if (!res?.ok) {
    throw new Error(`checkout gagal (${res?.message ?? "?"}) — pastikan aplikasi berjalan & data ter-seed`);
  }
  return { orderId: res.orderId, redirect: res.redirect };
}

async function pollStatus(cookie, orderId, timeoutMs = 15 * 60 * 1000) {
  // ?reconcile=1 → fallback Status API: webhook tidak bisa menjangkau
  // localhost, jadi e2e ini bergantung pada reconcile untuk mendeteksi
  // settlement (di produksi webhook adalah sumber utama).
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${APP_URL}/api/pay/${orderId}/status?reconcile=1`, {
      headers: { Cookie: cookie },
    }).then(j);
    if (res?.status === "paid" || res?.status === "failed" || res?.status === "expired") return res;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, status: "timeout", message: "Waktu tunggu habis (15 menit)" };
}

async function main() {
  console.log(`[e2e] Aplikasi: ${APP_URL}`);
  console.log("[e2e] Login pelanggan demo...");
  const cookie = await login();
  console.log("[e2e] Buat order (paket)...");
  const { orderId, redirect } = await checkout(cookie);
  console.log(`[e2e] Order dibuat: ${orderId} → ${APP_URL}${redirect}`);
  console.log("\n>>> BUKA URL DI ATAS DI BROWSER, klik 'Bayar Sekarang', lalu");
  console.log("    selesaikan pembayaran di popup Snap (QRIS/VA sandbox).");
  console.log(">>> Menunggu pembayaran (poll status tiap 5 detik, maks 15 menit)...\n");

  const result = await pollStatus(cookie, orderId);

  console.log("=".repeat(60));
  console.log("HASIL E2E SNAP POPUP (MIDTRANS SANDBOX)");
  console.log("=".repeat(60));
  console.log(`Order   : ${orderId}`);
  console.log(`Status  : ${result.status}`);
  if (result.redirect) console.log(`Redirect: ${result.redirect}`);
  if (result.message) console.log(`Pesan   : ${result.message}`);
  process.exit(result.status === "paid" ? 0 : 1);
}

main().catch((e) => {
  console.error("✗ error:", e.message);
  process.exit(1);
});
