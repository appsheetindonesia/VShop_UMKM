/**
 * Unit test data murni `src/lib/midtrans-codes.ts` — sumber tunggal tabel
 * kode gagal (dipakai midtrans.ts, halaman admin, dan midtrans.test.ts).
 *
 * Menjamin invarian referensi admin: setiap kode di MIDTRANS_FAILURE_CODES
 * masuk PERSIS SATU grup (tidak ada yang hilang / ganda), dan tiap grup
 * channel punya label Bahasa Indonesia.
 */
import { describe, expect, it } from "vitest";
import {
  CHANNEL_LABEL,
  CHANNEL_RESPONSE_CODES,
  MIDTRANS_FAILURE_CODES,
  channelCodeGroups,
  midtransCodeGroups,
} from "./midtrans-codes";

describe("midtransCodeGroups — pengelompokan referensi admin", () => {
  it("menutup SEMUA kode MIDTRANS_FAILURE_CODES persis satu grup (tidak ada yang hilang/ganda)", () => {
    const groups = midtransCodeGroups();
    const seen = new Set<string>();
    let total = 0;
    for (const g of groups) {
      expect(Object.keys(g.codes).length).toBeGreaterThan(0);
      for (const code of Object.keys(g.codes)) {
        expect(seen.has(code), `kode ${code} muncul di >1 grup`).toBe(false);
        seen.add(code);
        total++;
        expect(MIDTRANS_FAILURE_CODES[code]).toBe(g.codes[code]);
      }
    }
    expect(total).toBe(Object.keys(MIDTRANS_FAILURE_CODES).length);
    expect(total).toBeGreaterThan(50);
  });

  it("memiliki 4 grup dengan label jelas (kartu / VA / QRIS / 4xx)", () => {
    const groups = midtransCodeGroups();
    expect(groups.map((g) => g.id)).toEqual(["card", "va", "qris", "midtrans-4xx"]);
    for (const g of groups) {
      expect(g.label.length).toBeGreaterThan(5);
    }
  });
});

describe("channelCodeGroups — referensi channel_response_code", () => {
  it("setiap channel dari CHANNEL_RESPONSE_CODES punya grup + label Indonesia", () => {
    const groups = channelCodeGroups();
    expect(groups.length).toBe(Object.keys(CHANNEL_RESPONSE_CODES).length);
    for (const g of groups) {
      expect(g.label).toBe(CHANNEL_LABEL[g.channel]);
      expect(g.label.length).toBeGreaterThan(1);
      expect(Object.keys(g.codes).length).toBeGreaterThan(0);
      // Isi identik dengan tabel sumber.
      expect(g.codes).toEqual({ ...CHANNEL_RESPONSE_CODES[g.channel] });
    }
  });
});
