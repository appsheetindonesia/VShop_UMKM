import type { Metadata } from "next";
import MerchCard from "@/components/MerchCard";
import { listMerchandise } from "@/lib/service";

export const metadata: Metadata = {
  title: "Merchandise",
};

export default function MerchandisePage({
  searchParams,
}: {
  searchParams?: { kategori?: string };
}) {
  const all = listMerchandise("active");
  const categories = Array.from(new Set(all.map((m) => m.category)));
  const active = searchParams?.kategori;
  const items = active ? all.filter((m) => m.category === active) : all;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="text-center">
        <span className="chip bg-brand-100 text-brand-800">🛍️ MERCHANDISE</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Merchandise V Shop</h1>
        <p className="mt-1 text-sm text-gray-500">Merch eksklusif untuk member V Shop</p>
      </div>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <FilterChip href="/merchandise" active={!active}>
          Semua
        </FilterChip>
        {categories.map((c) => (
          <FilterChip key={c} href={`/merchandise?kategori=${encodeURIComponent(c)}`} active={active === c}>
            {c}
          </FilterChip>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((m) => (
          <MerchCard key={m.id} product={m} />
        ))}
      </div>
      {items.length === 0 && (
        <div className="card mt-6 p-10 text-center text-sm text-gray-500">
          Tidak ada merchandise pada kategori ini.
        </div>
      )}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
        active ? "bg-brand-600 text-white" : "bg-white text-gray-600 hover:bg-gray-100 border border-gray-200"
      }`}
    >
      {children}
    </a>
  );
}
