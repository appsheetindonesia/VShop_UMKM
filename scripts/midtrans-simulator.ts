/**
 * SIMULATOR MIDTRANS SANDBOX — fixture test permanen (scripts/).
 *
 * Server HTTP lokal yang meng-emulasi dua endpoint Midtrans yang dipakai
 * adapter `src/lib/midtrans.ts` (lewat override `MIDTRANS_API_BASE`):
 *
 *   POST /snap/v1/transactions   — buat transaksi → { token, redirect_url }
 *   GET  /v2/:orderId/status     — Status API → transaction_status, status_code, …
 *
 * Perilaku sandbox yang PALING penting untuk diuji:
 *   1. **TOLAK DUPLIKAT** — membuat transaksi dengan `order_id` yang sudah
 *      pernah dipakai (transaksi aktif ATAU ditandai via `markUsed`) → HTTP
 *      406 `{ status_code: "406", status_message: "Nomor order sudah pernah
 *      dipakai" }`. Inilah alasan `retryOrderPayment` selalu memakai nomor
 *      order BARU (`nextRetryOrderNumber`) — nomor lama yang terminal tidak
 *      bisa dipakai ulang.
 *   2. **STATUS** — transaksi dibuat `pending` (201), lalu test mengubahnya
 *      jadi terminal via `settle()` (settlement/200), `fail()` (deny/202,
 *      kode kustom), atau `expire()` (expire/203). Status API mengembalikan
 *      nilai terkini → diverifikasi adapter (`isMidtransPaid`,
 *      `midtransFailureReason`, `midtransTerminalFailure`).
 *   3. **SETTLEMENT QRIS** (`settleQris`) — alur SUKSES QRIS: settlement/200
 *      dengan `payment_type: "qris"` (+ channel opsional).
 *   4. **DENY GOPAY** (`denyGopay`) — alur GAGAL e-wallet: deny/202 dengan
 *      `payment_type: "gopay"` + **`channel_response_code`/message** (default
 *      `201` "Saldo GoPay tidak mencukupi") — Status API mengembalikan field
 *      channel sehingga `midtransFailureReason` memilih alasan SPESIFIK
 *      kanal (lebih presisi dari 202 umum).
 *
 * Auth Basic diverifikasi bila `serverKey` diberikan (adapter selalu
 * mengirim `Basic base64(serverKey:)`).
 *
 * Dijalankan OTOMATIS oleh `npm test` via scripts/e2e-retry.test.ts
 * (vitest include default mencakup `scripts/*.test.ts`).
 * Khusus: `npm run test:e2e-retry`.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

/** Status transaksi yang dipahami Midtrans (subset yang relevan). */
export type SimTransactionStatus =
  | "pending"
  | "settlement"
  | "deny"
  | "expire"
  | "cancel"
  | "failure";

export interface SimTransaction {
  orderId: string;
  grossAmount: number;
  token: string;
  transactionId: string;
  transactionStatus: SimTransactionStatus;
  /** Kode status Midtrans (mis. "201" pending, "200" settlement, "202" deny). */
  statusCode: string;
  statusMessage: string;
  paymentType: string;
  fraudStatus: string;
  /** Kode respons CHANNEL (GoPay/OVO/VA) — lebih spesifik dari status_code. */
  channelResponseCode?: string;
  channelResponseMessage?: string;
  createdAt: string;
  paidAt?: string;
}

export interface MidtransSimulatorOptions {
  /** Bila diberikan, semua request diverifikasi Basic auth serverKey. */
  serverKey?: string;
}

/** Opsi bersama settle/fail — termasuk detail CHANNEL (GoPay/OVO/VA). */
export interface SimChannelOptions {
  statusCode?: string;
  statusMessage?: string;
  paymentType?: string;
  channelResponseCode?: string;
  channelResponseMessage?: string;
}

export interface SimFailOptions {
  statusCode?: string;
  statusMessage?: string;
  transactionStatus?: Extract<SimTransactionStatus, "deny" | "cancel" | "failure">;
  channelResponseCode?: string;
  channelResponseMessage?: string;
}

/** Opsi `settleQris` — detail channel opsional (QRIS umumnya tanpa kode). */
export interface SimSettleQrisOptions {
  statusCode?: string;
  statusMessage?: string;
  channelResponseCode?: string;
  channelResponseMessage?: string;
}

/** Opsi `denyGopay` — channel_response_code default `201` (saldo kurang). */
export interface SimDenyGopayOptions {
  statusCode?: string;
  statusMessage?: string;
  channelResponseCode?: string;
  channelResponseMessage?: string;
}

