"use client";

import { postJson, useSubmit } from "@/lib/client";

export default function ArchiveButton({ voucherId, archived }: { voucherId: string; archived: boolean }) {
  const { run, loading } = useSubmit();

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() =>
        run(async () => {
          const res = await postJson(`/api/merchant/vouchers/${voucherId}/archive`, {});
          return res;
        })
      }
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        archived
          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {loading ? "..." : archived ? "Aktifkan" : "Arsipkan"}
    </button>
  );
}
