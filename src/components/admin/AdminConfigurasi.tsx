"use client";

import { useState } from "react";
import { channelCodeGroups, midtransCodeGroups } from "@/lib/midtrans-codes";
import type {
  SettingCategory,
  SettingListItem,
} from "@/lib/settings";

type CategoryStatus = "configured" | "partial" | "empty";

export interface ConfigurasiInitial {
  settings: SettingListItem[];
  statuses: Record<SettingCategory, CategoryStatus>;
}

interface SettingsResponse {
  ok: boolean;
  settings?: SettingListItem[];
  statuses?: Record<SettingCategory, CategoryStatus>;
  message?: string;
  errors?: string[];
  saved?: string[];
}

interface TestResponse {
  ok: boolean;
  detail: string;
}

const STATUS_META: Record<CategoryStatus, { label: string; cls: string }> = {
  configured: { label: "Terkonfigurasi", cls: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Sebagian", cls: "bg-amber-100 text-amber-800" },
  empty: { label: "Belum diisi", cls: "bg-gray-100 text-gray-700" },
};

export default function AdminConfigurasi({ initial }: { initial: ConfigurasiInitial }) {
  const [settings, setSettings] = useState<SettingListItem[]>(initial.settings);
  const [statuses, setStatuses] = useState(initial.statuses);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [testBusy, setTestBusy] = useState<SettingCategory | null>(null);
  const [testResult, setTestResult] = useState<Partial<Record<SettingCategory, TestResponse>>>({});
  const [notice, setNotice] = useState<string | null>(null);

  // Nilai per key (form state); rahasia diisi HANYA bila user mengetik ulang.
  const [values, setValues] = useState<Record<string, string>>({});

  const byCategory = new Map<SettingCategory, SettingListItem[]>();
  for (const s of settings) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }

  async function save(category: SettingCategory) {
    setBusyKey(category);
    setNotice(null);
    const updates: Record<string, string | null> = {};
    for (const s of byCategory.get(category) ?? []) {
      const v = values[s.key];
      // Rahasia kosong = pertahankan nilai lama; non-rahasia selalu dikirim.
      if (s.isSecret && !v) updates[s.key] = null;
      else updates[s.key] = v ?? "";
    }
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = (await res.json()) as SettingsResponse;
      if (!data.ok) {
        setNotice(`✗ ${data.message ?? "Gagal menyimpan"}`);
        return;
      }
      if (data.settings) setSettings(data.settings);
      if (data.statuses) setStatuses(data.statuses);
      setValues({}); // reset form (rahasia kembali kosong → tampil mask)
      setNotice(data.errors?.length
        ? `Tersimpan (${data.saved?.length}), sebagian gagal: ${data.errors.join("; ")}`
        : `✓ Pengaturan ${category} tersimpan`);
    } catch {
      setNotice("✗ Gagal menyimpan — periksa jaringan");
    } finally {
      setBusyKey(null);
    }
  }

  async function runTest(category: SettingCategory) {
    setTestBusy(category);
    try {
      const res = await fetch("/api/admin/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      const data = (await res.json()) as TestResponse & { message?: string };
      setTestResult((prev) => ({
        ...prev,
        [category]: { ok: data.ok, detail: data.detail ?? data.message ?? "Gagal" },
      }));
    } catch {
      setTestResult((prev) => ({
        ...prev,
        [category]: { ok: false, detail: "Gagal menghubungi server" },
      }));
    } finally {
      setTestBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {notice && (
        <div className="card border-l-4 border-brand-500 p-3 text-sm text-gray-700">{notice}</div>
      )}

      {Array.from(byCategory.entries()).map(([cat, rows]) => {
        const category = cat as SettingCategory;
        const meta = STATUS_META[statuses[category] ?? "empty"];
        return (
          <section key={category} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  <span aria-hidden="true" className="mr-1.5">
                    {CATEGORY_ICON[category]}
                  </span>
                  {CATEGORY_LABEL[category]}
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">{CATEGORY_HINT[category]}</p>
              </div>
              <span className={`chip ${meta.cls}`}>{meta.label}</span>
            </div>

            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {rows.map((s) => (
                <label key={s.key} className="block">
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-800">
                    {s.label}
                    {s.source === "env" && (
                      <span className="chip bg-gray-100 text-gray-500">env</span>
                    )}
                  </span>
                  <input
                    type={s.isSecret ? "password" : "text"}
                    value={values[s.key] ?? ""}
                    placeholder={s.isSecret ? (s.display || "Belum diisi") : s.display || "Belum diisi"}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [s.key]: e.target.value }))
                    }
                    className="input mt-1 w-full !py-2 text-sm"
                    autoComplete="off"
                  />
                  <span className="mt-0.5 block text-xs text-gray-400">{s.description}</span>
                  {s.isSecret && (
                    <span className="mt-0.5 block text-xs text-amber-600">
                      {s.source === "unset" ? "Belum disimpan" : "Tersimpan & terenkripsi — kosongkan untuk mempertahankan"}
                    </span>
                  )}
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => void save(category)}
                disabled={busyKey === category}
                className="btn-primary !py-2 text-sm"
              >
                {busyKey === category ? "Menyimpan…" : "Simpan"}
              </button>
              <button
                onClick={() => void runTest(category)}
                disabled={testBusy === category}
                className="btn-secondary !py-2 text-sm"
              >
                {testBusy === category ? "Menguji…" : "Uji Koneksi"}
              </button>
              {testResult[category] && (
                <span
                  className={`text-sm font-medium ${
                    testResult[category].ok ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {testResult[category].ok ? "✓" : "✗"} {testResult[category].detail}
                </span>
              )}
            </div>
          </section>
        );
      })}

      {/* ---------- Referensi kode gagal Midtrans (sumber: src/lib/midtrans-codes.ts) ---------- */}
      <details className="card p-4">
        <summary className="cursor-pointer select-none text-sm font-bold text-gray-900 hover:text-brand-700">
          📖 Referensi Kode Pembayaran Midtrans
        </summary>
        <p className="mt-2 text-xs text-gray-500">
          Tabel kode gagal yang dipakai aplikasi untuk menerjemahkan
          status_code &amp; channel_response_code (sumber tunggal{" "}
          <code className="font-mono">src/lib/midtrans-codes.ts</code>) —
          berguna saat menelusuri paymentAudit / notifikasi.
        </p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {midtransCodeGroups().map((g) => (
            <div key={g.id} className="rounded-xl border border-gray-100 p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700">{g.label}</p>
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {Object.entries(g.codes).map(([code, reason]) => (
                  <p key={code} className="text-[11px] leading-snug text-gray-600">
                    <span className="font-mono font-semibold text-gray-800">{code}</span>{" "}
                    — {reason}
                  </p>
                ))}
              </div>
            </div>
          ))}
          {channelCodeGroups().map((g) => (
            <div key={g.channel} className="rounded-xl border border-gray-100 p-3">
              <p className="mb-2 text-xs font-semibold text-gray-700">
                🔌 {g.label} (channel_response_code)
              </p>
              <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {Object.entries(g.codes).map(([code, reason]) => (
                  <p key={code} className="text-[11px] leading-snug text-gray-600">
                    <span className="font-mono font-semibold text-gray-800">{code}</span>{" "}
                    — {reason}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

const CATEGORY_LABEL: Record<SettingCategory, string> = {
  postgres: "Database PostgreSQL",
  midtrans: "Payment Gateway",
  whatsapp: "WhatsApp Gateway",
  ai: "AI / Integrasi",
  lainnya: "Lainnya",
};

const CATEGORY_ICON: Record<SettingCategory, string> = {
  postgres: "🗄️",
  midtrans: "💳",
  whatsapp: "💬",
  ai: "🤖",
  lainnya: "🧩",
};

const CATEGORY_HINT: Record<SettingCategory, string> = {
  postgres: "Koneksi ke PostgreSQL / Supabase (REST + service role).",
  midtrans: "Koneksi Midtrans (Snap + Status API) — sandbox/produksi.",
  whatsapp: "Koneksi WhatsApp Cloud API untuk notifikasi.",
  ai: "Endpoint AI (opsional) — OpenAI-compatible.",
  lainnya: "Pengaturan umum aplikasi.",
};
