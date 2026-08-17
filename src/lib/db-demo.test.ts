/**
 * Unit test MODE DEMO (JSON) `src/lib/db.ts` — DEBOUNCE tulis file.
 *
 * Banyak `mutate()` berurutan dalam satu tick → MAKSIMAL SATU tulis
 * `data/db.json` (pola batch+flush yang sama dengan koalesensi Supabase,
 * snapshot terbaru menang). Jumlah tulis diukur lewat `getJsonWriteCount()`
 * (counter modul, seumur proses) dan isi file dibaca dari disk.
 * `VSHOP_DATA_DIR` mengarah ke direktori temp agar data/ proyek tak tersentuh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- Helper ----------

type DbModule = typeof import("./db");
const saveEnv: Record<string, string | undefined> = {};

let tempDir = "";
let mod: DbModule;

const tick = () => new Promise((r) => setTimeout(r, 40));

function user(id: string, name = "U") {
  return { id, name, passwordHash: "x", role: "customer" as const, createdAt: now };
}
const now = "2026-08-16T00:00:00.000Z";

function readDbFile(): { users: { id: string; name: string }[] } {
  return JSON.parse(fs.readFileSync(path.join(tempDir, "db.json"), "utf8"));
}

async function freshDemoDb(): Promise<DbModule> {
  // Pastikan tidak ada env Supabase yang bocor dari runner → mode demo murni.
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    delete process.env[k];
  }
  vi.resetModules();
  delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  const m = await import("./db");
  await m.ensureHydrated();
  expect(m.getStoreMode()).toBe("json");
  // Seed awal (file baru) menulis sekali — abaikan, hitung tulis mutasi saja.
  return m;
}

// ---------- Test ----------

describe("mode demo (JSON) — debounce tulis file", () => {
  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vshop-demo-"));
    saveEnv.VSHOP_DATA_DIR = process.env.VSHOP_DATA_DIR;
    process.env.VSHOP_DATA_DIR = tempDir;
    mod = await freshDemoDb();
  });

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [k, v] of Object.entries(saveEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("3 mutate berurutan dalam satu tick → SATU tulis file dengan snapshot terbaru", async () => {
    const before = mod.getJsonWriteCount();
    mod.mutate((d) => d.users.push(user("u1")));
    mod.mutate((d) => d.users.push(user("u2")));
    mod.mutate((d) => d.users.push(user("u3")));
    // Belum ada tulis — flush masih menunggu akhir tick (debounce).
    expect(mod.getJsonWriteCount()).toBe(before);
    await tick();
    expect(mod.getJsonWriteCount()).toBe(before + 1);
    const ids = readDbFile().users.map((u) => u.id);
    expect(ids).toContain("u1");
    expect(ids).toContain("u2");
    expect(ids).toContain("u3");
  });

  it("mutasi per tick → satu tulis per tick (bukan sekali selamanya)", async () => {
    const before = mod.getJsonWriteCount();
    mod.mutate((d) => d.users.push(user("uA")));
    await tick();
    mod.mutate((d) => d.users.push(user("uB")));
    await tick();
    mod.mutate((d) => d.users.push(user("uC")));
    await tick();
    expect(mod.getJsonWriteCount()).toBe(before + 3);
  });

  it("snapshot terbaru menang — mutasi kedua di tick yang sama tidak tertimpa tulis lama", async () => {
    const before = mod.getJsonWriteCount();
    mod.mutate((d) => d.users.push(user("u9", "Versi-1")));
    // Mutasi berikutnya sebelum flush: update baris yang sama.
    mod.mutate((d) => {
      const u = d.users.find((x) => x.id === "u9");
      if (u) u.name = "Versi-2";
    });
    await tick();
    expect(mod.getJsonWriteCount()).toBe(before + 1); // tulis lama dilewati
    expect(readDbFile().users.find((u) => u.id === "u9")?.name).toBe("Versi-2");
  });

  it("flushNow memaksa tulis segera untuk mutasi yang belum ter-flush", async () => {
    const before = mod.getJsonWriteCount();
    mod.mutate((d) => d.users.push(user("uX")));
    expect(mod.getJsonWriteCount()).toBe(before);
    await mod.flushNow(200);
    expect(mod.getJsonWriteCount()).toBe(before + 1);
    expect(readDbFile().users.map((u) => u.id)).toContain("uX");
  });

  it("upsertUser (jalur writeDirty) ikut di-debounce dengan snapshot terbaru", async () => {
    const before = mod.getJsonWriteCount();
    mod.upsertUser({ id: "u9", name: "Awal", passwordHash: "x", role: "customer", createdAt: now });
    mod.upsertUser({ id: "u9", name: "Akhir", passwordHash: "x", role: "customer", createdAt: now });
    await tick();
    expect(mod.getJsonWriteCount()).toBe(before + 1);
    expect(readDbFile().users.find((u) => u.id === "u9")?.name).toBe("Akhir");
  });

  it("getPersistQueueInfo: mode json + jsonWriteCount sinkron dengan counter (observability /api/health)", async () => {
    const before = mod.getJsonWriteCount();
    const info0 = mod.getPersistQueueInfo();
    expect(info0.storeMode).toBe("json");
    expect(info0.jsonWriteCount).toBe(before);

    mod.mutate((d) => d.users.push(user("u-a")));
    mod.mutate((d) => d.users.push(user("u-b")));
    await tick(); // debounce: 1 tulis
    const info1 = mod.getPersistQueueInfo();
    expect(info1.jsonWriteCount).toBe(before + 1);
    expect(info1.jsonWriteCount).toBe(mod.getJsonWriteCount());
  });
});
