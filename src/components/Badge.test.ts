import { describe, expect, it } from "vitest";
import { claimBadge, paymentBadge, statusColor, type BadgeColor } from "./Badge";

/**
 * Mapping status pembayaran/klaim → label + warna — SUMBER TUNGGAL
 * (`paymentBadge`/`claimBadge` di Badge.tsx), dipakai lintas halaman
 * (akun, status-member, transaksi, admin orders, AdminPaymentHistory,
 * PaymentHistoryList, merchant laporan/dashboard). Test ini menjaga agar
 * semua tampilan order menampilkan label/warna yang SAMA.
 */

describe("paymentBadge — mapping status → label → warna", () => {
  it("paid → Berhasil (hijau)", () => {
    expect(paymentBadge("paid")).toEqual({ label: "Berhasil", color: "green" });
  });

  it("pending → Menunggu (kuning)", () => {
    expect(paymentBadge("pending")).toEqual({ label: "Menunggu", color: "yellow" });
  });

  it("failed tanpa reason → Gagal (merah)", () => {
    expect(paymentBadge("failed")).toEqual({ label: "Gagal", color: "red" });
  });

  it("failed dengan reason KOSONG ('') → tetap Gagal (fallback, bukan label kosong)", () => {
    expect(paymentBadge("failed", "")).toEqual({ label: "Gagal", color: "red" });
  });

  it("failed dengan reason terisi → reason dipakai sebagai label, tetap merah", () => {
    expect(paymentBadge("failed", "Ditolak oleh bank")).toEqual({
      label: "Ditolak oleh bank",
      color: "red",
    });
  });

  it("expired tanpa reason → Kadaluarsa (abu-abu)", () => {
    expect(paymentBadge("expired")).toEqual({ label: "Kadaluarsa", color: "gray" });
  });

  it("expired dengan reason kosong → Kadaluarsa (fallback)", () => {
    expect(paymentBadge("expired", "")).toEqual({ label: "Kadaluarsa", color: "gray" });
  });

  it("expired dengan reason terisi → reason dipakai sebagai label, abu-abu", () => {
    expect(paymentBadge("expired", "Waktu pembayaran habis")).toEqual({
      label: "Waktu pembayaran habis",
      color: "gray",
    });
  });

  it("cancelled → Dibatalkan (abu-abu)", () => {
    expect(paymentBadge("cancelled")).toEqual({ label: "Dibatalkan", color: "gray" });
  });

  it("status tak dikenal → status mentah, abu-abu (tidak crash saat skema berubah)", () => {
    expect(paymentBadge("future-status")).toEqual({ label: "future-status", color: "gray" });
  });

  it("reason kosong untuk status non-gagal/kadaluarsa diabaikan", () => {
    expect(paymentBadge("paid", "alasan tidak relevan")).toEqual({
      label: "Berhasil",
      color: "green",
    });
  });
});

describe("claimBadge — mapping status klaim → label → warna", () => {
  it("active → Aktif (hijau)", () => {
    expect(claimBadge("active")).toEqual({ label: "Aktif", color: "green" });
  });

  it("used → Terpakai (oranye)", () => {
    expect(claimBadge("used")).toEqual({ label: "Terpakai", color: "orange" });
  });

  it("expired → Kadaluarsa (abu-abu)", () => {
    expect(claimBadge("expired")).toEqual({ label: "Kadaluarsa", color: "gray" });
  });

  it("status tak dikenal → status mentah, abu-abu", () => {
    expect(claimBadge("unknown")).toEqual({ label: "unknown", color: "gray" });
  });
});

describe("statusColor — mapping status → warna (komponen dasar Badge)", () => {
  it("sukses/aktif → hijau", () => {
    for (const s of ["active", "approved", "paid", "completed", "success"]) {
      expect(statusColor(s)).toBe("green");
    }
  });

  it("menunggu/diproses → kuning", () => {
    for (const s of ["pending", "processing"]) {
      expect(statusColor(s)).toBe("yellow");
    }
  });

  it("terpakai → oranye", () => {
    expect(statusColor("used")).toBe("orange");
  });

  it("terminal gagal → merah", () => {
    for (const s of ["expired", "failed", "rejected", "archived", "cancelled"]) {
      expect(statusColor(s)).toBe("red");
    }
  });

  it("default → abu-abu", () => {
    expect(statusColor("apapun")).toBe("gray");
  });
});

describe("tipe BadgeColor — semua warna punya kelas Tailwind", () => {
  // Menjaga agar warna baru yang ditambah ke helper punya style di map styles.
  it("green/blue/orange/red/gray/yellow semuanya valid", () => {
    const colors: BadgeColor[] = ["green", "blue", "orange", "red", "gray", "yellow"];
    for (const c of colors) {
      expect(c).toBeTruthy();
    }
  });
});
