"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Merchant } from "@/lib/types";
import { merchantCode } from "@/lib/format";

export default function UmkmSearch({ merchants }: { merchants: Merchant[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return merchants;
    return merchants.filter(
      (m) =>
        m.namaUsaha.toLowerCase().includes(s) ||
        m.kategoriUsaha.toLowerCase().includes(s)
    );
  }, [q, merchants]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true">
          🔍
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari merchant..."
          aria-label="Cari merchant"
          className="input !rounded-full !pl-10"
        />
      </div>

      {filtered.map((m) => (
        <div key={m.id} className="card flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-50 text-2xl" aria-hidden="true">
              {m.logoUsaha ?? "🏪"}
            </span>
            <div>
              <p className="font-bold text-gray-900">{m.namaUsaha}</p>
              <p className="text-xs text-gray-500">
                {m.kategoriUsaha} · <span className="font-mono">{merchantCode(m.id)}</span>
              </p>
              <p className="text-xs text-gray-400">{m.jamOperasional ?? "-"}</p>
            </div>
          </div>
          <span className="chip bg-emerald-50 !text-emerald-700">Buka</span>
        </div>
      ))}

      {filtered.length === 0 && (
        <div className="card p-8 text-center text-sm text-gray-500">
          Tidak ada merchant yang cocok dengan pencarian.
        </div>
      )}

      <div className="pt-2 text-center">
        <Link href="/promo" className="text-sm font-semibold text-brand-600 hover:underline">
          Lihat voucher yang bisa diklaim →
        </Link>
      </div>
    </div>
  );
}
