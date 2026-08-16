"use client";

import { useEffect, useRef, useState } from "react";
import { postJson, useSubmit } from "@/lib/client";

declare global {
  interface Window {
    snap?: {
      embed: (token: string, options: SnapEmbedOptions) => void;
    };
  }
}

interface SnapEmbedOptions {
  embedId?: string;
  onSuccess?: (result?: unknown) => void;
  onPending?: (result?: unknown) => void;
  onError?: (result?: unknown) => void;
  onClose?: () => void;
}

interface SnapErrorResult {
  status_code?: string | number;
  status_message?: string;
}

const methods = [
  { id: "qris", label: "QRIS", icon: "📱", desc: "Scan dari aplikasi e-wallet / m-banking" },
  { id: "gopay", label: "GoPay", icon: "💚", desc: "Dompet digital Gojek" },
  { id: "ovo", label: "OVO", icon: "💜", desc: "Dompet digital OVO" },
  { id: "dana", label: "DANA", icon: "💙", desc: "Dompet digital DANA" },
  { id: "va-bca", label: "BCA Virtual Account", icon: "🏦", desc: "Transfer dari m-BCA / KlikBCA" },
  { id: "va-bni", label: "BNI Virtual Account", icon: "🏦", desc: "Transfer dari m-BNI / ATM" },
  { id: "va-mandiri", label: "Mandiri Virtual Account", icon: "🏦", desc: "Transfer dari Livin' / ATM" },
] as const;

