"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRupiah } from "@/lib/format";

const presets = [25000, 50000, 100000, 200000];

export default function TopupForm() {
  const router = useRouter();
  const [amount, setAmount] = useState(50000);
  const [custom, setCustom] = useState("");

  const finalAmount = custom ? Number(custom) : amount;

  return (
    <div className="card space-y-4 p-5">
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setAmount(p);
              setCustom("");
            }}
            className={`rounded-xl border-2 px-4 py-3 text-sm font-bold transition ${
              amount === p && !custom
                ? "border-brand-500 bg-brand-50 text-brand-700"
                : "border-gray-200 text-gray-700 hover:border-gray-300"
            }`}
          >
            {formatRupiah(p)}
          </button>
        ))}
      </div>

      <div>
        <label htmlFor="custom" className="label">Nominal lain (Rp)</label>
        <input
          id="custom"
          type="number"
          min={10000}
          max={5000000}
          step={1000}
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Minimal 10.000"
          className="input"
        />
        {custom && (Number(custom) < 10000 || Number(custom) > 5000000) && (
          <p className="mt-1 text-xs font-medium text-red-600">
            Nominal harus antara Rp10.000 dan Rp5.000.000.
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={Number.isNaN(finalAmount) || finalAmount < 10000 || finalAmount > 5000000}
        onClick={() => router.push(`/checkout?type=topup&amount=${finalAmount}`)}
        className="btn-primary w-full"
      >
        Lanjutkan · {formatRupiah(finalAmount)}
      </button>
    </div>
  );
}
