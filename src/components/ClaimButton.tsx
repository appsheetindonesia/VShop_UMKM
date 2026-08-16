"use client";

import { useState } from "react";
import { postJson, useSubmit } from "@/lib/client";

export default function ClaimButton({ voucherId, label = "Klaim" }: { voucherId: string; label?: string }) {
  const { run, loading } = useSubmit();
  const [done, setDone] = useState(false);

  return (
    <button
      type="button"
      disabled={loading || done}
      onClick={() =>
        run(async () => {
          const res = await postJson<{ ok: boolean; message?: string; redirect?: string }>(
            `/api/vouchers/${voucherId}/claim`,
            {}
          );
          if (res.ok) setDone(true);
          return res;
        })
      }
      className="btn-accent !px-4 !py-1.5 !text-xs"
    >
      {done ? "✓ Diklaim" : loading ? "..." : label}
    </button>
  );
}
