/**
 * Unit test mode kirim WhatsApp (src/lib/whatsapp.ts): TEMPLATE MESSAGE
 * Meta sebagai mode utama + fallback teks bebas. `fetch` di-stub sehingga
 * payload yang dikirim ke Graph API bisa diverifikasi tanpa jaringan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodyTemplate,
  dailySummaryWaMessage,
  failedWaMessage,
  normalizeToE164,
  notifyClaimExpiringSoon,
  notifyClaimExpiringSoon24h,
  notifyMerchantDailySummary,
  notifyMerchantPaymentConfigIssue,
  notifyOrderPayment,
  notifyOrderRetried,
  notifyVoucherRedeemed,
  paidWaMessage,
  retriedWaMessage,
  sendMessage,
  templateWithButtons,
  type WaButtonSpec,
  type WaDeps,
  type WaMessage,
} from "./whatsapp";
import type { ClaimedVoucher, Merchant, Order, User, Voucher } from "./types";

// ===== Fixture + deps stub untuk notifyOrderPayment (pemilihan penerima) =====
// Seam `WaDeps` (getOrder/getMerchantById/getUserById) disuntik PER PANGGILAN —
// lookup data diverifikasi tanpa mocking modul; antrian kirim tetap memakai
// fetch stub global.
const fixture = {
  orders: [] as Array<Record<string, unknown> | Order>,
  users: [] as Array<{ id: string; name: string; phone: string }>,
  merchants: {} as Record<string, { noWAUsaha: string; namaUsaha: string }>,
};

/** Deps stub: baca dari fixture (bukan store nyata). */
function testDeps(): WaDeps {
  return {
    getOrder: (id) =>
      (fixture.orders.find((o) => o.id === id) ?? null) as Order | null,
    getMerchantById: (id) =>
      (fixture.merchants[id] ?? null) as Merchant | null,
    getUserById: (id) => fixture.users.find((u) => u.id === id) ?? null,
  };
}

// ---------- Stub fetch ----------
let responses: Array<{ status: number; body: unknown }>;
let requests: Array<{ url: string; payload: Record<string, unknown> }>;

const saveEnv: Record<string, string | undefined> = {};
function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    // Simpan nilai ORISINAL (pra-test) sekali saja — beberapa setEnv pada
    // kunci yang sama dalam satu test tidak boleh menimpa snapshot restore.
    if (!(k in saveEnv)) saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  responses = [];
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      requests.push({ url, payload });
      const r = responses.shift() ?? { status: 200, body: { messages: [{ id: "wamid-1" }] } };
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
        text: async () => JSON.stringify(r.body),
      } as Response;
    })
  );
  setEnv({
    WHATSAPP_TOKEN: "token-test",
    WHATSAPP_PHONE_NUMBER_ID: "12345",
    WHATSAPP_API_BASE: "https://graph.test/v99",
    APP_URL: "https://vshop.test",
    WHATSAPP_MESSAGE_MODE: "auto",
    WHATSAPP_TEMPLATE_PAID: "vshop_payment_success",
    WHATSAPP_TEMPLATE_FAILED: "vshop_payment_failed",
    WHATSAPP_TEMPLATE_ORDER: "vshop_new_order",
    WHATSAPP_TEMPLATE_LANG: "id",
    // Antrian: backoff cepat & retry maks 3 agar test deterministik-cepat.
    WA_RETRY_BASE_MS: "1",
    WA_RETRY_MAX_ATTEMPTS: "3",
    WA_QUEUE_CONCURRENCY: "3",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saveEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const msg: WaMessage = {
  template: bodyTemplate("vshop_payment_success", "id", [
    "Siti",
    "VS-0001",
    "Rp7.000",
    "https://vshop.test/sukses?order=o1",
  ]),
  text: "Halo Siti! ✅ Pembayaran order VS-0001 sebesar Rp7.000 berhasil.",
};

describe("sendMessage — mode auto (template utama, fallback teks)", () => {
  it("mengirim TEMPLATE dengan nama + bahasa + komponen body saat template tersedia", async () => {
    const res = await sendMessage("6281234567890", msg);
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(true);
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.type).toBe("template");
    expect(p.to).toBe("6281234567890");
    const t = p.template as Record<string, unknown>;
    expect(t.name).toBe("vshop_payment_success");
    expect(t.language).toEqual({ code: "id" });
    expect(t.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Siti" },
          { type: "text", text: "VS-0001" },
          { type: "text", text: "Rp7.000" },
          { type: "text", text: "https://vshop.test/sukses?order=o1" },
        ],
      },
    ]);
  });

  it("fallback ke TEKS BEBAS bila template ditolak (mis. belum disetujui / sandbox)", async () => {
    responses.push({ status: 412, body: { error: { message: "template not found" } } });
    const res = await sendMessage("6281234567890", msg);
    expect(requests).toHaveLength(2);
    expect(requests[0].payload.type).toBe("template");
    expect(requests[1].payload.type).toBe("text");
    expect((requests[1].payload.text as { body: string }).body).toBe(msg.text);
    // delivered diambil dari respons teks (yang berhasil).
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(true);
  });

  it("fallback juga berjalan saat template error non-HTTP (network)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      })
    );
    const res = await sendMessage("6281234567890", msg);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network");
  });
});

describe("sendMessage — mode text (selalu teks bebas)", () => {
  it("tidak pernah mengirim template walau nama template terkonfigurasi", async () => {
    setEnv({ WHATSAPP_MESSAGE_MODE: "text" });
    const res = await sendMessage("6281234567890", msg);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.type).toBe("text");
    expect(res.ok).toBe(true);
  });
});

