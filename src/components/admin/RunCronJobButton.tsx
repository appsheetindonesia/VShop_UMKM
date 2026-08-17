"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";

interface RunResult {
  ok: boolean;
  job?: string;
  detail?: string;
  message?: string;
}

/**
 * Tombol "Jalankan Sekarang" per job cron (halaman admin Cron Jobs):
 * memanggil POST /api/admin/cron/run lalu menampilkan hasil inline dan
 * me-refresh halaman (last run per job terbarui dari cron_runs).
 */
export default function RunCronJobButton({ jobKey }: { jobKey: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await postJson<RunResult>("/api/admin/cron/run", { job: jobKey });
      setResult({
        ok: Boolean(res.ok),
        text: res.ok ? `✅ ${res.detail ?? "Selesai"}` : `❌ ${res.message ?? "Gagal"}`,
      });
      router.refresh();
    } catch {
      setResult({ ok: false, text: "❌ Gagal terhubung ke server" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="btn-primary !px-4 !py-2 text-sm"
      >
        {loading ? "Menjalankan..." : "▶ Jalankan Sekarang"}
      </button>
      {result && (
        <p
          role="status"
          className={`text-xs font-medium ${result.ok ? "text-emerald-700" : "text-red-700"}`}
        >
          {result.text}
        </p>
      )}
    </div>
  );
}
