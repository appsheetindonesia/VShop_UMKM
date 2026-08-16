import type { Metadata } from "next";
import Badge, { statusColor } from "@/components/Badge";
import MerchForm from "@/components/admin/MerchForm";
import ArchiveButton from "@/components/admin/ArchiveMerchButton";
import { listMerchandise } from "@/lib/service";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = {
  title: "Kelola Merchandise",
};

export default function AdminMerchandisePage() {
  const items = listMerchandise();

  return (
    <div className="space-y-8">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🛍️ MERCHANDISE</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Kelola Merchandise</h1>
        <p className="mt-1 text-sm text-gray-500">Tambah, edit, dan arsipkan produk V Shop.</p>
      </div>

      <div className="max-w-md">
        <MerchForm />
      </div>

      <section>
        <h2 className="text-lg font-bold text-gray-900">Daftar Produk ({items.length})</h2>
        <div className="card mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-3">Produk</th>
                <th className="px-4 py-3">Kategori</th>
                <th className="px-4 py-3">Harga</th>
                <th className="px-4 py-3">Stok</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id} className="border-b border-gray-100 align-middle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-xl" aria-hidden="true">
                        {m.image}
                      </span>
                      <div>
                        <p className="font-medium text-gray-900">{m.name}</p>
                        <p className="text-xs text-gray-400">{m.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{m.category}</td>
                  <td className="px-4 py-3 font-semibold text-accent-600">{formatRupiah(m.price)}</td>
                  <td className="px-4 py-3 text-gray-600">{m.stock}</td>
                  <td className="px-4 py-3">
                    <Badge color={statusColor(m.status)}>{m.status}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <MerchForm product={m} />
                      <ArchiveButton productId={m.id} archived={m.status === "archived"} />
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                    Belum ada produk.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