describe("sendMessage — antrian in-memory + retry backoff", () => {
  it("gagal sementara (HTTP 500) diulang otomatis lalu berhasil", async () => {
    // Pass 1: template 500 → fallback teks 500 (transient). Pass 2: template
    // 500 → fallback teks 200 → sukses. Total 4 request.
    responses.push(
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 500, body: {} },
      { status: 200, body: { messages: [{ id: "wamid-ok" }] } }
    );
    const res = await sendMessage("6281234567890", msg);
    expect(requests).toHaveLength(4);
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(true);
  });

  it("kegagalan permanen (HTTP 400) TIDAK diulang", async () => {
    responses.push({ status: 400, body: {} }, { status: 400, body: {} });
    const res = await sendMessage("6281234567890", msg);
    // template 400 → fallback teks 400 → berhenti (permanen, tanpa retry).
    expect(requests).toHaveLength(2);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("HTTP 400");
  });

  it("response sukses TANPA message id → gagal 'no message id' (transient, diulang)", async () => {
    responses.push(
      { status: 200, body: {} }, // tanpa messages → no message id → retry
      { status: 200, body: { messages: [{ id: "wamid-ok" }] } }
    );
    const res = await sendMessage("6281234567890", { text: "Halo" });
    expect(res.ok).toBe(true);
    expect(res.delivered).toBe(true);
    expect(requests).toHaveLength(2);
  });

  it("fetch melempar NON-Error (string) → error 'network' (String(err))", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw "ECONNRESET-string";
      })
    );
    const res = await sendMessage("6281234567890", { text: "Halo" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network");
  });

  it("mode demo (tanpa token): template di-log ringkas; template tanpa components tetap jalan", async () => {
    setEnv({ WHATSAPP_TOKEN: undefined, WHATSAPP_PHONE_NUMBER_ID: undefined });
    const res = await sendMessage("6281234567890", msg);
    expect(res.ok).toBe(true); // demo selalu "berhasil"
    expect(res.delivered).toBe(false);

    // Template tanpa komponen → payload tanpa field components.
    const res2 = await sendMessage("6281234567890", { template: { name: "x", language: "id" } });
    expect(res2.ok).toBe(true);
    expect(requests).toHaveLength(0); // demo tidak memanggil fetch
  });

  it("network error diulang sampai max attempts lalu gagal", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        throw new Error("ECONNRESET");
      })
    );
    // Pesan teks-only: 1 fetch per percobaan → 3 percobaan = 3 call.
    const res = await sendMessage("6281234567890", { text: "Halo!" });
    expect(calls).toBe(3); // max attempts
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network");
  });

  it("konkurrensi dibatasi (WA_QUEUE_CONCURRENCY) walau banyak kiriman", async () => {
    setEnv({ WA_QUEUE_CONCURRENCY: "2" });
    let active = 0;
    let maxActive = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 15));
        active--;
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: "wamid-x" }] }),
          text: async () => "",
        } as Response;
      })
    );
    const results = await Promise.all(
      ["6281111111111", "6282222222222", "6283333333333", "6284444444444"].map((to) =>
        sendMessage(to, { text: "Halo!" })
      )
    );
    expect(maxActive).toBe(2);
    expect(results.every((r) => r.ok && r.delivered)).toBe(true);
  });

  it("notifyVoucherRedeemed tetap mengembalikan hasil asli lewat antrian", async () => {
    setEnv({ WHATSAPP_TEMPLATE_REDEEMED: "vshop_voucher_redeemed" });
    const ok = await notifyVoucherRedeemed("0812987654321", "Warung Nusantara", {
      id: "c1",
      voucherId: "v1",
      userId: "u1",
      kode: "VS-8F3A-21KQ",
      kodeKonfirmasi: "482913",
      status: "active",
      claimedAt: "2026-08-10T00:00:00.000Z",
      useCount: 0,
      voucher: {
        id: "v1",
        merchantId: "m1",
        merchantName: "Warung Nusantara",
        name: "Diskon 20% Makanan",
        jenisVoucher: "diskon",
        nilai: 20000,
        minTransaksi: 100000,
        kuota: 100,
        masaBerlaku: "2026-09-01T00:00:00.000Z",
        maksPenggunaan: 1,
        syaratKetentuan: "",
        jumlah: 100,
        status: "active",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      user: {
        id: "u1",
        name: "Siti Aminah",
        phone: "081234567890",
        passwordHash: "x",
        role: "customer",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
  });
});

describe("sendMessage — tanpa template", () => {
  it("langsung kirim teks bebas (mode auto, template tidak dikonfigurasi)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID: undefined });
    const res = await sendMessage("6281234567890", { text: "Halo!" });
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.type).toBe("text");
    expect(res.ok).toBe(true);
  });
});

describe("pesan pembayaran — link detail transaksi (riwayat pembayaran)", () => {
  const order = {
    id: "ord-trx",
    orderNumber: "VS-20260816-0001",
    userId: "u1",
    type: "package" as const,
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
    totalAmount: 7000,
    status: "paid" as const,
    paymentStatus: "paid" as const,
    paymentMethod: "qris",
    metadata: {},
    createdAt: "2026-08-16T10:00:00.000Z",
  };

  it("paidWaMessage: template param {{4}} = link /transaksi/[orderId]", () => {
    const m = paidWaMessage(order, "Siti Aminah");
    const params = (m.template!.components![0].parameters as Array<{ text: string }>);
    expect(params[3].text).toBe("https://vshop.test/transaksi/ord-trx");
    // Fallback teks juga menuju detail transaksi (bukan /sukses lagi).
    expect(m.text).toContain("https://vshop.test/transaksi/ord-trx");
    expect(m.text).not.toContain("/sukses?order=");
  });

  it("WA_LINK_BASE (domain publik) dipakai untuk link — terpisah dari APP_URL", () => {
    setEnv({ WA_LINK_BASE: "https://wa.vshop.test" });
    const m = paidWaMessage(order, "Siti Aminah");
    const params = (m.template!.components![0].parameters as Array<{ text: string }>);
    expect(params[3].text).toBe("https://wa.vshop.test/transaksi/ord-trx");
    expect(m.text).toContain("https://wa.vshop.test/transaksi/ord-trx?print=1");
    expect(m.text).not.toContain("https://vshop.test/transaksi/ord-trx");
    // failedWaMessage ikut memakai link base yang sama.
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: { failureReason: "Pembayaran ditolak oleh bank" } };
    const f = failedWaMessage(failed, "Siti");
    expect(f.text).toContain("https://wa.vshop.test/bayar/ord-trx");
    expect(f.text).toContain("https://wa.vshop.test/transaksi/ord-trx");
  });

  it("failedWaMessage: template param {{5}} = link /transaksi/[orderId]", () => {
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: { failureReason: "Pembayaran ditolak oleh bank" } };
    const m = failedWaMessage(failed, "Siti Aminah");
    const params = (m.template!.components![0].parameters as Array<{ text: string }>);
    expect(params[4].text).toBe("https://vshop.test/transaksi/ord-trx");
    // Fallback teks punya DUA link: Coba Lagi (/bayar/) + Detail transaksi.
    expect(m.text).toContain("https://vshop.test/bayar/ord-trx");
    expect(m.text).toContain("https://vshop.test/transaksi/ord-trx");
  });

  it("alasan gagal spesifik ikut dalam pesan", () => {
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: { failureReason: "Saldo tidak mencukupi" } };
    const m = failedWaMessage(failed, "Siti Aminah");
    expect(m.text).toContain("Saldo tidak mencukupi");
    const params = (m.template!.components![0].parameters as Array<{ text: string }>);
    expect(params[3].text).toBe("Saldo tidak mencukupi");
  });

  it("failed tanpa failureReason & bukan expired → 'Pembayaran belum berhasil'", () => {
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: {} };
    const m = failedWaMessage(failed, "Siti Aminah");
    expect(m.text).toContain("Pembayaran belum berhasil");
  });

  it("retriedWaMessage: template param {{4}} = link /bayar/[orderId] + teks fallback", () => {
    setEnv({ WHATSAPP_TEMPLATE_RETRIED: "vshop_payment_retried" });
    const retried = { ...order, paymentStatus: "pending" as const, status: "pending" as const };
    const m = retriedWaMessage(retried, "Siti Aminah");
    const params = (m.template!.components![0].parameters as Array<{ text: string }>).map(
      (p) => p.text
    );
    expect(params).toEqual([
      "Siti Aminah",
      "VS-20260816-0001",
      "Rp\u00A07.000",
      "https://vshop.test/bayar/ord-trx",
    ]);
    expect(m.text).toContain("siap dibayar ulang");
    expect(m.text).toContain("https://vshop.test/bayar/ord-trx");
  });

  it("retriedWaMessage tanpa template → teks bebas", () => {
    setEnv({ WHATSAPP_TEMPLATE_RETRIED: undefined });
    const retried = { ...order, paymentStatus: "pending" as const, status: "pending" as const };
    const m = retriedWaMessage(retried, "Siti");
    expect(m.template).toBeUndefined();
    expect(m.text).toContain("/bayar/ord-trx");
  });

  it("default env: apiBase & templateLang fallback, NEXT_PUBLIC_APP_URL dipakai bila APP_URL kosong", () => {
    setEnv({
      WHATSAPP_API_BASE: undefined,
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: "https://fallback.test",
      WHATSAPP_TEMPLATE_LANG: undefined,
      WHATSAPP_TEMPLATE_PAID: undefined,
      WHATSAPP_TEMPLATE_FAILED: undefined,
    });
    const m = paidWaMessage(order, "Siti");
    expect(m.template).toBeUndefined(); // tanpa template → fallback teks
    expect(m.text).toContain("https://fallback.test/transaksi/ord-trx");
    // failedWaMessage juga tanpa template → teks bebas.
    const f = failedWaMessage({ ...order, paymentStatus: "failed" as const, status: "cancelled" as const }, "Siti");
    expect(f.template).toBeUndefined();
  });
});

