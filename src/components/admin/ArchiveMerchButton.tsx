"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ArchiveMerchButton({
  productId,
  archived,
}: {
  productId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await fetch(`/api/admin/merchandise/${productId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: archived ? "activate" : "archive" }),
          });
          router.refresh();
        } finally {
          setLoading(false);
        }
      }}
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
