#!/usr/bin/env node
/**
 * E2E WEBHOOK MIDTRANS vs SUPABASE LOKAL — notifikasi signed end-to-end.
 *
 * Mengirim Payment Notification Midtrans ASLI-format (signature SHA-512
 * diverifikasi persis seperti docs.midtrans.com) ke `/api/midtrans/notification`
 * aplikasi yang sedang berjalan, lalu memverifikasi efeknya di PostgreSQL
 * (Supabase lokal) — payment_status, paid_at, failureReason, dan kronologi
 * `metadata.paymentAudit` (event + source + statusCode + transactionStatus).
 *
 * Skenario (per order terpisah):
 *   1. deny        — status_code 202, transaction_status deny (qris)     → failed
 *   2. settlement  — status_code 200, transaction_status settlement      → paid
 *   3. expire      — status_code 203, transaction_status expire (qris)   → expired
 *   4. deny OVO    — channel_response_code 68 (RC sandbox resmi OVO)      → failed,
 *                    failureReason SPESIFIK KANAL + channelResponseCode/
 *                    channelResponseMessage terekam di paymentAudit
 *   5. signature salah → 403 & order TETAP pending (kontrol negatif)
 *
 * Alur (mengikuti seam aplikasi yang sebenarnya):
 *   checkout pelanggan demo (mode demo: tanpa key → token tiruan, tanpa
 *   panggilan HTTP keluar) → admin simpan TEST KEY lewat `/api/admin/settings`
 *   (jalur Configurasi — cache server ter-update live, tanpa restart) →
 *   webhook signed diterima & diverifikasi oleh server → verifikasi Postgres.
 *
 * Prasyarat: aplikasi berjalan (APP_URL), Supabase lokal up, ter-seed
 * (customer@vshop.id / customer123, admin@vshop.id / admin123).
 *
 * Jalankan:  npm run db:webhook   (atau: node scripts/e2e-webhook.mjs)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ---------- Muat .env.local / .env sederhana ----------
for (const file of [".env.local", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        let v = m[2].replace(/\s+#.*$/, "").trim(); // buang komentar trailing
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    }
  } catch { /* file tidak ada */ }
}

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TEST_KEY = "SB-Mid-server-e2e-webhook-local";

if (!SB_URL || !SB_KEY) {
  console.error("✗ Supabase lokal belum dikonfigurasi (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY). Jalankan npm run db:setup dulu.");
  process.exit(1);
}
const sb = createClient(SB_URL, SB_KEY);