describe("templateWithButtons — component `button` (url / quick_reply)", () => {
  it("body + tombol url ber-suffix: sub_type/index + parameters suffix", () => {
    const buttons: WaButtonSpec[] = [
      { subType: "url", index: 0, payload: "ord-abc" },
    ];
    const t = templateWithButtons("vshop_payment_failed", "id", ["Siti", "VS-0001"], buttons);
    expect(t.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Siti" },
          { type: "text", text: "VS-0001" },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "ord-abc" }],
      },
    ]);
  });

  it("tombol url TANPA payload (URL tetap di template) → komponen tanpa parameters", () => {
    const t = templateWithButtons(
      "vshop_new_order",
      "id",
      ["Warung"],
      [{ subType: "url", index: 0 }]
    );
    const btn = t.components![1];
    expect(btn.type).toBe("button");
    expect(btn.sub_type).toBe("url");
    expect(btn.index).toBe("0");
    expect(btn.parameters).toBeUndefined();
  });

  it("tombol quick_reply membawa payload reply (teks yang terkirim saat diketuk)", () => {
    const t = templateWithButtons(
      "vshop_payment_failed",
      "id",
      ["Siti"],
      [{ subType: "quick_reply", index: 0, payload: "BAYAR_ULANG" }]
    );
    expect(t.components![1]).toEqual({
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "text", text: "BAYAR_ULANG" }],
    });
  });

  it("beberapa tombol: indeks urut 0,1,2 sesuai posisi di template Meta", () => {
    const buttons: WaButtonSpec[] = [
      { subType: "url", index: 0, payload: "ord-x" }, // Bayar ulang
      { subType: "url", index: 1, payload: "ord-x" }, // Lihat detail
      { subType: "quick_reply", index: 2, payload: "HUBUNGI_ADMIN" },
    ];
    const t = templateWithButtons("vshop_payment_failed", "id", ["Siti"], buttons);
    const comps = t.components!.slice(1);
    expect(comps.map((c) => c.index)).toEqual(["0", "1", "2"]);
    expect(comps.map((c) => c.sub_type)).toEqual(["url", "url", "quick_reply"]);
  });
});

describe("tombol template pesan pembayaran (WHATSAPP_TEMPLATE_*_BUTTONS)", () => {
  const order = {
    id: "ord-btns",
    orderNumber: "VS-20260816-0007",
    userId: "u1",
    type: "package" as const,
    items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
    totalAmount: 7000,
    status: "paid" as const,
    paymentStatus: "paid" as const,
    paymentMethod: "qris",
    metadata: {},
    createdAt: "2026-08-16T10:00:00.000Z",
  };

  it("paid + BUTTONS=detail → tombol url 'Lihat detail' dengan suffix order.id", () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "detail" });
    const m = paidWaMessage(order, "Siti");
    const comps = m.template!.components!;
    expect(comps[0].type).toBe("body");
    expect(comps[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "ord-btns" }],
    });
  });

  it("paid + BUTTONS=invoice → tombol url 'Lihat Invoice PDF' (template /transaksi/{{1}}?print=1)", () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "invoice" });
    const m = paidWaMessage(order, "Siti");
    const comps = m.template!.components!;
    expect(comps[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "ord-btns" }], // suffix order.id
    });
  });

  it("paid fallback teks: No. Invoice + link invoice PDF (?print=1); order lama → fallback nomor order", () => {
    const withInv = { ...order, metadata: { invoiceNumber: "VS-INV-20260816-0001" } };
    const m = paidWaMessage(withInv, "Siti");
    expect(m.text).toContain("No. Invoice: VS-INV-20260816-0001");
    expect(m.text).toContain("https://vshop.test/transaksi/ord-btns?print=1");
    // Order lama tanpa invoiceNumber → teks memakai nomor order sebagai
    // fallback (getInvoiceNumber) — link invoice PDF tetap `?print=1`.
    const legacy = paidWaMessage(order, "Siti");
    expect(legacy.text).toContain("No. Invoice: VS-20260816-0007");
    expect(legacy.text).toContain("https://vshop.test/transaksi/ord-btns?print=1");
  });

  it("failed + BUTTONS=retry,detail → dua tombol url urut: bayar lalu detail", () => {
    setEnv({ WHATSAPP_TEMPLATE_FAILED_BUTTONS: "retry,detail" });
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: { failureReason: "Pembayaran ditolak oleh bank" } };
    const m = failedWaMessage(failed, "Siti");
    const comps = m.template!.components!.slice(1);
    expect(comps).toEqual([
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "ord-btns" }], // /bayar/{{1}}
      },
      {
        type: "button",
        sub_type: "url",
        index: "1",
        parameters: [{ type: "text", text: "ord-btns" }], // /transaksi/{{1}}
      },
    ]);
  });

  it("failed + BUTTONS=detail,retry → urutan dibalik (peran diurut sesuai env)", () => {
    setEnv({ WHATSAPP_TEMPLATE_FAILED_BUTTONS: "detail,retry" });
    const failed = { ...order, paymentStatus: "failed" as const, status: "cancelled" as const, metadata: {} };
    const m = failedWaMessage(failed, "Siti");
    const comps = m.template!.components!.slice(1);
    expect(comps.map((c) => c.index)).toEqual(["0", "1"]);
    expect(comps.every((c) => c.sub_type === "url")).toBe(true);
    expect(comps.every((c) => (c.parameters as Array<{ text: string }>)[0].text === "ord-btns")).toBe(true);
  });

  it("peran tidak dikenal diabaikan dengan peringatan; tanpa peran valid → template body-only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "detail,foobar" });
    const m = paidWaMessage(order, "Siti");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("foobar"));
    const comps = m.template!.components!;
    expect(comps).toHaveLength(2); // body + 1 tombol (detail), foobar dibuang
    expect(comps[1].sub_type).toBe("url");
    warn.mockRestore();

    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "foo,bar" });
    const m2 = paidWaMessage(order, "Siti");
    expect(m2.template!.components!).toHaveLength(1); // body-only
    expect(m2.template!.components![0].type).toBe("body");
  });

  it("tanpa env BUTTONS → template tetap body-only (perilaku lama)", () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: undefined, WHATSAPP_TEMPLATE_FAILED_BUTTONS: undefined });
    const m = paidWaMessage(order, "Siti");
    expect(m.template!.components!).toHaveLength(1);
    expect(m.template!.components![0].type).toBe("body");
  });

  it("payload button dikirim utuh ke Cloud API (verifikasi request nyata)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "detail" });
    const m = paidWaMessage(order, "Siti");
    const res = await sendMessage("6281234567890", m);
    expect(res.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const t = requests[0].payload.template as { components: Array<Record<string, unknown>> };
    expect(t.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "ord-btns" }],
    });
  });

  it("mode text → tombol tidak pernah dikirim (teks bebas saja)", () => {
    setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "detail", WHATSAPP_MESSAGE_MODE: "text" });
    const m = paidWaMessage(order, "Siti");
    expect(m.template).toBeDefined(); // tetap dibangun, tapi mode text tidak mengirim
  });
});

