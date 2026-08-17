/**
 * DATA MURNI tabel kode gagal Midtrans — SATU-SATUNYA sumber kebenaran.
 *
 * Diimpor oleh:
 *   - `src/lib/midtrans.ts` (logika pemetaan alasan — re-export agar import
 *     lama `from "@/lib/midtrans"` tetap bekerja);
 *   - halaman admin (referensi kode untuk support/audit, mis. Configurasi);
 *   - unit test (seluruh tabel dipastikan terpetakan, tidak ada yang lewat).
 *
 * TANPA dependensi server (tidak import settings/db) — aman dipakai di
 * komponen client. File ini murni data + helper murni; JANGAN menaruh
 * logika I/O di sini.
 */

/**
 * Tabel status_code Midtrans → alasan gagal spesifik (Bahasa Indonesia).
 *
 * 2xx = kode status pembayaran (kartu / bank transfer / e-channel /
 * convenience store / QRIS / e-wallet). 4xx = kode status Midtrans dari
 * Status API / pembuatan transaksi (bukan kode channel) — bisa muncul saat
 * transaksi bermasalah (mis. 407 transaksi sudah kedaluwarsa, 406 nomor
 * order sudah dipakai, 401/402 salah konfigurasi merchant).
 *
 * Sumber: docs.midtrans.com/reference/status-code (Code 2xx & Code 4xx).
 * Diekspor agar unit test bisa menguji SELURUH tabel (tidak boleh ada
 * kode yang terlewat).
 */
export const MIDTRANS_FAILURE_CODES: Readonly<Record<string, string>> = {
  // Kartu kredit
  "101": "Kartu kedaluwarsa",
  "102": "Kartu ditolak oleh bank",
  "103": "Saldo kartu tidak mencukupi",
  "104": "Kartu diblokir karena dugaan penipuan",
  "105": "Kartu tidak aktif",
  "106": "Melebihi limit transaksi",
  "107": "Kartu diblokir oleh bank",
  "108": "Nomor kartu tidak valid",
  "109": "Tanggal kedaluwarsa kartu tidak valid",
  "110": "Kode CVV tidak valid",
  "111": "Jenis kartu tidak didukung",
  "112": "Kartu ditolak saat verifikasi 3DS",
  "113": "Kartu ditolak oleh bank saat verifikasi 3DS",
  "114": "Saldo kartu tidak mencukupi saat verifikasi 3DS",
  "115": "Kartu diblokir oleh bank saat verifikasi 3DS",
  "116": "Melebihi limit transaksi saat verifikasi 3DS",
  "117": "Kartu tidak valid saat verifikasi 3DS",
  "118": "Kartu kedaluwarsa saat verifikasi 3DS",
  "119": "Kode CVV tidak valid saat verifikasi 3DS",
  "188": "Kartu belum terdaftar 3DS",
  // Umum / bank transfer / e-channel / retail
  "201": "Pembayaran dibatalkan",
  "202": "Pembayaran ditolak oleh bank",
  "203": "Waktu pembayaran habis",
  "204": "Pembayaran ditolak oleh bank",
  "205": "Pembayaran ditolak oleh bank",
  "206": "Pembayaran ditolak oleh bank",
  "207": "Transaksi ditolak karena dugaan penipuan",
  "208": "Pembayaran ditolak oleh bank",
  "209": "Pembayaran ditolak oleh penyedia",
  "210": "Pembayaran ditolak oleh bank",
  "211": "Pembayaran ditolak oleh penerbit",
  "212": "Pembayaran ditolak oleh bank",
  "213": "Jumlah transaksi tidak sesuai",
  // QRIS
  "214": "QRIS gagal diproses",
  "215": "Pembayaran ditolak oleh bank (QRIS)",
  "216": "Saldo tidak mencukupi (QRIS)",
  "217": "Pembayaran ditolak oleh bank (QRIS)",
  "218": "Pembayaran ditolak oleh bank (QRIS)",
  "219": "Melebihi limit transaksi (QRIS)",
  "220": "Pembayaran ditolak oleh bank (QRIS)",
  "221": "Waktu pembayaran QRIS habis",
  "222": "Pembayaran ditolak oleh bank (QRIS)",
  "223": "Pembayaran ditolak oleh bank (QRIS)",
  "224": "Pembayaran ditolak oleh bank (QRIS)",
  "225": "Pembayaran ditolak oleh bank (QRIS)",
  "226": "Pembayaran ditolak oleh bank (QRIS)",
  "227": "Pembayaran ditolak oleh bank (QRIS)",
  "228": "Pembayaran ditolak oleh bank (QRIS)",
  "229": "Pembayaran ditolak oleh bank (QRIS)",
  "230": "Pembayaran ditolak oleh bank (QRIS)",
  // 4xx — kode status Midtrans (docs: status-code-4xx); bukan kode channel.
  "400": "Data transaksi tidak valid",
  "401": "Akses ditolak — periksa konfigurasi kunci Midtrans",
  "402": "Metode pembayaran tidak tersedia untuk merchant",
  "403": "Permintaan ditolak (konten tidak sesuai)",
  "404": "Transaksi tidak ditemukan",
  "405": "Metode permintaan tidak diizinkan",
  "406": "Nomor order sudah pernah dipakai",
  "407": "Transaksi sudah kedaluwarsa",
  "408": "Tipe data transaksi salah",
  "410": "Akun merchant nonaktif — hubungi dukungan",
  "411": "Token transaksi tidak valid atau kedaluwarsa",
  "412": "Status transaksi tidak dapat diubah",
  "413": "Format permintaan tidak valid",
};

