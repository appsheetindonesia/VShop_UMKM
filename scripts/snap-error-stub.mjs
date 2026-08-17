/**
 * STUB SNAP.JS + MIDTRANS API — fixture test e2e popup onError.
 *
 * Server HTTP lokal yang meng-emulasi dua hal sekaligus:
 *   1. **Midtrans API** (lewat override `MIDTRANS_API_BASE`):
 *        POST /transactions        → { token, redirect_url } (token BUKAN
 *                                    "snap-demo-…" sehingga order dianggap
 *                                    mode ASLI)
 *        GET  /:orderId/status     → pending (201)
 *   2. **snap.js lokal** (lewat `MIDTRANS_SNAP_SCRIPT_URL`):
 *        GET  /snap.js             → mendefinisikan `window.snap.embed(token,
 *                                    { onSuccess, onPending, onError, … })`
 *                                    yang MEMICU `onError` (setelah ~400ms)
 *                                    berisi `status_code` / `status_message`
 *                                    dari env (default QRIS 216 saldo kurang).
 *
 * Dipakai oleh `scripts/e2e-snap-error.mjs`: app di-restart dengan env
 *   MIDTRANS_SERVER_KEY=SB-Mid-server-snapstub
 *   MIDTRANS_CLIENT_KEY=SB-Mid-client-snapstub
 *   MIDTRANS_API_BASE=http://127.0.0.1:54400
 *   MIDTRANS_SNAP_SCRIPT_URL=http://127.0.0.1:54400/snap.js
 *
 * Jalankan sendiri:  node scripts/snap-error-stub.mjs   (port: SNAP_STUB_PORT / 54400)
 */
import http from "node:http";

const PORT = Number(process.env.SNAP_STUB_PORT ?? 54400);
// Kode & pesan yang dikirim onError (simulasikan kegagalan QRIS saldo kurang).
const STATUS_CODE = process.env.SNAP_STUB_STATUS_CODE ?? "216";
const STATUS_MESSAGE = process.env.SNAP_STUB_MESSAGE ?? "Saldo tidak mencukupi (QRIS)";

/** JavaScript stub snap.js — memicu onError dengan status_code (400ms). */
const SNAP_JS = `
window.snap = {
  embed: function (token, opts) {
    window.__snapStubToken = token;
    setTimeout(function () {
      if (opts && typeof opts.onError === 'function') {
        opts.onError({
          status_code: ${JSON.stringify(STATUS_CODE)},
          status_message: ${JSON.stringify(STATUS_MESSAGE)},
          transaction_status: 'deny',
          transaction_id: 'txn-snap-stub-onerror',
          payment_type: 'qris',
          order_id: token
        });
      }
    }, 400);
  }
};
`;

const server = http.createServer((req, res) => {
  console.log(`[snap-stub] ${req.method} ${req.url}`);
  res.setHeader("Content-Type", "application/json");
  const url = (req.url ?? "").split("?")[0];

  // snap.js — teks/JavaScript (bukan JSON).
  if (req.method === "GET" && url.endsWith("/snap.js")) {
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end(SNAP_JS);
  }

  // Snap create transaction → token asli-tiruan (BUKAN snap-demo-*).
  if (req.method === "POST" && url.endsWith("/transactions")) {
    res.writeHead(200);
    return res.end(
      JSON.stringify({
        token: `snap-stub-${Date.now()}`,
        redirect_url: "https://stub.test/pay",
      })
    );
  }

  // Status API → pending (transaksi belum dibayar; onError-lah yang menandai gagal).
  if (req.method === "GET" && /\/status$/.test(url)) {
    const orderId = decodeURIComponent(url.slice(1).replace(/\/status$/, ""));
    res.writeHead(200);
    return res.end(
      JSON.stringify({
        status_code: "201",
        status_message: "Success, transaction is found",
        transaction_status: "pending",
        transaction_id: "txn-snap-stub-status",
        payment_type: "qris",
        order_id: orderId,
        gross_amount: "0",
      })
    );
  }

  res.writeHead(404);
  res.end(JSON.stringify({ status_code: "404", status_message: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[snap-stub] up on http://127.0.0.1:${PORT} (onError: ${STATUS_CODE} ${STATUS_MESSAGE})`);
});