describe("normalizeToE164", () => {
  it("mengubah 08xx → 628xx dan menerima nomor internasional", () => {
    expect(normalizeToE164("081234567890")).toBe("6281234567890");
    expect(normalizeToE164("+6281234567890")).toBe("6281234567890");
    expect(normalizeToE164("6281234567890")).toBe("6281234567890");
    expect(normalizeToE164("0812-3456-7890")).toBe("6281234567890");
  });
  it("menolak nomor tidak valid", () => {
    expect(normalizeToE164("")).toBeNull();
    expect(normalizeToE164("12345")).toBeNull();
    expect(normalizeToE164(undefined)).toBeNull();
    // Tanpa digit sama sekali setelah pembersihan karakter.
    expect(normalizeToE164("abc!@#")).toBeNull();
  });
});

describe("notifyVoucherRedeemed (merchant)", () => {
  const voucher: Voucher = {
    id: "v1",
    merchantId: "m1",
    merchantName: "Warung Nusantara",
    name: "Diskon 20% Makanan",
    jenisVoucher: "diskon",
    nilai: 20000,
    minTransaksi: 100000,
    kuota: 100,
    masaBerlaku: "2026-09-01T00:00:00.000Z",
    maksPenggunaan: 1,
    syaratKetentuan: "",
    jumlah: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const user: User = {
    id: "u1",
    name: "Siti Aminah",
    phone: "081234567890",
    passwordHash: "x",
    role: "customer",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const claim: ClaimedVoucher = {
    id: "c1",
    voucherId: "v1",
    userId: "u1",
    kode: "VS-8F3A-21KQ",
    kodeKonfirmasi: "482913",
    status: "active",
    claimedAt: "2026-08-10T00:00:00.000Z",
    useCount: 0,
  };

  it("mengirim template REDEEMED ke nomor merchant (E.164)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_REDEEMED: "vshop_voucher_redeemed" });
    const ok = await notifyVoucherRedeemed("0812987654321", "Warung Nusantara", {
      ...claim,
      voucher,
      user,
    });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.to).toBe("62812987654321"); // 0812987654321 → 62 + 812987654321
    expect(p.type).toBe("template");
    const t = p.template as Record<string, unknown>;
    expect(t.name).toBe("vshop_voucher_redeemed");
    expect(t.language).toEqual({ code: "id" });
    expect(t.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Warung Nusantara" },
          { type: "text", text: "Diskon 20% Makanan" },
          { type: "text", text: "Rp\u00A020.000" },
          { type: "text", text: "Siti Aminah" },
          { type: "text", text: "VS-8F3A-21KQ" },
        ],
      },
    ]);
  });

  it("fallback teks bebas bila template ditolak", async () => {
    setEnv({ WHATSAPP_TEMPLATE_REDEEMED: "vshop_voucher_redeemed" });
    responses.push({ status: 400, body: { error: { message: "template not approved" } } });
    const ok = await notifyVoucherRedeemed("0812987654321", "Warung Nusantara", {
      ...claim,
      voucher,
      user,
    });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0].payload.type).toBe("template");
    expect(requests[1].payload.type).toBe("text");
    expect((requests[1].payload.text as { body: string }).body).toContain("berhasil diredeem oleh Siti Aminah");
  });

  it("nomor merchant tidak valid → false, tanpa request", async () => {
    const ok = await notifyVoucherRedeemed("123", "Warung Nusantara", claim);
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("klaim tanpa voucher/user → fallback nama & nilai, teks bebas tanpa template", async () => {
    const ok = await notifyVoucherRedeemed("0812987654321", "Warung Nusantara", claim);
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.type).toBe("text");
    const body = (requests[0].payload.text as { body: string }).body;
    expect(body).toContain("Voucher"); // fallback nama voucher
    expect(body).toContain("Pelanggan"); // fallback nama pelanggan
  });
});

