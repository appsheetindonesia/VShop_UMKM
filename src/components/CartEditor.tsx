"use client";

import { useRouter } from "next/navigation";
import { delJson, putJson } from "@/lib/client";
import { formatRupiah } from "@/lib/format";
import type { Merchandise } from "@/lib/types";

export default function CartEditor({
  items,
}: {
  items: { item: { productId: string; quantity: number }; product: Merchandise | undefined }[];
}) {
  const router = useRouter();
  const valid = items.filter((x) => x.product);
  const subtotal = valid.reduce((s, x) => s + (x.product?.price ?? 0) * x.item.quantity, 0);

  async function setQty(productId: string, qty: number, stock: number) {
    if (qty < 1 || qty > stock) return;
    await putJson(`/api/cart/${productId}`, { quantity: qty });
    router.refresh();
  }

  async function remove(productId: string) {
    await delJson(`/api/cart/${productId}`);
    router.refresh();
  }

  if (valid.length === 0) {
    return (
      <div className="card p-8 text-center text-sm text-gray-500">
        Keranjang kosong. Yuk belanja merchandise V Shop!
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {valid.map(({ item, product }) => (
        <div key={item.productId} className="card flex items-center gap-4 p-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-3xl" aria-hidden="true">
            {product!.image}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-gray-900">{product!.name}</p>
            <p className="text-sm font-bold text-accent-600">{formatRupiah(product!.price)}</p>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-gray-300">
                <button
                  type="button"
                  onClick={() => setQty(item.productId, item.quantity - 1, product!.stock)}
                  className="px-2.5 py-1 text-gray-600 hover:bg-gray-100"
                  aria-label="Kurangi jumlah"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm font-bold">{item.quantity}</span>
                <button
                  type="button"
                  onClick={() => setQty(item.productId, item.quantity + 1, product!.stock)}
                  className="px-2.5 py-1 text-gray-600 hover:bg-gray-100"
                  aria-label="Tambah jumlah"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={() => remove(item.productId)}
                className="text-sm font-medium text-red-500 hover:underline"
              >
                Hapus
              </button>
            </div>
          </div>
          <p className="text-sm font-bold text-gray-900">
            {formatRupiah(product!.price * item.quantity)}
          </p>
        </div>
      ))}

      <div className="card flex items-center justify-between p-4">
        <span className="font-medium text-gray-600">Subtotal</span>
        <span className="text-lg font-extrabold text-gray-900">{formatRupiah(subtotal)}</span>
      </div>
    </div>
  );
}
