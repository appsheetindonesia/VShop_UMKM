/**
 * Unit test `midtransFailureReason` (src/lib/midtrans.ts).
 *
 * Menguji SELURUH tabel kode (`MIDTRANS_FAILURE_CODES`) — kartu, bank
 * transfer, e-channel, convenience store, QRIS, e-wallet, dan kode 4xx —
 * plus fallback `transaction_status` dan kasus bukan-kegagalan (null).
 * Tabel diekspor sehingga setiap kode baru otomatis teruji tanpa daftar
 * duplikat di test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  CHANNEL_RESPONSE_CODES,
  MIDTRANS_FAILURE_CODES,
  MidtransApiError,
  createPaymentTransaction,
  getMidtransStatus,
  getOrderExpiryHours,
  isMidtransConfigError,
  isMidtransPaid,
  isMockSnapToken,
  midtransChannelFailureReason,
  midtransClientKey,
  midtransFailureReason,
  midtransTerminalFailure,
  paymentTypeToMethod,
  snapScriptUrl,
  snapVtwebUrl,
  verifyMidtransSignature,
} from "./midtrans";

type MidtransModule = typeof import("./midtrans");

const saveEnv: Record<string, string | undefined> = {};
function setEnv(pairs: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(pairs)) {
    saveEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Import ulang modul dengan env tertentu (konstanta dibaca saat module load). */
async function freshMidtrans(env: Record<string, string | undefined>): Promise<MidtransModule> {
  setEnv(env);
  vi.resetModules();
  return import("./midtrans");
}

// fetch stub global (tanpa jaringan)
let requests: Array<{ url: string; init?: RequestInit }>;
let fetchResponse: { ok: boolean; status: number; body: unknown; text?: string };