describe("notifyClaimExpiringSoon (pelanggan)", () => {
  const voucher: Voucher = {
    id: "v1",
    merchantId: "m1",
    merchantName: "Warung Nusantara",
    name: "Diskon 20% Makanan",
    jenisVoucher: "diskon",
    nilai: 20000,
    minTransaksi: 100000,
    kuota: 100,
    masaBerlaku: "2026-08-18T00:00:00.000Z",
    maksPenggunaan: 1,
    syaratKetentuan: "",
    jumlah: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const user: User = {
    id: "u1",
    name: "Siti Aminah",
    phone: "081234567890",
    passwordHash: "x",
    role: "customer",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const claim: ClaimedVoucher = {
    id: "c1",
    voucherId: "v1",
    userId: "u1",
    kode: "VS-8F3A-21KQ",
    kodeKonfirmasi: "482913",
    status: "active",
    claimedAt: "2026-08-10T00:00:00.000Z",
    useCount: 0,
  };

  it("mengirim template EXPIRING ke pelanggan dengan tanggal kadaluarsa", async () => {
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring" });
    const ok = await notifyClaimExpiringSoon({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.to).toBe("6281234567890");
    expect(p.type).toBe("template");
    const t = p.template as Record<string, unknown>;
    expect(t.name).toBe("vshop_voucher_expiring");
    const params = (t.components as Array<{ parameters: Array<{ text: string }> }>)[0].parameters;
    expect(params[0].text).toBe("Siti Aminah");
    expect(params[1].text).toBe("Diskon 20% Makanan");
    expect(params[2].text).toContain("20.000"); // formatRupiah memakai spasi non-breaking
    expect(params[3].text).toContain("2026"); // tanggal kadaluarsa
    expect(params[4].text).toContain("/voucher-saya");
  });

  it("pelanggan tanpa nomor → false, tanpa request", async () => {
    const ok = await notifyClaimExpiringSoon({ ...claim, voucher, user: { ...user, phone: undefined } });
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("CTA 'Gunakan Sekarang': BUTTONS=vouchers → tombol url tetap (tanpa parameter) + body utuh", async () => {
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring", WHATSAPP_TEMPLATE_EXPIRING_BUTTONS: "vouchers" });
    const ok = await notifyClaimExpiringSoon({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const t = requests[0].payload.template as {
      components: Array<Record<string, unknown>>;
    };
    expect(t.components).toHaveLength(2); // body + tombol
    // Tombol url CTA → URL tetap di template Meta (<APP_URL>/voucher-saya), tanpa suffix.
    expect(t.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
    });
    // Body tetap 5 parameter (placeholder urut, {{5}} = link voucher-saya).
    const params = (t.components[0] as { parameters: Array<{ text: string }> }).parameters;
    expect(params).toHaveLength(5);
    expect(params[4].text).toContain("/voucher-saya");
  });

  it("CTA tanpa env BUTTONS → template body-only (perilaku lama)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring", WHATSAPP_TEMPLATE_EXPIRING_BUTTONS: undefined });
    const ok = await notifyClaimExpiringSoon({ ...claim, voucher, user });
    expect(ok).toBe(true);
    const t = requests[0].payload.template as { components: unknown[] };
    expect(t.components).toHaveLength(1);
    expect((t.components[0] as { type: string }).type).toBe("body");
  });

  it("peran ber-order (detail/retry) diabaikan utk notifikasi voucher (peringatan)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring", WHATSAPP_TEMPLATE_EXPIRING_BUTTONS: "detail,vouchers" });
    const ok = await notifyClaimExpiringSoon({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("detail"));
    const t = requests[0].payload.template as { components: Array<Record<string, unknown>> };
    expect(t.components).toHaveLength(2); // detail dibuang → hanya vouchers
    expect(t.components[1].sub_type).toBe("url");
    warn.mockRestore();
  });

  it("klaim tanpa voucher → fallback nama & tanggal; user tanpa nama → 'Pelanggan'", async () => {
    const ok = await notifyClaimExpiringSoon({
      ...claim,
      user: { ...user, name: undefined } as unknown as User,
    });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.type).toBe("text");
    const body = (requests[0].payload.text as { body: string }).body;
    expect(body).toContain("Voucher");
    expect(body).toContain("Pelanggan");
  });
});

describe("notifyClaimExpiringSoon24h (pengingat H-1 / 24 jam)", () => {
  const voucher: Voucher = {
    id: "v1",
    merchantId: "m1",
    merchantName: "Warung Nusantara",
    name: "Diskon 20% Makanan",
    jenisVoucher: "diskon",
    nilai: 20000,
    minTransaksi: 100000,
    kuota: 100,
    masaBerlaku: "2026-08-17T00:00:00.000Z",
    maksPenggunaan: 1,
    syaratKetentuan: "",
    jumlah: 100,
    status: "active",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const user: User = {
    id: "u1",
    name: "Siti Aminah",
    phone: "081234567890",
    passwordHash: "x",
    role: "customer",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const claim: ClaimedVoucher = {
    id: "c1",
    voucherId: "v1",
    userId: "u1",
    kode: "VS-8F3A-21KQ",
    kodeKonfirmasi: "482913",
    status: "active",
    claimedAt: "2026-08-10T00:00:00.000Z",
    useCount: 0,
  };

  it("mengirim template EXPIRING dengan teks H-1 (kadaluarsa besok)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring" });
    const ok = await notifyClaimExpiringSoon24h({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.to).toBe("6281234567890");
    expect(p.type).toBe("template");
    const t = p.template as Record<string, unknown>;
    expect(t.name).toBe("vshop_voucher_expiring");
    const params = (t.components as Array<{ parameters: Array<{ text: string }> }>)[0].parameters;
    expect(params[0].text).toBe("Siti Aminah");
    expect(params[1].text).toBe("Diskon 20% Makanan");
    expect(params[4].text).toContain("/voucher-saya");
  });

  it("fallback teks H-1 menyebut 'KADALUARSA BESOK'", async () => {
    // Tanpa template → teks bebas; verifikasi konten tier H-1.
    const ok = await notifyClaimExpiringSoon24h({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.type).toBe("text");
    const body = (requests[0].payload.text as { body: string }).body;
    expect(body).toContain("KADALUARSA BESOK");
    expect(body).toContain("17 Agustus");
    expect(body).toContain("/voucher-saya");
  });

  it("pelanggan tanpa nomor → false, tanpa request", async () => {
    const ok = await notifyClaimExpiringSoon24h({ ...claim, voucher, user: { ...user, phone: undefined } });
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });

  it("tier H-1 juga memakai CTA 'Gunakan Sekarang' (BUTTONS=vouchers)", async () => {
    setEnv({ WHATSAPP_TEMPLATE_EXPIRING: "vshop_voucher_expiring", WHATSAPP_TEMPLATE_EXPIRING_BUTTONS: "vouchers" });
    const ok = await notifyClaimExpiringSoon24h({ ...claim, voucher, user });
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const t = requests[0].payload.template as {
      components: Array<Record<string, unknown>>;
    };
    expect(t.components).toHaveLength(2);
    expect(t.components[1]).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
    });
  });
});

