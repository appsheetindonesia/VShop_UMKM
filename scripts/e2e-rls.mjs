#!/usr/bin/env node
/**
 * e2e-rls.mjs — verifikasi policy RLS per tabel terhadap Supabase LOKAL.
 *
 * Login sebagai 3 role dan memeriksa policy SELECT/INSERT/UPDATE di 12 tabel:
 *
 *   anon           — hanya tabel publik yang terlihat (paket, merchant, promo,
 *                    voucher, merchandise); tabel privat (order, dompet, sesi,
 *                    dll.) tersembunyi RLS; insert tanpa policy ditolak.
 *   authenticated  — pemilik (customer & merchant demo dari seed): melihat
 *                    baris miliknya sendiri, BUKAN milik user lain; update
 *                    profil sendiri; insert/update hanya sesuai policy owner.
 *   service_role   — bypass RLS: melihat semua data (termasuk kolom sensitif).
 *
 * Prasyarat: `npm run db:setup` (stack lokal + seed). Jalankan:
 *   node scripts/e2e-rls.mjs
 * Keluar dengan exit code 1 bila ada policy yang melanggar ekspektasi.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

// ---------- Muat .env.local / .env ----------
const env = {};
for (const file of [".env.local", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in env)) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        env[m[1]] = v;
      }
    }
  } catch {
    // abaikan bila file tidak ada
  }
}

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE belum diatur.");
  console.error("  Jalankan `npm run db:setup` dulu (menulis .env.local otomatis).");
  process.exit(1);
}

// ---------- Util ----------
const results = [];
function check(name, outcome) {
  const ok = !!outcome.ok;
  results.push({ name, ok });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : " — " + (outcome.detail ?? "gagal")}`);
}

/** SELECT dengan filter opsional; error → {rows: [], error}. */
async function sel(client, table, opts = {}) {
  let q = client.from(table).select(opts.select ?? "*");
  if (opts.eq) q = q.eq(opts.eq[0], opts.eq[1]);
  if (opts.single) q = q.single();
  else if (opts.maybeSingle) q = q.maybeSingle();
  const { data, error } = await q;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  return { rows, error };
}

/** True bila error Postgres menandakan penolakan RLS / permission. */
const isRlsDenied = (error) =>
  !!error &&
  (String(error.code ?? "").includes("42501") ||
    /row-level security|permission denied/i.test(error.message ?? ""));

const count = (r) => r.rows.length;
const rowError = (r) => r.error?.message ?? String(r.error?.code ?? "");

