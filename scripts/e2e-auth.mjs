#!/usr/bin/env node
/**
 * E2E alur login WhatsApp (Supabase Auth + middleware renewal).
 *
 * Self-contained: menyalakan MOCK Supabase (Auth + PostgREST) lokal + aplikasi
 * Next.js dalam mode Supabase, lalu menguji:
 *
 *   A. Daftar dengan nomor E.164 (+62…) → sesi + cookie refresh dibuat.
 *   B. Login phone + password (format lokal 08xx dinormalisasi ke E.164)
 *      → sesi + cookie refresh dibuat.
 *   C. Renew: cookie sesi dihapus, cookie refresh dipertahankan → middleware
 *      memperbarui sesi SEBELUM render → cookie refresh BERTAHAN (di-rotasi,
 *      masih bisa dipakai untuk renew berikutnya); token lama jadi invalid.
 *
 * Jalankan:  node scripts/e2e-auth.mjs
 * Opsional:  node scripts/e2e-auth.mjs --keep   (jangan matikan server saat keluar)
 */
import { spawn } from "node:child_process";
import http from "node:http";
import { randomBytes } from "node:crypto";

// ==================== Util ====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KEEP = process.argv.includes("--keep");

function getFreePort() {
  return new Promise((resolve) => {
    const srv = http.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function parseCookies(res) {
  const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const jar = {};
  for (const sc of setCookies) {
    const [pair] = sc.split(";");
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar, omit = []) {
  return Object.entries(jar)
    .filter(([k]) => !omit.includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// ==================== Mock Supabase ====================
class MockSupabase {
  constructor() {
    this.users = new Map(); // id → auth user
    this.refresh = new Map(); // token → { userId, used }
    this.tables = {
      profiles: [],
      sessions: [],
      packages: [
        { id: "pkg-e2e-7", name: "Paket 7 Hari", days: 7, price: 7000, features: ["a"], badge: null },
        { id: "pkg-e2e-14", name: "Paket 14 Hari", days: 14, price: 13000, features: ["a"], badge: "TERPOPULER" },
        { id: "pkg-e2e-30", name: "Paket 30 Hari", days: 30, price: 25000, features: ["a"], badge: "PALING HEMAT" },
      ],
      merchants: [],
      memberships: [],
      promos: [],
      vouchers: [],
      claimed_vouchers: [],
      orders: [],
      merchandise: [],
      wallets: [],
      carts: [],
    };
    this.reqLog = [];
  }

  digits(p) {
    return String(p ?? "").replace(/\D/g, "");
  }

  issueSession(userId, n) {
    const token = `rt_${userId}_${n}`;
    this.refresh.set(token, { userId, used: false });
    const payload = btoa(JSON.stringify({ sub: userId, role: "authenticated" }));
    return {
      access_token: `header.${payload}.sig`,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: token,
      user: this.users.get(userId),
    };
  }

  // ---- PostgREST ----
  handleRest(req, url) {
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return null;
    const table = m[1];
    const rows = this.tables[table] ?? [];
    const maybeSingle = (req.headers.accept ?? "").includes("pgrst.object");

    if (req.method === "GET") {
      const select = url.searchParams.get("select") ?? "*";
      // Aplikasi memakai sintaks `Alias:column` (dipertahankan postgrest-js v2 &
      // diterima PostgREST asli; bentuk `col as "alias"` DITOLAK PostgREST karena
      // postgrest-js v2 menghilangkan spasi). Dukungan `as "..."` tetap ada untuk
      // kompatibilitas.
      const cols = select.split(",").map((s) => {
        const t = s.trim();
        const cm = t.match(/^([a-zA-Z_][a-zA-Z0-9_]*):([a-z_][a-z0-9_]*)$/);
        if (cm) return { src: cm[2], out: cm[1] };
        const am = t.match(/^(.*?)as\s*"([^"]+)"$/);
        return am ? { src: am[1].trim(), out: am[2] } : { src: t, out: t };
      });
      // filter: format PostgREST `col=eq.<val>` — operator di NILAI, bukan kunci
      let out = rows;
      for (const [k, v] of url.searchParams.entries()) {
        const fm = v.match(/^eq\.([\s\S]*)$/);
        if (fm) {
          const val = fm[1];
          out = out.filter((r) => String(r[k] ?? "") === val);
        }
      }
      const projected = out.map((r) => {
        const o = {};
        for (const c of cols) {
          o[c.out] = c.src === "*" ? r : r[c.src] ?? null;
        }
        return o;
      });
      if (maybeSingle) {
        if (projected.length === 0) {
          this.reqLog.push(`GET ${table} → 0 baris (maybeSingle null)`);
          return this.json(200, null);
        }
        if (projected.length > 1) return this.json(406, { message: "multiple rows" });
        this.reqLog.push(`GET ${table} → 1 baris`);
        return this.json(200, projected[0]);
      }
      this.reqLog.push(`GET ${table} → ${projected.length} baris`);
      return this.json(200, projected);
    }

    if (req.method === "POST" && table) {
      return this.readBody(req).then((body) => {
        const incoming = Array.isArray(body) ? body : [body];
        for (const row of incoming) {
          const key = row.id ?? row.token ?? row.user_id;
          if (key !== undefined) {
            const idx = rows.findIndex((r) => (r.id ?? r.token ?? r.user_id) === key);
            if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
            else rows.push({ ...row });
          } else rows.push({ ...row });
        }
        this.reqLog.push(`POST ${table} upsert ${incoming.length} baris`);
        return this.json(200, incoming);
      });
    }
    return this.json(405, { message: "method not allowed" });
  }

  // ---- Auth ----
  handleAuth(req, url) {
    if (url.pathname === "/auth/v1/admin/users" && req.method === "POST") {
      return this.readBody(req).then((body) => {
        // Supabase menolak nomor yang sudah terdaftar (uniqueness di auth.users)
        const dupPhone =
          body.phone &&
          [...this.users.values()].some((u) => u.phone && this.digits(u.phone) === this.digits(body.phone));
        if (dupPhone) {
          this.reqLog.push(`POST admin/users → duplikat phone`);
          return this.json(400, {
            error: "phone_exists",
            error_description: "Phone number already registered",
            code: "phone_exists",
          });
        }
        const id = `auth_${this.users.size + 1}`;
        const user = {
          id,
          phone: body.phone ?? null,
          email: body.email ?? null,
          phone_confirm: true,
          email_confirm: true,
          user_metadata: body.user_metadata ?? {},
          created_at: new Date().toISOString(),
          // Supabase menyimpan password di auth.users — bukan di tabel profil
          // (aplikasi menulis password_hash = null ke profiles saat upsert).
          password: body.password ?? null,
        };
        this.users.set(id, user);
        // Simulasi trigger handle_new_user → profil aplikasi.
        this.tables.profiles.push({
          id,
          name: user.user_metadata.name ?? "",
          phone: user.phone ? this.digits(user.phone) : null,
          email: user.email ?? null,
          password_hash: body.password ?? "",
          role: "customer",
          created_at: user.created_at,
        });
        this.reqLog.push(`POST admin/users → ${id} (${user.phone})`);
        return this.json(200, user);
      });
    }

    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      return this.readBody(req).then((body) => {
        if (grant === "password") {
          const digits = body.phone ? this.digits(body.phone) : null;
          const user = [...this.users.values()].find(
            (u) =>
              (digits && this.digits(u.phone) === digits) ||
              (body.email && u.email === body.email)
          );
          const okPass = user && user.password === body.password;
          if (!user || !okPass) {
            this.reqLog.push("POST token/password → invalid credentials");
            return this.json(400, { error: "invalid_credentials", error_description: "Invalid login credentials" });
          }
          const n = [...this.refresh.entries()].filter(([, v]) => v.userId === user.id).length + 1;
          this.reqLog.push(`POST token/password → ${user.phone}`);
          return this.json(200, this.issueSession(user.id, n));
        }
        if (grant === "refresh_token") {
          const entry = this.refresh.get(body.refresh_token);
          if (!entry || entry.used) {
            this.reqLog.push("POST token/refresh → invalid_grant");
            return this.json(400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
          }
          entry.used = true; // rotasi: token lama tidak bisa dipakai lagi
          const user = this.users.get(entry.userId);
          const n = [...this.refresh.entries()].filter(([, v]) => v.userId === user.id).length + 1;
          this.reqLog.push(`POST token/refresh → rotasi ke rt_${user.id}_${n}`);
          return this.json(200, this.issueSession(user.id, n));
        }
        return this.json(400, { error: "unsupported_grant_type" });
      });
    }
    return null;
  }

  readBody(req) {
    return new Promise((resolve) => {
      let s = "";
      req.on("data", (c) => (s += c));
      req.on("end", () => {
        try {
          resolve(s ? JSON.parse(s) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  json(status, data) {
    return { status, data };
  }

  listen(port) {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const run = async () => {
        let handled = this.handleAuth(req, url);
        if (handled === null) handled = this.handleRest(req, url);
        if (handled === null) {
          this.reqLog.push(`${req.method} ${url.pathname} → 404`);
          handled = this.json(404, { message: "not found" });
        }
        const out = await handled;
        res.writeHead(out.status, {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(JSON.stringify(out.data)),
          "Prefer": "return=representation",
        });
        res.end(JSON.stringify(out.data));
      };
      run().catch(() => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end("{}");
      });
    });
    return new Promise((resolve) => this.server.listen(port, "127.0.0.1", resolve));
  }

  close() {
    return new Promise((r) => this.server?.close(r));
  }
}

// ==================== Aplikasi ====================
function spawnApp(port, mockPort) {
  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${mockPort}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb-anon-e2e-test",
    SUPABASE_SERVICE_ROLE_KEY: "sb-service-e2e-test",
    SESSION_ENCRYPTION_KEY: Buffer.from(randomBytes(32)).toString("base64"),
  };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npm, ["run", "dev", "--", "-p", String(port)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    // Windows: npm.cmd butuh shell agar bisa dieksekusi (EINVAL tanpa shell).
    shell: process.platform === "win32",
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, getLog: () => log };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch { /* abaikan */ }
}

async function waitReady(port, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.status < 500) return true;
    } catch { /* belum siap */ }
    await sleep(1000);
  }
  return false;
}

// ==================== Tes ====================
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ==================== Main ====================
const BASE = "http://127.0.0.1";
const mock = new MockSupabase();
const mockPort = await getFreePort();
const appPort = await getFreePort();
await mock.listen(mockPort);
console.log(`▶ Mock Supabase    : ${BASE}:${mockPort}`);

let app;
try {
  app = spawnApp(appPort, mockPort);
} catch (e) {
  console.error("✗ Gagal spawn aplikasi:", e.message);
  await mock.close();
  process.exit(1);
}
console.log(`▶ Aplikasi Next.js : ${BASE}:${appPort} (mode Supabase, tunggu siap…)`);

let appReady = await waitReady(appPort);
if (!appReady) {
  console.error("✗ Aplikasi tidak siap dalam waktu tunggu. Log:\n" + app.getLog().slice(-1500));
  killTree(app.child);
  await mock.close();
  process.exit(1);
}
console.log("  Aplikasi siap.\n");

const PHONE_E164 = "+6281298765432";
const PHONE_LOCAL = "081298765432";
const PASS = "rahasia123";
const NAME = "Budi E2E";

try {
  // ---------- A. Daftar dengan nomor E.164 ----------
  await test("A. Daftar dengan nomor E.164 → sesi + cookie refresh dibuat", async () => {
    const res = await fetch(`${BASE}:${appPort}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "customer",
        name: NAME,
        phone: PHONE_E164,
        password: PASS,
        confirmPassword: PASS,
      }),
    });
    const body = await res.json().catch(() => null);
    assert(res.status === 200 && body?.ok, `daftar gagal: ${res.status} ${JSON.stringify(body)}`);
    const jar = parseCookies(res);
    assert(jar.vshop_session, "cookie sesi tidak diset");
    assert(jar.vshop_sb_refresh, "cookie refresh tidak diset");
    const stateOf = (html) =>
      html.includes(NAME)
        ? "login"
        : html.includes("Belum masuk")
          ? "belum-login"
          : html.includes("Kamu sedang sebagai Tamu")
            ? "guest"
            : "lainnya";
    const akun1 = await fetch(`${BASE}:${appPort}/akun`, { headers: { Cookie: cookieHeader(jar) } });
    const s1 = stateOf(await akun1.text());
    await sleep(2000); // beri waktu flush tulis async
    const akun2 = await fetch(`${BASE}:${appPort}/akun`, { headers: { Cookie: cookieHeader(jar) } });
    const s2 = stateOf(await akun2.text());
    if (s1 !== "login" || s2 !== "login") {
      // Debug: bandingkan token di cookie vs token sesi di mock
      const sess = await fetch(`${BASE}:${mockPort}/rest/v1/sessions?select=token,user_id`).then((r) => r.json());
      const akunHeaders = akun1.headers.getSetCookie ? akun1.headers.getSetCookie() : [];
      console.log(`    [debug A] cookie sesi=${jar.vshop_session?.slice(0, 8)}… | mock sessions=${sess.map((s) => s.token.slice(0, 8)).join(",")}`);
      console.log(`    [debug A] Set-Cookie dari /akun#1: ${akunHeaders.join(" | ") || "(tidak ada)"}`);
    }
    assert(
      akun1.status === 200 && s1 === "login",
      `halaman akun state: langsung="${s1}", setelah 2s="${s2}" (harus login)`
    );
  });

  // ---------- B. Login phone + password ----------
  let loginJar;
  await test("B. Login phone + password (08xx dinormalisasi ke E.164)", async () => {
    const res = await fetch(`${BASE}:${appPort}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: PHONE_LOCAL, password: PASS, role: "customer" }),
    });
    const body = await res.json().catch(() => null);
    assert(res.status === 200 && body?.ok, `login gagal: ${res.status} ${JSON.stringify(body)}`);
    loginJar = parseCookies(res);
    assert(loginJar.vshop_session && loginJar.vshop_sb_refresh, "cookie sesi/refresh tidak diset saat login");
    const akun = await fetch(`${BASE}:${appPort}/akun`, { headers: { Cookie: cookieHeader(loginJar) } });
    assert((await akun.text()).includes(NAME), "sesi login tidak valid");
  });

  // ---------- C. Renew via middleware ----------
  if (!loginJar?.vshop_session || !loginJar?.vshop_sb_refresh) {
    await test("C. Renew (dilewati — login gagal)", () => {
      throw new Error("Test B gagal, tidak ada cookie untuk di-renew.");
    });
  } else {
  const S1 = loginJar.vshop_session;
  const R1 = loginJar.vshop_sb_refresh;

  await test("C.1 Renew: hapus sesi cookie, refresh cookie dipertahankan → middleware set sesi baru", async () => {
    const res = await fetch(`${BASE}:${appPort}/beranda`, {
      headers: { Cookie: `vshop_sb_refresh=${R1}` }, // tanpa sesi — middleware slow path
    });
    assert(res.status === 200, `halaman gagal: ${res.status}`);
    const jar = parseCookies(res);
    assert(jar.vshop_session && jar.vshop_session !== S1, "sesi baru tidak diset / tidak berubah");
    assert(jar.vshop_sb_refresh && jar.vshop_sb_refresh !== R1, "refresh token tidak dirotasi oleh renew");
    loginJar = jar;
  });

  await test("C.2 Sesuai renew, sesi tetap valid (login tanpa flash) — /akun menampilkan nama", async () => {
    const akun = await fetch(`${BASE}:${appPort}/akun`, { headers: { Cookie: cookieHeader(loginJar) } });
    assert(akun.status === 200 && (await akun.text()).includes(NAME), "sesi hasil renew tidak valid");
  });

  await test("C.3 Refresh cookie BERTAHAN: bisa dipakai renew berikutnya (rotasi berlanjut)", async () => {
    const R2 = loginJar.vshop_sb_refresh;
    const res = await fetch(`${BASE}:${appPort}/beranda`, {
      headers: { Cookie: `vshop_sb_refresh=${R2}` },
    });
    assert(res.status === 200, `halaman gagal: ${res.status}`);
    const jar = parseCookies(res);
    assert(jar.vshop_session && jar.vshop_session !== loginJar.vshop_session, "renew kedua tidak membuat sesi baru");
    assert(jar.vshop_sb_refresh && jar.vshop_sb_refresh !== R2, "renew kedua tidak merotasi refresh token");
  });

  await test("C.4 Token refresh lama (R1) sudah invalid → middleware bersihkan cookie refresh", async () => {
    const res = await fetch(`${BASE}:${appPort}/beranda`, {
      headers: { Cookie: `vshop_sb_refresh=${R1}` }, // token lama yang sudah dipakai
    });
    assert(res.status === 200, `halaman gagal (renewal tak boleh menggagalkan request): ${res.status}`);
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const cleared = sc.find((c) => c.startsWith("vshop_sb_refresh="));
    assert(cleared && /max-age=0|expires=/i.test(cleared), "cookie refresh tidak dibersihkan untuk token invalid");
  });
  }

  // ---------- Laporan ----------
  const fail = results.filter((r) => !r.ok);
  console.log(`\n=== Hasil: ${results.length - fail.length}/${results.length} lolos ===`);
  for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}`);
  if (fail.length > 0) {
    console.log("\nMock requests (debug):");
    console.log(mock.reqLog.map((l) => "  " + l).join("\n"));
    console.log("\nApp log (debug):\n" + app.getLog().slice(-1200));
    process.exitCode = 1;
  } else {
    console.log("\nSemua alur login WhatsApp terverifikasi ✅");
  }
} finally {
  if (KEEP) {
    // Mode debug: pertahankan mock + aplikasi tetap hidup (Ctrl+C untuk
    // berhenti) — berguna untuk inspeksi manual setelah tes selesai.
    console.log(`\n(--keep) Mock: ${BASE}:${mockPort} · App: ${BASE}:${appPort}`);
    console.log("  Tekan Ctrl+C untuk menghentikan.");
    await new Promise(() => {});
  } else {
    killTree(app.child);
    await mock.close();
    await sleep(500); // beri waktu taskkill menyelesaikan pohon proses
    console.log("\nServers dihentikan (pakai --keep untuk membiarkan tetap berjalan).");
    process.exit(process.exitCode ?? 0);
  }
}