export default function PayForm({
  orderId,
  total,
  mock = true,
  embed = false,
  redirectUrl,
  snapToken,
  snapScriptUrl,
  clientKey,
}: {
  orderId: string;
  total?: number;
  /** true = mode demo (pembayaran disimulasikan). false = Midtrans asli. */
  mock?: boolean;
  /**
   * true = Snap EMBED: form pembayaran dirender inline di `#snap-container`
   * (saat MIDTRANS_CLIENT_KEY tersedia). false = tombol Bayar → fallback
   * halaman Snap VT-web.
   */
  embed?: boolean;
  /** Fallback URL Snap VT-web (tanpa client key / Snap.js gagal dimuat). */
  redirectUrl?: string;
  /** Snap token asli (mode Midtrans). */
  snapToken?: string;
  /** URL script Snap.js (sandbox / produksi / override uji). */
  snapScriptUrl?: string;
  /** MIDTRANS_CLIENT_KEY — publik, dipakai oleh Snap.js. */
  clientKey?: string;
}) {
  const [method, setMethod] = useState<string>("qris");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false); // transaksi dibuat, belum settle
  const [embedFailed, setEmbedFailed] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Alasan gagal dari Snap onError — ditampilkan di popup SEBELUM redirect. */
  const [snapError, setSnapError] = useState<{ reason: string; code?: string } | null>(null);
  const embedCalled = useRef(false);
  const isQris = method === "qris";
  const real = !mock;

  // ---------- Demo: simulasikan sukses ----------
  const simulateDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await postJson<{ ok: boolean; message?: string; redirect?: string }>(
        `/api/pay/${orderId}`,
        { method }
      );
      if (res.ok && res.redirect) {
        window.location.href = res.redirect;
        return;
      }
      setError(res.message ?? "Pembayaran gagal");
    } catch {
      setError("Terjadi kesalahan koneksi. Coba lagi.");
    } finally {
      setLoading(false);
    }
  };

  // ---------- Snap.js (mode Midtrans asli) ----------
  const loadSnap = async (): Promise<boolean> => {
    if (typeof window === "undefined") return false;
    if (window.snap) return true;
    if (!snapScriptUrl || !clientKey) return false;
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = snapScriptUrl!;
      script.setAttribute("data-client-key", clientKey!);
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
    });
  };

  /** Tanya Midtrans Status API lalu redirect ke sukses/gagal; pending → state. */
  const verifyAndRedirect = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pay/${orderId}/status`)
        .then((r) => r.json())
        .catch(() => null);
      if (res?.ok && res.status === "paid") {
        window.location.href = res.redirect;
        return;
      }
      if (res?.ok && (res.status === "failed" || res.status === "expired")) {
        window.location.href = res.redirect;
        return;
      }
      setPending(true);
      setInfo("Pembayaran belum selesai. Selesaikan pembayaran di form di atas, lalu cek status lagi.");
    } catch {
      setError("Gagal memeriksa status pembayaran.");
    } finally {
      setLoading(false);
    }
  };

const handleSnapSuccess = (result?: unknown) => {
    recordCallback("success", result);
    void verifyAndRedirect();
  };

  /**
   * onError Snap.js → catat callback (audit) + kirim kode status ke server
   * agar alasan spesifik disimpan. Server mengembalikan `reason` (alasan
   * efektif dari tabel kode Midtrans) — ditampilkan LANGSUNG di popup
   * sebelum redirect; tombol "Lihat Detail" membuka layar Pembayaran Gagal.
   * Bila server tidak merespons, fallback ke redirect langsung (alur lama).
   */
  const handleSnapError = async (result?: unknown) => {
    recordCallback("error", result);
    const err = (result ?? {}) as SnapErrorResult;
    const code = typeof err.status_code === "string" ? err.status_code : String(err.status_code ?? "");
    const message = typeof err.status_message === "string" ? err.status_message : undefined;
    try {
      const res = await postJson<{ ok: boolean; reason?: string; code?: string | null }>(
        `/api/pay/${orderId}/fail`,
        { reason: "failed", code: code || undefined, message }
      );
      if (res?.ok) {
        setSnapError({
          reason:
            (typeof res.reason === "string" && res.reason.length > 0 ? res.reason : undefined) ??
            message ??
            "Pembayaran gagal diproses",
          code: (typeof res.code === "string" && res.code.length > 0 ? res.code : undefined) ?? (code || undefined),
        });
        return;
      }
    } catch {
      // fall through → redirect langsung (jaringan bermasalah)
    }
    window.location.href = `/bayar/gagal?order=${orderId}&reason=failed`;
  };

  const handleSnapClose = () => {
    recordCallback("close");
    setInfo("Pembayaran belum selesai. Selesaikan pembayaran di form di atas, atau cek status pembayaran.");
  };

  /** Catat callback Snap ke metadata order (audit trail) — fire-and-forget. */
  const recordCallback = (event: string, result?: unknown) => {
    const normalized =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : result !== undefined
          ? { message: String(result) }
          : undefined;
    void postJson(`/api/pay/${orderId}/snap-callback`, {
      event,
      result: normalized,
    }).catch(() => null);
  };

  // ---------- Snap EMBED: render form pembayaran inline saat halaman dimuat ----------
  useEffect(() => {
    if (!real || !embed || !snapToken) return;
    let cancelled = false;
    (async () => {
      const ready = await loadSnap();
      if (cancelled) return;
      if (!ready || !window.snap) {
        setEmbedFailed(true);
        setInfo("Gagal memuat pembayaran inline. Gunakan tautan di bawah untuk membayar.");
        return;
      }
      // Guard di titik panggil: StrictMode menjalankan effect dua kali —
      // pastikan snap.embed hanya dipanggil sekali.
      if (embedCalled.current) return;
      embedCalled.current = true;
      window.snap.embed(snapToken, {
        embedId: "snap-container",
        onSuccess: (result?: unknown) => void handleSnapSuccess(result),
        onPending: (result?: unknown) => {
          recordCallback("pending", result);
          setPending(true);
          setInfo("Pembayaran sedang diproses. Cek status setelah selesai.");
        },
        onError: (result?: unknown) => void handleSnapError(result),
        onClose: handleSnapClose,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, embed, snapToken]);

  // ---------- Mode asli tanpa embed (tidak ada client key) → VT-web ----------
  const payViaRedirect = async () => {
    setError(null);
    if (snapToken && (await loadSnap()) && window.snap) {
      // Client key tersedia tetapi embed nonaktif → fallback aman ke redirect.
    }
    if (redirectUrl) {
      window.location.href = redirectUrl;
      return;
    }
    setError("Token pembayaran tidak tersedia. Silakan coba lagi.");
  };

  const payNow = () => {
    if (mock) void simulateDemo();
    else void payViaRedirect();
  };

  // ==================== RENDER ====================
  return mock ? (
    <div>
      <div className="grid gap-2">
        {methods.map((m) => (
          <label
            key={m.id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 transition ${
              method === m.id ? "border-brand-600 bg-brand-100" : "border-gray-200 bg-white hover:border-gray-300"
            }`}
          >
            <input
              type="radio"
              name="method"
              value={m.id}
              checked={method === m.id}
              onChange={() => setMethod(m.id)}
              className="h-4 w-4 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-2xl" aria-hidden="true">{m.icon}</span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-gray-900">{m.label}</span>
              <span className="block text-xs text-gray-500">{m.desc}</span>
            </span>
          </label>
        ))}
      </div>

      {isQris ? (
        <QrisPanel orderId={orderId} total={total} />
      ) : (
        <>
          {error && (
            <div role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          {info && (
            <div className="mt-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
              {info}
            </div>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={payNow}
            className="btn-primary mt-5 w-full"
          >
            {loading ? "Memeriksa..." : "Bayar Sekarang"}
          </button>
          <p className="mt-2 text-center text-xs text-gray-400">
            Mode demo — pembayaran disimulasikan (tidak ada uang asli).
          </p>
        </>
      )}
    </div>
  ) : (
    <div>
      {embed ? (
        <>
          <div
            id="snap-container"
            aria-label="Form pembayaran inline (Snap embed)"
            className="min-h-24 overflow-hidden rounded-xl border border-gray-200 bg-white"
          />
          {!embedFailed && (
            <p className="mt-3 text-center text-xs text-gray-400">
              Form pembayaran dimuat langsung dari Midtrans (Snap embed) — pilih metode &
              selesaikan pembayaran di atas.
            </p>
          )}
          {embedFailed && (
            <div role="alert" className="mt-3 space-y-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              <p>Gagal memuat form pembayaran inline. Gunakan halaman Snap untuk membayar.</p>
              {redirectUrl && (
                <a href={redirectUrl} className="btn-secondary w-full !text-red-700">
                  Buka di Halaman Snap
                </a>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {error && (
            <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
          <button
            type="button"
            disabled={loading}
            onClick={payNow}
            className="btn-primary mt-2 w-full"
          >
            {loading ? "Mengalihkan..." : "Bayar Sekarang"}
          </button>
          {redirectUrl && (
            <a href={redirectUrl} className="mt-2 block text-center text-xs font-semibold text-brand-600 hover:underline">
              Buka langsung di Halaman Snap →
            </a>
          )}
        </>
      )}

      {info && (
        <div className="mt-3 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          {info}
        </div>
      )}
      {pending && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void verifyAndRedirect()}
          className="btn-secondary mt-2 w-full"
        >
          {loading ? "Memeriksa..." : "Cek Status Pembayaran"}
        </button>
      )}
      <p className="mt-2 text-center text-xs text-gray-400">
        🔒 Pembayaran diproses langsung oleh Midtrans secara aman.
      </p>

      {snapError && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="snap-error-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <span className="text-4xl" aria-hidden="true">⚠️</span>
            <h2 id="snap-error-title" className="mt-2 text-lg font-bold text-gray-900">
              Pembayaran Gagal
            </h2>
            <p className="mt-1.5 text-sm font-semibold text-red-600">{snapError.reason}</p>
            {snapError.code && (
              <p className="mt-1 font-mono text-xs text-gray-400">Kode {snapError.code}</p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Pembayaran tidak dapat diproses. Buka detail untuk mencoba lagi atau kembali ke
              beranda.
            </p>
            <div className="mt-4 space-y-2">
              <a
                href={`/bayar/gagal?order=${orderId}&reason=failed`}
                className="btn-primary block w-full"
              >
                Lihat Detail
              </a>
              <button
                type="button"
                onClick={() => setSnapError(null)}
                className="btn-secondary w-full"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Panel QRIS — hanya mode demo (placeholder QR + countdown sesuai wireframe). */
function QrisPanel({ orderId, total }: { orderId: string; total?: number }) {
  const [seconds, setSeconds] = useState(15 * 60);
  const { run, loading, error } = useSubmit();
  const expired = seconds <= 0;

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  const onAction = () => {
    if (expired) {
      // Countdown habis → tandai kadaluarsa → layar Pembayaran Gagal.
      run(() =>
        postJson(`/api/pay/${orderId}/fail`, { reason: "expired" }).then((res) => {
          if (res?.ok) {
            window.location.href = `/bayar/gagal?order=${orderId}&reason=expired`;
            return { ok: true };
          }
          return res ?? { ok: false, message: "Gagal menandai pembayaran" };
        })
      );
      return;
    }
    // Simulasikan sukses.
    run(() => postJson(`/api/pay/${orderId}`, { method: "qris" }));
  };

  return (
    <div className="mt-4 flex flex-col items-center rounded-2xl border border-gray-200 bg-white p-6 text-center">
      <p className="text-sm text-gray-500">Total dibayar</p>
      <p className="mt-0.5 text-2xl font-extrabold text-gray-900">
        {total ? new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(total) : "-"}
      </p>

      {/* Placeholder QR */}
      <div
        className="mt-4 flex h-44 w-44 items-center justify-center rounded-2xl border-2 border-gray-200 bg-white"
        aria-label="Kode QR pembayaran"
        role="img"
      >
        <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
          {Array.from({ length: 12 }).map((_, i) =>
            Array.from({ length: 12 }).map((_, j) => {
              const finder =
                (i < 4 && j < 4) || (i < 4 && j > 7) || (i > 7 && j < 4);
              const cell =
                finder ? ((i % 3 === 0 || j % 3 === 0) ? 0 : 1)
                : ((i * 7 + j * 13 + (i * j) % 5) % 3 === 0 ? 1 : 0);
              return cell ? (
                <rect key={`${i}-${j}`} x={i * 10} y={j * 10} width="9" height="9" fill="#0F172A" />
              ) : null;
            })
          )}
        </svg>
      </div>

      <p className="mt-4 font-mono text-sm font-medium text-red-600">
        {expired ? "Kode QR kedaluwarsa" : `Selesai dalam ${mm}:${ss}`}
      </p>

      {error && (
        <div role="alert" className="mt-3 w-full rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={loading}
        onClick={onAction}
        className="btn-primary mt-5 w-full"
      >
        {loading ? "Memeriksa..." : expired ? "Bayar Ulang" : "Cek Status Pembayaran"}
      </button>
      <p className="mt-2 text-xs text-gray-400">
        {expired
          ? "Waktu pembayaran habis. Klik “Bayar Ulang” untuk mengulang pembayaran."
          : "Mode demo: klik “Cek Status Pembayaran” untuk mensimulasikan QRIS sukses."}
      </p>
    </div>
  );
}