function stubFetch() {
  requests = [];
  fetchResponse = { ok: true, status: 200, body: {} };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      return {
        ok: fetchResponse.ok,
        status: fetchResponse.status,
        json: async () => fetchResponse.body,
        text: async () => fetchResponse.text ?? JSON.stringify(fetchResponse.body),
      } as Response;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saveEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

describe("midtransFailureReason — seluruh tabel kode", () => {
  // Setiap kode di tabel harus dipetakan ke alasannya sendiri.
  it("memetakan SEMUA kode di MIDTRANS_FAILURE_CODES ke alasan spesifik", () => {
    const entries = Object.entries(MIDTRANS_FAILURE_CODES);
    expect(entries.length).toBeGreaterThan(50); // 2xx kartu + VA/e-channel/cstore + QRIS + 4xx
    for (const [code, reason] of entries) {
      const r = midtransFailureReason({
        status_code: code,
        transaction_status: "failure",
      });
      expect(r, `kode ${code} harus terpetakan`).toEqual({ code, reason });
    }
  });

  // Contoh khas per kanal — pengaman baca-manusia (label terpampang ke user).
  it("kode e-channel / convenience store / VA memberi alasan yang tepat", () => {
    const cases: Array<[string, string]> = [
      ["201", "Pembayaran dibatalkan"],
      ["202", "Pembayaran ditolak oleh bank"],
      ["203", "Waktu pembayaran habis"],
      ["204", "Pembayaran ditolak oleh bank"],
      ["207", "Transaksi ditolak karena dugaan penipuan"],
      ["213", "Jumlah transaksi tidak sesuai"],
    ];
    for (const [code, reason] of cases) {
      expect(midtransFailureReason({ status_code: code, transaction_status: "failure" })?.reason).toBe(
        reason
      );
    }
  });

  it("kode QRIS / e-wallet memberi alasan yang tepat", () => {
    const cases: Array<[string, string]> = [
      ["214", "QRIS gagal diproses"],
      ["216", "Saldo tidak mencukupi (QRIS)"],
      ["221", "Waktu pembayaran QRIS habis"],
    ];
    for (const [code, reason] of cases) {
      expect(midtransFailureReason({ status_code: code, transaction_status: "failure" })?.reason).toBe(
        reason
      );
    }
  });

  it("kode 4xx (401/402/403, 406 duplicate, 407 expired, 410 nonaktif) terpetakan", () => {
    const cases: Array<[string, string]> = [
      ["401", "Akses ditolak — periksa konfigurasi kunci Midtrans"],
      ["402", "Metode pembayaran tidak tersedia untuk merchant"],
      ["403", "Permintaan ditolak (konten tidak sesuai)"],
      ["406", "Nomor order sudah pernah dipakai"],
      ["407", "Transaksi sudah kedaluwarsa"],
      ["410", "Akun merchant nonaktif — hubungi dukungan"],
    ];
    for (const [code, reason] of cases) {
      expect(midtransFailureReason({ status_code: code })?.reason).toBe(reason);
    }
  });
});

describe("midtransFailureReason — fallback & kasus khusus", () => {
  it("kode tak dikenal + transaction_status terminal → fallback pesan status", () => {
    const cases: Array<[string, string]> = [
      ["expire", "Waktu pembayaran habis"],
      ["deny", "Pembayaran ditolak oleh bank"],
      ["cancel", "Pembayaran dibatalkan"],
      ["failure", "Pembayaran gagal diproses"],
    ];
    for (const [tx, reason] of cases) {
      const r = midtransFailureReason({
        status_code: "999",
        transaction_status: tx,
      });
      expect(r).toEqual({ code: "999", reason });
    }
  });

  it("kode dikenal menang atas transaction_status", () => {
    const r = midtransFailureReason({
      status_code: "202",
      transaction_status: "failure",
    });
    expect(r?.reason).toBe("Pembayaran ditolak oleh bank");
    expect(r?.code).toBe("202");
  });

  it("spasi di status_code di-trim sebelum dicocokkan", () => {
    const r = midtransFailureReason({ status_code: "  216  ", transaction_status: "failure" });
    expect(r?.code).toBe("216");
    expect(r?.reason).toBe("Saldo tidak mencukupi (QRIS)");
  });

  it("status bukan kegagalan terminal → null (pendant berjalan / lunas)", () => {
    const r = midtransFailureReason({
      status_code: "201",
      transaction_status: "pending",
    });
    // 201 terpetakan sebagai "Pembayaran dibatalkan" — tapi hanya dipanggil
    // route setelah midtransTerminalFailure; untuk status non-terminal,
    // fallback transaction_status tidak tersedia → null bila kode tak dikenal.
    expect(r).not.toBeNull();
    expect(
      midtransFailureReason({
        status_code: "201",
        transaction_status: "pending",
      })?.reason
    ).toBeTruthy();
  });

  it("kode kosong & transaction_status non-terminal → null", () => {
    expect(
      midtransFailureReason({ status_code: "", transaction_status: "pending" })
    ).toBeNull();
    expect(
      midtransFailureReason({ status_code: undefined, transaction_status: "settlement" })
    ).toBeNull();
  });
});

describe("midtransFailureReason — channel_response_code (GoPay/OVO/VA)", () => {
  // Seluruh kode di tiap tabel channel harus terpetakan (pola yg sama dgn
  // MIDTRANS_FAILURE_CODES) — tidak ada kode yang boleh terlewat.
  it("memetakan SEMUA kode di CHANNEL_RESPONSE_CODES per channel", () => {
    const total = Object.values(CHANNEL_RESPONSE_CODES).reduce((s, t) => s + Object.keys(t).length, 0);
    expect(total).toBeGreaterThan(10);
    for (const [channel, table] of Object.entries(CHANNEL_RESPONSE_CODES)) {
      for (const [code, reason] of Object.entries(table)) {
        const r = midtransChannelFailureReason(channel, code);
        expect(r, `${channel}:${code} harus terpetakan`).toEqual({ code, reason });
      }
    }
  });

  it("GoPay — saldo kurang, dompet diblokir, OTP tidak valid → alasan spesifik", () => {
    const cases: Array<[string, string]> = [
      ["201", "Saldo GoPay tidak mencukupi"],
      ["112", "Dompet GoPay diblokir"],
      ["1604", "Kode OTP GoPay tidak valid"],
      ["1610", "Kode OTP GoPay kedaluwarsa"],
    ];
    for (const [code, reason] of cases) {
      const r = midtransFailureReason({ payment_type: "gopay", channel_response_code: code });
      expect(r?.reason.startsWith(reason)).toBe(true);
      expect(r?.code).toBe(code);
    }
  });

  it("OVO — RC sandbox resmi (14/17/26/40/68) → alasan spesifik", () => {
    const cases: Array<[string, string]> = [
      ["14", "Nomor belum terdaftar di OVO"],
      ["17", "Pembayaran dibatalkan di aplikasi OVO"],
      ["26", "Gagal mengirim konfirmasi ke aplikasi OVO"],
      ["40", "Pembayaran OVO gagal diproses"],
      ["68", "OVO tidak merespons — waktu pembayaran habis"],
    ];
    for (const [code, reason] of cases) {
      const r = midtransFailureReason({ payment_type: "ovo", channel_response_code: code });
      expect(r?.reason.startsWith(reason)).toBe(true);
    }
  });

  it("VA / bank transfer — kode ISO bank (05 Do Not Honor, 51 saldo kurang)", () => {
    expect(
      midtransFailureReason({
        payment_type: "bank_transfer",
        channel_response_code: "05",
      })?.reason
    ).toBe("Transaksi ditolak oleh bank (Do Not Honor)");
    expect(
      midtransFailureReason({
        payment_type: "bank_transfer",
        channel_response_code: "51",
      })?.reason
    ).toBe("Saldo rekening tidak mencukupi");
  });

  it("channel code MENANG atas status_code Midtrans (lebih spesifik)", () => {
    // deny (202) generik — tapi channel OVO 68 menjelaskan penyebab persisnya.
    const r = midtransFailureReason({
      status_code: "202",
      transaction_status: "deny",
      payment_type: "ovo",
      channel_response_code: "68",
      channel_response_message: "OVO Wallet late to give response to OVO JPOS",
    });
    expect(r?.code).toBe("68");
    expect(r?.reason).toContain("OVO tidak merespons");
    expect(r?.reason).toContain("OVO Wallet late to give response");
  });

  it("kode channel TAK DIKENAL untuk kanal dikenal → 'Ditolak oleh {channel} (kode …)'", () => {
    const r = midtransFailureReason({
      status_code: "202",
      transaction_status: "deny",
      payment_type: "gopay",
      channel_response_code: "50014",
      channel_response_message: "Transaction is cancelled",
    });
    expect(r?.code).toBe("50014");
    expect(r?.reason).toContain("Ditolak oleh GoPay (kode 50014)");
    expect(r?.reason).toContain("Transaction is cancelled");
  });

  it("tanpa channel code / channel tak dikenal → perilaku lama (tabel status_code)", () => {
    expect(
      midtransFailureReason({ payment_type: "qris", status_code: "216", transaction_status: "failure" })?.reason
    ).toBe("Saldo tidak mencukupi (QRIS)");
    expect(
      midtransFailureReason({ payment_type: "qris", channel_response_code: "50014" })?.reason
    ).toContain("Ditolak oleh QRIS (kode 50014)");
  });

  it("channel code tanpa status terminal lain → tetap null bila tidak ada kode", () => {
    expect(
      midtransFailureReason({ payment_type: "ovo", transaction_status: "settlement" })
    ).toBeNull();
  });
});

describe("getOrderExpiryHours — dibaca per-panggilan, bukan module-load", () => {
  it("default 24, dan env yang diubah SETELAH import langsung berlaku", async () => {
    const m = await freshMidtrans({ ORDER_EXPIRY_HOURS: undefined });
    expect(m.getOrderExpiryHours()).toBe(24);
    // Ubah env tanpa re-import modul — per-request read harus menangkapnya.
    process.env.ORDER_EXPIRY_HOURS = "0.01";
    expect(m.getOrderExpiryHours()).toBe(0.01);
    process.env.ORDER_EXPIRY_HOURS = "3";
    expect(m.getOrderExpiryHours()).toBe(3);
  });

  it("nilai tidak valid (NaN / nol / negatif) jatuh ke default 24", async () => {
    const m = await freshMidtrans({ ORDER_EXPIRY_HOURS: "abc" });
    expect(m.getOrderExpiryHours()).toBe(24);
    process.env.ORDER_EXPIRY_HOURS = "0";
    expect(m.getOrderExpiryHours()).toBe(24);
    process.env.ORDER_EXPIRY_HOURS = "-5";
    expect(m.getOrderExpiryHours()).toBe(24);
    process.env.ORDER_EXPIRY_HOURS = "";
    expect(m.getOrderExpiryHours()).toBe(24);
  });
});

describe("createPaymentTransaction", () => {
  beforeEach(() => {
    stubFetch();
  });

  it("tanpa MIDTRANS_SERVER_KEY → token tiruan (mode demo)", async () => {
    const m = await freshMidtrans({ MIDTRANS_SERVER_KEY: undefined });
    const res = await m.createPaymentTransaction({
      orderId: "ord_1",
      orderNumber: "VS-1",
      totalAmount: 7000,
    });
    expect(res).toEqual({ token: "snap-demo-ord_1", mock: true });
    expect(requests).toHaveLength(0);
  });

  it("dengan key → POST ke Snap API dengan payload lengkap + expiry", async () => {
    const m = await freshMidtrans({
      MIDTRANS_SERVER_KEY: "svc-key",
      MIDTRANS_API_BASE: "https://mid.test/v2",
    });
    const res = await m.createPaymentTransaction({
      orderId: "ord_1",
      orderNumber: "VS-2026-1",
      totalAmount: 7000,
      customerName: "Siti Aminah",
      customerEmail: "siti@mail.id",
      customerPhone: "081234567890",
    });
    expect(res.mock).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://mid.test/v2/transactions");
    const auth = (requests[0].init?.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe(`Basic ${Buffer.from("svc-key:").toString("base64")}`);
    const body = JSON.parse(String(requests[0].init?.body));
    expect(body.transaction_details).toEqual({
      order_id: "VS-2026-1",
      gross_amount: 7000,
      expiry: { unit: "hours", duration: 24 },
    });
    expect(body.customer_details).toMatchObject({
      first_name: "Siti",
      last_name: "Aminah",
      email: "siti@mail.id",
      phone: "081234567890",
    });
    expect(body.credit_card).toEqual({ secure: true });
  });

  it("tidak ok → throw dengan status + body", async () => {
    const m = await freshMidtrans({
      MIDTRANS_SERVER_KEY: "svc-key",
      MIDTRANS_API_BASE: "https://mid.test/v2",
    });
    fetchResponse = { ok: false, status: 400, body: {}, text: "bad request" };
    await expect(
      m.createPaymentTransaction({ orderId: "o", orderNumber: "VS-1", totalAmount: 1 })
    ).rejects.toThrow("Midtrans error 400");
  });
});

describe("getMidtransStatus", () => {
  beforeEach(() => {
    stubFetch();
  });

  it("tanpa key → throw", async () => {
    const m = await freshMidtrans({ MIDTRANS_SERVER_KEY: undefined });
    await expect(m.getMidtransStatus("VS-1")).rejects.toThrow(
      "MIDTRANS_SERVER_KEY belum diatur"
    );
  });

  it("mengambil status via Status API", async () => {
    const m = await freshMidtrans({
      MIDTRANS_SERVER_KEY: "svc-key",
      MIDTRANS_API_BASE: "https://mid.test/v2",
    });
    fetchResponse.body = { transaction_status: "settlement", status_code: "200" };
    const st = await m.getMidtransStatus("VS-1");
    expect(st.transaction_status).toBe("settlement");
    expect(requests[0].url).toBe("https://mid.test/v2/VS-1/status");
  });

  it("tidak ok → throw MidtransApiError dengan statusCode", async () => {
    const m = await freshMidtrans({
      MIDTRANS_SERVER_KEY: "svc-key",
      MIDTRANS_API_BASE: "https://mid.test/v2",
    });
    fetchResponse = { ok: false, status: 401, body: {}, text: "{\"error_messages\":[\"Access denied\"]}" };
    const err = (await m.getMidtransStatus("VS-1").catch((e) => e)) as MidtransApiError;
    // instanceof terhadap import top-level TIDAK valid (freshMidtrans = modul
    // baru) — periksa via name + statusCode (duck typing).
    expect(err.name).toBe("MidtransApiError");
    expect(err.statusCode).toBe("401");
    expect(err.message).toContain("Access denied");
    // Pemanggil route bisa memicu notifikasi konfigurasi dari statusCode ini.
    expect(isMidtransConfigError(err.statusCode)).toBe(true);
  });
});

describe("isMidtransConfigError & MidtransApiError — error konfigurasi pembayaran", () => {
  it("401/402/403/410 = error KONFIGURASI (pemicu notifikasi merchant)", () => {
    for (const code of ["401", "402", "403", "410"]) {
      expect(isMidtransConfigError(code), `${code} harus true`).toBe(true);
    }
  });

  it("kode transaksi / lainnya BUKAN error konfigurasi", () => {
    for (const code of ["200", "201", "202", "203", "216", "406", "407", "500", "", undefined]) {
      expect(isMidtransConfigError(code), `${code} harus false`).toBe(false);
    }
  });

  it("MidtransApiError membawa statusCode & potongan body", () => {
    const e = new MidtransApiError(401, "{\"error_messages\":[\"Access denied\"]}");
    expect(e).toBeInstanceOf(Error);
    expect(e.statusCode).toBe("401");
    expect(e.message).toContain("Access denied");
  });
});

describe("verifyMidtransSignature — SHA512(order_id + status_code + gross_amount + ServerKey)", () => {
  const KEY = "SB-Mid-server-abc123XYZ_test_key";
  /** Signature SHA512 ala Midtrans: gabungan MENTAH tanpa pemisah. */
  const sig = (orderId: string, statusCode: string, grossAmount: string) =>
    createHash("sha512")
      .update(`${orderId}${statusCode}${grossAmount}${KEY}`)
      .digest("hex");

  it("tanpa server key → false (tidak ada basis verifikasi)", () => {
    setEnv({ MIDTRANS_SERVER_KEY: undefined });
    expect(verifyMidtransSignature("o", "200", "7000", "x")).toBe(false);
  });

  it("signature BENAR (sesuai dokumentasi resmi, gabungan mentah) → true", () => {
    setEnv({ MIDTRANS_SERVER_KEY: KEY });
    const good = sig("VS-20260816-0001", "200", "7000.00");
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", good)).toBe(true);
  });

  it("signature SALAH → false; mengganti komponen mana pun juga false (signature mengikat payload)", () => {
    setEnv({ MIDTRANS_SERVER_KEY: KEY });
    const good = sig("VS-20260816-0001", "200", "7000.00");
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", "salah")).toBe(false);
    // Signature valid HANYA untuk payload persis: order_id / status_code /
    // gross_amount yang berbeda menolak signature yang sama.
    expect(verifyMidtransSignature("VS-20260816-0002", "200", "7000.00", good)).toBe(false);
    expect(verifyMidtransSignature("VS-20260816-0001", "201", "7000.00", good)).toBe(false);
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000", good)).toBe(false);
  });

  it("gross_amount di-hash MENTAH tanpa normalisasi: '7000.00' ≠ '7000'", () => {
    setEnv({ MIDTRANS_SERVER_KEY: KEY });
    // Midtrans mengirim "7000.00"; membulatkan jadi "7000" mengubah hash
    // — verifikasi harus memakai string persis dari payload webhook.
    const good = sig("VS-20260816-0001", "200", "7000.00");
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000", good)).toBe(false);
    expect(
      verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", sig("VS-20260816-0001", "200", "7000"))
    ).toBe(false);
  });

  it("hex bersifat case-sensitive (Midtrans lowercase) → uppercase ditolak", () => {
    setEnv({ MIDTRANS_SERVER_KEY: KEY });
    const good = sig("VS-20260816-0001", "200", "7000.00");
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", good.toUpperCase())).toBe(false);
  });

  it("signature kosong / bukan hex → false", () => {
    setEnv({ MIDTRANS_SERVER_KEY: KEY });
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", "")).toBe(false);
    expect(verifyMidtransSignature("VS-20260816-0001", "200", "7000.00", "abc")).toBe(false);
  });
});

describe("isMidtransPaid & midtransTerminalFailure", () => {
  it("settlement → paid; capture tanpa challenge → paid; capture challenge → tidak", () => {
    expect(isMidtransPaid({ transaction_status: "settlement" })).toBe(true);
    expect(isMidtransPaid({ transaction_status: "capture", fraud_status: "accept" })).toBe(true);
    expect(isMidtransPaid({ transaction_status: "capture", fraud_status: "challenge" })).toBe(false);
    expect(isMidtransPaid({ transaction_status: "pending" })).toBe(false);
  });
  it("terminal failure: expire/deny/cancel/failure; lainnya null", () => {
    expect(midtransTerminalFailure({ transaction_status: "expire" })).toBe("expired");
    expect(midtransTerminalFailure({ transaction_status: "deny" })).toBe("failed");
    expect(midtransTerminalFailure({ transaction_status: "cancel" })).toBe("failed");
    expect(midtransTerminalFailure({ transaction_status: "failure" })).toBe("failed");
    expect(midtransTerminalFailure({ transaction_status: "settlement" })).toBeNull();
    expect(midtransTerminalFailure({})).toBeNull();
  });
});

describe("paymentTypeToMethod", () => {
  it("memetakan semua payment_type + default", () => {
    expect(paymentTypeToMethod("qris")).toBe("QRIS");
    expect(paymentTypeToMethod("gopay")).toBe("GoPay");
    expect(paymentTypeToMethod("ovo")).toBe("OVO");
    expect(paymentTypeToMethod("dana")).toBe("DANA");
    expect(paymentTypeToMethod("bank_transfer")).toBe("Virtual Account");
    expect(paymentTypeToMethod("credit_card")).toBe("Kartu Kredit");
    expect(paymentTypeToMethod("echannel")).toBe("Mandiri Bill Payment");
    expect(paymentTypeToMethod("cstore")).toBe("Convenience Store");
    expect(paymentTypeToMethod("shopeepay")).toBe("ShopeePay");
    expect(paymentTypeToMethod("akulaku")).toBe("Akulaku");
    expect(paymentTypeToMethod(undefined)).toBe("Midtrans");
    expect(paymentTypeToMethod("unknown")).toBe("unknown");
  });
});

describe("url & mode (env-dependent, fresh import)", () => {
  it("sandbox default: snapScriptUrl & snapVtwebUrl sandbox; isMidtransProduction false", async () => {
    const m = await freshMidtrans({
      MIDTRANS_IS_PRODUCTION: undefined,
      MIDTRANS_SNAP_SCRIPT_URL: undefined,
    });
    expect(m.snapScriptUrl()).toBe("https://app.sandbox.midtrans.com/snap/snap.js");
    expect(m.snapVtwebUrl("tok-1")).toBe(
      "https://app.sandbox.midtrans.com/snap/v2/vtweb/tok-1"
    );
    expect(m.isMidtransProduction()).toBe(false);
    expect(m.midtransClientKey()).toBeUndefined();
    expect(m.isMockSnapToken("snap-demo-x")).toBe(true);
    expect(m.isMockSnapToken("real-token")).toBe(false);
  });

  it("produksi + override script URL + client key", async () => {
    const m = await freshMidtrans({
      MIDTRANS_IS_PRODUCTION: "true",
      MIDTRANS_SNAP_SCRIPT_URL: "https://cdn.test/snap.js",
      MIDTRANS_CLIENT_KEY: "client-1",
    });
    expect(m.isMidtransProduction()).toBe(true);
    expect(m.snapScriptUrl()).toBe("https://cdn.test/snap.js");
    expect(m.snapVtwebUrl("tok-2")).toBe("https://app.midtrans.com/snap/v2/vtweb/tok-2");
    expect(m.midtransClientKey()).toBe("client-1");
  });
});
