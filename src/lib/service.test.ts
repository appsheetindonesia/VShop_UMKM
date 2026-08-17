/**
 * Unit test `retryOrderPayment` (src/lib/service.ts): pada retry, order
 * mendapat NOMOR ORDER BARU (order_id lama berstatus terminal bisa ditolak
 * Midtrans) + riwayat nomor tersimpan di metadata. Mode Supabase di-mock
 * (sama seperti db.test.ts) sehingga tidak menyentuh disk / jaringan.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAdmin, store, calls, resetAll } = vi.hoisted(() => {
  const store: Record<string, unknown[]> = {};
  const calls: { method: string; table: string; rows?: unknown[] }[] = [];
  const project = (sel: string, row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    const re = /([a-z_]+)(?:\s+as\s+"([a-zA-Z_]+)")?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sel))) {
      const src = m[1];
      const dest = m[2] ?? m[1];
      if (src in row) out[dest] = row[src];
    }
    return out;
  };
  const client = {
    from(table: string) {
      return {
        select: async (sel: string) => ({
          data: (store[table] ?? []).map((r) => project(sel, r as Record<string, unknown>)),
          error: null,
        }),
        upsert: async (rows: unknown[]) => {
          calls.push({ method: "upsert", table, rows });
          store[table] = rows;
          return { error: null, data: rows };
        },
        insert: async (rows: unknown[]) => {
          calls.push({ method: "insert", table, rows });
          store[table] = [...(store[table] ?? []), ...(Array.isArray(rows) ? rows : [rows])];
          return { error: null, data: rows };
        },
      };
    },
  };
  return {
    mockAdmin: client,
    store,
    calls,
    resetAll: () => {
      for (const k of Object.keys(store)) delete store[k];
      calls.length = 0;
    },
  };
});

vi.mock("./supabase/server", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => mockAdmin,
  getSupabaseAnon: () => mockAdmin,
}));

// Tanpa MIDTRANS_SERVER_KEY → createPaymentTransaction mode demo (token
// tiruan, tanpa jaringan) — tepat untuk menguji logika retry.
const waitFlush = () => new Promise((r) => setTimeout(r, 30));

async function freshDb() {
  vi.resetModules();
  resetAll();
  const db = await import("./db");
  await db.ensureHydrated(); // mode supabase (mock)
  return await import("./service");
}

describe("retryOrderPayment", () => {
  it("memberi nomor order baru + menyimpan riwayat di metadata", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    const oldNumber = order.orderNumber;
    // Nomor invoice STABIL dibuat saat order dibuat (VS-INV-…).
    const invoiceNumber = order.metadata.invoiceNumber;
    expect(invoiceNumber).toMatch(/^VS-INV-\d{8}-\d{4}$/);
    expect(invoiceNumber).not.toBe(oldNumber);

    // Tandai gagal dulu (dengan alasan spesifik).
    svc.markOrderFailed(order.id, "failed", "Pembayaran ditolak oleh bank");
    await waitFlush();

    const retried = await svc.retryOrderPayment(order.id);
    const retriedNumber = retried.orderNumber; // objek live — tangkap nilainya
    expect(retriedNumber).not.toBe(oldNumber);
    expect(retried.paymentStatus).toBe("pending");
    expect(retried.status).toBe("pending");
    expect(retried.metadata.originalOrderNumber).toBe(oldNumber);
    expect(retried.metadata.previousOrderNumbers).toEqual([oldNumber]);
    // Alasan kegagalan lama dibersihkan.
    expect(retried.metadata.failureReason).toBeUndefined();
    // Token dibuat ulang untuk transaksi baru (mode demo: snap-demo-<orderId>).
    expect(retried.snapToken).toMatch(/^snap-demo-/);
    // NOMOR INVOICE TIDAK BERUBAH saat retry mengganti nomor order — stabil
    // untuk bukti transaksi (beda dari orderNumber).
    expect(retried.metadata.invoiceNumber).toBe(invoiceNumber);
    expect(retried.metadata.invoiceNumber).not.toBe(retriedNumber);
  });

  it("retry kedua menghasilkan nomor baru lagi, riwayat bertambah, invoice tetap", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });
    const original = order.orderNumber;
    const invoice = order.metadata.invoiceNumber;

    const r1 = await svc.retryOrderPayment(order.id);
    const r1Number = r1.orderNumber; // objek live — tangkap nilainya sekarang
    const r2 = await svc.retryOrderPayment(order.id);
    const r2Number = r2.orderNumber;
    const r2History = [...(r2.metadata.previousOrderNumbers as string[])];

    expect(r1Number).not.toBe(original);
    expect(r2Number).not.toBe(original);
    expect(r2Number).not.toBe(r1Number); // wajib beda dari retry pertama
    expect(r2.metadata.originalOrderNumber).toBe(original);
    expect(r2History).toEqual([original, r1Number]);
    // Nomor invoice stabil sepanjang rantai retry (2x retry → tetap sama).
    expect(r2.metadata.invoiceNumber).toBe(invoice);
  });

  it("MENOLAK retry untuk order yang sudah lunas (guard API, bukan hanya UI)", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });
    svc.markOrderPaid(order.id, "QRIS");
    await waitFlush();
    // Baca state LIVE dari store (objek hasil createOrder adalah snapshot).
    const livePaid = svc.getOrder(order.id)!;
    const paidNumber = livePaid.orderNumber;
    const paidAt = livePaid.paidAt;

    // Pertahanan di sisi API: retry order lunas harus ditolak — membuat
    // transaksi baru untuk order yang sudah dibayar berisiko charge ganda.
    await expect(svc.retryOrderPayment(order.id)).rejects.toThrow(
      /Order sudah lunas/
    );
    // Order tetap lunas — tidak direset, nomor & paidAt tidak berubah,
    // tidak ada transaksi/riwayat baru.
    const after = svc.getOrder(order.id)!;
    expect(after.paymentStatus).toBe("paid");
    expect(after.orderNumber).toBe(paidNumber);
    expect(after.paidAt).toBe(paidAt);
    expect(after.metadata.previousOrderNumbers).toBeUndefined();
    expect(after.metadata.originalOrderNumber).toBeUndefined();
  });

  it("MENOLAK retry melebihi batas percobaan (maks MAX_ORDER_RETRIES, default 3)", async () => {
    const svc = await freshDb();
    const service = await import("./service");
    const max = service.MAX_ORDER_RETRIES;
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });

    // max percobaan pertama berhasil (tiap retry → pending + nomor baru).
    let lastNumber = order.orderNumber;
    for (let i = 0; i < max; i++) {
      const r = await svc.retryOrderPayment(order.id);
      expect(r.paymentStatus).toBe("pending");
      expect(r.orderNumber).not.toBe(lastNumber);
      lastNumber = r.orderNumber;
    }
    // Hitungan di log audit sesuai batas.
    const before = svc.getOrder(order.id)!;
    expect(
      (before.metadata.paymentAudit as { event: string }[]).filter(
        (e) => e.event === "retry"
      ).length
    ).toBe(max);

    // Retry ke-(max+1) ditolak di sisi service (API mengembalikan 400).
    await expect(svc.retryOrderPayment(order.id)).rejects.toThrow(
      /Batas percobaan pembayaran ulang/
    );
    // Order tetap pending, nomor & riwayat TIDAK berubah setelah batas.
    const after = svc.getOrder(order.id)!;
    expect(after.paymentStatus).toBe("pending");
    expect(after.orderNumber).toBe(lastNumber);
    expect(
      (after.metadata.paymentAudit as { event: string }[]).filter(
        (e) => e.event === "retry"
      ).length
    ).toBe(max);
  });
});

describe("createOrder — nomor invoice stabil (VS-INV-…)", () => {
  it("dibuat sekali dengan format VS-INV-YYYYMMDD-XXXX, unik & naik per order", async () => {
    const svc = await freshDb();
    const a = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [],
      totalAmount: 1000,
      metadata: {},
    });
    const b = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [],
      totalAmount: 1000,
      metadata: {},
    });
    const invA = String(a.order.metadata.invoiceNumber);
    const invB = String(b.order.metadata.invoiceNumber);
    expect(invA).toMatch(/^VS-INV-\d{8}-\d{4}$/);
    expect(invB).toMatch(/^VS-INV-\d{8}-\d{4}$/);
    expect(invA).not.toBe(invB);
    // Suffix naik untuk hari yang sama (maks + 1).
    expect(Number(invB.slice(-4))).toBe(Number(invA.slice(-4)) + 1);
    // Berbeda dari nomor order (yang dipakai Midtrans).
    expect(invA).not.toBe(a.order.orderNumber);
  });

  it("tahan gap: order dengan suffix tinggi dihapus → berikutnya maks+1", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
      today.getDate()
    ).padStart(2, "0")}`;
    db.mutate((d) => {
      d.orders.push({
        id: "o-gap",
        orderNumber: "VS-20260817-0001",
        userId: "u1",
        type: "package",
        items: [],
        totalAmount: 5000,
        status: "paid",
        paymentStatus: "paid",
        metadata: { invoiceNumber: `VS-INV-${ymd}-0009` },
        createdAt: new Date().toISOString(),
      } as never);
    });
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [],
      totalAmount: 1000,
      metadata: {},
    });
    expect(String(order.metadata.invoiceNumber)).toBe(`VS-INV-${ymd}-0010`);
  });
});

describe("notifikasi voucher hampir kadaluarsa (tier 48 jam & H-1/24 jam)", () => {
  // freshDb() di file ini TIDAK menghapus holder globalThis (keputusan
  // arsitektur #9) — tanpa ini, seed test sebelumnya bocor ke test berikut
  // (id voucher/klaim duplikat). Bersihkan holder agar tiap test fresh.
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  /** Seed voucher + klaim langsung via mutate (tanpa syarat membership/kuota). */
  async function seedExpiringClaim(
    svc: typeof import("./service"),
    db: typeof import("./db"),
    opts: {
      expInHours: number;
      expiringNotifiedAt?: string;
      expiring24hNotifiedAt?: string;
    }
  ) {
    const now = Date.now();
    const voucher = {
      id: "v-exp",
      merchantId: "m1",
      merchantName: "Warung Nusantara",
      name: "Diskon 20% Makanan",
      jenisVoucher: "diskon",
      nilai: 20000,
      minTransaksi: 100000,
      kuota: 100,
      masaBerlaku: new Date(now + opts.expInHours * 3_600_000).toISOString(),
      maksPenggunaan: 1,
      syaratKetentuan: "",
      jumlah: 100,
      status: "active" as const,
      createdAt: new Date(now - 86_400_000).toISOString(),
    };
    const claim = {
      id: "clm-exp",
      voucherId: voucher.id,
      userId: "u1",
      kode: "VS-EXP-0001",
      kodeKonfirmasi: "111111",
      status: "active" as const,
      claimedAt: new Date(now - 86_400_000).toISOString(),
      useCount: 0,
      expiringNotifiedAt: opts.expiringNotifiedAt,
      expiring24hNotifiedAt: opts.expiring24hNotifiedAt,
    };
    db.mutate((d) => {
      d.vouchers.push(voucher);
      d.claimedVouchers.push(claim);
    });
    return { voucher, claim };
  }

  it("tier H-1 menemukan klaim yang habis dalam 24 jam ke depan", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedExpiringClaim(svc, db, { expInHours: 20 });

    const now = new Date();
    const due = svc.getClaimsExpiringSoon24h(24, now);
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe("clm-exp");
    expect(due[0].voucher?.name).toBe("Diskon 20% Makanan");

    // Klaim yang habis > 24 jam (mis. 30 jam) tidak masuk tier H-1.
    db.mutate((d) => {
      const v = d.vouchers.find((x) => x.id === "v-exp")!;
      v.masaBerlaku = new Date(now.getTime() + 30 * 3_600_000).toISOString();
    });
    expect(svc.getClaimsExpiringSoon24h(24, now)).toHaveLength(0);
    // Tapi masih masuk tier 48 jam.
    expect(svc.getClaimsExpiringSoon(48, now)).toHaveLength(1);
  });

  it("dedupe H-1 independen dari tier 48 jam (tidak saling blokir)", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();

    // Sudah dinotifikasi 48 jam → tier 48 jam lewati, tier H-1 masih kirim.
    await seedExpiringClaim(svc, db, { expInHours: 12, expiringNotifiedAt: new Date().toISOString() });
    expect(svc.getClaimsExpiringSoon(24, now)).toHaveLength(0);
    expect(svc.getClaimsExpiringSoon24h(24, now)).toHaveLength(1);

    // Setelah H-1 dikirim (markClaimExpiring24hNotified) → keduanya lewati.
    svc.markClaimExpiring24hNotified("clm-exp");
    expect(svc.getClaimsExpiringSoon24h(24, now)).toHaveLength(0);
  });

  it("markClaimExpiring24hNotified hanya mengisi kolom tier H-1", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedExpiringClaim(svc, db, { expInHours: 12 });

    svc.markClaimExpiring24hNotified("clm-exp");
    const c = db.getDB().claimedVouchers.find((x) => x.id === "clm-exp")!;
    expect(c.expiring24hNotifiedAt).toBeTruthy();
    expect(c.expiringNotifiedAt).toBeUndefined();

    // Tier 48 jam tidak terblokir oleh penandaan tier H-1.
    expect(svc.getClaimsExpiringSoon(24, new Date())).toHaveLength(1);
  });
});

