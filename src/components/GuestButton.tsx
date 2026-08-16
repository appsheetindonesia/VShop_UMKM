"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client";

export default function GuestButton({
  label = "Lanjut sebagai Tamu",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        await postJson("/api/auth/guest", {});
        router.push("/beranda");
        router.refresh();
      }}
      className={className}
    >
      {loading ? "Memproses..." : label}
    </button>
  );
}
