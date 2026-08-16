"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";
import type { Merchandise } from "@/lib/types";

export default function AddToCart({ product }: { product: Merchandise }) {
  const router = useRouter();
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState<"cart" | "buy" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  async function act(mode: "cart" | "buy") {
    setLoading(mode);
    setError(null);
    try {
      const res = await postJson<{ ok: boolean; message?: string; redirect?: string }>(
        "/api/cart",
        { productId: product.id, quantity: qty, mode }
      );
      if (!res.ok) {
        setError(res.message ?? "Gagal menambahkan");
        return;
      }
      if (mode === "buy") {
        router.push("/checkout?type=cart");
        router.refresh();
      } else {
        setAdded(true);
        router.refresh();
        setTimeout(() => setAdded(false), 2500);
      }
    } catch {
      setError("Terjadi kesalahan koneksi");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-gray-600">Jumlah:</span>
        <div className="flex items-center rounded-xl border border-gray-300">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            className="px-3 py-2 text-gray-600 hover:bg-gray-100"
            aria-label="Kurangi jumlah"
          >
            −
          </button>
          <span className="w-10 text-center text-sm font-bold" aria-live="polite">
            {qty}
          </span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(product.stock, q + 1))}
            className="px-3 py-2 text-gray-600 hover:bg-gray-100"
            aria-label="Tambah jumlah"
          >
            +
          </button>
        </div>
        {added && <span className="text-sm font-semibold text-emerald-600">✓ Masuk keranjang</span>}
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={loading !== null || product.stock <= 0}
          onClick={() => act("cart")}
          className="btn-secondary flex-1"
        >
          {loading === "cart" ? "Menambahkan..." : "🛒 Tambah ke Keranjang"}
        </button>
        <button
          type="button"
          disabled={loading !== null || product.stock <= 0}
          onClick={() => act("buy")}
          className="btn-primary flex-1"
        >
          {loading === "buy" ? "Memproses..." : "Beli Sekarang"}
        </button>
      </div>
    </div>
  );
}
