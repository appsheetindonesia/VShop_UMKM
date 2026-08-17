/**
 * Unit test `src/lib/pagination.ts` — parse nomor halaman dari searchParams
 * (default, invalid, clamp) dan pembangunan href yang mempertahankan filter.
 */
import { describe, expect, it } from "vitest";
import { buildListHref, parsePageNumber } from "./pagination";

describe("parsePageNumber", () => {
  it("tanpa / bukan bilangan bulat positif → halaman 1", () => {
    expect(parsePageNumber(undefined, 30)).toBe(1);
    expect(parsePageNumber("", 30)).toBe(1);
    expect(parsePageNumber("abc", 30)).toBe(1);
    expect(parsePageNumber("1.5", 30)).toBe(1); // bukan bilangan bulat
    expect(parsePageNumber("0", 30)).toBe(1);
    expect(parsePageNumber("-2", 30)).toBe(1);
  });

  it("clamp ke halaman terakhir bila melebihi jumlah halaman", () => {
    // 30 item, 20/halaman → 2 halaman; minta halaman 9 → 2.
    expect(parsePageNumber("9", 30)).toBe(2);
    expect(parsePageNumber("2", 30)).toBe(2);
    // 0 item → minimal 1 halaman (halaman 1).
    expect(parsePageNumber("3", 0)).toBe(1);
    expect(parsePageNumber(undefined, 0)).toBe(1);
  });

  it("nilai valid & dalam rentang → dipertahankan", () => {
    expect(parsePageNumber("1", 45)).toBe(1);
    expect(parsePageNumber("2", 45)).toBe(2);
    expect(parsePageNumber("3", 45)).toBe(3); // 45/20 → 3 halaman
  });

  it("pageSize kustom dihormati", () => {
    expect(parsePageNumber("4", 30, 10)).toBe(3); // 30/10 = 3 halaman → clamp 3
    expect(parsePageNumber("2", 30, 10)).toBe(2);
  });
});

describe("buildListHref", () => {
  const base = "/akun/riwayat-pembayaran";

  it("tanpa parameter → path polos; page 1 dihilangkan", () => {
    expect(buildListHref(base, {})).toBe(base);
    expect(buildListHref(base, { page: 1 })).toBe(base);
  });

  it("mempertahankan status & q; page 2+ ikut disertakan", () => {
    expect(buildListHref(base, { status: "paid" })).toBe(`${base}?status=paid`);
    expect(buildListHref(base, { status: "paid", q: "VS-123" })).toBe(
      `${base}?status=paid&q=VS-123`
    );
    expect(buildListHref(base, { status: "paid", q: "VS-123", page: 2 })).toBe(
      `${base}?status=paid&q=VS-123&page=2`
    );
    expect(buildListHref(base, { q: "a b" })).toBe(`${base}?q=a+b`);
  });

  it("filter jenis transaksi (type) ikut dipertahankan", () => {
    expect(buildListHref(base, { type: "topup" })).toBe(`${base}?type=topup`);
    expect(buildListHref(base, { status: "paid", type: "topup" })).toBe(
      `${base}?status=paid&type=topup`
    );
    expect(buildListHref(base, { status: "failed", type: "merchandise", q: "VS-9", page: 3 })).toBe(
      `${base}?status=failed&q=VS-9&type=merchandise&page=3`
    );
    expect(buildListHref(base, { type: "" })).toBe(base);
  });

  it("q kosong diabaikan", () => {
    expect(buildListHref(base, { q: "" })).toBe(base);
    expect(buildListHref(base, { status: "failed", q: "" })).toBe(`${base}?status=failed`);
  });
});