export interface MidtransSimulator {
  server: Server;
  /** Base URL (127.0.0.1, port acak) — isi ke MIDTRANS_API_BASE. */
  url: string;
  /** Transaksi yang dibuat, key = order_id. */
  transactions: Map<string, SimTransaction>;
  /** order_id yang ditandai "sudah pernah dipakai" TANPA transaksi aktif. */
  usedOrderIds: Set<string>;
  /** Jumlah request POST /snap/v1/transactions yang diterima. */
  createCount: number;
  /** Jumlah request GET /v2/:orderId/status yang diterima. */
  statusCount: number;
  /** Ubah transaksi jadi LUNAS (settlement, status_code 200). */
  settle(orderId: string, opts?: { paymentType?: string }): SimTransaction;
  /** Ubah transaksi jadi GAGAL (deny/202 default; kode & pesan bisa di-set). */
  fail(orderId: string, opts?: SimFailOptions): SimTransaction;
  /** Ubah transaksi jadi KADALUARSA (expire/203). */
  expire(orderId: string): SimTransaction;
  /**
   * SETTLEMENT QRIS — alur SUKSES: settlement/200 + `payment_type: "qris"`
   * (+ detail channel opsional, mis. `channel_response_code` dari penyedia).
   */
  settleQris(orderId: string, opts?: SimSettleQrisOptions): SimTransaction;
  /**
   * DENY GOPAY — alur GAGAL e-wallet: deny/202 + `payment_type: "gopay"` +
   * `channel_response_code` default `201` (pesan mentah penyedia "Saldo
   * tidak mencukupi") sehingga Status API membawa alasan SPESIFIK kanal
   * (tabel: "Saldo GoPay tidak mencukupi" + pesan mentah), bukan 202 umum.
   */
  denyGopay(orderId: string, opts?: SimDenyGopayOptions): SimTransaction;
  /** Tandai order_id sudah pernah dipakai tanpa membuat transaksi. */
  markUsed(orderId: string): void;
  close(): Promise<void>;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function startMidtransSimulator(
  opts: MidtransSimulatorOptions = {}
): Promise<MidtransSimulator> {
  const transactions = new Map<string, SimTransaction>();
  const usedOrderIds = new Set<string>();
  let createCount = 0;
  let statusCount = 0;

  const expectedAuth = opts.serverKey
    ? `Basic ${Buffer.from(`${opts.serverKey}:`).toString("base64")}`
    : null;

  function makeTransaction(orderId: string, grossAmount: number): SimTransaction {
    createCount++;
    const t: SimTransaction = {
      orderId,
      grossAmount,
      token: `snap-sim-${randomUUID().slice(0, 8)}-${createCount}`,
      transactionId: `sim-trx-${randomUUID().slice(0, 12)}`,
      transactionStatus: "pending",
      statusCode: "201",
      statusMessage: "Transaksi dibuat",
      paymentType: "qris",
      fraudStatus: "accept",
      createdAt: new Date().toISOString(),
    };
    transactions.set(orderId, t);
    return t;
  }

  function updateStatus(
    orderId: string,
    patch: Partial<SimTransaction> & { transactionStatus: SimTransactionStatus }
  ): SimTransaction {
    const t = transactions.get(orderId);
    if (!t) throw new Error(`Simulator: transaksi ${orderId} tidak ada`);
    Object.assign(t, patch);
    return t;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    // Auth Basic (opsional) — adapter selalu mengirimnya bila server key ada.
    if (expectedAuth) {
      const auth = req.headers.authorization ?? "";
      if (auth !== expectedAuth) {
        json(res, 401, { status_code: "401", status_message: "Akses ditolak — kunci salah" });
        return;
      }
    }

    // Terima bentuk path resmi (`/snap/v1/transactions`, `/v2/:id/status`)
    // MAUPUN bentuk polos seam `MIDTRANS_API_BASE` (base polos →
    // `/transactions` & `/:id/status`).
    let pathname = url.pathname;
    if (pathname.startsWith("/snap/v1")) pathname = pathname.slice("/snap/v1".length) || "/";
    if (pathname.startsWith("/v2")) pathname = pathname.slice("/v2".length) || "/";

    // -------- POST /snap/v1/transactions --------
    if (req.method === "POST" && pathname === "/transactions") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw || "{}") as Record<string, unknown>;
      } catch {
        json(res, 400, { status_code: "400", status_message: "Format permintaan tidak valid" });
        return;
      }
      const details = (payload.transaction_details ?? {}) as Record<string, unknown>;
      const orderId = String(details.order_id ?? "");
      const grossAmount = Number(details.gross_amount ?? 0);
      if (!orderId) {
        json(res, 400, { status_code: "400", status_message: "order_id wajib diisi" });
        return;
      }

