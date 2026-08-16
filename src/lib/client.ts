"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

export async function postJson<T = { ok: boolean; message?: string }>(
  url: string,
  body: unknown
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function putJson<T = { ok: boolean; message?: string }>(
  url: string,
  body: unknown
): Promise<T> {
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function delJson<T = { ok: boolean; message?: string }>(url: string): Promise<T> {
  const res = await fetch(url, { method: "DELETE" });
  return (await res.json()) as T;
}

/**
 * Hook submit formulir: menangani state loading + pesan error,
 * lalu refresh / redirect setelah sukses.
 */
export function useSubmit(options?: {
  onSuccess?: (data: { ok: boolean; message?: string; redirect?: string }) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<{ ok: boolean; message?: string; redirect?: string }>) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fn();
        if (!data.ok) {
          setError(data.message ?? "Terjadi kesalahan. Coba lagi.");
          return;
        }
        if (data.redirect) {
          router.push(data.redirect);
          router.refresh();
        } else {
          router.refresh();
        }
        options?.onSuccess?.(data);
      } catch {
        setError("Terjadi kesalahan koneksi. Coba lagi.");
      } finally {
        setLoading(false);
      }
    },
    [options, router]
  );

  return { run, loading, error, setError };
}
