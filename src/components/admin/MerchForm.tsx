"use client";

import { useState } from "react";
import { postJson, useSubmit } from "@/lib/client";
import Field from "@/components/Field";
import ImageField from "@/components/ImageField";
import type { Merchandise } from "@/lib/types";

export default function MerchForm({ product }: { product?: Merchandise }) {
  const { run, loading, error } = useSubmit();
  const [editing, setEditing] = useState(false);
  const isEdit = !!product;

  if (isEdit && !editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-200"
      >
        Edit
      </button>
    );
  }

  return (
    <div className={isEdit ? "card mt-2 space-y-3 p-4" : "card space-y-4 p-5"}>
      <h2 className="font-bold text-gray-900">{isEdit ? "Edit Produk" : "Tambah Produk Baru"}</h2>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const body = {
            name: fd.get("name"),
            description: fd.get("description"),
            price: fd.get("price"),
            stock: fd.get("stock"),
            image: fd.get("image") || "🛍️",
            category: fd.get("category"),
          };
          run(async () => {
            const res = isEdit
              ? await fetch(`/api/admin/merchandise/${product!.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                }).then((r) => r.json())
              : await postJson("/api/admin/merchandise", body);
            return res;
          });
        }}
      >
        <Field label="Nama Produk" name="name" defaultValue={product?.name} placeholder="cth: Kaos V Shop" required />
        <div>
          <label htmlFor={`desc-${product?.id ?? "new"}`} className="label">Deskripsi</label>
          <textarea
            id={`desc-${product?.id ?? "new"}`}
            name="description"
            rows={2}
            defaultValue={product?.description}
            className="input resize-none"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Harga (Rp)" name="price" type="number" min={1} defaultValue={product?.price} required />
          <Field label="Stok" name="stock" type="number" min={0} defaultValue={product?.stock} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Kategori" name="category" defaultValue={product?.category} placeholder="Fashion" required />
          <ImageField
            name="image"
            label="Gambar Produk"
            defaultValue={product?.image}
            hint="JPG/PNG maks 2MB (opsional)"
            folder="produk"
          />
        </div>

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary flex-1 !py-2 text-sm">
            {loading ? "Menyimpan..." : "Simpan"}
          </button>
          {isEdit && (
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn-secondary !py-2 text-sm"
            >
              Batal
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