async function signInAs(phone, password) {
  const base = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await base.auth.signInWithPassword({ phone, password });
  if (error || !data.session) throw new Error(`login ${phone} gagal: ${error?.message}`);
  return createClient(URL, ANON, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
}

// ---------- Main ----------
const anon = createClient(URL, ANON, { auth: { persistSession: false } });
const service = createClient(URL, SERVICE, { auth: { persistSession: false } });

console.log("▶ Uji RLS — Supabase lokal\n");

// Kesehatan + id user seed (untuk ekspektasi "milik sendiri" vs "milik orang lain")
const health = await sel(anon, "packages", { select: "id" });
if (health.error) {
  console.error(`✗ Supabase tidak terjangkau (${rowError(health)}). Jalankan \`npm run db:setup\` dulu.`);
  process.exit(1);
}

const { rows: profiles } = await sel(service, "profiles", { select: "id,email,role" });
const customer = profiles.find((p) => p.email === "customer@vshop.id");
const merchant = profiles.find((p) => p.email === "merchant@vshop.id");
if (!customer || !merchant) {
  console.error("✗ User demo (customer@vshop.id / merchant@vshop.id) tidak ditemukan — jalankan `npm run db:seed`.");
  process.exit(1);
}

// ==================== 1. ANON ====================
console.log("1/4 Role: anon (tanpa login)\n");

// Tabel PUBLIK — boleh SELECT
for (const [t, label] of [
  ["packages", "paket"],
  ["merchants", "merchant"],
  ["promos", "promo"],
  ["vouchers", "voucher"],
  ["merchandise", "merchandise"],
]) {
  const r = await sel(anon, t, { select: "id" });
  check(`anon SELECT ${label} (publik)`, { ok: count(r) > 0, detail: rowError(r) });
}

// Tabel PRIVAT — RLS menyembunyikan semua baris (0 hasil, bukan error).
// `sessions` khusus: 0003 hanya me-grant kolom aman (token, user_id, ...),
// jadi `select("*")` justru kena `permission denied` — query kolom aman
// untuk membuktikan RLS menyembunyikan baris (bukan hak kolom).
for (const [t, label] of [
  ["profiles", "profil user lain"],
  ["orders", "order"],
  ["wallets", "dompet"],
  ["memberships", "keanggotaan"],
  ["claimed_vouchers", "voucher terklaim"],
  ["sessions", "sesi"],
  ["carts", "keranjang"],
]) {
  const r = await sel(anon, t, { select: t === "sessions" ? "token" : "*" });
  check(`anon SELECT ${label} (terblokir RLS → 0 baris)`, { ok: !r.error && count(r) === 0, detail: rowError(r) });
}

// Insert tanpa policy → ditolak RLS
{
  const r = await anon.from("orders").insert({ id: "rls-anon-order", order_number: "RLS-ANON", user_id: customer.id, type: "package", items: [], total_amount: 0, status: "pending", payment_status: "pending", metadata: {} });
  check("anon INSERT orders (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}

// Kolom sensitif sessions → hak kolom ditolak (0003)
{
  const r = await sel(anon, "sessions", { select: "sb_refresh_enc" });
  check("anon SELECT sessions.sb_refresh_enc (kolom ditolak)", { ok: isRlsDenied(r.error), detail: rowError(r) });
}

// ==================== 2. AUTHENTICATED — CUSTOMER ====================
console.log("\n2/4 Role: authenticated (customer demo — pemilik order/dompet/keanggotaan)\n");

let customerClient;
try {
  customerClient = await signInAs("+6281234567890", "customer123");
} catch (e) {
  console.error(`  ✗ ${e.message}`);
  process.exit(1);
}

// Baris MILIK SENDIRI — terlihat
{
  const r = await sel(customerClient, "profiles", { select: "id", eq: ["id", customer.id] });
  check("customer SELECT profil sendiri", { ok: count(r) === 1, detail: rowError(r) });
}

// Data uji: seed tidak menyediakan sesi aplikasi & voucher terklaim,
// jadi buat baris milik customer via service_role dulu agar uji
// "melihat baris sendiri" deterministik (dibersihkan di akhir).
{
  const { error: e1 } = await service.from("sessions").insert({
    token: "rls-session-1", user_id: customer.id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600e3).toISOString(),
  });
  const { error: e2 } = await service.from("claimed_vouchers").insert({
    id: "rls-cv-1", voucher_id: "rls-voucher", user_id: customer.id,
    kode: "RLS-CV-0001", kode_konfirmasi: "RLS", status: "active",
  });
  if (e1 || e2) {
    console.error(`  ✗ Gagal menyiapkan data uji: ${e1?.message ?? e2?.message}`);
    process.exit(1);
  }
}

// Kolom PK per tabel (wallets PK = user_id, sessions PK = token, sisanya id)
for (const [t, label, pkCol] of [
  ["orders", "order sendiri", "id"],
  ["wallets", "dompet sendiri", "user_id"],
  ["memberships", "keanggotaan sendiri", "id"],
  ["claimed_vouchers", "voucher terklaim sendiri", "id"],
  ["sessions", "sesi sendiri", "token"],
]) {
  const r = await sel(customerClient, t, { select: pkCol });
  check(`customer SELECT ${label}`, { ok: !r.error && count(r) >= 1, detail: rowError(r) });
}

// Baris MILIK ORANG LAIN — tersembunyi (0 baris)
{
  const r = await sel(customerClient, "orders", { select: "id", eq: ["user_id", merchant.id] });
  check("customer SELECT order merchant (bukan miliknya → 0)", { ok: count(r) === 0, detail: rowError(r) });
}
{
  const r = await sel(customerClient, "profiles", { select: "id", eq: ["id", merchant.id] });
  check("customer SELECT profil merchant (bukan miliknya → 0)", { ok: count(r) === 0, detail: rowError(r) });
}
{
  const r = await sel(customerClient, "wallets", { select: "id", eq: ["user_id", merchant.id] });
  check("customer SELECT dompet merchant (bukan miliknya → 0)", { ok: count(r) === 0, detail: rowError(r) });
}

// Tabel publik tetap terlihat setelah login
{
  const r = await sel(customerClient, "merchants", { select: "id" });
  check("customer SELECT merchant (publik)", { ok: count(r) > 0, detail: rowError(r) });
}

// Insert/update sesuai policy
{
  const r = await anon.from("orders").select("id").eq("id", "rls-anon-order");
  const r2 = await customerClient.from("orders").insert({
    id: "rls-customer-order", order_number: "RLS-CUST", user_id: customer.id,
    type: "package", items: [], total_amount: 0, status: "pending", payment_status: "pending", metadata: {},
  });
  check("customer INSERT orders (tanpa policy → ditolak)", { ok: isRlsDenied(r2.error), detail: r2.error?.message });
  void r;
}

// Update profil sendiri → boleh
{
  const r = await customerClient.from("profiles").update({ name: "Siti Aminah" }).eq("id", customer.id);
  check("customer UPDATE profil sendiri (policy update_own)", { ok: !r.error, detail: r.error?.message });
}

// Insert merchant baru sebagai customer → policy check(true) mengizinkan (tetap dibersihkan)
{
  const r = await customerClient.from("merchants").insert({
    id: "rls-customer-merchant", user_id: customer.id, nama_usaha: "RLS Test", kategori_usaha: "Uji",
    no_wa_usaha: "081234567890", alamat_usaha: "-", nama_pemilik: "Siti", no_wa_pemilik: "081234567890",
    email: "rls-customer@vshop.id", status: "pending",
  });
  check("customer INSERT merchant (policy insert_authenticated)", { ok: !r.error, detail: r.error?.message });
}

// Insert promo sebagai customer untuk merchant milik ORANG LAIN → ditolak
// (pakai id merchant asli milik user merchant demo, bukan merchant buatan
// customer di atas — yang itu justru miliknya sendiri sehingga policy
// promos_insert_owner mengizinkan).
const { rows: merchantRows } = await sel(service, "merchants", { select: "id,user_id" });
const realMerchant = merchantRows.find((m) => m.user_id === merchant.id);
if (!realMerchant) {
  console.error("  ✗ Merchant demo (Warung Nusantara) tidak ditemukan di seed");
  process.exit(1);
}
{
  const r = await customerClient.from("promos").insert({
    id: "rls-customer-promo", merchant_id: realMerchant.id, merchant_name: "Warung Nusantara",
    name: "X", jenis_voucher: "diskon", start_date: new Date().toISOString(),
    end_date: new Date().toISOString(), jumlah: 1,
  });
  check("customer INSERT promo (bukan owner merchant → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}

// Kolom sensitif sessions tetap tertutup walau authenticated
{
  const r = await sel(customerClient, "sessions", { select: "sb_refresh_enc" });
  check("customer SELECT sessions.sb_refresh_enc (kolom ditolak)", { ok: isRlsDenied(r.error), detail: rowError(r) });
}

// ==================== 3. AUTHENTICATED — MERCHANT ====================
console.log("\n3/4 Role: authenticated (merchant demo — pemilik Warung Nusantara)\n");

let merchantClient;
try {
  merchantClient = await signInAs("+6281298765432", "merchant123");
} catch (e) {
  console.error(`  ✗ ${e.message}`);
  process.exit(1);
}

// Merchant melihat merchant miliknya
{
  const r = await sel(merchantClient, "merchants", { select: "id,nama_usaha", eq: ["user_id", merchant.id] });
  check("merchant SELECT merchant sendiri", { ok: count(r) >= 1, detail: rowError(r) });
}

// Update merchant milik sendiri (Warung Nusantara) → boleh
{
  const r = await merchantClient.from("merchants").update({ deskripsi: "RLS e2e" }).eq("id", realMerchant.id).select("id");
  check("merchant UPDATE merchant milik sendiri", { ok: !r.error && r.data?.length === 1, detail: r.error?.message });
  void r;
}

// Customer TIDAK boleh update merchant milik merchant demo (policy update_owner)
{
  const r = await customerClient.from("merchants").update({ deskripsi: "hack" }).eq("id", realMerchant.id).select("id");
  check("customer UPDATE merchant milik orang lain (0 baris)", { ok: !r.error && r.data?.length === 0, detail: r.error?.message });
  void r;
}

// Merchant tidak melihat order customer (bukan miliknya)
{
  const r = await sel(merchantClient, "orders", { select: "id", eq: ["user_id", customer.id] });
  check("merchant SELECT order customer (bukan miliknya → 0)", { ok: count(r) === 0, detail: rowError(r) });
}

// ==================== 4. SERVICE ROLE (bypass RLS) ====================
console.log("\n4/4 Role: service_role (bypass RLS)\n");

{
  const r = await sel(service, "orders", { select: "id" });
  check("service SELECT semua order (bypass)", { ok: count(r) >= 1, detail: rowError(r) });
}
{
  const r = await sel(service, "sessions", { select: "sb_refresh_enc" });
  check("service SELECT sessions.sb_refresh_enc (boleh — satu-satunya role)", { ok: !r.error, detail: rowError(r) });
}

// ---------- Bersihkan data uji ----------
console.log("\nMembersihkan data uji…");
for (const [table, idCol, ids] of [
  ["promos", "id", ["rls-customer-promo"]],
  ["merchants", "id", ["rls-customer-merchant"]],
  ["orders", "id", ["rls-customer-order", "rls-anon-order"]],
  ["claimed_vouchers", "id", ["rls-cv-1"]],
  ["sessions", "token", ["rls-session-1"]],
]) {
  for (const id of ids) {
    const { error } = await service.from(table).delete().eq(idCol, id);
    if (error) console.warn(`  ! Gagal membersihkan ${table}#${id}: ${error.message}`);
  }
}

// ---------- Laporan ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n=== RLS: ${results.length - failed.length}/${results.length} lolos ===`);
if (failed.length > 0) {
  console.log("Policy yang melanggar ekspektasi:");
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
console.log("Semua policy RLS terverifikasi ✅ (publik vs pemilik vs service)");
