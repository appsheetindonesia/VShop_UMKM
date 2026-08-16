import Link from "next/link";
import { formatRupiah } from "@/lib/format";
import type { Merchandise } from "@/lib/types";

export default function MerchCard({ product }: { product: Merchandise }) {
  return (
    <Link
      href={`/merchandise/${product.slug}`}
      className="card group block overflow-hidden transition hover:shadow-md"
    >
      <div className="flex aspect-square items-center justify-center bg-gradient-to-br from-gray-50 to-brand-50 text-6xl transition group-hover:scale-105">
        <span aria-hidden="true">{product.image}</span>
      </div>
      <div className="p-3">
        <p className="text-[11px] font-medium text-brand-600">{product.category}</p>
        <h3 className="mt-0.5 line-clamp-1 text-sm font-semibold text-gray-900">{product.name}</h3>
        <div className="mt-1.5 flex items-center justify-between">
          <p className="font-bold text-accent-600">{formatRupiah(product.price)}</p>
          {product.stock <= 0 ? (
            <span className="chip bg-red-100 text-red-700">Habis</span>
          ) : (
            <span className="chip bg-emerald-100 text-emerald-700">Stok {product.stock}</span>
          )}
        </div>
      </div>
    </Link>
  );
}