describe("runExpiryJob merekam run ke cron_runs (satu baris per eksekusi)", () => {
  // freshDb() tidak menghapus holder globalThis (keputusan #9) — bersihkan
  // agar state test sebelumnya tidak bocor ke test ini.
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("mencatat expiredCount (termasuk run 0) untuk laporan admin", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const cron = await import("./cron");
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });

    // Run #1: tidak ada order basi → tercatat 0 (job tetap "pernah berjalan").
    // Pencatatan kini di runExpiryJob (bukan service) agar satu baris per
    // eksekusi lengkap (order + pengingat voucher).
    expect(await cron.runExpiryJob()).toEqual([]);

    // Backdate order > ORDER_EXPIRY_HOURS jam → run #2 men-expire 1 order.
    db.mutate((d) => {
      const o = d.orders.find((x) => x.id === order.id)!;
      o.createdAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    });
    const expired = await cron.runExpiryJob();
    expect(expired).toContain(order.id);
    await waitFlush();

    const runs = (store["cron_runs"] ?? []) as Array<{
      job: string;
      expired_count: number;
      ran_at: string;
    }>;
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ job: "expire", expired_count: 0 });
    expect(runs[1]).toMatchObject({ job: "expire", expired_count: 1 });
    expect(new Date(runs[1].ran_at).getTime() >= new Date(runs[0].ran_at).getTime()).toBe(true);
  });
});

describe("ORDER_EXPIRY_HOURS kecil (0.01 jam = 36 detik) — verifikasi batas cepat", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("men-expire order > 36 detik, membiarkan yang lebih muda tetap pending", async () => {
    process.env.ORDER_EXPIRY_HOURS = "0.01"; // 0.01 jam = 36 detik
    try {
      const svc = await freshDb(); // nilai dibaca per-panggilan — resetModules tak lagi wajib
      const db = await import("./db");

      const mkOrder = async (tag: string, backdateSec: number) => {
        const { order } = await svc.createOrder({
          userId: "u1",
          type: "package",
          items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
          totalAmount: 7000,
          metadata: { tag },
        });
        db.mutate((d) => {
          const o = d.orders.find((x) => x.id === order.id)!;
          o.createdAt = new Date(Date.now() - backdateSec * 1000).toISOString();
        });
        return order;
      };

      const old = await mkOrder("old", 60); // 60 detik lalu → melewati 36s → expire
      const young = await mkOrder("young", 10); // 10 detik lalu → belum lewat → tetap pending

      const cron = await import("./cron");
      const expired = await cron.runExpiryJob();
      expect(expired).toContain(old.id);
      expect(expired).not.toContain(young.id);
      expect(svc.getOrder(old.id)!.paymentStatus).toBe("expired");
      expect(svc.getOrder(young.id)!.paymentStatus).toBe("pending");

      await waitFlush();
      const runs = (store["cron_runs"] ?? []) as Array<{ expired_count: number }>;
      expect(runs[runs.length - 1]?.expired_count).toBe(1);
    } finally {
      delete process.env.ORDER_EXPIRY_HOURS;
    }
  });

  it("cutoff membaca ORDER_EXPIRY_HOURS per-panggilan: env diubah setelah module load langsung berlaku", async () => {
    process.env.ORDER_EXPIRY_HOURS = "24"; // module load dengan default 24 jam
    try {
      const svc = await freshDb(); // import SEKARANG (tanpa reset ulang setelahnya)
      const db = await import("./db");

      const { order } = await svc.createOrder({
        userId: "u1",
        type: "package",
        items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
        totalAmount: 7000,
        metadata: { tag: "per-request" },
      });
      db.mutate((d) => {
        const o = d.orders.find((x) => x.id === order.id)!;
        o.createdAt = new Date(Date.now() - 30_000).toISOString(); // 30 detik lalu
      });

      // Ubah env TANPA resetModules. Dengan cutoff per-panggilan, 0.001 jam
      // (= 3,6 detik) langsung berlaku → order 30 detik ikut di-expire.
      // Perilaku lama (konstanta module-load 24 jam) TIDAK akan men-expire-nya.
      process.env.ORDER_EXPIRY_HOURS = "0.001";
      const expired = svc.expireStaleOrders(new Date());
      expect(expired).toContain(order.id);
      expect(svc.getOrder(order.id)!.paymentStatus).toBe("expired");
    } finally {
      delete process.env.ORDER_EXPIRY_HOURS;
    }
  });
});

describe("nextOrderNumber — tahan gap/deletion", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("nomor yang dihapus tidak dipakai ulang (hanya tersisa 0002 → berikutnya 0003)", async () => {
    const svc = await freshDb();
    const db = await import("./db");

    const mk = () =>
      svc.createOrder({
        userId: "u1",
        type: "topup",
        items: [{ name: "A", unitPrice: 1, quantity: 1 }],
        totalAmount: 1,
        metadata: {},
      });

    const a = await mk();
    const b = await mk();
    expect(b.order.orderNumber.endsWith("-0002")).toBe(true);

    // Simulasi cleanup data uji: hapus order pertama → tersisa hanya 0002.
    db.mutate((d) => {
      d.orders = d.orders.filter((o) => o.id !== a.order.id);
    });

    const c = await mk();
    // Tanpa fix (count+1): count=1 → "0002" (DUPLIKAT). Dengan fix (max+1): "0003".
    expect(c.order.orderNumber.endsWith("-0003")).toBe(true);
    expect(c.order.orderNumber).not.toBe(b.order.orderNumber);
  });
});

