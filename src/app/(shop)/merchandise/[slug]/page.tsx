import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AddToCart from "@/components/AddToCart";
import { getMerchandiseBySlug } from "@/lib/service";
import { getSessionUser } from "@/lib/auth";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Detail Produk",
};

export default function MerchandiseDetailPage({ params }: { params: { slug: string } }) {
  const product = getMerchandiseBySlug(params.slug);
  if (!product) notFound();

  const user = getSessionUser();
  const isCustomer = !!user && user.role === "customer";

  return (
    <div className="mx-auto max-w-5xl">
      <nav className="text-xs text-gray-400" aria-label="Breadcrumb">
        <Link href="/merchandise" className="hover:text-brand-600">Merchandise</Link>
        <span className="mx-1">/</span>
        <span className="text-gray-600">{product.name}</span>
      </nav>

      <div className="mt-4 grid gap-8 md:grid-cols-2">
        <div className="card flex aspect-square items-center justify-center bg-gradient-to-br from-gray-50 to-brand-50 text-[10rem]">
          <span aria-hidden="true">{product.image}</span>
        </div>

        <div>
          <span className="chip bg-brand-100 text-brand-800">{product.category}</span>
          <h1 className="mt-3 text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="mt-2 text-3xl font-extrabold text-accent-600">{formatRupiah(product.price)}</p>

          <div className="mt-4 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            {product.description}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Stok:</span>
            {product.stock > 0 ? (
              <span className="chip bg-emerald-100 text-emerald-800">Tersedia {product.stock}</span>
            ) : (
              <span className="chip bg-red-100 text-red-700">Stok Habis</span>
            )}
          </div>

          <div className="mt-6">
            {isCustomer ? (
              <AddToCart product={product} />
            ) : (
              <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
                {user?.role === "merchant" || user?.role === "admin" ? (
                  <span>
                    Gunakan akun <strong>pelanggan</strong> untuk membeli merchandise.{" "}
                    <Link href="/masuk/pelanggan" className="font-semibold underline">
                      Login pelanggan
                    </Link>
                  </span>
                ) : (
                  <span>
                    Masuk untuk membeli merchandise V Shop.{" "}
                    <Link href="/masuk/pelanggan" className="font-semibold underline">
                      Login / Daftar
                    </Link>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
