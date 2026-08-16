"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";

export default function ReviewButtons({ merchantId }: { merchantId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"approved" | "rejected" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(decision: "approved" | "rejected") {
    setLoading(decision);
    setError(null);
    try {
      const res = await postJson(`/api/admin/merchants/${merchantId}/review`, { decision });
      if (!res.ok) setError(res.message ?? "Gagal");
      else router.refresh();
    } catch {
      setError("Terjadi kesalahan koneksi");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => review("approved")}
        className="btn-primary flex-1 !py-2"
      >
        {loading === "approved" ? "Memproses..." : "✓ Setujui"}
      </button>
      <button
        type="button"
        disabled={loading !== null}
        onClick={() => review("rejected")}
        className="btn-secondary flex-1 !py-2 !text-red-600"
      >
        {loading === "rejected" ? "Memproses..." : "✕ Tolak"}
      </button>
      {error && <p className="w-full text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