describe("getAdminPaymentSummary (dashboard admin)", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  /** Seed user + order langsung (tanpa createOrder → tanpa Midtrans). */
  async function seedOrders() {
    const svc = await freshDb();
    const db = await import("./db");
    // Waktu relatif terhadap AWAL HARI INI (zona server) — bukan `now`,
    // agar suite tetap hijau bila dijalankan tepat setelah tengah malam.
    const sot = new Date();
    sot.setHours(0, 0, 0, 0);
    const sotMs = sot.getTime();
    db.mutate((d) => {
      d.users.push(
        { id: "u1", name: "Siti Aminah", phone: "081234567890", passwordHash: "x", role: "customer", createdAt: new Date(sotMs - 86_400_000).toISOString() } as never,
        { id: "u2", name: "Budi", phone: "081298765432", passwordHash: "x", role: "customer", createdAt: new Date(sotMs - 86_400_000).toISOString() } as never
      );
      const mk = (
        id: string,
        orderNumber: string,
        userId: string,
        paymentStatus: string,
        offsetFromSotMs: number
      ) =>
        ({
          id,
          orderNumber,
          userId,
          type: "package",
          items: [],
          totalAmount: 10000,
          status: paymentStatus === "paid" ? "paid" : paymentStatus === "pending" ? "pending" : "cancelled",
          paymentStatus,
          metadata:
            paymentStatus === "failed" ? { failureReason: "Pembayaran ditolak oleh bank" } : {},
          createdAt: new Date(sotMs + offsetFromSotMs).toISOString(),
        }) as never;
      // Offset terbesar = paling baru (sot + 6 jam lebih baru dari +1 jam).
      d.orders.push(
        mk("o-today-paid", "VS-20260816-0001", "u1", "paid", 21_600_000),
        mk("o-today-failed", "VS-20260816-0002", "u1", "failed", 14_400_000),
        mk("o-today-expired", "VS-20260816-0003", "u2", "expired", 7_200_000),
        mk("o-today-pending", "VS-20260816-0004", "u2", "pending", 3_600_000),
        // Kemarin — tidak masuk ringkasan hari ini.
        mk("o-yesterday-paid", "VS-20260815-0001", "u1", "paid", -3_600_000)
      );
    });
    return { svc, db };
  }

  it("meringkas order per status yang dibuat hari ini (default range=today)", async () => {
    const { svc } = await seedOrders();
    const s = svc.getAdminPaymentSummary();
    expect(s.range).toBe("today");
    expect(s.period.total).toBe(4); // order kemarin tidak dihitung
    expect(s.period.paid).toBe(1);
    expect(s.period.failed).toBe(1);
    expect(s.period.expired).toBe(1);
    expect(s.period.pending).toBe(1);
    expect(s.period.revenue).toBe(10000); // hanya yang paid
  });

  it("range=7d mencakup order kemarin; daftar & ringkasan ikut rentang", async () => {
    const { svc } = await seedOrders();
    const s7 = svc.getAdminPaymentSummary("7d");
    expect(s7.range).toBe("7d");
    expect(s7.period.total).toBe(5); // 4 hari ini + 1 kemarin
    expect(s7.period.paid).toBe(2);
    expect(s7.period.expired).toBe(1);
    // Order kemarin masuk daftar 7 hari; terbaru tetap paling atas.
    expect(s7.recent[0].orderNumber).toBe("VS-20260816-0001");
    expect(s7.recent.map((r) => r.orderNumber)).toContain("VS-20260815-0001");
    expect(s7.recent).toHaveLength(5);
  });

  it("daftar terbaru mengurutkan menurun + menyertakan nama pelanggan", async () => {
    const { svc } = await seedOrders();
    const s = svc.getAdminPaymentSummary("today", 3);
    expect(s.recent).toHaveLength(3);
    // Urutan terbaru dulu (ageMs terkecil = paling baru).
    expect(s.recent[0].orderNumber).toBe("VS-20260816-0001");
    expect(s.recent[0].customerName).toBe("Siti Aminah");
    expect(s.recent[1].customerName).toBe("Siti Aminah");
    expect(s.recent[2].customerName).toBe("Budi");
    // Alasan gagal spesifik ikut terbawa untuk badge admin.
    expect(s.recent[1].failureReason).toBe("Pembayaran ditolak oleh bank");
  });

  it("baris recent membawa rincian panel detail (items, paymentAudit, snapCallbacks)", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d) => {
      d.users.push({
        id: "u1",
        name: "Siti Aminah",
        phone: "081234567890",
        passwordHash: "x",
        role: "customer",
        createdAt: new Date().toISOString(),
      } as never);
      d.orders.push({
        id: "o-detail",
        orderNumber: "VS-20260817-0099",
        userId: "u1",
        type: "package",
        items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
        totalAmount: 7000,
        status: "paid",
        paymentStatus: "paid",
        metadata: {
          paymentAudit: [
            {
              at: "2026-08-17T01:00:00.000Z",
              source: "create",
              event: "created",
              paymentStatus: "pending",
            },
            {
              at: "2026-08-17T01:05:00.000Z",
              source: "snap",
              event: "success",
              paymentStatus: "pending",
              statusCode: "200",
            },
            {
              at: "2026-08-17T01:06:00.000Z",
              source: "status-api",
              event: "paid",
              paymentStatus: "paid",
              transactionStatus: "settlement",
            },
          ],
          snapCallbacks: [
            {
              event: "success",
              at: "2026-08-17T01:05:00.000Z",
              result: { transaction_status: "settlement", payment_type: "qris" },
            },
          ],
        },
        createdAt: new Date().toISOString(),
      } as never);
    });
    const s = svc.getAdminPaymentSummary();
    const row = s.recent.find((r) => r.id === "o-detail");
    expect(row).toBeDefined();
    expect(row!.items).toEqual([{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }]);
    expect(row!.paymentAudit).toHaveLength(3);
    expect(row!.paymentAudit![1].event).toBe("success");
    expect(row!.snapCallbacks).toHaveLength(1);
    expect(row!.snapCallbacks![0].result?.transaction_status).toBe("settlement");
    // Baris lain tanpa metadata detail → array kosong (panel menampilkan kosong).
    const plain = s.recent.find((r) => r.id !== "o-detail");
    if (plain) {
      expect(plain.paymentAudit).toEqual([]);
      expect(plain.snapCallbacks).toEqual([]);
    }
  });

  it("order di luar rentang tidak masuk ringkasan maupun daftar (range=today)", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = Date.now();
    db.mutate((d) => {
      d.orders.push({
        id: "o-old",
        orderNumber: "VS-20260801-0001",
        userId: "u1",
        type: "package",
        items: [],
        totalAmount: 5000,
        status: "paid",
        paymentStatus: "paid",
        metadata: {},
        createdAt: new Date(now - 10 * 86_400_000).toISOString(),
      } as never);
    });
    const s = svc.getAdminPaymentSummary(); // today
    expect(s.period.total).toBe(0);
    expect(s.period.paid).toBe(0);
    expect(s.recent).toHaveLength(0); // daftar juga dibatasi rentang
    // Order 10 hari lalu masih di luar 7 hari → tetap kosong.
    expect(svc.getAdminPaymentSummary("7d").recent).toHaveLength(0);
    // Tapi masuk rentang 30 hari → muncul lagi di ringkasan & daftar.
    const s30 = svc.getAdminPaymentSummary("30d");
    expect(s30.period.paid).toBe(1);
    expect(s30.recent[0].orderNumber).toBe("VS-20260801-0001");
    expect(s30.recent[0].customerName).toBe("—"); // user tidak ada di seed
  });
});

