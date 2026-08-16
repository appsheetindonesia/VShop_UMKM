"use client";

import { useState } from "react";

const SUPA_ENABLED =
  typeof process !== "undefined" && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

export default function ImageField({
  name,
  label,
  placeholder,
  hint,
  folder = "uploads",
  defaultValue,
}: {
  name: string;
  label: string;
  placeholder?: string;
  hint?: string;
  folder?: string;
  defaultValue?: string;
}) {
  const [url, setUrl] = useState(() =>
    defaultValue && defaultValue.startsWith("http") ? defaultValue : ""
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Mode demo: tanpa Supabase Storage, gunakan placeholder teks (emoji).
  if (!SUPA_ENABLED) {
    return (
      <div>
        <label htmlFor={name} className="label">
          {label}
        </label>
        <input
          id={name}
          name={name}
          className="input"
          placeholder={placeholder}
          defaultValue={defaultValue}
        />
        {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      </div>
    );
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("folder", folder);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (!json.ok || !json.url) throw new Error(json.message || "Upload gagal");
      setUrl(json.url);
    } catch (uploadErr) {
      setErr(uploadErr instanceof Error ? uploadErr.message : "Upload gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="label">{label}</label>
      <label
        className={`flex cursor-pointer items-center justify-center rounded-xl border-2 border-dashed px-3 py-2.5 text-sm font-medium transition ${
          url
            ? "border-brand-300 bg-brand-50 text-brand-700"
            : "border-gray-300 bg-white text-gray-500 hover:border-brand-400"
        }`}
      >
        {busy ? "Mengunggah..." : url ? "Ganti gambar" : "Pilih gambar"}
        <input
          id={name}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={onFile}
          className="sr-only"
        />
      </label>
      {url && (
        <div className="mt-2 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={label} className="h-12 w-12 rounded-lg object-cover" />
          <span className="max-w-[16rem] truncate text-xs text-gray-500">{url}</span>
        </div>
      )}
      <input type="hidden" name={name} value={url} />
      {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
