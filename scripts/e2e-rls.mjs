#!/usr/bin/env node
/**
 * e2e-rls.mjs — verifikasi keamanan Supabase LOKAL dalam satu perintah:
 * RLS per tabel + Storage bucket 'vshop-assets' + Auth phone (OTP & password).
 *
 * RLS — login sebagai 3 role dan memeriksa policy SELECT/INSERT/UPDATE:
 *
 *   anon           — hanya tabel publik yang terlihat (paket, merchant, promo,
 *                    voucher, merchandise); tabel privat (order, dompet, sesi,
 *                    dll.) tersembunyi RLS; insert tanpa policy ditolak.
 *   authenticated  — pemilik (customer & merchant demo dari seed): melihat
 *                    baris miliknya sendiri, BUKAN milik user lain; update
 *                    profil sendiri; insert/update hanya sesuai policy owner.
 *   service_role   — bypass RLS: melihat semua data (termasuk kolom sensitif).
 *
 * STORAGE — bucket 'vshop-assets': SELECT publik, tapi INSERT/UPDATE/DELETE
 * khusus `to authenticated` DENGAN owner check (folder per user, migration
 * 0012): anon ditolak tulis/hapus; authenticated hanya boleh menulis/ubah/
 * hapus objek di folder milik sendiri ({uid}/...) — isolasi antar user
 * diuji (upload/update/delete lintas folder ditolak); service bypass.
 *
 * TABEL 0004–0007 — notification_logs (0005) & cron_runs (0007) bersifat
 * DEFAULT DENY untuk anon/authenticated (0 baris; insert/update/delete
 * ditolak — 0003 memberi GRANT ALL, jadi RLS satu-satunya gerbang); kolom
 * expiring_notified_at / expiring_24h_notified_at pada claimed_vouchers
 * (0004/0006) terlihat oleh pemilik, tersembunyi dari user lain.
 *
 * AUTH PHONE — OTP via [auth.sms.test_otp] (nomor → kode tetap: 6281298765432
 * = "654321", 6281234567890 = "123456") + login phone+password.
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
console.log("1/6 Role: anon (tanpa login)\n");

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
  ["notification_logs", "log notifikasi"],
  ["cron_runs", "riwayat run cron"],
]) {
  const r = await sel(anon, t, { select: t === "sessions" ? "token" : "*" });
  check(`anon SELECT ${label} (terblokir RLS → 0 baris)`, { ok: !r.error && count(r) === 0, detail: rowError(r) });
}

// Insert tanpa policy → ditolak RLS
{
  const r = await anon.from("orders").insert({ id: "rls-anon-order", order_number: "RLS-ANON", user_id: customer.id, type: "package", items: [], total_amount: 0, status: "pending", payment_status: "pending", metadata: {} });
  check("anon INSERT orders (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}
{
  const r = await anon.from("notification_logs").insert({
    id: "rls-notif-anon", recipient: "6281234567890", type: "paid", status: "sent", delivered: false,
  });
  check("anon INSERT notification_logs (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}
{
  const r = await anon.from("cron_runs").insert({
    id: "rls-cron-anon", job: "expire", ran_at: new Date().toISOString(), expired_count: 0,
  });
  check("anon INSERT cron_runs (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}

// Kolom sensitif sessions → hak kolom ditolak (0003)
{
  const r = await sel(anon, "sessions", { select: "sb_refresh_enc" });
  check("anon SELECT sessions.sb_refresh_enc (kolom ditolak)", { ok: isRlsDenied(r.error), detail: rowError(r) });
}

// ==================== 2. AUTHENTICATED — CUSTOMER ====================
console.log("\n2/7 Role: authenticated (customer demo — pemilik order/dompet/keanggotaan)\n");

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

// Insert order sesuai policy orders_insert_own (migration 0008):
// dengan check (user_id = auth.uid()::text) — boleh untuk milik sendiri,
// DITOLAK bila user_id = auth user lain.
{
  const r = await customerClient.from("orders").insert({
    id: "rls-customer-order", order_number: "RLS-CUST", user_id: customer.id,
    type: "package", items: [], total_amount: 0, status: "pending", payment_status: "pending", metadata: {},
  }).select("id");
  check("customer INSERT order MILIK SENDIRI (policy orders_insert_own → boleh)", {
    ok: !r.error && r.data?.some((row) => row.id === "rls-customer-order"),
    detail: r.error?.message,
  });
}
{
  const r = await customerClient.from("orders").insert({
    id: "rls-customer-order-foreign", order_number: "RLS-CUST-FOREIGN", user_id: merchant.id,
    type: "package", items: [], total_amount: 0, status: "pending", payment_status: "pending", metadata: {},
  }).select("id");
  check("customer INSERT order atas nama USER LAIN (user_id ≠ auth.uid() → ditolak RLS)", {
    ok: isRlsDenied(r.error) || (!r.error && (r.data?.length ?? 0) === 0),
    detail: r.error?.message ?? (r.data?.length ? "baris ter-insert" : undefined),
  });
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

// notification_logs / cron_runs: anon/authenticated tidak boleh menulis log palsu
{
  const r = await customerClient.from("notification_logs").insert({
    id: "rls-notif-customer", recipient: "6281234567890", type: "paid", status: "sent", delivered: false,
  });
  check("customer INSERT notification_logs (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}
{
  const r = await customerClient.from("cron_runs").insert({
    id: "rls-cron-customer", job: "expire", ran_at: new Date().toISOString(), expired_count: 0,
  });
  check("customer INSERT cron_runs (tanpa policy → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}

// ==================== 3. AUTHENTICATED — MERCHANT ====================
console.log("\n3/7 Role: authenticated (merchant demo — pemilik Warung Nusantara)\n");

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
console.log("\n4/7 Role: service_role (bypass RLS)\n");

{
  const r = await sel(service, "orders", { select: "id" });
  check("service SELECT semua order (bypass)", { ok: count(r) >= 1, detail: rowError(r) });
}
{
  const r = await sel(service, "sessions", { select: "sb_refresh_enc" });
  check("service SELECT sessions.sb_refresh_enc (boleh — satu-satunya role)", { ok: !r.error, detail: rowError(r) });
}

// notification_logs: service_role menulis & membaca (append-only telemetri)
{
  const r = await service.from("notification_logs").insert({
    id: "rls-notif-svc", order_id: "RLS-0001", recipient: "6281234567890",
    type: "paid", status: "sent", delivered: true, template_name: "vshop_paid",
  });
  check("service INSERT notification_logs (bypass — satu-satunya penulis)", { ok: !r.error, detail: r.error?.message });
}
{
  const r = await sel(service, "notification_logs", { select: "recipient,type,status,delivered,template_name", eq: ["id", "rls-notif-svc"] });
  check("service SELECT notification_logs (bypass)", {
    ok: count(r) === 1 && r.rows[0]?.status === "sent" && r.rows[0]?.delivered === true,
    detail: rowError(r),
  });
}

// cron_runs: service_role menulis & membaca (append-only telemetri)
{
  const r = await service.from("cron_runs").insert({
    id: "rls-cron-svc", job: "expire", ran_at: new Date().toISOString(),
    expired_count: 3, notified_count: 2,
  });
  check("service INSERT cron_runs (bypass — satu-satunya penulis)", { ok: !r.error, detail: r.error?.message });
}
{
  const r = await sel(service, "cron_runs", { select: "job,expired_count,notified_count", eq: ["id", "rls-cron-svc"] });
  check("service SELECT cron_runs (bypass)", {
    ok: count(r) === 1 && r.rows[0]?.job === "expire" && r.rows[0]?.expired_count === 3,
    detail: rowError(r),
  });
}

// ==================== 5. STORAGE — bucket vshop-assets ====================
console.log("\n5/7 Storage: bucket 'vshop-assets' (folder per user, owner check)\n");

// Policy storage (0012_storage_owner.sql): SELECT publik (tanpa batasan role),
// tapi INSERT/UPDATE/DELETE khusus `to authenticated` DENGAN owner check —
// objek hanya boleh dibuat/diubah/dihapus di folder milik sendiri (segment
// path pertama = auth.uid()). Upload memakai pola path: {uid}/{id}-{rand}.{ext}.
// Service role bypass RLS.
const STO_TS = Date.now();
const ownPath = (uid, id) => `${uid}/${id}-${STO_TS}.txt`;
const anyPath = (folder, id) => `${folder}/${id}-${STO_TS}.txt`;
const stoBody = (id, tag = "") =>
  new Blob([`rls e2e ${tag}${id} ${STO_TS}`], { type: "text/plain" });

const isStorageDenied = (error) =>
  !!error &&
  (String(error.statusCode ?? "") === "403" ||
    /row-level security|permission denied/i.test(error.message ?? ""));

const CUST_DIR = customer.id;
const MCH_DIR = merchant.id;

// Setup: 1 objek via service_role di folder non-uid (uji read publik &
// update/delete anon — service tidak terikat owner check).
const SVC_STO = anyPath("svc-owner", "svc");
{
  const { data, error } = await service.storage
    .from("vshop-assets")
    .upload(SVC_STO, stoBody("svc"), { contentType: "text/plain" });
  check("service UPLOAD objek (bypass RLS, folder bebas)", { ok: !error && !!data?.path, detail: error?.message });
}

// --- anon ---
{
  const { error } = await anon.storage
    .from("vshop-assets")
    .upload(anyPath("anon", "anon"), stoBody("anon"), { contentType: "text/plain" });
  check("anon UPLOAD (policy insert khusus authenticated → ditolak)", { ok: isStorageDenied(error), detail: error?.message });
}
{
  const { error } = await anon.storage.from("vshop-assets").download(SVC_STO);
  check("anon DOWNLOAD (read publik → boleh)", { ok: !error, detail: error?.message });
}
{
  const { error } = await anon.storage
    .from("vshop-assets")
    .update(SVC_STO, stoBody("anon-upd"), { contentType: "text/plain" });
  check("anon UPDATE (policy update khusus authenticated → ditolak)", { ok: isStorageDenied(error), detail: error?.message });
}
// Catatan: storage DELETE yang ditolak RLS TIDAK mengembalikan error —
// PostgREST menghapus 0 baris → HTTP 200 dengan data kosong. Yang benar
// diuji: objek TETAP ADA setelah anon mencoba hapus.
{
  const { error } = await anon.storage.from("vshop-assets").remove([SVC_STO]);
  const surv = await service.storage.from("vshop-assets").download(SVC_STO);
  check("anon DELETE (tanpa owner → tanpa dampak, objek tetap ada)", {
    ok: !error && !surv.error,
    detail: error?.message ?? (surv.error ? `objek hilang: ${surv.error.message}` : undefined),
  });
}

// --- authenticated: folder milik sendiri boleh penuh ---
const CUST_STO = ownPath(CUST_DIR, "cust");
{
  const { data, error } = await customerClient.storage
    .from("vshop-assets")
    .upload(CUST_STO, stoBody("cust"), { contentType: "text/plain" });
  check("customer UPLOAD di folder sendiri (owner check → boleh)", { ok: !error && !!data?.path, detail: error?.message });
}
{
  const { error } = await customerClient.storage.from("vshop-assets").download(CUST_STO);
  check("customer DOWNLOAD objek sendiri", { ok: !error, detail: error?.message });
}
{
  const { error } = await customerClient.storage
    .from("vshop-assets")
    .update(CUST_STO, stoBody("cust-upd"), { contentType: "text/plain" });
  check("customer UPDATE objek sendiri", { ok: !error, detail: error?.message });
}
{
  const { error } = await customerClient.storage.from("vshop-assets").remove([CUST_STO]);
  const gone = await service.storage.from("vshop-assets").download(CUST_STO);
  check("customer DELETE objek sendiri (benar-benar terhapus)", {
    ok: !error && !!gone.error,
    detail: error?.message ?? (gone.error ? undefined : "objek masih ada"),
  });
}

// --- ISOLASI ANTAR USER: folder orang lain TIDAK boleh disentuh ---
// Objek milik merchant (di folder merchant.id) untuk uji lintas user.
const MCH_STO = ownPath(MCH_DIR, "mch");
{
  const { data, error } = await merchantClient.storage
    .from("vshop-assets")
    .upload(MCH_STO, stoBody("mch"), { contentType: "text/plain" });
  check("merchant UPLOAD di folder sendiri (owner check → boleh)", { ok: !error && !!data?.path, detail: error?.message });
}
// customer mencoba UPLOAD ke folder merchant → with check gagal (42501)
{
  const { error } = await customerClient.storage
    .from("vshop-assets")
    .upload(ownPath(MCH_DIR, "cust-intr"), stoBody("cust", "intr-"), { contentType: "text/plain" });
  check("customer UPLOAD di folder MERCHANT → ditolak (isolasi insert)", { ok: isStorageDenied(error), detail: error?.message });
}
// customer mencoba UPDATE objek milik merchant → 0 baris, isi TIDAK berubah
{
  const { error } = await customerClient.storage
    .from("vshop-assets")
    .update(MCH_STO, stoBody("mch", "intr-upd-"), { contentType: "text/plain" });
  const surv = await service.storage.from("vshop-assets").download(MCH_STO);
  const text = surv.error ? null : await surv.data.text();
  check("customer UPDATE objek MERCHANT → tanpa dampak, isi asli utuh (isolasi update)", {
    ok: text !== null && text.includes("rls e2e mch ") && !text.includes("intr-upd"),
    detail: error?.message ?? (text === null ? "objek tidak bisa dibaca" : `isi berubah: ${text}`),
  });
}
// merchant mencoba DELETE objek milik customer → 0 baris, objek TETAP ADA
const CUST2 = ownPath(CUST_DIR, "cust2");
{
  await customerClient.storage
    .from("vshop-assets")
    .upload(CUST2, stoBody("cust2"), { contentType: "text/plain" });
  const { error } = await merchantClient.storage.from("vshop-assets").remove([CUST2]);
  const surv = await service.storage.from("vshop-assets").download(CUST2);
  check("merchant DELETE objek CUSTOMER → tanpa dampak, objek tetap ada (isolasi delete)", {
    ok: !surv.error,
    detail: error?.message ?? (surv.error ? `objek hilang: ${surv.error.message}` : undefined),
  });
}
// merchant tetap bisa hapus objek miliknya sendiri
{
  const { error } = await merchantClient.storage.from("vshop-assets").remove([MCH_STO]);
  const gone = await service.storage.from("vshop-assets").download(MCH_STO);
  check("merchant DELETE objek sendiri (benar-benar terhapus)", {
    ok: !error && !!gone.error,
    detail: error?.message ?? (gone.error ? undefined : "objek masih ada"),
  });
}

// ==================== 6. AUTH PHONE — OTP + password ====================
console.log("\n6/7 Auth phone: OTP ([auth.sms.test_otp]) + password terhadap Supabase lokal\n");

// [auth.sms.test_otp] memetakan nomor → kode tetap: 6281298765432 = "654321"
// (customer 6281234567890 = "123456"). enable_confirmations=false → verifyOtp
// langsung mengembalikan sesi. Nomor dipakai user merchant demo (sudah ada di
// auth.users), jadi tidak ada user uji baru yang perlu dibersihkan.
const OTP_PHONE = "+6281298765432";
const OTP_CODE = "654321";

// Kirim OTP → sukses (test_otp: tidak ada SMS sungguhan dikirim).
// GoTrue rate-limit SMS (config.toml max_frequency="5s"): bila script
// dijalankan dua kali berdekatan (atau run CI/lokal bersamaan), kiriman
// kedua kena 429 over_sms_send_rate_limit — retry dengan jeda.
{
  let error;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await anon.auth.signInWithOtp({ phone: OTP_PHONE });
    if (!r.error) {
      error = null;
      break;
    }
    error = r.error;
    if (String(r.error.code) === "over_sms_send_rate_limit" && attempt < 3) {
      console.log(`  ! OTP rate limit (run berdekatan) — retry dalam 6s (${attempt}/3)…`);
      await new Promise((res) => setTimeout(res, 6000));
    }
  }
  check("OTP kirim (signInWithOtp) untuk nomor ter-map", { ok: !error, detail: error?.message });
}
// Token salah → ditolak
{
  const { error } = await anon.auth.verifyOtp({ phone: OTP_PHONE, token: "000000", type: "sms" });
  check("OTP verifikasi token SALAH → ditolak", { ok: !!error, detail: error?.message ?? "tidak ada error" });
}
// Token benar → sesi + sesi itu bisa akses data sendiri (RLS owner)
{
  const { data, error } = await anon.auth.verifyOtp({ phone: OTP_PHONE, token: OTP_CODE, type: "sms" });
  check("OTP verifikasi token BENAR → sesi dibuat", { ok: !error && !!data.session, detail: error?.message });
  if (!error && data.session) {
    const otpClient = createClient(URL, ANON, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    });
    const r = await sel(otpClient, "profiles", { select: "id,email", eq: ["id", merchant.id] });
    check("sesi OTP bisa SELECT profil sendiri (RLS owner)", {
      ok: count(r) === 1 && r.rows[0]?.email === "merchant@vshop.id",
      detail: rowError(r),
    });
  } else {
    check("sesi OTP bisa SELECT profil sendiri (RLS owner)", { ok: false, detail: "sesi tidak ada" });
  }
}
// Password: nomor yang sama juga login via phone+password (fallback tetap ada)
{
  const { error } = await anon.auth.signInWithPassword({ phone: OTP_PHONE, password: "salah" });
  check("password SALAH untuk phone → ditolak", { ok: !!error, detail: error?.message ?? "tidak ada error" });
}
{
  const { data, error } = await anon.auth.signInWithPassword({ phone: OTP_PHONE, password: "merchant123" });
  check("password BENAR untuk phone → sesi dibuat", { ok: !error && !!data.session, detail: error?.message });
}

// ==================== 7. TABEL MIGRATION 0004-0007 ====================
console.log("\n7/7 Tabel 0004–0007: claimed_vouchers (kolom notifikasi) + notification_logs + cron_runs\n");

// notification_logs (0005) & cron_runs (0007): DEFAULT DENY — RLS aktif
// TANPA policy → anon/authenticated membaca 0 baris & insert/update/delete
// ditolak (0003 memberi GRANT ALL, jadi RLS adalah satu-satunya gerbang;
// satu-satunya penulis/pembaca = service_role, sudah diuji di seksi 4).
{
  const r = await sel(customerClient, "notification_logs", { select: "*" });
  check("customer SELECT notification_logs (default deny → 0 baris)", { ok: !r.error && count(r) === 0, detail: rowError(r) });
}
{
  const r = await sel(merchantClient, "cron_runs", { select: "*" });
  check("merchant SELECT cron_runs (default deny → 0 baris)", { ok: !r.error && count(r) === 0, detail: rowError(r) });
}
{
  const r = await customerClient.from("notification_logs").insert({
    id: "rls-notif-auth", recipient: "6281234567890", type: "paid", status: "sent", delivered: false,
  });
  check("customer INSERT notification_logs (default deny → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}
{
  const r = await merchantClient.from("cron_runs").insert({
    id: "rls-cron-auth", job: "expire", ran_at: new Date().toISOString(), expired_count: 1,
  });
  check("merchant INSERT cron_runs (default deny → ditolak)", { ok: isRlsDenied(r.error), detail: r.error?.message });
}
// Update baris yang ditulis service (rls-notif-svc) → 0 baris ter-filter RLS
{
  const r = await customerClient.from("notification_logs").update({ delivered: true }).eq("id", "rls-notif-svc").select("id");
  check("customer UPDATE notification_logs (default deny → 0 baris)", { ok: !r.error && r.data?.length === 0, detail: r.error?.message });
}
// Hapus baris service → tanpa dampak, baris tetap ada (0 baris terhapus)
{
  const r = await customerClient.from("notification_logs").delete().eq("id", "rls-notif-svc");
  const surv = await sel(service, "notification_logs", { select: "id", eq: ["id", "rls-notif-svc"] });
  check("customer DELETE notification_logs (default deny → baris tetap ada)", { ok: !r.error && count(surv) === 1, detail: r.error?.message });
}
{
  const r = await merchantClient.from("cron_runs").delete().eq("id", "rls-cron-svc");
  const surv = await sel(service, "cron_runs", { select: "id", eq: ["id", "rls-cron-svc"] });
  check("merchant DELETE cron_runs (default deny → baris tetap ada)", { ok: !r.error && count(surv) === 1, detail: r.error?.message });
}

// claimed_vouchers (0004/0006): kolom expiring_notified_at /
// expiring_24h_notified_at terlihat oleh pemilik, tersembunyi dari user lain
// (policy select_own 0001 tetap berlaku untuk kolom baru).
{
  const { error: e1 } = await service.from("claimed_vouchers").insert({
    id: "rls-cv-0004", voucher_id: "rls-voucher", user_id: customer.id,
    kode: "RLS-CV-0004", kode_konfirmasi: "RLS", status: "active",
    expiring_notified_at: new Date().toISOString(),
    expiring_24h_notified_at: new Date().toISOString(),
  });
  check("service INSERT claimed_vouchers + kolom 0004/0006 (bypass)", { ok: !e1, detail: e1?.message });
}
{
  const r = await sel(customerClient, "claimed_vouchers", {
    select: "id,expiring_notified_at,expiring_24h_notified_at",
    eq: ["id", "rls-cv-0004"],
  });
  check("customer SELECT kolom expiring_* di klaim sendiri (0004/0006 → terlihat)", {
    ok: count(r) === 1 && !!r.rows[0]?.expiring_notified_at && !!r.rows[0]?.expiring_24h_notified_at,
    detail: rowError(r),
  });
}
{
  const r = await sel(merchantClient, "claimed_vouchers", {
    select: "id,expiring_notified_at,expiring_24h_notified_at",
    eq: ["id", "rls-cv-0004"],
  });
  check("merchant SELECT klaim customer (bukan miliknya → 0 baris, kolom baru ikut tersembunyi)", {
    ok: count(r) === 0,
    detail: rowError(r),
  });
}

// ---------- Bersihkan data uji ----------
console.log("\nMembersihkan data uji…");
// Storage — hapus sisa objek uji (bypass service_role)
for (const p of [
  SVC_STO,
  CUST_STO,
  CUST2,
  MCH_STO,
  anyPath("anon", "anon"),
  ownPath(MCH_DIR, "cust-intr"),
]) {
  const { error } = await service.storage.from("vshop-assets").remove([p]);
  if (error && !/not found/i.test(error.message ?? "")) {
    console.warn(`  ! Gagal membersihkan storage ${p}: ${error.message}`);
  }
}
for (const [table, idCol, ids] of [
  ["promos", "id", ["rls-customer-promo"]],
  ["merchants", "id", ["rls-customer-merchant"]],
  ["orders", "id", ["rls-customer-order", "rls-customer-order-foreign", "rls-anon-order"]],
  ["claimed_vouchers", "id", ["rls-cv-1", "rls-cv-0004"]],
  ["sessions", "token", ["rls-session-1"]],
  ["notification_logs", "id", ["rls-notif-svc"]],
  ["cron_runs", "id", ["rls-cron-svc"]],
]) {
  for (const id of ids) {
    const { error } = await service.from(table).delete().eq(idCol, id);
    if (error) console.warn(`  ! Gagal membersihkan ${table}#${id}: ${error.message}`);
  }
}

// ---------- Laporan ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n=== RLS + Storage + Auth phone: ${results.length - failed.length}/${results.length} lolos ===`);
if (failed.length > 0) {
  console.log("Policy yang melanggar ekspektasi:");
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
console.log("Semua policy RLS, Storage, dan Auth phone terverifikasi ✅ (publik vs pemilik vs service)");
