/**
 * Unit test format (src/lib/format.ts) — formatRupiah, tanggal, daysLeft
 * (dengan fake timers), dan merchantCode deterministik.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  daysLeft,
  formatDate,
  formatDateLong,
  formatDateTime,
  formatRupiah,
  merchantCode,
} from "./format";

describe("formatRupiah", () => {
  it("memakai locale id-ID dengan spasi non-breaking", () => {
    expect(formatRupiah(7000)).toBe("Rp\u00A07.000");
    expect(formatRupiah(1_250_000)).toBe("Rp\u00A01.250.000");
  });
  it("nol", () => {
    expect(formatRupiah(0)).toBe("Rp\u00A00");
  });
});

describe("formatDate / formatDateLong / formatDateTime", () => {
  const iso = "2026-08-16T14:05:00.000Z";
  it("tanpa input → '-'", () => {
    expect(formatDate(undefined)).toBe("-");
    expect(formatDateLong(undefined)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
  });
  it("format pendek & panjang memuat tahun dan bulan", () => {
    const d = formatDate(iso);
    expect(d).toContain("2026");
    expect(d).toContain("Agu");
    const dl = formatDateLong(iso);
    expect(dl).toContain("2026");
    expect(dl).toContain("Agustus");
  });
  it("formatDateTime memuat tanggal + jam", () => {
    const dt = formatDateTime(iso);
    expect(dt).toContain("2026");
    expect(dt).toContain("Agu");
  });
});

describe("daysLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("menghitung sisa hari dan membatasi di 0", () => {
    expect(daysLeft("2026-08-17T00:00:00.000Z")).toBe(1);
    expect(daysLeft("2026-08-16T12:00:00.000Z")).toBe(1); // ceil
    expect(daysLeft("2026-08-16T00:00:00.000Z")).toBe(0);
    expect(daysLeft("2026-08-15T00:00:00.000Z")).toBe(0); // sudah lewat → 0
  });
});

describe("merchantCode", () => {
  it("deterministik dan berformat VS-xxxxx", () => {
    const a = merchantCode("m1");
    const b = merchantCode("m1");
    expect(a).toBe(b);
    expect(a).toMatch(/^VS-\d{5}$/);
    expect(merchantCode("m2")).toMatch(/^VS-\d{5}$/);
    expect(merchantCode("m1")).not.toBe(merchantCode("m2"));
  });
});