describe("paymentRangeStart — batas rentang ringkasan admin", () => {
  it("today → awal hari zona server (jam/menit 0)", async () => {
    const svc = await freshDb();
    const now = new Date("2026-08-17T14:30:00.000Z");
    const start = new Date(svc.paymentRangeStart("today", now));
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    expect(start.getSeconds()).toBe(0);
    expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("7d / 30d → now dikurangi N×86.400.000", async () => {
    const svc = await freshDb();
    const now = new Date("2026-08-17T12:00:00.000Z");
    expect(svc.paymentRangeStart("7d", now)).toBe(now.getTime() - 7 * 86_400_000);
    expect(svc.paymentRangeStart("30d", now)).toBe(now.getTime() - 30 * 86_400_000);
  });
});

describe("paymentAudit (kronologi status pembayaran)", () => {
  async function makeOrder(svc: typeof import("./service")) {
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: { packageId: "pkg1" },
    });
    return order;
  }

  const auditOf = (o: { metadata: Record<string, unknown> }) =>
    (o.metadata.paymentAudit ?? []) as Array<{
      at: string;
      source: string;
      event: string;
      paymentStatus: string;
      statusCode?: string;
      statusMessage?: string;
      transactionStatus?: string;
      orderNumber?: string;
      detail?: string;
    }>;

  it("order baru membuka log dengan event created", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);
    const audit = auditOf(order);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      source: "create",
      event: "created",
      paymentStatus: "pending",
      orderNumber: order.orderNumber,
    });
  });

  it("kegagalan mencatat status_code/status_message dari sumbernya", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);

    // Simulasi webhook Midtrans: deny + kode 202 + pesan asli.
    svc.markOrderFailed(order.id, "failed", "Pembayaran ditolak oleh bank", {
      source: "webhook",
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
      transactionId: "txn-abc",
      paymentType: "qris",
      orderNumber: order.orderNumber,
    });
    await waitFlush();

    const audit = auditOf(svc.getOrder(order.id)!);
    expect(audit).toHaveLength(2); // created + failed
    expect(audit[1]).toMatchObject({
      source: "webhook",
      event: "failed",
      paymentStatus: "failed",
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
      transactionId: "txn-abc",
      paymentType: "qris",
    });
    expect(audit[1].at >= audit[0].at).toBe(true); // kronologi: created → failed
  });

  it("observasi pending beruntun di-dedupe, perubahan status direkam", async () => {
    const svc = await freshDb();
    const order = await makeOrder(svc);

    // Status API dipoll berkali-kali dengan hasil sama → satu entri saja.
    const obs = {
      source: "status-api" as const,
      event: "pending" as const,
      paymentStatus: "pending" as const,
      statusCode: "201",
      statusMessage: "Transaction is pending",
      transactionStatus: "pending",
      orderNumber: order.orderNumber,
    };
    svc.recordPaymentAudit(order.id, obs);
    svc.recordPaymentAudit(order.id, obs);
    svc.recordPaymentAudit(order.id, obs);
    // Status berubah → deny: entri baru.
    svc.recordPaymentAudit(order.id, {
      ...obs,
      statusCode: "202",
      statusMessage: "Payment is denied",
      transactionStatus: "deny",
    });
    await waitFlush();

    const audit = auditOf(svc.getOrder(order.id)!);
    expect(audit).toHaveLength(3); // created + pending (satu) + deny
    expect(audit[1]).toMatchObject({ event: "pending", statusCode: "201" });
    expect(audit[2]).toMatchObject({ event: "pending", statusCode: "202" });
  });

  it("retry mencatat kronologi nomor order baru", async () => {
    const svc = await freshDb();
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      metadata: {},
    });
    svc.markOrderFailed(order.id, "failed", "Ditolak bank");
    await waitFlush();
    const retried = await svc.retryOrderPayment(order.id);
    const audit = retried.metadata.paymentAudit as Array<{ event: string }>;
    expect(audit.some((a) => a.event === "created")).toBe(true);
    expect(audit.some((a) => a.event === "failed")).toBe(true);
    expect(audit.some((a) => a.event === "retry")).toBe(true);
  });
});

describe("registerCustomer / registerMerchant / login", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("registerCustomer membuat user customer + password di-hash", async () => {
    const svc = await freshDb();
    const user = svc.registerCustomer({
      name: "Siti Aminah",
      phone: "0812-3456-7890",
      password: "rahasia123",
    });
    expect(user.role).toBe("customer");
    expect(user.phone).toBe("081234567890"); // non-digit dibuang
    expect(user.passwordHash).not.toBe("rahasia123");
  });

  it("nomor duplikat → throw", async () => {
    const svc = await freshDb();
    svc.registerCustomer({ name: "A", phone: "081234567890", password: "x12345" });
    expect(() =>
      svc.registerCustomer({ name: "B", phone: "081234567890", password: "y12345" })
    ).toThrow("Nomor WhatsApp sudah terdaftar");
  });

  it("registerMerchant membuat user merchant + merchant pending", async () => {
    const svc = await freshDb();
    const { user, merchant } = svc.registerMerchant({
      namaUsaha: "Kopi Nusantara",
      kategoriUsaha: "F&B",
      noWAUsaha: "0812987654321",
      alamatUsaha: "Jl. Melati No. 1",
      namaPemilik: "Budi Santoso",
      noWAPemilik: "0812987654321",
      email: "Budi@Kopi.ID",
      password: "rahasia123",
    });
    expect(user.role).toBe("merchant");
    expect(user.email).toBe("budi@kopi.id");
    expect(merchant).toMatchObject({ namaUsaha: "Kopi Nusantara", status: "pending", userId: user.id });
  });

  it("email / nomor pemilik duplikat → throw", async () => {
    const svc = await freshDb();
    svc.registerMerchant({
      namaUsaha: "Kopi A", kategoriUsaha: "F&B", noWAUsaha: "6281", alamatUsaha: "Jl. A 1",
      namaPemilik: "Budi", noWAPemilik: "0812987654321", email: "budi@kopi.id", password: "x12345",
    });
    expect(() =>
      svc.registerMerchant({
        namaUsaha: "Kopi B", kategoriUsaha: "F&B", noWAUsaha: "6282", alamatUsaha: "Jl. B 1",
        namaPemilik: "Agus", noWAPemilik: "081211111111", email: "budi@kopi.id", password: "y12345",
      })
    ).toThrow("Email sudah terdaftar");
    expect(() =>
      svc.registerMerchant({
        namaUsaha: "Kopi C", kategoriUsaha: "F&B", noWAUsaha: "6283", alamatUsaha: "Jl. C 1",
        namaPemilik: "Cici", noWAPemilik: "0812987654321", email: "cici@kopi.id", password: "z12345",
      })
    ).toThrow("Nomor WhatsApp pemilik sudah terdaftar");
  });

  it("login via email atau nomor; password salah / user tidak ada → null", async () => {
    const svc = await freshDb();
    svc.registerCustomer({ name: "Siti", phone: "081234567890", password: "rahasia123" });
    expect(svc.login("081234567890", "rahasia123")?.name).toBe("Siti");
    expect(svc.login("0812-3456-7890", "rahasia123")?.name).toBe("Siti"); // normalisasi
    expect(svc.login("081234567890", "salah")).toBeNull();
    expect(svc.login("081299999999", "rahasia123")).toBeNull();
  });
});

describe("membership & wallet", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  async function seedPackage(svc: typeof import("./service"), db: typeof import("./db")) {
    db.mutate((d) => {
      d.packages.push({ id: "pkg1", name: "Paket 7 Hari", days: 7, price: 7000, features: [] });
    });
    return svc.getPackages()[0];
  }

  it("activateMembership: lama dinonaktifkan, baru aktif; getActiveMembership; paket tak ada → throw", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedPackage(svc, db);

    const m1 = svc.activateMembership("u1", "pkg1");
    expect(m1.status).toBe("active");
    expect(m1.packageName).toBe("Paket 7 Hari");
    expect(svc.getActiveMembership("u1")?.id).toBe(m1.id);

    const m2 = svc.activateMembership("u1", "pkg1");
    expect(db.getDB().memberships.find((x: any) => x.id === m1.id)!.status).toBe("expired");
    expect(svc.getActiveMembership("u1")?.id).toBe(m2.id);

    expect(() => svc.activateMembership("u1", "nope")).toThrow("Paket tidak ditemukan");
    expect(svc.getActiveMembership("u-tanpa")).toBeNull();
  });

  it("getWallet membuat wallet 0; topup menambah saldo (markOrderPaid)", async () => {
    const svc = await freshDb();
    expect(svc.getWallet("u1")).toEqual({ userId: "u1", balance: 0 });
    const { order } = await svc.createOrder({
      userId: "u1",
      type: "topup",
      items: [{ name: "Top Up", unitPrice: 50000, quantity: 1 }],
      totalAmount: 50000,
      metadata: {},
    });
    svc.markOrderPaid(order.id, "qris");
    await waitFlush();
    expect(svc.getWallet("u1").balance).toBe(50000);
  });
});

describe("cart", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  async function seedProduct(db: typeof import("./db")) {
    db.mutate((d) => {
      d.merchandise.push({
        id: "prod1", name: "Mug V Shop", slug: "mug", description: "Mug keramik",
        price: 25000, stock: 5, image: "☕", category: "Aksesoris", status: "active",
        createdAt: new Date().toISOString(),
      });
    });
  }

  it("addToCart baru/tambah, update, remove, clear, detail, total, error paths", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedProduct(db);

    svc.addToCart("u1", "prod1", 2);
    expect(svc.getCart("u1")).toEqual([{ productId: "prod1", quantity: 2 }]);
    svc.addToCart("u1", "prod1", 1);
    expect(svc.getCart("u1")[0].quantity).toBe(3);
    expect(svc.cartTotal("u1")).toBe(75000);

    const detailed = svc.getCartDetailed("u1");
    expect(detailed[0].product?.name).toBe("Mug V Shop");

    svc.updateCartItem("u1", "prod1", 1);
    expect(svc.getCart("u1")[0].quantity).toBe(1);
    svc.removeCartItem("u1", "prod1");
    expect(svc.getCart("u1")).toEqual([]);
    svc.addToCart("u1", "prod1", 1);
    svc.clearCart("u1");
    expect(svc.getCart("u1")).toEqual([]);

    // error paths
    expect(() => svc.addToCart("u1", "prod1", 0)).toThrow("Kuantitas minimal 1");
    expect(() => svc.addToCart("u1", "prod1", 99)).toThrow("Stok hanya tersisa 5");
    expect(() => svc.addToCart("u1", "nope", 1)).toThrow("Produk tidak ditemukan");
    expect(() => svc.updateCartItem("u1", "nope", 1)).toThrow("Produk tidak ditemukan");
    expect(() => svc.updateCartItem("u1", "prod1", 99)).toThrow("Stok hanya tersisa 5");
    expect(() => svc.updateCartItem("u1", "prod1", 0)).toThrow("Kuantitas minimal 1");
    // cart kosong → update/remove no-op
    svc.updateCartItem("u-tanpa", "prod1", 2);
    svc.removeCartItem("u-tanpa", "prod1");
    expect(svc.cartTotal("u-tanpa")).toBe(0);
  });
});