describe("notifyOrderPayment — pemilihan penerima (pelanggan/merchant)", () => {
  /** Tunggu antrian kirim fire-and-forget selesai. */
  const waitDrain = () => new Promise((r) => setTimeout(r, 120));

  const customer = {
    id: "u1",
    name: "Siti Aminah",
    phone: "081234567890",
  };

  function paymentOrder(id: string, over: Record<string, unknown> = {}): Order {
    return {
      id,
      orderNumber: `VS-20260816-${id}`,
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      status: "paid",
      paymentStatus: "paid",
      paymentMethod: "qris",
      metadata: {},
      createdAt: "2026-08-16T10:00:00.000Z",
      ...over,
    } as Order;
  }

  beforeEach(() => {
    fixture.orders.length = 0;
    fixture.users.length = 0;
    fixture.users.push(customer);
    fixture.merchants.m1 = { noWAUsaha: "0812987654321", namaUsaha: "Warung Nusantara" };
    setEnv({ WHATSAPP_BUSINESS_TO: undefined });
  });

  it("paid order paket → hanya PELANGGAN (1 kirim, template paid)", async () => {
    fixture.orders.push(paymentOrder("ord-pkg"));
    await notifyOrderPayment("ord-pkg", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.to).toBe("6281234567890");
    expect(p.type).toBe("template");
    expect((p.template as Record<string, unknown>).name).toBe("vshop_payment_success");
  });

  it("paid order merchandise → PELANGGAN + MERCHANT (WHATSAPP_BUSINESS_TO), 2 kirim", async () => {
    setEnv({ WHATSAPP_BUSINESS_TO: "081311111111" });
    fixture.orders.push(
      paymentOrder("ord-merch", {
        type: "merchandise",
        status: "processing",
        items: [{ name: "Mug V Shop", unitPrice: 25000, quantity: 1 }],
        totalAmount: 25000,
      })
    );
    await notifyOrderPayment("ord-merch", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(2);
    const byTo = Object.fromEntries(requests.map((r) => [r.payload.to, r.payload]));
    expect(byTo["6281234567890"]).toBeDefined(); // pelanggan
    expect(byTo["6281311111111"]).toBeDefined(); // merchant (E.164)
    expect((byTo["6281311111111"].template as Record<string, unknown>).name).toBe(
      "vshop_new_order"
    );
  });

  it("paid merchandise dengan metadata.merchantId → merchant dari getMerchantById (noWAUsaha)", async () => {
    fixture.orders.push(
      paymentOrder("ord-m1", {
        type: "merchandise",
        metadata: { merchantId: "m1" },
      })
    );
    await notifyOrderPayment("ord-m1", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(2);
    const byTo = Object.fromEntries(requests.map((r) => [r.payload.to, r.payload]));
    // noWAUsaha 0812987654321 → 62 + 812987654321
    expect(byTo["62812987654321"]).toBeDefined();
  });

  it("failed → hanya PELANGGAN (template failed)", async () => {
    fixture.orders.push(
      paymentOrder("ord-fail", {
        type: "merchandise",
        status: "cancelled",
        paymentStatus: "failed",
        metadata: { failureReason: "Pembayaran ditolak oleh bank" },
      })
    );
    await notifyOrderPayment("ord-fail", "failed", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.to).toBe("6281234567890");
    expect((requests[0].payload.template as Record<string, unknown>).name).toBe(
      "vshop_payment_failed"
    );
  });

  it("expired → hanya PELANGGAN, alasan 'Waktu pembayaran habis'", async () => {
    fixture.orders.push(
      paymentOrder("ord-exp", { status: "cancelled", paymentStatus: "expired" })
    );
    await notifyOrderPayment("ord-exp", "expired", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.type).toBe("template");
    const params = (
      (p.template as { components: Array<{ parameters: Array<{ text: string }> }> }).components[0]
        .parameters
    );
    expect(params[3].text).toBe("Waktu pembayaran habis");
  });

  it("pelanggan tanpa nomor valid → 0 kirim (dilewati, dicatat)", async () => {
    fixture.users[0] = { ...customer, phone: "123" }; // tidak valid
    fixture.orders.push(paymentOrder("ord-nophone"));
    await notifyOrderPayment("ord-nophone", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(0);
  });

  it("merchandise tanpa target merchant → pelanggan saja (skip log merchant)", async () => {
    fixture.orders.push(
      paymentOrder("ord-nomerchant", { type: "merchandise" }) // tanpa merchantId & businessTo
    );
    await notifyOrderPayment("ord-nomerchant", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.to).toBe("6281234567890");
  });

  it("order tidak ditemukan → notifikasi dilewati tanpa request", async () => {
    fixture.orders.length = 0;
    await notifyOrderPayment("ord-gone", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(0);
  });

  it("user tidak ditemukan → nama 'Pelanggan', logSkipped dengan '-'", async () => {
    fixture.users.length = 0;
    fixture.orders.push(paymentOrder("ord-nouser"));
    await notifyOrderPayment("ord-nouser", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(0);
  });

  it("failed dengan nomor pelanggan tidak valid → logSkipped (0 kirim)", async () => {
    fixture.users[0] = { ...customer, phone: "123" };
    fixture.orders.push(
      paymentOrder("ord-fnophone", { paymentStatus: "failed", status: "cancelled" })
    );
    await notifyOrderPayment("ord-fnophone", "failed", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(0);
  });

  it("merchantId ada tapi noWAUsaha tidak valid → fallback businessTo, pelanggan saja", async () => {
    fixture.merchants.m1 = { noWAUsaha: "123", namaUsaha: "Warung" }; // noWAUsaha tidak valid
    fixture.orders.push(
      paymentOrder("ord-mbad", { type: "merchandise", metadata: { merchantId: "m1" } })
    );
    await notifyOrderPayment("ord-mbad", "paid", testDeps());
    await waitDrain();
    expect(requests).toHaveLength(1); // hanya pelanggan (businessTo unset)
    expect(requests[0].payload.to).toBe("6281234567890");
  });

  describe("payload template end-to-end (seam deps + fetch)", () => {
    /** Ambil request pertama ke Cloud API; `template` bertipe template. */
    const tpl = (i = 0) => requests[i].payload.template as {
      name: string;
      language: { code: string };
      components?: Array<{ type: string; sub_type?: string; index?: string; parameters?: Array<{ text: string }> }>;
    };
    const bodyParams = (i = 0) => tpl(i).components?.[0].parameters?.map((p) => p.text) ?? [];

    it("paid → template lengkap ke PELANGGAN: nama, no. order, jumlah, link transaksi", async () => {
      fixture.orders.push(paymentOrder("ord-e2e"));
      await notifyOrderPayment("ord-e2e", "paid", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      const p = requests[0].payload;
      expect(p.to).toBe("6281234567890"); // E.164 dari 081234567890
      expect(p.messaging_product).toBe("whatsapp");
      expect(p.type).toBe("template");
      expect(tpl().name).toBe("vshop_payment_success");
      expect(tpl().language).toEqual({ code: "id" });
      expect(bodyParams()).toEqual([
        "Siti Aminah",
        "VS-20260816-ord-e2e",
        "Rp\u00A07.000",
        "https://vshop.test/transaksi/ord-e2e",
      ]);
      // Hanya komponen body (tanpa tombol bila env BUTTONS kosong).
      expect(tpl().components).toHaveLength(1);
    });

    it("paid merchandise → template ORDER lengkap ke MERCHANT (nama, item, jumlah, link transaksi)", async () => {
      fixture.orders.push(
        paymentOrder("ord-m2", {
          type: "merchandise",
          status: "processing",
          items: [{ name: "Mug V Shop", unitPrice: 25000, quantity: 2 }],
          totalAmount: 50000,
          metadata: { merchantId: "m1" }, // target merchant via fixture.merchants.m1
        })
      );
      await notifyOrderPayment("ord-m2", "paid", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(2);
      // Merchant = request kedua (first-come first-serve antrian konkurrensi 3).
      const m = requests.find((r) => r.payload.to === "62812987654321")!;
      expect(m.payload.type).toBe("template");
      const mt = m.payload.template as {
        name: string;
        language: { code: string };
        components?: Array<{ parameters?: Array<{ text: string }> }>;
      };
      expect(mt.name).toBe("vshop_new_order");
      expect(mt.language).toEqual({ code: "id" });
      const params = (mt.components?.[0].parameters ?? []).map((p) => p.text);
      // {{5}} = link DETAIL TRANSAKSI — penjual langsung membuka pesanan masuk.
      expect(params).toEqual([
        "Warung Nusantara",
        "VS-20260816-ord-m2",
        "Mug V Shop×2",
        "Rp\u00A050.000",
        "https://vshop.test/transaksi/ord-m2",
      ]);
    });

    it("paid merchandise → teks bebas merchant memuat link detail transaksi + dashboard", async () => {
      fixture.orders.push(
        paymentOrder("ord-m3", {
          type: "merchandise",
          status: "processing",
          items: [{ name: "Mug V Shop", unitPrice: 25000, quantity: 1 }],
          totalAmount: 25000,
          metadata: { merchantId: "m1" },
        })
      );
      setEnv({ WHATSAPP_MESSAGE_MODE: "text" }); // teks bebas murni
      await notifyOrderPayment("ord-m3", "paid", testDeps());
      await waitDrain();
      const m = requests.find((r) => r.payload.to === "62812987654321")!;
      expect(m.payload.type).toBe("text");
      const body = (m.payload.text as { body: string }).body;
      expect(body).toContain("https://vshop.test/transaksi/ord-m3");
      expect(body).toContain("https://vshop.test/merchant/dashboard");
    });

    it("failed → template lengkap ke PELANGGAN dengan alasan spesifik + link detail", async () => {
      fixture.orders.push(
        paymentOrder("ord-fe2e", {
          paymentStatus: "failed",
          status: "cancelled",
          metadata: { failureReason: "Pembayaran ditolak oleh bank" },
        })
      );
      await notifyOrderPayment("ord-fe2e", "failed", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      const p = requests[0].payload;
      expect(p.to).toBe("6281234567890");
      expect(tpl().name).toBe("vshop_payment_failed");
      expect(bodyParams()).toEqual([
        "Siti Aminah",
        "VS-20260816-ord-fe2e",
        "Rp\u00A07.000",
        "Pembayaran ditolak oleh bank",
        "https://vshop.test/transaksi/ord-fe2e",
      ]);
    });

    it("expired → template failed dengan alasan 'Waktu pembayaran habis' (bukan reason metadata)", async () => {
      fixture.orders.push(
        paymentOrder("ord-ex2e", {
          paymentStatus: "expired",
          status: "cancelled",
          metadata: {}, // tanpa failureReason → fallback waktu habis
        })
      );
      await notifyOrderPayment("ord-ex2e", "expired", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      expect(tpl().name).toBe("vshop_payment_failed");
      expect(bodyParams()[3]).toBe("Waktu pembayaran habis");
    });

    it("paid + WHATSAPP_TEMPLATE_PAID_BUTTONS=detail → tombol url ikut terkirim (suffix order.id)", async () => {
      setEnv({ WHATSAPP_TEMPLATE_PAID_BUTTONS: "detail" });
      fixture.orders.push(paymentOrder("ord-bte2e"));
      await notifyOrderPayment("ord-bte2e", "paid", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      const comps = tpl().components ?? [];
      expect(comps).toHaveLength(2); // body + tombol
      expect(comps[1]).toEqual({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "ord-bte2e" }],
      });
    });

    it("notifyOrderRetried (retry massal admin) → template lengkap ke PELANGGAN + link /bayar", async () => {
      setEnv({ WHATSAPP_TEMPLATE_RETRIED: "vshop_payment_retried" });
      fixture.orders.push(
        paymentOrder("ord-rt", { paymentStatus: "pending", status: "pending" })
      );
      notifyOrderRetried(fixture.orders.find((o) => o.id === "ord-rt") as Order, testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      const p = requests[0].payload;
      expect(p.to).toBe("6281234567890"); // pelanggan, E.164
      expect(p.type).toBe("template");
      expect(tpl().name).toBe("vshop_payment_retried");
      expect(bodyParams()).toEqual([
        "Siti Aminah",
        "VS-20260816-ord-rt",
        "Rp\u00A07.000",
        "https://vshop.test/bayar/ord-rt",
      ]);
    });

    it("notifyOrderRetried tanpa nomor pelanggan valid → logSkipped, tanpa kirim", async () => {
      fixture.users[0] = { ...customer, phone: "123" }; // tidak valid
      fixture.orders.push(
        paymentOrder("ord-rt2", { paymentStatus: "pending", status: "pending" })
      );
      notifyOrderRetried(fixture.orders.find((o) => o.id === "ord-rt2") as Order, testDeps());
      await waitDrain();
      expect(requests).toHaveLength(0);
    });

    it("failed + WHATSAPP_TEMPLATE_FAILED_BUTTONS=retry,detail → dua tombol url (bayar + detail)", async () => {
      setEnv({ WHATSAPP_TEMPLATE_FAILED_BUTTONS: "retry,detail" });
      fixture.orders.push(
        paymentOrder("ord-fbte2e", {
          paymentStatus: "failed",
          status: "cancelled",
          metadata: { failureReason: "Saldo tidak mencukupi" },
        })
      );
      await notifyOrderPayment("ord-fbte2e", "failed", testDeps());
      await waitDrain();
      expect(requests).toHaveLength(1);
      const comps = tpl().components ?? [];
      expect(comps).toHaveLength(3); // body + 2 tombol
      expect(comps.slice(1).map((c) => ({ sub_type: c.sub_type, index: c.index }))).toEqual([
        { sub_type: "url", index: "0" },
        { sub_type: "url", index: "1" },
      ]);
      // Kedua tombol membawa suffix order.id.
      expect(
        comps
          .slice(1)
          .every((c) => c.parameters?.[0]?.text === "ord-fbte2e")
      ).toBe(true);
      // Alasan spesifik tetap di body.
      expect(bodyParams()[3]).toBe("Saldo tidak mencukupi");
    });
  });
});

describe("notifyMerchantPaymentConfigIssue — konfigurasi pembayaran bermasalah", () => {
  const waitDrain = () => new Promise((r) => setTimeout(r, 120));

  function configOrder(id: string): Order {
    return {
      id,
      orderNumber: `VS-CFG-${id}`,
      userId: "u1",
      type: "package",
      items: [{ name: "Paket 7 Hari", unitPrice: 7000, quantity: 1 }],
      totalAmount: 7000,
      status: "pending",
      paymentStatus: "pending",
      metadata: {},
      createdAt: "2026-08-16T10:00:00.000Z",
    } as Order;
  }

  beforeEach(() => {
    fixture.orders.length = 0;
    fixture.merchants.m1 = { noWAUsaha: "0812987654321", namaUsaha: "Warung Nusantara" };
  });

  it("kirim ke MERCHANT via merchantId order, pesan memuat kode + alasan + link configurasi", async () => {
    const order = configOrder("m1");
    order.metadata = { merchantId: "m1" }; // arahkan ke fixture.merchants.m1
    fixture.orders.push(order);
    const sent = notifyMerchantPaymentConfigIssue(
      order,
      "401",
      "Akses ditolak — periksa konfigurasi kunci Midtrans",
      testDeps()
    );
    expect(sent).toBe(true);
    await waitDrain();
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.type).toBe("text"); // teks bebas — alert internal, tanpa template Meta
    expect(p.to).toBe("62812987654321"); // 0812987654321 → E.164
    const body = (p.text as { body: string }).body;
    expect(body).toContain("kode 401");
    expect(body).toContain("Akses ditolak");
    expect(body).toContain("/admin/configurasi");
    expect(body).toContain("VS-CFG-m1");
  });

  it("fallback ke WHATSAPP_BUSINESS_TO bila order tak terkait merchant", async () => {
    setEnv({ WHATSAPP_BUSINESS_TO: "081311111111" });
    const order = configOrder("m2");
    fixture.orders.push(order);
    const sent = notifyMerchantPaymentConfigIssue(
      order,
      "410",
      "Akun merchant nonaktif — hubungi dukungan",
      testDeps()
    );
    expect(sent).toBe(true);
    await waitDrain();
    expect(requests).toHaveLength(1);
    expect(requests[0].payload.to).toBe("6281311111111");
    expect((requests[0].payload.text as { body: string }).body).toContain("kode 410");
  });

  it("tanpa target merchant → dilewati (skip log), tanpa kirim", async () => {
    setEnv({ WHATSAPP_BUSINESS_TO: undefined });
    fixture.merchants = {};
    const order = configOrder("m3");
    fixture.orders.push(order);
    const sent = notifyMerchantPaymentConfigIssue(order, "401", "Akses ditolak", testDeps());
    expect(sent).toBe(false);
    await waitDrain();
    expect(requests).toHaveLength(0);
  });
});

describe("ringkasan harian merchant (daily summary)", () => {
  const merchant: Merchant = {
    id: "m1",
    userId: "u-m1",
    namaUsaha: "Warung Nusantara",
    kategoriUsaha: "kuliner",
    noWAUsaha: "0812987654321",
    alamatUsaha: "Jl. Melati 1",
    namaPemilik: "Budi",
    noWAPemilik: "0812987654321",
    email: "warung@test.id",
    status: "approved",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const summary = { claimedToday: 5, revenueToday: 20000, pendingOrders: 2 };

  it("dailySummaryWaMessage: template DAILY_SUMMARY + params urut (nama, klaim, rupiah, pending, link laporan)", () => {
    setEnv({ WHATSAPP_TEMPLATE_DAILY_SUMMARY: "vshop_daily_summary" });
    const msg = dailySummaryWaMessage("Warung Nusantara", summary);
    expect(msg.template).toBeDefined();
    const t = msg.template as unknown as { name: string; language: string; components: WaButtonSpec[] };
    expect(t.name).toBe("vshop_daily_summary");
    expect(t.language).toBe("id");
    expect(t.components).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "Warung Nusantara" },
          { type: "text", text: "5" },
          { type: "text", text: "Rp\u00A020.000" },
          { type: "text", text: "2" },
          { type: "text", text: "https://vshop.test/merchant/laporan" },
        ],
      },
    ]);
  });

  it("dailySummaryWaMessage: fallback teks bebas berisi angka + link laporan", () => {
    setEnv({ WHATSAPP_TEMPLATE_DAILY_SUMMARY: undefined });
    const msg = dailySummaryWaMessage("Warung Nusantara", summary);
    expect(msg.template).toBeUndefined();
    const text = msg.text ?? "";
    expect(text).toContain("5 voucher terklaim");
    expect(text).toContain("pendapatan Rp\u00A020.000");
    expect(text).toContain("2 order pending");
    expect(text).toContain("/merchant/laporan");
  });

  it("notifyMerchantDailySummary: kirim ke noWAUsaha merchant (E.164) + template", async () => {
    setEnv({ WHATSAPP_TEMPLATE_DAILY_SUMMARY: "vshop_daily_summary" });
    const ok = await notifyMerchantDailySummary(merchant, summary);
    expect(ok).toBe(true);
    expect(requests).toHaveLength(1);
    const p = requests[0].payload;
    expect(p.to).toBe("62812987654321");
    expect(p.type).toBe("template");
    expect((p.template as { name: string }).name).toBe("vshop_daily_summary");
    expect(
      (p.template as { components: Array<{ parameters?: Array<{ type: string; text: string }> }> })
        .components[0].parameters
    ).toEqual([
      { type: "text", text: "Warung Nusantara" },
      { type: "text", text: "5" },
      { type: "text", text: "Rp\u00A020.000" },
      { type: "text", text: "2" },
      { type: "text", text: "https://vshop.test/merchant/laporan" },
    ]);
  });

  it("nomor merchant tidak valid → false, tanpa kirim", async () => {
    setEnv({ WHATSAPP_TEMPLATE_DAILY_SUMMARY: undefined });
    const ok = await notifyMerchantDailySummary({ ...merchant, noWAUsaha: "" }, summary);
    expect(ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
