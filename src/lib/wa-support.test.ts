import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWaSupportLink, getSupportAppUrl, getSupportPhone } from "./wa-support";

describe("buildWaSupportLink", () => {
  it("nomor lokal 08… dinormalisasi ke E.164 di tautan wa.me", () => {
    const link = buildWaSupportLink("081234567890", { orderNumber: "VS-0001" });
    expect(link).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
  });

  it("format +62… / 62… / dengan strip juga dinormalisasi", () => {
    for (const p of ["+6281234567890", "6281234567890", "0812-3456-7890"]) {
      expect(buildWaSupportLink(p, {})).toContain("wa.me/6281234567890");
    }
  });

  it("pesan terisi: konteks order, invoice, dan link detail — di-encode URL", () => {
    const link = buildWaSupportLink("081234567890", {
      orderNumber: "VS-20260817-0001",
      invoiceNumber: "VS-INV-20260817-0001",
      orderUrl: "http://localhost:3000/transaksi/ord_abc",
    })!;
    const text = decodeURIComponent(link.split("?text=")[1]);
    expect(text).toContain("Halo V Shop! Saya butuh bantuan terkait pesanan saya.");
    expect(text).toContain("No. Order: VS-20260817-0001");
    expect(text).toContain("No. Invoice: VS-INV-20260817-0001");
    expect(text).toContain("Detail pesanan: http://localhost:3000/transaksi/ord_abc");
    // baris dipisah newline yang di-encode
    expect(link).toContain("%0A");
  });

  it("tanpa nomor / nomor tidak valid → null (tombol disembunyikan pemanggil)", () => {
    expect(buildWaSupportLink(null, {})).toBeNull();
    expect(buildWaSupportLink("", {})).toBeNull();
    expect(buildWaSupportLink("12345", {})).toBeNull();
    expect(buildWaSupportLink("abc", {})).toBeNull();
  });

  it("tanpa opsi → hanya sapaan (masih link valid)", () => {
    const link = buildWaSupportLink("6281234567890")!;
    expect(decodeURIComponent(link.split("?text=")[1])).toBe(
      "Halo V Shop! Saya butuh bantuan terkait pesanan saya."
    );
  });
});

describe("getSupportPhone — Configurasi / env", () => {
  beforeEach(() => {
    process.env.WHATSAPP_SUPPORT_NUMBER = "081234567890";
    delete (globalThis as Record<string, unknown>).__vshopSettings;
  });
  afterEach(() => {
    delete process.env.WHATSAPP_SUPPORT_NUMBER;
    delete (globalThis as Record<string, unknown>).__vshopSettings;
    vi.unstubAllGlobals();
  });

  it("mengembalikan nilai env WHATSAPP_SUPPORT_NUMBER sebagai fallback", () => {
    expect(getSupportPhone()).toBe("081234567890");
  });
});

describe("getSupportAppUrl — prioritas WA_LINK_BASE > app_url > APP_URL > NEXT_PUBLIC_APP_URL > localhost", () => {
  beforeEach(() => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.WA_LINK_BASE;
    delete (globalThis as Record<string, unknown>).__vshopSettings;
  });
  afterEach(() => {
    delete process.env.APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.WA_LINK_BASE;
    delete (globalThis as Record<string, unknown>).__vshopSettings;
  });

  it("fallback NEXT_PUBLIC_APP_URL saat APP_URL kosong", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.test";
    expect(getSupportAppUrl()).toBe("https://fallback.test");
  });

  it("default localhost:3000 saat tidak ada env", () => {
    expect(getSupportAppUrl()).toBe("http://localhost:3000");
  });

  it("APP_URL menang atas NEXT_PUBLIC_APP_URL", () => {
    process.env.APP_URL = "https://app.test";
    process.env.NEXT_PUBLIC_APP_URL = "https://fallback.test";
    expect(getSupportAppUrl()).toBe("https://app.test");
  });

  it("WA_LINK_BASE menang atas APP_URL (domain publik terpisah)", () => {
    process.env.WA_LINK_BASE = "https://wa.publik.test";
    process.env.APP_URL = "https://app.test";
    expect(getSupportAppUrl()).toBe("https://wa.publik.test");
  });
});