describe("markOrderPaid — cabang tipe order", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("package → membership aktif dibuat", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d) => {
      d.packages.push({ id: "pkg1", name: "Paket 30 Hari", days: 30, price: 29000, features: [] });
    });
    const { order } = await svc.createOrder({
      userId: "u1", type: "package",
      items: [{ name: "Paket 30 Hari", unitPrice: 29000, quantity: 1 }],
      totalAmount: 29000, metadata: { packageId: "pkg1" },
    });
    svc.markOrderPaid(order.id, "qris");
    await waitFlush();
    const m = db.getDB().memberships.find((x: any) => x.userId === "u1") as any;
    expect(m).toBeTruthy();
    expect(m.packageName).toBe("Paket 30 Hari");
    expect(db.getDB().orders.find((o: any) => o.id === order.id)!.paymentStatus).toBe("paid");
    expect(db.getDB().orders.find((o: any) => o.id === order.id)!.paidAt).toBeTruthy();
  });

  it("merchandise → stok berkurang + cart dibersihkan + status processing", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d) => {
      d.merchandise.push({
        id: "prod1", name: "Mug", slug: "mug", description: "d", price: 25000, stock: 5,
        image: "☕", category: "Aksesoris", status: "active", createdAt: new Date().toISOString(),
      });
    });
    svc.addToCart("u1", "prod1", 2);
    const { order } = await svc.createOrder({
      userId: "u1", type: "merchandise",
      items: [{ name: "Mug", unitPrice: 25000, quantity: 2, productId: "prod1" }],
      totalAmount: 50000, metadata: {},
    });
    svc.markOrderPaid(order.id, "qris");
    await waitFlush();
    expect(db.getDB().merchandise.find((p: any) => p.id === "prod1")!.stock).toBe(3);
    expect(db.getDB().carts["u1"]).toEqual([]);
    const o = db.getDB().orders.find((x: any) => x.id === order.id)!;
    expect(o.status).toBe("processing");
    expect(o.paymentMethod).toBe("qris");
  });

  it("idempotent: markOrderPaid kedua tidak menggandakan membership", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d) => {
      d.packages.push({ id: "pkg1", name: "Paket", days: 7, price: 7000, features: [] });
    });
    const { order } = await svc.createOrder({
      userId: "u1", type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000, metadata: { packageId: "pkg1" },
    });
    svc.markOrderPaid(order.id, "qris");
    svc.markOrderPaid(order.id, "qris"); // webhook duplikat
    await waitFlush();
    expect(db.getDB().memberships.filter((m: any) => m.userId === "u1")).toHaveLength(1);
  });
});

describe("markOrderFailed & recordSnapCallback", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  async function makeOrder(svc: typeof import("./service")) {
    const { order } = await svc.createOrder({
      userId: "u1", type: "package",
      items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000, metadata: {},
    });
    return order;
  }

  it("markOrderFailed: reason default + detail spesifik + audit; lunas tidak diubah", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const o1 = await makeOrder(svc);
    svc.markOrderFailed(o1.id, "failed", "Pembayaran ditolak oleh bank");
    const updated = db.getDB().orders.find((o: any) => o.id === o1.id)!;
    expect(updated.paymentStatus).toBe("failed");
    expect(updated.status).toBe("cancelled");
    expect(updated.metadata.failureReason).toBe("Pembayaran ditolak oleh bank");
    expect((updated.metadata.paymentAudit as Array<{ event: string }>).some((a) => a.event === "failed")).toBe(true);

    const o2 = await makeOrder(svc);
    svc.markOrderFailed(o2.id, "expired"); // tanpa detail → default waktu habis
    expect(db.getDB().orders.find((o: any) => o.id === o2.id)!.metadata.failureReason).toBe(
      "Waktu pembayaran habis"
    );

    const o3 = await makeOrder(svc);
    svc.markOrderPaid(o3.id, "qris");
    await waitFlush();
    svc.markOrderFailed(o3.id, "failed", "tidak boleh"); // lunas → idempotent
    expect(db.getDB().orders.find((o: any) => o.id === o3.id)!.paymentStatus).toBe("paid");
    expect(() => svc.markOrderFailed("nope", "failed")).toThrow("Order tidak ditemukan");
  });

  it("recordSnapCallback: menyimpan event + hasil transaksi ke audit", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const o = await makeOrder(svc);
    svc.recordSnapCallback(o.id, "success", {
      status_code: "200", transaction_status: "settlement", payment_type: "qris", transaction_id: "tx-1",
    });
    const updated = db.getDB().orders.find((x: any) => x.id === o.id)!;
    const cbs = updated.metadata.snapCallbacks as Array<{ event: string; result?: Record<string, unknown> }>;
    expect(cbs).toHaveLength(1);
    expect(cbs[0].event).toBe("success");
    expect(cbs[0].result?.transaction_id).toBe("tx-1");
    const audit = updated.metadata.paymentAudit as Array<{ event: string; statusCode?: string }>;
    expect(audit[audit.length - 1].statusCode).toBe("200");
    expect(() => svc.recordSnapCallback("nope", "close")).toThrow("Order tidak ditemukan");
  });
});

describe("promo & voucher publik", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("listActivePromos / listActiveVouchers / getVoucher", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = Date.now();
    db.mutate((d) => {
      d.promos.push({ id: "pr1", merchantId: "m1", merchantName: "Kopi", name: "Promo Aktif", jenisVoucher: "diskon", startDate: new Date(now - 1000).toISOString(), endDate: new Date(now + 86_400_000).toISOString(), jumlah: 10, createdAt: new Date(now).toISOString() });
      d.promos.push({ id: "pr2", merchantId: "m1", merchantName: "Kopi", name: "Promo Lewat", jenisVoucher: "diskon", startDate: new Date(now - 1000).toISOString(), endDate: new Date(now - 1).toISOString(), jumlah: 10, createdAt: new Date(now).toISOString() });
      d.vouchers.push({ id: "v1", merchantId: "m1", merchantName: "Kopi", name: "Voucher Aktif", jenisVoucher: "diskon", nilai: 5000, minTransaksi: 20000, kuota: 10, masaBerlaku: new Date(now + 86_400_000).toISOString(), maksPenggunaan: 1, syaratKetentuan: "", jumlah: 10, status: "active", createdAt: new Date(now).toISOString() });
      d.vouchers.push({ id: "v2", merchantId: "m1", merchantName: "Kopi", name: "Voucher Nonaktif", jenisVoucher: "diskon", nilai: 5000, minTransaksi: 20000, kuota: 10, masaBerlaku: new Date(now + 86_400_000).toISOString(), maksPenggunaan: 1, syaratKetentuan: "", jumlah: 10, status: "archived", createdAt: new Date(now).toISOString() });
    });
    expect(svc.listActivePromos().map((p) => p.id)).toEqual(["pr1"]);
    expect(svc.listActiveVouchers().map((v) => v.id)).toEqual(["v1"]);
    expect(svc.getVoucher("v1")?.name).toBe("Voucher Aktif");
    expect(svc.getVoucher("nope")).toBeUndefined();
  });
});