      // TOLAK DUPLIKAT: order_id pernah dipakai (transaksi atau markUsed) → 406.
      if (transactions.has(orderId) || usedOrderIds.has(orderId)) {
        json(res, 406, {
          status_code: "406",
          status_message: "Nomor order sudah pernah dipakai",
          error_messages: ["Nomor order sudah pernah dipakai"],
        });
        return;
      }

      const t = makeTransaction(orderId, grossAmount);
      // redirect_url memakai `serverBase` (di-assign setelah listen) —
      // handler hanya berjalan setelahnya, jadi aman dari TDZ.
      json(res, 201, {
        token: t.token,
        redirect_url: `${serverBase}/${t.orderId}`,
      });
      return;
    }

    // -------- GET /v2/:orderId/status --------
    const m = pathname.match(/^\/([^/]+)\/status$/);
    if (req.method === "GET" && m) {
      statusCount++;
      const orderId = decodeURIComponent(m[1]);
      const t = transactions.get(orderId);
      if (!t) {
        json(res, 404, { status_code: "404", status_message: "Transaksi tidak ditemukan" });
        return;
      }
      json(res, 200, {
        status_code: t.statusCode,
        status_message: t.statusMessage,
        transaction_id: t.transactionId,
        order_id: t.orderId,
        gross_amount: t.grossAmount.toFixed(2),
        payment_type: t.paymentType,
        transaction_status: t.transactionStatus,
        fraud_status: t.fraudStatus,
        // Detail CHANNEL (GoPay/OVO/VA) — dikirim hanya bila ada, persis
        // seperti Status API asli; adapter memakainya utk alasan spesifik.
        ...(t.channelResponseCode !== undefined
          ? { channel_response_code: t.channelResponseCode }
          : {}),
        ...(t.channelResponseMessage !== undefined
          ? { channel_response_message: t.channelResponseMessage }
          : {}),
        transaction_time: t.createdAt,
        ...(t.paidAt ? { settlement_time: t.paidAt } : {}),
      });
      return;
    }

    json(res, 404, { status_code: "404", status_message: "Endpoint tidak dikenal" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const serverBase = `http://127.0.0.1:${port}`;

  return {
    server,
    url: serverBase,
    transactions,
    usedOrderIds,
    get createCount() {
      return createCount;
    },
    get statusCount() {
      return statusCount;
    },
    settle: (orderId, opts = {}) =>
      updateStatus(orderId, {
        transactionStatus: "settlement",
        statusCode: "200",
        statusMessage: "Transaksi berhasil",
        paymentType: opts.paymentType ?? "qris",
        paidAt: new Date().toISOString(),
      }),
    fail: (orderId, opts = {}) =>
      updateStatus(orderId, {
        transactionStatus: opts.transactionStatus ?? "deny",
        statusCode: opts.statusCode ?? "202",
        statusMessage: opts.statusMessage ?? "Pembayaran ditolak oleh bank",
        ...(opts.channelResponseCode !== undefined
          ? { channelResponseCode: opts.channelResponseCode }
          : {}),
        ...(opts.channelResponseMessage !== undefined
          ? { channelResponseMessage: opts.channelResponseMessage }
          : {}),
      }),
    expire: (orderId) =>
      updateStatus(orderId, {
        transactionStatus: "expire",
        statusCode: "203",
        statusMessage: "Waktu pembayaran habis",
      }),
    settleQris: (orderId, opts = {}) =>
      updateStatus(orderId, {
        transactionStatus: "settlement",
        statusCode: opts.statusCode ?? "200",
        statusMessage: opts.statusMessage ?? "Transaksi berhasil",
        paymentType: "qris",
        paidAt: new Date().toISOString(),
        ...(opts.channelResponseCode !== undefined
          ? { channelResponseCode: opts.channelResponseCode }
          : {}),
        ...(opts.channelResponseMessage !== undefined
          ? { channelResponseMessage: opts.channelResponseMessage }
          : {}),
      }),
    denyGopay: (orderId, opts = {}) =>
      updateStatus(orderId, {
        transactionStatus: "deny",
        statusCode: opts.statusCode ?? "202",
        statusMessage: opts.statusMessage ?? "Pembayaran ditolak oleh bank",
        paymentType: "gopay",
        channelResponseCode: opts.channelResponseCode ?? "201",
        // Pesan MENTAH dari penyedia (dengan `channelResponseMessage: ""`
        // adapter memakai alasan tabel saja — tanpa suffix mentah).
        channelResponseMessage:
          opts.channelResponseMessage !== undefined
            ? opts.channelResponseMessage
            : "Saldo tidak mencukupi",
      }),
    markUsed: (orderId) => {
      usedOrderIds.add(orderId);
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