/**
 * Tabel `channel_response_code` per channel pembayaran → alasan spesifik
 * (Bahasa Indonesia). Kode ini datang dari penyedia channel (GoPay/OVO/bank)
 * di payload webhook / Status API — LEBIH SPESIFIK daripada status_code
 * Midtrans (mis. 202 deny) karena menyebut penyebab persisnya.
 *
 * Sumber:
 *   - GoPay: docs.midtrans.com/reference/gopay-response-codes (tabel lengkap
 *     resmi; hanya kode yang relevan untuk KEGAGALAN pembayaran dipilih).
 *   - OVO:  docs.midtrans.com/docs/testing-payment-on-sandbox (RC yang
 *     dipetakan ke skenario error di sandbox: 14/17/26/40/68).
 *   - VA / bank transfer: ISO 8583 response codes umum (05 "Do not honor"
 *     tercantum di docs.midtrans.com/docs/error-code-and-response-code).
 *
 * Channel tanpa tabel resmi yang bisa diverifikasi (QRIS/ShopeePay/DANA/dst.)
 * memakai fallback "Ditolak oleh {channel} (kode …)" + pesan mentah — kode
 * & pesan mentahnya tetap terekam utuh di paymentAudit.
 * Diekspor agar unit test bisa menguji seluruh tabel (tidak ada kode yang
 * terlewat) — pola yang sama dengan MIDTRANS_FAILURE_CODES.
 */
export const CHANNEL_RESPONSE_CODES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  gopay: {
    "201": "Saldo GoPay tidak mencukupi",
    "112": "Dompet GoPay diblokir",
    "126": "Dompet pelanggan GoPay diblokir",
    "3006": "Dompet pengirim GoPay diblokir",
    "3007": "Transaksi tidak ditemukan atau kedaluwarsa",
    "101": "Dompet GoPay tidak ditemukan",
    "1603": "Kode OTP GoPay wajib diisi",
    "1604": "Kode OTP GoPay tidak valid",
    "1610": "Kode OTP GoPay kedaluwarsa",
    "1203": "Terlalu banyak percobaan PIN GoPay",
    "825": "Transaksi debit ditolak oleh bank",
    "900": "Layanan GoPay bermasalah — coba lagi",
    "2007": "Pembayaran masih diproses",
  },
  ovo: {
    "14": "Nomor belum terdaftar di OVO",
    "17": "Pembayaran dibatalkan di aplikasi OVO",
    "26": "Gagal mengirim konfirmasi ke aplikasi OVO",
    "40": "Pembayaran OVO gagal diproses",
    "68": "OVO tidak merespons — waktu pembayaran habis",
  },
  bank_transfer: {
    "05": "Transaksi ditolak oleh bank (Do Not Honor)",
    "14": "Nomor rekening tidak valid",
    "51": "Saldo rekening tidak mencukupi",
    "91": "Bank penerbit tidak merespons — coba lagi",
  },
};

/** Label Bahasa Indonesia per channel (dipakai fallback kode tak dikenal). */
export const CHANNEL_LABEL: Record<string, string> = {
  gopay: "GoPay",
  ovo: "OVO",
  bank_transfer: "Virtual Account",
  echannel: "Mandiri Bill Payment",
  cstore: "Convenience Store",
  qris: "QRIS",
  shopeepay: "ShopeePay",
  dana: "DANA",
  credit_card: "Kartu Kredit",
};

// ---------- Helper MURNI untuk tampilan (referensi admin) ----------

/** Satu grup kode status_code untuk ditampilkan di referensi admin. */
export interface MidtransCodeGroup {
  id: string;
  label: string;
  /** Subset MIDTRANS_FAILURE_CODES milik grup ini. */
  codes: Record<string, string>;
}

/**
 * Kelompokkan MIDTRANS_FAILURE_CODES per kategori untuk tampilan referensi
 * (admin/Configurasi). Setiap kode TERCOVER PERSIS SATU grup — dijamin unit
 * test (tidak boleh ada kode yang hilang atau ganda).
 */
export function midtransCodeGroups(): MidtransCodeGroup[] {
  const pick = (re: RegExp) =>
    Object.fromEntries(Object.entries(MIDTRANS_FAILURE_CODES).filter(([k]) => re.test(k)));
  return [
    { id: "card", label: "💳 Kartu Kredit (1xx)", codes: pick(/^1\d\d$/) },
    { id: "va", label: "🏦 Bank Transfer / E-Channel / Retail (2xx)", codes: pick(/^2(0\d|1[0-3])$/) },
    { id: "qris", label: "📱 QRIS (2xx)", codes: pick(/^2(1[4-9]|[23]\d)$/) },
    { id: "midtrans-4xx", label: "⚙️ Kode 4xx Midtrans", codes: pick(/^4\d\d$/) },
  ];
}

/** Satu grup channel_response_code untuk tampilan referensi admin. */
export interface ChannelCodeGroup {
  channel: string;
  label: string;
  codes: Record<string, string>;
}

/** Kelompokkan CHANNEL_RESPONSE_CODES per channel (dengan label Indonesia). */
export function channelCodeGroups(): ChannelCodeGroup[] {
  return Object.entries(CHANNEL_RESPONSE_CODES).map(([channel, codes]) => ({
    channel,
    label: CHANNEL_LABEL[channel] ?? channel,
    codes: { ...codes },
  }));
}