describe("claimVoucher — semua cabang", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  async function seedClaimable(svc: typeof import("./service"), db: typeof import("./db"), over: Record<string, unknown> = {}) {
    const now = Date.now();
    db.mutate((d) => {
      d.memberships.push({ id: "mbr1", userId: "u1", packageId: "pkg1", packageName: "Paket", startDate: new Date(now - 1000).toISOString(), endDate: new Date(now + 86_400_000).toISOString(), status: "active", createdAt: new Date(now).toISOString() });
      d.vouchers.push({
        id: "v1", merchantId: "m1", merchantName: "Kopi", name: "Diskon Kopi", jenisVoucher: "diskon",
        nilai: 5000, minTransaksi: 20000, kuota: 2, masaBerlaku: new Date(now + 86_400_000).toISOString(),
        maksPenggunaan: 1, syaratKetentuan: "", jumlah: 2, status: "active", createdAt: new Date(now).toISOString(), ...over,
      });
    });
  }

  it("sukses → claim aktif dengan kode + kode konfirmasi", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedClaimable(svc, db);
    const res = svc.claimVoucher("u1", "v1");
    expect(res.ok).toBe(true);
    expect(res.claim?.status).toBe("active");
    expect(res.claim?.kode).toMatch(/^VS-/);
    expect(res.claim?.kodeKonfirmasi).toMatch(/^\d{6}$/);
  });

  it("voucher tidak ada / nonaktif → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedClaimable(svc, db, { status: "archived" });
    expect(svc.claimVoucher("u1", "nope").ok).toBe(false);
    expect(svc.claimVoucher("u1", "v1").message).toContain("tidak aktif");
  });

  it("masa berlaku habis → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedClaimable(svc, db, { masaBerlaku: new Date(Date.now() - 1000).toISOString() });
    expect(svc.claimVoucher("u1", "v1").message).toContain("sudah habis");
  });

  it("tanpa membership aktif → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d) => {
      d.memberships.push({ id: "mbr1", userId: "u1", packageId: "pkg1", packageName: "Paket", startDate: new Date().toISOString(), endDate: new Date(Date.now() - 1000).toISOString(), status: "expired", createdAt: new Date().toISOString() });
      d.vouchers.push({ id: "v1", merchantId: "m1", merchantName: "Kopi", name: "Diskon", jenisVoucher: "diskon", nilai: 5000, minTransaksi: 0, kuota: 2, masaBerlaku: new Date(Date.now() + 86_400_000).toISOString(), maksPenggunaan: 1, syaratKetentuan: "", jumlah: 2, status: "active", createdAt: new Date().toISOString() });
    });
    expect(svc.claimVoucher("u1", "v1").message).toContain("Aktifkan paket dulu");
  });

  it("kuota habis / sudah punya aktif / maks penggunaan → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedClaimable(svc, db);
    // kuota 2: klaim 2 user lain → kuota habis
    db.mutate((d) => {
      d.claimedVouchers.push({ id: "c1", voucherId: "v1", userId: "u9", kode: "VS-A", kodeKonfirmasi: "1", status: "active", claimedAt: new Date().toISOString(), useCount: 0 });
      d.claimedVouchers.push({ id: "c2", voucherId: "v1", userId: "u8", kode: "VS-B", kodeKonfirmasi: "2", status: "active", claimedAt: new Date().toISOString(), useCount: 0 });
    });
    expect(svc.claimVoucher("u1", "v1").message).toContain("Kuota voucher sudah habis");

    // kuota tersisa → sukses; klaim kedua → sudah punya aktif
    const db2 = await import("./db");
    db2.mutate((d) => { d.claimedVouchers.pop(); d.claimedVouchers.pop(); });
    expect(svc.claimVoucher("u1", "v1").ok).toBe(true);
    expect(svc.claimVoucher("u1", "v1").message).toContain("masih aktif");
  });

  it("maks penggunaan tercapai → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedClaimable(svc, db, { maksPenggunaan: 1 });
    db.mutate((d) => {
      d.claimedVouchers.push({ id: "c-old", voucherId: "v1", userId: "u1", kode: "VS-OLD", kodeKonfirmasi: "1", status: "used", claimedAt: new Date(Date.now() - 86_400_000).toISOString(), useCount: 1 });
    });
    expect(svc.claimVoucher("u1", "v1").message).toContain("Maksimal penggunaan");
  });
});

describe("redeemVoucher & getMyClaims", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  async function seedRedeemable(svc: typeof import("./service"), db: typeof import("./db")) {
    const now = Date.now();
    db.mutate((d) => {
      d.merchants.push({ id: "m1", userId: "u-m", namaUsaha: "Kopi Nusantara", kategoriUsaha: "F&B", noWAUsaha: "6281", alamatUsaha: "Jl. 1", namaPemilik: "Budi", noWAPemilik: "6281", email: "b@k.id", status: "approved", createdAt: new Date().toISOString() });
      d.vouchers.push({ id: "v1", merchantId: "m1", merchantName: "Kopi Nusantara", name: "Diskon", jenisVoucher: "diskon", nilai: 5000, minTransaksi: 0, kuota: 10, masaBerlaku: new Date(now + 86_400_000).toISOString(), maksPenggunaan: 1, syaratKetentuan: "", jumlah: 10, status: "active", createdAt: new Date(now).toISOString() });
      d.users.push({ id: "u1", name: "Siti", phone: "081234567890", passwordHash: "x", role: "customer", createdAt: new Date().toISOString() });
      d.claimedVouchers.push({ id: "c1", voucherId: "v1", userId: "u1", kode: "VS-ABCD-1234", kodeKonfirmasi: "123456", status: "active", claimedAt: new Date(now - 1000).toISOString(), useCount: 0 });
    });
  }

  it("sukses → useCount naik & status used saat maks tercapai", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedRedeemable(svc, db);
    const res = svc.redeemVoucher("m1", "vs-abcd-1234", "123456"); // kode case-insensitive
    expect(res.ok).toBe(true);
    expect(res.claim?.useCount).toBe(1);
    expect(res.claim?.voucher?.name).toBe("Diskon");
    expect(res.claim?.user?.name).toBe("Siti");
    expect(db.getDB().claimedVouchers.find((c: any) => c.id === "c1")!.status).toBe("used");
  });

  it("kode tidak ditemukan / bukan milik merchant → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedRedeemable(svc, db);
    expect(svc.redeemVoucher("m1", "VS-XXXX-9999", "123456").message).toContain("tidak ditemukan");
    db.mutate((d) => { (d.vouchers[0] as any).merchantId = "m2"; });
    expect(svc.redeemVoucher("m1", "VS-ABCD-1234", "123456").message).toContain("bukan milik");
  });

  it("sudah used / expired / kode konfirmasi salah → error", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedRedeemable(svc, db);
    db.mutate((d) => { (d.claimedVouchers[0] as any).status = "used"; });
    expect(svc.redeemVoucher("m1", "VS-ABCD-1234", "123456").message).toContain("sudah terpakai");
    db.mutate((d) => { (d.claimedVouchers[0] as any).status = "expired"; });
    expect(svc.redeemVoucher("m1", "VS-ABCD-1234", "123456").message).toContain("kedaluwarsa");
    db.mutate((d) => { (d.claimedVouchers[0] as any).status = "active"; });
    expect(svc.redeemVoucher("m1", "VS-ABCD-1234", "000000").message).toContain("tidak cocok");
  });

  it("getMyClaims mengurutkan terbaru & join voucher", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    await seedRedeemable(svc, db);
    db.mutate((d) => {
      d.claimedVouchers.push({ id: "c2", voucherId: "v1", userId: "u1", kode: "VS-NEW", kodeKonfirmasi: "2", status: "active", claimedAt: new Date(Date.now() + 1000).toISOString(), useCount: 0 });
    });
    const claims = svc.getMyClaims("u1");
    expect(claims[0].id).toBe("c2"); // terbaru dulu
    expect(claims[1].voucher?.name).toBe("Diskon");
    expect(svc.getMyClaims("u-tanpa")).toEqual([]);
  });
});

describe("merchant: profil, promo, voucher, klaim", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  it("getMerchantByUserId / getMerchantById", async () => {
    const svc = await freshDb();
    const { merchant } = svc.registerMerchant({
      namaUsaha: "Kopi", kategoriUsaha: "F&B", noWAUsaha: "6281", alamatUsaha: "Jl. 1",
      namaPemilik: "Budi", noWAPemilik: "6282", email: "b@k.id", password: "x12345",
    });
    expect(svc.getMerchantByUserId(merchant.userId)?.id).toBe(merchant.id);
    expect(svc.getMerchantById(merchant.id)?.namaUsaha).toBe("Kopi");
    expect(svc.getMerchantById("nope")).toBeUndefined();
  });

  it("createPromoWithVouchers: promo + N voucher (cap 500)", async () => {
    const svc = await freshDb();
    const { promo, vouchers } = svc.createPromoWithVouchers({
      merchantId: "m1", merchantName: "Kopi Nusantara", promoName: "Promo Ramadhan",
      jenisVoucher: "diskon", startDate: "2026-03-01", endDate: "2026-03-31", jumlahPromo: 5,
      voucherName: "Diskon Kopi", nilaiVoucher: 5000, minTransaksi: 20000, kuota: 10,
      masaBerlaku: "2026-12-31", maksPenggunaan: 1, syaratKetentuan: "", jumlahVoucher: 3,
    });
    expect(promo.name).toBe("Promo Ramadhan");
    expect(vouchers).toHaveLength(3);
    expect(vouchers[0]).toMatchObject({ merchantId: "m1", promoId: promo.id, status: "active" });
    expect(svc.getMerchantPromos("m1")).toHaveLength(1);
    expect(svc.getMerchantVouchers("m1")).toHaveLength(3);
  });

  it("createPromoWithVouchers membatasi 500 voucher", async () => {
    const svc = await freshDb();
    const { vouchers } = svc.createPromoWithVouchers({
      merchantId: "m1", merchantName: "Kopi", promoName: "Besar", jenisVoucher: "diskon",
      startDate: "2026-03-01", endDate: "2026-03-31", jumlahPromo: 1, voucherName: "V",
      nilaiVoucher: 1, minTransaksi: 0, kuota: 1, masaBerlaku: "2026-12-31", maksPenggunaan: 1,
      syaratKetentuan: "", jumlahVoucher: 10000,
    });
    expect(vouchers).toHaveLength(500);
  });

  it("archiveVoucher: toggle status; voucher bukan milik merchant → throw", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = Date.now();
    db.mutate((d) => {
      d.vouchers.push({ id: "v1", merchantId: "m1", merchantName: "Kopi", name: "V", jenisVoucher: "diskon", nilai: 1, minTransaksi: 0, kuota: 1, masaBerlaku: new Date(now + 1000).toISOString(), maksPenggunaan: 1, syaratKetentuan: "", jumlah: 1, status: "active", createdAt: new Date(now).toISOString() });
      d.claimedVouchers.push({ id: "c1", voucherId: "v1", userId: "u1", kode: "VS-1", kodeKonfirmasi: "1", status: "active", claimedAt: new Date(now).toISOString(), useCount: 0 });
    });
    svc.archiveVoucher("m1", "v1");
    expect(db.getDB().vouchers.find((v: any) => v.id === "v1")!.status).toBe("archived");
    svc.archiveVoucher("m1", "v1"); // toggle balik
    expect(db.getDB().vouchers.find((v: any) => v.id === "v1")!.status).toBe("active");
    expect(() => svc.archiveVoucher("m2", "v1")).toThrow("Voucher tidak ditemukan");
    // getMerchantClaims memfilter klaim per merchant
    const claims = svc.getMerchantClaims("m1");
    expect(claims[0].id).toBe("c1");
    expect(svc.getMerchantClaims("m2")).toEqual([]);
  });
});

