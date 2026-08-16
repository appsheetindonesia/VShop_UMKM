import type { Metadata } from "next";
import Badge, { statusColor } from "@/components/Badge";
import ReviewButtons from "@/components/admin/ReviewButtons";
import { listMerchants } from "@/lib/service";
import { formatDateLong } from "@/lib/format";

export const metadata: Metadata = {
  title: "Review Merchant",
};

export default function AdminMerchantsPage() {
  const merchants = listMerchants();

  return (
    <div className="space-y-6">
      <div>
        <span className="chip bg-brand-100 text-brand-800">🏪 MERCHANT</span>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Review Merchant</h1>
        <p className="mt-1 text-sm text-gray-500">
          Tinjau pendaftaran merchant sebelum akun mereka aktif.
        </p>
      </div>

      <div className="grid gap-4">
        {merchants.map((m) => (
          <div key={m.id} className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-50 text-2xl" aria-hidden="true">
                  {m.logoUsaha ?? "🏪"}
                </span>
                <div>
                  <p className="font-bold text-gray-900">{m.namaUsaha}</p>
                  <p className="text-xs text-gray-500">
                    {m.kategoriUsaha} · daftar {formatDateLong(m.createdAt)}
                  </p>
                </div>
              </div>
              <Badge color={statusColor(m.status)}>
                {m.status === "approved" ? "Disetujui" : m.status === "rejected" ? "Ditolak" : "Menunggu"}
              </Badge>
            </div>

            <div className="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <Info label="Pemilik" value={m.namaPemilik} />
              <Info label="WA Usaha" value={m.noWAUsaha} />
              <Info label="Email" value={m.email} />
              <Info label="Alamat" value={m.alamatUsaha} />
              <Info label="Jam Operasional" value={m.jamOperasional ?? "-"} />
              <Info
                label="Google Maps"
                value={m.googleMapsUrl ? "Lihat lokasi" : "-"}
                href={m.googleMapsUrl}
              />
              <div className="sm:col-span-2 lg:col-span-3">
                <Info label="Deskripsi" value={m.deskripsi ?? "-"} />
              </div>
            </div>

            {m.status === "pending" && (
              <div className="flex gap-3 border-t border-gray-100 px-5 py-4">
                <ReviewButtons merchantId={m.id} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Info({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <p className="text-xs text-gray-400">{label}</p>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="font-medium text-brand-600 hover:underline">
          {value}
        </a>
      ) : (
        <p className="font-medium text-gray-700">{value}</p>
      )}
    </div>
  );
}
