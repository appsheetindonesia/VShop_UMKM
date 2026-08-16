"use client";

import { useSubmit, postJson } from "@/lib/client";

export default function LogoutButton({ className = "btn-secondary" }: { className?: string }) {
  const { run, loading } = useSubmit();

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() => run(() => postJson("/api/auth/logout", {}))}
      className={className}
    >
      {loading ? "Keluar..." : "Keluar"}
    </button>
  );
}