describe("expireStaleClaims — tandai klaim voucher hangus otomatis (cron)", () => {
  const now = Date.now();
  const past = new Date(now - 3_600_000).toISOString(); // 1 jam lalu
  const future = new Date(now + 3_600_000).toISOString(); // 1 jam lagi

  function seed(db: { mutate: (fn: (d: any) => void) => void }) {
    db.mutate((d: any) => {
      d.vouchers.push(
        { id: "v-exp", merchantId: "m1", merchantName: "Warung", name: "Lepas", jenisVoucher: "diskon", nilai: 20000, minTransaksi: 0, kuota: 10, masaBerlaku: past, maksPenggunaan: 1, syaratKetentuan: "", jumlah: 10, status: "active", createdAt: new Date(now).toISOString() },
        { id: "v-ok", merchantId: "m1", merchantName: "Warung", name: "Masih", jenisVoucher: "diskon", nilai: 20000, minTransaksi: 0, kuota: 10, masaBerlaku: future, maksPenggunaan: 1, syaratKetentuan: "", jumlah: 10, status: "active", createdAt: new Date(now).toISOString() }
      );
      d.claimedVouchers.push(
        { id: "c-stale", voucherId: "v-exp", userId: "u1", kode: "VS-STALE", kodeKonfirmasi: "1", status: "active", claimedAt: new Date(now).toISOString(), useCount: 0 },
        { id: "c-fresh", voucherId: "v-ok", userId: "u1", kode: "VS-FRESH", kodeKonfirmasi: "2", status: "active", claimedAt: new Date(now).toISOString(), useCount: 0 },
        { id: "c-used", voucherId: "v-exp", userId: "u1", kode: "VS-USED", kodeKonfirmasi: "3", status: "used", claimedAt: new Date(now).toISOString(), usedAt: new Date(now).toISOString(), useCount: 1 },
        { id: "c-already", voucherId: "v-exp", userId: "u1", kode: "VS-ALRDY", kodeKonfirmasi: "4", status: "expired", claimedAt: new Date(now).toISOString(), useCount: 0 }
      );
    });
  }

  it("klaim aktif dengan voucher lewat masa berlaku → 'expired'; yang lain tidak disentuh", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    seed(db);

    expect(svc.expireStaleClaims(new Date(now))).toBe(1); // hanya c-stale
    const byId = Object.fromEntries(
      db.getDB().claimedVouchers.map((c: any) => [c.id, c.status])
    );
    expect(byId["c-stale"]).toBe("expired");
    expect(byId["c-fresh"]).toBe("active"); // masa berlaku masih depan
    expect(byId["c-used"]).toBe("used"); // sudah terpakai, tak disentuh
    expect(byId["c-already"]).toBe("expired"); // sudah expired, tak dihitung ulang
  });

  it("idempoten: run kedua → 0 klaim baru (tidak menimpa status lain)", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    seed(db);
    expect(svc.expireStaleClaims(new Date(now))).toBe(1);
    expect(svc.expireStaleClaims(new Date(now))).toBe(0);
  });

  it("klaim tanpa voucher (orphan) → tidak disentuh dan tidak dihitung", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d: any) => {
      d.claimedVouchers.push({
        id: "c-orphan", voucherId: "v-gone", userId: "u1", kode: "VS-ORPHAN",
        kodeKonfirmasi: "5", status: "active", claimedAt: new Date(now).toISOString(), useCount: 0,
      });
    });
    expect(svc.expireStaleClaims(new Date(now))).toBe(0);
    expect(db.getDB().claimedVouchers.find((c: any) => c.id === "c-orphan")!.status).toBe("active");
  });
});

describe("getRetryMetrics — metrik retry massal (dashboard admin)", () => {
  const DAY = 86_400_000;
  /** Kunci tanggal lokal (sama dengan implementasi) untuk asersi bucket. */
  const localKey = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const dayKey = (msAgo: number) => localKey(new Date(Date.now() - msAgo));
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

  /** freshDb + RESET state global (metrik menghitung SEMUA order — jangan
   *  membocorkan order/retry dari describe lain yang sudah jalan). */
  async function freshMetricsDb() {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
    return freshDb();
  }

  function seedOrder(
    db: { mutate: (fn: (d: any) => void) => void },
    id: string,
    currentStatus: string,
    audit: Array<{ event: string; at: string; paymentStatus: string }>
  ) {
    db.mutate((d: any) => {
      d.orders.push({
        id, orderNumber: `VS-R-${id}`, userId: "u1", type: "package",
        items: [{ name: "Paket", unitPrice: 7000, quantity: 1 }],
        totalAmount: 7000, status: currentStatus === "paid" ? "paid" : "pending",
        paymentStatus: currentStatus, paymentMethod: "qris",
        metadata: { paymentAudit: audit }, createdAt: iso(DAY),
      });
    });
  }

  it("retry sukses & gagal dihitung, rate = sukses/(sukses+gagal)", async () => {
    const svc = await freshMetricsDb();
    const db = await import("./db");
    // Sukses: retry → paid (hari ini).
    seedOrder(db, "a", "paid", [
      { event: "created", at: iso(0), paymentStatus: "pending" },
      { event: "retry", at: iso(0), paymentStatus: "pending" },
      { event: "paid", at: iso(0), paymentStatus: "paid" },
    ]);
    // Gagal: retry → failed (hari ini).
    seedOrder(db, "b", "failed", [
      { event: "retry", at: iso(0), paymentStatus: "pending" },
      { event: "failed", at: iso(0), paymentStatus: "failed" },
    ]);

    const m = svc.getRetryMetrics(7);
    expect(m.totalAttempts).toBe(2);
    expect(m.success).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.pending).toBe(0);
    expect(m.successRate).toBe(50);
    expect(m.todayAttempts).toBe(2);
  });

  it("retry berantai: hasil tiap retry = status terminal pertama SETELAH retry itu", async () => {
    const svc = await freshMetricsDb();
    const db = await import("./db");
    seedOrder(db, "c", "paid", [
      { event: "retry", at: iso(2 * DAY), paymentStatus: "pending" }, // gagal lagi setelahnya
      { event: "failed", at: iso(2 * DAY), paymentStatus: "failed" },
      { event: "retry", at: iso(DAY), paymentStatus: "pending" }, // akhirnya sukses
      { event: "paid", at: iso(DAY), paymentStatus: "paid" },
    ]);

    const m = svc.getRetryMetrics(7);
    expect(m.totalAttempts).toBe(2);
    expect(m.success).toBe(1);
    expect(m.failed).toBe(1);
    expect(m.successRate).toBe(50);
    // Retry pertama masuk bucket hari -2, retry kedua hari -1.
    const byDate = Object.fromEntries(m.daily.map((d) => [d.date, d]));
    expect(byDate[dayKey(2 * DAY)].attempts).toBe(1);
    expect(byDate[dayKey(2 * DAY)].failed).toBe(1);
    expect(byDate[dayKey(DAY)].success).toBe(1);
  });

  it("retry terakhir belum tuntas → pending (tidak dihitung di penyebut rate)", async () => {
    const svc = await freshMetricsDb();
    const db = await import("./db");
    seedOrder(db, "d", "pending", [
      { event: "retry", at: iso(DAY), paymentStatus: "pending" },
    ]);

    const m = svc.getRetryMetrics(7);
    expect(m.totalAttempts).toBe(1);
    expect(m.pending).toBe(1);
    expect(m.success).toBe(0);
    expect(m.failed).toBe(0);
    expect(m.successRate).toBe(0); // tidak ada hasil tuntas
  });

  it("retry di luar jendela 7 hari diabaikan; hari tanpa retry tetap ada di daily", async () => {
    const svc = await freshMetricsDb();
    const db = await import("./db");
    seedOrder(db, "e", "paid", [
      { event: "retry", at: iso(10 * DAY), paymentStatus: "pending" }, // 10 hari lalu
      { event: "paid", at: iso(9 * DAY), paymentStatus: "paid" },
    ]);

    const m = svc.getRetryMetrics(7);
    expect(m.totalAttempts).toBe(0);
    expect(m.daily).toHaveLength(7);
    expect(m.daily.every((d) => d.attempts === 0)).toBe(true);
  });
});