let pass = 0;
let fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label} ${extra}`); }
};

// ---------- HTTP helpers (cookie jar) ----------
const jarOf = () => ({ cookies: new Map() });
const cookieHeader = (jar) =>
  [...jar.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");

async function api(urlPath, { method = "GET", body, jar } = {}) {
  const res = await fetch(`${APP_URL}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(jar ? { Cookie: cookieHeader(jar) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  if (jar) {
    for (const sc of setCookies) {
      const pair = sc.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq > 0) jar.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  return { status: res.status, data };
}

async function login(identifier, password, jar) {
  const r = await api("/api/auth/login", { method: "POST", body: { identifier, password }, jar });
  if (!r.data?.ok) throw new Error(`login ${identifier} gagal: ${r.data?.message ?? r.status}`);
  return r;
}

async function checkout(jar) {
  const r = await api("/api/checkout", {
    method: "POST",
    body: { type: "package", packageId: "pkg_7hari" },
    jar,
  });
  if (!r.data?.ok) throw new Error(`checkout gagal: ${r.data?.message ?? r.status}`);
  return r.data.orderId;
}

// ---------- Midtrans signature (SHA512(order_id + status_code + gross_amount + key)) ----------
const sha512 = (s) => crypto.createHash("sha512").update(s).digest("hex");

function signedWebhook(orderNumber, grossAmount, { statusCode, transactionStatus, statusMessage, paymentType, transactionId, fraudStatus = "accept" }, key) {
  return {
    transaction_time: new Date().toISOString(),
    transaction_status: transactionStatus,
    transaction_id: transactionId,
    status_code: statusCode,
    status_message: statusMessage,
    signature_key: sha512(`${orderNumber}${statusCode}${grossAmount}${key}`),
    payment_type: paymentType,
    order_id: orderNumber,
    gross_amount: String(grossAmount),
    fraud_status: fraudStatus,
  };
}

// ---------- Verifikasi Postgres ----------
async function fetchOrder(orderNumber) {
  const { data, error } = await sb
    .from("orders")
    .select("id,order_number,total_amount,status,payment_status,payment_method,paid_at,metadata,created_at")
    .eq("order_number", orderNumber)
    .single();
  if (error) throw new Error(`ambil order ${orderNumber}: ${error.message}`);
  return data;
}

const auditOf = (o) => (Array.isArray(o.metadata?.paymentAudit) ? o.metadata.paymentAudit : []);
const lastOf = (o) => auditOf(o)[auditOf(o).length - 1];

async function verifyScenario(label, orderNumber, expect) {
  console.log(`\n── Verifikasi "${label}" (${orderNumber}) di PostgreSQL`);
  const o = await fetchOrder(orderNumber);
  const audit = auditOf(o);
  const last = lastOf(o);

  ok(o.payment_status === expect.paymentStatus, `payment_status = ${expect.paymentStatus}`, `(dapat: ${o.payment_status})`);
  if (expect.status) ok(o.status === expect.status, `status = ${expect.status}`, `(dapat: ${o.status})`);
  if (expect.paidAt) ok(Boolean(o.paid_at), "paid_at terisi");
  if (expect.method) ok(o.payment_method === expect.method, `payment_method = ${expect.method}`, `(dapat: ${o.payment_method})`);
  if (expect.methodNull) ok(o.payment_method === null, "payment_method tetap null (belum dibayar)", `(dapat: ${o.payment_method})`);
  if (expect.failureReason !== undefined) {
    ok(o.metadata?.failureReason === expect.failureReason, `failureReason = "${expect.failureReason}"`, `(dapat: ${o.metadata?.failureReason})`);
  }
  if (expect.failureReasonStartsWith !== undefined) {
    ok(
      typeof o.metadata?.failureReason === "string" &&
        o.metadata.failureReason.startsWith(expect.failureReasonStartsWith),
      `failureReason dimulai "${expect.failureReasonStartsWith}…"`,
      `(dapat: ${o.metadata?.failureReason})`
    );
  }

  // Kronologi audit: entri pertama harus "created" dari createOrder.
  ok(audit.length >= 1 && audit[0]?.event === "created" && audit[0]?.source === "create",
    "audit dimulai event=created (source=create)", `(panjang: ${audit.length})`);
  // Entri terakhir = peristiwa webhook yang baru saja dikirim.
  if (expect.last) {
    ok(last?.event === expect.last.event, `audit terakhir event=${expect.last.event}`, `(dapat: ${last?.event})`);
    ok(last?.source === "webhook", "audit terakhir source=webhook", `(dapat: ${last?.source})`);
    if (expect.last.statusCode) ok(last?.statusCode === expect.last.statusCode, `audit statusCode=${expect.last.statusCode}`, `(dapat: ${last?.statusCode})`);
    if (expect.last.transactionStatus) ok(last?.transactionStatus === expect.last.transactionStatus, `audit transactionStatus=${expect.last.transactionStatus}`, `(dapat: ${last?.transactionStatus})`);
    if (expect.last.paymentType) ok(last?.paymentType === expect.last.paymentType, `audit paymentType=${expect.last.paymentType}`, `(dapat: ${last?.paymentType})`);
    // Alasan terpetakan (detail) DAN status_message mentah disimpan terpisah.
    if (expect.last.statusMessage) {
      ok(last?.statusMessage === expect.last.statusMessage, `audit statusMessage MENTAH = "${expect.last.statusMessage}"`, `(dapat: ${last?.statusMessage})`);
    }
    if (expect.last.detail) {
      ok(last?.detail === expect.last.detail, `audit detail (alasan) = "${expect.last.detail}"`, `(dapat: ${last?.detail})`);
    }
    if (expect.last.detailStartsWith) {
      ok(
        typeof last?.detail === "string" && last.detail.startsWith(expect.last.detailStartsWith),
        `audit detail dimulai "${expect.last.detailStartsWith}…"`,
        `(dapat: ${last?.detail})`
      );
    }
    if (expect.last.channelResponseCode) {
      ok(last?.channelResponseCode === expect.last.channelResponseCode, `audit channelResponseCode=${expect.last.channelResponseCode}`, `(dapat: ${last?.channelResponseCode})`);
    }
    if (expect.last.channelResponseMessage) {
      ok(last?.channelResponseMessage === expect.last.channelResponseMessage, "audit channelResponseMessage tersimpan", `(dapat: ${last?.channelResponseMessage})`);
    }
  }
  // Tidak ada entri webhook bila ekspektasi kosong (kontrol negatif).
  if (expect.noWebhook) {
    ok(!audit.some((e) => e.source === "webhook"), "tidak ada event source=webhook di audit");
  }
  return o;
}

// ---------- main ----------
async function main() {
  console.log(`[e2e] Aplikasi : ${APP_URL}`);
  console.log(`[e2e] Supabase : ${SB_URL}`);
  try {
    const up = await fetch(`${APP_URL}/`, { signal: AbortSignal.timeout(5000) });
    if (!up.ok) throw new Error(`HTTP ${up.status}`);
  } catch (e) {
    console.error(`✗ Aplikasi tidak merespons di ${APP_URL} — mulai dulu dev server-nya.`, e.message);
    process.exit(1);
  }

  // ---------- 0. Snapshot keadaan sebelum uji ----------
  // Guard: run sebelumnya yang tidak selesai meninggalkan test key di CACHE
  // server (globalThis) — tanpa restart, checkout akan memanggil Midtrans API
  // asli (mode "key ada") dan gagal 401. Probes via GET /api/admin/settings
  // (membaca cache server, bukan hanya tabel Postgres).
  const adminJar = jarOf();
  await login("admin@vshop.id", "admin123", adminJar);
  const probe = await api("/api/admin/settings", { jar: adminJar });
  const activeKey = probe.data?.settings?.find((s) => s.key === "midtrans_server_key");
  if (activeKey?.display) {
    console.error(
      `✗ Server masih memegang key midtrans (${activeKey.display}) dari run sebelumnya — cache globalThis.\n` +
      "  Restart dev server dulu (hentikan npm run dev, mulai lagi), lalu jalankan ulang script."
    );
    process.exit(1);
  }
  // Guard 2: sisa order dari run sebelumnya di Postgres (pending/failed/expired
  // hari ini) akan BENTROK dengan nomor order baru (order_number UNIQUE) dan
  // membuat batch write-through gagal diam-diam → order baru hilang. Abort
  // dengan instruksi bersih-bersih (bukan melanjutkan dengan kondisi kotor).
  const todayStart = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: leftovers, error: leftoversErr } = await sb
    .from("orders")
    .select("order_number,payment_status")
    .in("payment_status", ["pending", "failed", "expired"])
    .gte("created_at", todayStart);
  const staleOrders = (leftovers ?? []).filter((o) => o.order_number !== "VS-20260811-0001");
  if (!leftoversErr && staleOrders.length > 0) {
    console.error(
      `✗ Order sisa di Postgres (${staleOrders.map((o) => `${o.order_number}(${o.payment_status})`).join(", ")}) — ` +
      "nomor order UNIQUE akan bertabrakan dengan checkout baru sehingga write-through gagal.\n" +
      "  Bersihkan: hapus order sisa tsb (service role), lalu RESTART dev server (cache globalThis)."
    );
    process.exit(1);
  }
  const { data: preMbr } = await sb.from("memberships").select("id").eq("user_id", await customerId());
  const preMembershipIds = new Set((preMbr ?? []).map((m) => m.id));
  // Nomor order uji — dikumpulkan untuk dibersihkan DI AKHIR (finally).
  const testOrderNumbers = new Set();

  // ---------- 1. Buat 5 order (mode demo: tanpa key → tanpa HTTP keluar) ----------
  console.log("\n[1/6] Checkout pelanggan demo → 5 order (deny / settlement / expire / deny-OVO / kontrol)...");
  const custJar = jarOf();
  await login("customer@vshop.id", "customer123", custJar);
  const orderIds = [];
  for (let i = 0; i < 5; i++) orderIds.push(await checkout(custJar));
  // Write-through db.ts ber-debounce — tunggu sampai SEMUA order ter-flush
  // ke Postgres (polling maks ~10 dtk) sebelum verifikasi.
  let created = [];
  for (let t = 0; t < 30; t++) {
    const { data } = await sb
      .from("orders")
      .select("id,order_number,total_amount,payment_status,metadata")
      .in("id", orderIds)
      .order("created_at", { ascending: true });
    created = data ?? [];
    if (created.length === orderIds.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const byId = new Map(created.map((o) => [o.id, o]));
  for (const id of orderIds) {
    const o = byId.get(id);
    ok(o && o.payment_status === "pending", `order ${o?.order_number ?? id} dibuat pending`);
  }
  for (const o of created) testOrderNumbers.add(o.order_number);
  const [deny, settle, expire, denyOvo, control] = orderIds.map((id) => byId.get(id));
  if (!deny || !settle || !expire || !denyOvo || !control) {
    throw new Error(
      "Order uji belum ter-flush ke Postgres — cek stderr server ([db] Gagal menulis, mis. bentrok nomor order UNIQUE). Bersihkan DB & restart dev server dulu."
    );
  }

  try {
  // ---------- 2. Simpan TEST KEY via Configurasi (admin) ----------
  console.log("\n[2/6] Simpan test key via /api/admin/settings (jalur Configurasi)...");
  const saved = await api("/api/admin/settings", {
    method: "POST",
    body: { updates: { midtrans_server_key: TEST_KEY } },
    jar: adminJar,
  });
  ok(saved.status === 200 && saved.data?.saved?.includes("midtrans_server_key"), "midtrans_server_key tersimpan di settings");

  // ---------- 3. Kontrol negatif: signature salah → 403, order tetap pending ----------
  console.log("\n[3/6] Webhook signature SALAH → ditolak 403 & order tidak berubah...");
  const bad = signedWebhook(control.order_number, control.total_amount, {
    statusCode: "202", transactionStatus: "deny", statusMessage: "Transaction is denied",
    paymentType: "qris", transactionId: "txn-badsig",
  }, "SB-Mid-server-BUKAN-KUNCI-SAYA");
  const badRes = await api("/api/midtrans/notification", { method: "POST", body: bad });
  ok(badRes.status === 403, `HTTP 403 untuk signature salah`, `(dapat: ${badRes.status})`);
  const controlRow = await fetchOrder(control.order_number);
  ok(controlRow.payment_status === "pending", "kontrol tetap pending");
  ok(!auditOf(controlRow).some((e) => e.source === "webhook"), "kontrol tanpa event webhook");

  // ---------- 4. Kirim 4 webhook signed ----------
  console.log("\n[4/6] Kirim webhook signed: deny → settlement → expire → deny-OVO (channel 68)...");
  const cases = [
    { name: "deny", order: deny, body: signedWebhook(deny.order_number, deny.total_amount, {
      statusCode: "202", transactionStatus: "deny", statusMessage: "Transaction is denied",
      paymentType: "qris", transactionId: "txn-deny-e2e", fraudStatus: "accept",
    }, TEST_KEY) },
    { name: "settlement", order: settle, body: signedWebhook(settle.order_number, settle.total_amount, {
      statusCode: "200", transactionStatus: "settlement", statusMessage: "Success, transaction is settled",
      paymentType: "bank_transfer", transactionId: "txn-settle-e2e", fraudStatus: "accept",
    }, TEST_KEY) },
    { name: "expire", order: expire, body: signedWebhook(expire.order_number, expire.total_amount, {
      statusCode: "203", transactionStatus: "expire", statusMessage: "Transaction is expired",
      paymentType: "qris", transactionId: "txn-expire-e2e",
    }, TEST_KEY) },
    { name: "deny-OVO", order: denyOvo, body: {
      ...signedWebhook(denyOvo.order_number, denyOvo.total_amount, {
        statusCode: "202", transactionStatus: "deny", statusMessage: "Transaction is denied",
        paymentType: "ovo", transactionId: "txn-ovo-e2e", fraudStatus: "accept",
      }, TEST_KEY),
      // Kode & pesan spesifik kanal OVO (RC sandbox resmi: 68 = timeout).
      channel_response_code: "68",
      channel_response_message: "OVO Wallet late to give response to OVO JPOS",
    } },
  ];
  for (const c of cases) {
    const r = await api("/api/midtrans/notification", { method: "POST", body: c.body });
    ok(r.status === 200 && r.data?.status_code === 200, `webhook ${c.name} diterima (HTTP ${r.status})`);
  }

  // ---------- 5. Verifikasi paymentAudit & status di Postgres ----------
  await verifyScenario("deny (qris 202)", deny.order_number, {
    paymentStatus: "failed", status: "cancelled", methodNull: true,
    failureReason: "Pembayaran ditolak oleh bank",
    last: {
      event: "failed", source: "webhook", statusCode: "202", transactionStatus: "deny", paymentType: "qris",
      // Alasan terpetakan + status_message MENTAH — keduanya tersimpan.
      detail: "Pembayaran ditolak oleh bank",
      statusMessage: "Transaction is denied",
    },
  });
  await verifyScenario("deny OVO — channel 68 (RC sandbox resmi)", denyOvo.order_number, {
    paymentStatus: "failed", status: "cancelled", methodNull: true,
    failureReasonStartsWith: "OVO tidak merespons",
    last: {
      event: "failed", source: "webhook", statusCode: "202", transactionStatus: "deny",
      paymentType: "ovo", channelResponseCode: "68",
      channelResponseMessage: "OVO Wallet late to give response to OVO JPOS",
      detailStartsWith: "OVO tidak merespons",
      statusMessage: "Transaction is denied",
    },
  });
  await verifyScenario("settlement (bank_transfer 200)", settle.order_number, {
    paymentStatus: "paid", status: "paid", method: "Virtual Account", paidAt: true,
    last: { event: "paid", source: "webhook", statusCode: "200", transactionStatus: "settlement", paymentType: "bank_transfer" },
  });
  await verifyScenario("expire (qris 203)", expire.order_number, {
    paymentStatus: "expired", status: "cancelled", methodNull: true,
    failureReason: "Waktu pembayaran habis",
    last: { event: "expired", source: "webhook", statusCode: "203", transactionStatus: "expire", paymentType: "qris" },
  });

  // Efek samping nyata: order lunas → membership aktif dibuat.
  const { data: mbrs, error: mbrErr } = await sb.from("memberships").select("id").eq("user_id", await customerId());
  ok(!mbrErr, "query memberships OK");
  const newMbr = (mbrs ?? []).filter((m) => !preMembershipIds.has(m.id));
  ok(newMbr.length === 1, `membership aktif dibuat utk order lunas (${newMbr.length})`);

  // Cross-check via aplikasi: /api/pay/[orderId]/status utk order lunas.
  const st = await api(`/api/pay/${settle.id}/status`, { jar: custJar });
  ok(st.data?.status === "paid", "Status API aplikasi menyetujui order lunas");

  // ---------- 6. Bersihkan (SELALU, termasuk saat error) ----------
  } finally {
    console.log("\n[6/6] Bersihkan data uji...");
    // Tunggu log notifikasi async (fire-and-forget dari webhook) sempat tercatat.
    await new Promise((r) => setTimeout(r, 1500));
    // Nomor order dikumpulkan dari langkah 1; tambahan best-effort dari id
    // (bila crash sebelum poll selesai).
    if (orderIds.length > 0) {
      const { data: rows } = await sb.from("orders").select("order_number").in("id", orderIds);
      for (const r of rows ?? []) testOrderNumbers.add(r.order_number);
    }
    const nums = [...testOrderNumbers];
    if (nums.length > 0) {
      const delOrders = await sb.from("orders").delete().in("order_number", nums);
      ok(!delOrders.error, `order uji dihapus dari Postgres (${nums.length})`);
      // notification_logs.order_id menyimpan NOMOR ORDER (bukan id internal).
      const delLogs = await sb.from("notification_logs").delete().in("order_id", nums);
      ok(!delLogs.error, "notification_logs uji dihapus");
    }
    // Membership yang dibuat selama uji (utk order lunas).
    const { data: mbrs } = await sb.from("memberships").select("id").eq("user_id", await customerId());
    const newMbrs = (mbrs ?? []).filter((m) => !preMembershipIds.has(m.id));
    if (newMbrs.length > 0) {
      const delMbr = await sb.from("memberships").delete().in("id", newMbrs.map((m) => m.id));
      ok(!delMbr.error, "membership uji dihapus");
    }
    const delSetting = await sb.from("app_settings").delete().eq("key", "midtrans_server_key");
    ok(!delSetting.error, "test key dihapus dari app_settings (cache server masih memegangnya sampai restart)");
  }

  // ---------- Laporan ----------
  console.log("\n" + "=".repeat(64));
  console.log("HASIL E2E WEBHOOK MIDTRANS (SUPABASE LOKAL)");
  console.log("=".repeat(64));
  console.log(`  Lolos : ${pass}`);
  console.log(`  Gagal : ${fail}`);
  console.log("\nCatatan: cache server (globalThis) masih memegang test key & order uji —");
  console.log("restart dev server untuk keadaan benar-benar bersih (pola yang sama dgn verifikasi lain).");
  process.exit(fail === 0 ? 0 : 1);
}

let cachedCustomerId;
async function customerId() {
  if (cachedCustomerId) return cachedCustomerId;
  const { data } = await sb.from("profiles").select("id").eq("email", "customer@vshop.id").single();
  cachedCustomerId = data?.id;
  return cachedCustomerId;
}

main().catch((e) => {
  console.error("✗ error:", e.message);
  process.exit(1);
});
