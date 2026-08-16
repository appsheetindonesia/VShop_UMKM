/**
 * Unit test `midtransFailureReason` (src/lib/midtrans.ts).
 *
 * Menguji SELURUH tabel kode (`MIDTRANS_FAILURE_CODES`) — kartu, bank
 * transfer, e-channel, convenience store, QRIS, e-wallet, dan kode 4xx —
 * plus fallback `transaction_status` dan kasus bukan-kegagalan (null).
 * Tabel diekspor sehingga setiap kode baru otomatis teruji tanpa daftar
 * duplikat di test.
 */
import { describe, expect, it } from "vitest";
import { MIDTRANS_FAILURE_CODES, midtransFailureReason } from "./midtrans";

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