describe("getMerchantDailySummary (ringkasan harian cron)", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  const voucher = (
    id: string,
    merchantId: string,
    nilai: number
  ) => ({
    id,
    merchantId,
    merchantName: "Warung Nusantara",
    name: `Voucher ${id}`,
    jenisVoucher: "diskon",
    nilai,
    minTransaksi: 50000,
    kuota: 100,
    masaBerlaku: "2026-12-31T00:00:00.000Z",
    maksPenggunaan: 1,
    syaratKetentuan: "",
    jumlah: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  });

  const claim = (
    id: string,
    voucherId: string,
    claimedAt: string,
    status: "active" | "used" | "expired" = "active",
    usedAt?: string
  ) => ({
    id,
    voucherId,
    userId: "u1",
    kode: `VS-${id}`, // kode unik per klaim
    kodeKonfirmasi: "111111",
    status,
    claimedAt,
    usedAt,
    useCount: status === "used" ? 1 : 0,
  });

  it("menghitung klaim hari ini, pendapatan (redeem hari ini), dan order pending milik merchant", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const today = (h: number) =>
      new Date(dayStart.getTime() + h * 3_600_000).toISOString(); // hari ini, jam ke-h
    const yesterday = new Date(dayStart.getTime() - 3_600_000).toISOString();

    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000)); // m1
      d.vouchers.push(voucher("v-b", "m1", 50000)); // m1
      d.vouchers.push(voucher("v-c", "m2", 10000)); // merchant lain
      // m1: klaim hari ini (aktif), klaim kemarin (aktif), klaim+redeem hari ini,
      // klaim kemarin tapi redeem hari ini, klaim hari ini tapi redeem kemarin.
      d.claimedVouchers.push(claim("c1", "v-a", today(1), "active"));
      d.claimedVouchers.push(claim("c2", "v-a", yesterday, "active"));
      d.claimedVouchers.push(claim("c3", "v-a", today(2), "used", today(3)));
      d.claimedVouchers.push(claim("c4", "v-b", yesterday, "used", today(4)));
      d.claimedVouchers.push(claim("c5", "v-a", today(5), "used", yesterday));
      // Klaim voucher merchant lain (v-c) tidak dihitung.
      d.claimedVouchers.push(claim("c6", "v-c", today(1), "active"));
      // Order: pending milik m1, lunas milik m1, pending tanpa merchantId.
      d.orders.push({
        id: "o1", userId: "u1", orderNumber: "VS-T-0001", type: "merchandise",
        items: [], totalAmount: 25000, status: "pending", paymentStatus: "pending",
        metadata: { merchantId: "m1" }, createdAt: today(1),
      });
      d.orders.push({
        id: "o2", userId: "u1", orderNumber: "VS-T-0002", type: "merchandise",
        items: [], totalAmount: 25000, status: "paid", paymentStatus: "paid",
        metadata: { merchantId: "m1" }, createdAt: today(1),
      });
      d.orders.push({
        id: "o3", userId: "u1", orderNumber: "VS-T-0003", type: "merchandise",
        items: [], totalAmount: 25000, status: "pending", paymentStatus: "pending",
        metadata: {}, createdAt: today(1),
      });
    });

    const s = svc.getMerchantDailySummary("m1", now);
    // Klaim hari ini milik m1: c1, c3, c5 (c6 milik m2 diabaikan).
    expect(s.claimedToday).toBe(3);
    // Redeem hari ini milik m1: c3 (20rb) + c4 (50rb) = 70rb; c5 redeem kemarin.
    expect(s.revenueToday).toBe(70000);
    // Order pending milik m1: hanya o1 (o2 lunas, o3 tanpa merchantId).
    expect(s.pendingOrders).toBe(1);
  });

  it("batas hari: klaim tepat tengah malam dihitung, 1 ms sebelum tidak", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000));
      d.claimedVouchers.push(claim("c-edge", "v-a", dayStart.toISOString(), "active")); // tepat tengah malam
      d.claimedVouchers.push(
        claim("c-before", "v-a", new Date(dayStart.getTime() - 1).toISOString(), "active") // 1 ms sebelumnya
      );
    });

    const s = svc.getMerchantDailySummary("m1", now);
    expect(s.claimedToday).toBe(1);
    expect(s.revenueToday).toBe(0);
    expect(s.pendingOrders).toBe(0);
  });

  it("merchant tanpa voucher/klaim/order → semua nol", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000));
      d.claimedVouchers.push(claim("c1", "v-a", new Date().toISOString(), "active"));
    });
    expect(svc.getMerchantDailySummary("m9", new Date())).toEqual({
      claimedToday: 0,
      revenueToday: 0,
      pendingOrders: 0,
    });
  });
});

describe("getTierDeliveryMetrics — metrik pengingat voucher per tier", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { __vshopDbState?: unknown }).__vshopDbState;
  });

  const iso = (ms: number) => new Date(ms).toISOString();

  const voucher = (id: string, merchantId: string, nilai: number) => ({
    id,
    merchantId,
    merchantName: "Warung Nusantara",
    name: `Voucher ${id}`,
    jenisVoucher: "diskon",
    nilai,
    minTransaksi: 50000,
    kuota: 100,
    masaBerlaku: "2026-12-31T00:00:00.000Z",
    maksPenggunaan: 1,
    syaratKetentuan: "",
    jumlah: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  });

  const claim = (
    id: string,
    voucherId: string,
    claimedAt: string,
    extra: { expiringNotifiedAt?: string; expiring24hNotifiedAt?: string } = {}
  ) => {
    const userId: Record<string, string> = { c1: "u1", c2: "u1", c3: "u2", c4: "u3" };
    return {
      id,
      voucherId,
      userId: userId[id] ?? "uX",
      kode: `VS-${id}`,
      kodeKonfirmasi: "111111",
      status: "active",
      claimedAt,
      useCount: 0,
      ...extra,
    };
  };

  it("menghitung per tier: pelanggan diingatkan (distinct) + yang mengklaim ulang", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();
    const before = now.getTime() - 10 * 86_400_000; // 10 hari lalu (dalam periode 30 hari)
    const reminder = now.getTime() - 2 * 86_400_000; // pengingat 2 hari lalu

    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000));
      d.vouchers.push(voucher("v-b", "m1", 10000));
      // u1: klaim lama diingatkan 48 jam 2 hari lalu → lalu klaim voucher baru.
      d.claimedVouchers.push(claim("c1", "v-a", iso(before), { expiringNotifiedAt: iso(reminder) }));
      d.claimedVouchers.push(claim("c2", "v-b", iso(reminder + 3_600_000)));
      // u2: diingatkan 48 jam tapi TIDAK klaim ulang.
      d.claimedVouchers.push(claim("c3", "v-a", iso(before), { expiringNotifiedAt: iso(reminder) }));
      // u3: diingatkan tier H-1 (bukan 48 jam) → hanya masuk metrik H-1.
      d.claimedVouchers.push(
        claim("c4", "v-a", iso(before), { expiring24hNotifiedAt: iso(reminder) })
      );
    });

    const metrics = svc.getTierDeliveryMetrics(now, 30);
    const t48 = metrics.find((m) => m.tier === "48-jam")!;
    const tH1 = metrics.find((m) => m.tier === "H-1")!;
    // 48 jam: u1 + u2 diingatkan; hanya u1 yang klaim ulang.
    expect(t48).toEqual({ tier: "48-jam", reminded: 2, reclaimed: 1 });
    // H-1: hanya u3 diingatkan; u3 tidak klaim ulang.
    expect(tH1).toEqual({ tier: "H-1", reminded: 1, reclaimed: 0 });
  });

  it("klaim yang sama punya 2 marker → masuk KEDUA tier; klaim baru SEBELUM pengingat tidak dihitung", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();
    const before = now.getTime() - 5 * 86_400_000;
    const reminder = now.getTime() - 1 * 86_400_000;
    // Klaim baru DIBUAT sebelum pengingat (bukan sesudahnya).
    const newClaimBefore = reminder - 3_600_000;

    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000));
      d.vouchers.push(voucher("v-b", "m1", 10000));
      d.claimedVouchers.push(
        claim("c1", "v-a", iso(before), {
          expiringNotifiedAt: iso(reminder),
          expiring24hNotifiedAt: iso(reminder),
        })
      );
      d.claimedVouchers.push(claim("c2", "v-b", iso(newClaimBefore)));
    });

    const metrics = svc.getTierDeliveryMetrics(now, 30);
    // User sama diingatkan di KEDUA tier → reminded 1 di tiap tier;
    // klaim barunya lebih TUA dari pengingat → tidak dihitung klaim ulang.
    for (const m of metrics) {
      expect(m.reminded).toBe(1);
      expect(m.reclaimed).toBe(0);
    }
  });

  it("pengingat di luar periode diabaikan; tanpa data → nol", async () => {
    const svc = await freshDb();
    const db = await import("./db");
    const now = new Date();
    const oldReminder = now.getTime() - 40 * 86_400_000; // 40 hari lalu (> 30)

    db.mutate((d: any) => {
      d.vouchers.push(voucher("v-a", "m1", 20000));
      d.claimedVouchers.push(
        claim("c1", "v-a", iso(oldReminder), { expiringNotifiedAt: iso(oldReminder) })
      );
    });

    const metrics = svc.getTierDeliveryMetrics(now, 30);
    expect(metrics).toEqual([
      { tier: "48-jam", reminded: 0, reclaimed: 0 },
      { tier: "H-1", reminded: 0, reclaimed: 0 },
    ]);

    // Store kosong (reset) → tetap dua baris dengan nol.
    const svc2 = await freshDb();
    expect(svc2.getTierDeliveryMetrics(now, 30)).toEqual([
      { tier: "48-jam", reminded: 0, reclaimed: 0 },
      { tier: "H-1", reminded: 0, reclaimed: 0 },
    ]);
  });
});
