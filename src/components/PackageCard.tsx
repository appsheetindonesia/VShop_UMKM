import { formatRupiah } from "@/lib/format";
import type { Package } from "@/lib/types";
import ChoosePackageButton from "@/components/ChoosePackageButton";

export default function PackageCard({
  pkg,
  canSubscribe,
}: {
  pkg: Package;
  canSubscribe: boolean;
}) {
  return (
    <div
      className={`card relative flex flex-col p-5 ${
        pkg.badge ? "border-2 border-brand-500" : ""
      }`}
    >
      {pkg.badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent-500 px-3 py-0.5 text-xs font-bold text-white">
          {pkg.badge}
        </span>
      )}
      <h3 className="text-lg font-bold text-gray-900">{pkg.name}</h3>
      <p className="mt-1 text-2xl font-extrabold text-brand-600">{formatRupiah(pkg.price)}</p>
      <ul className="mt-4 space-y-2">
        {pkg.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-xs text-emerald-700" aria-hidden="true">
              ✓
            </span>
            {f}
          </li>
        ))}
      </ul>
      <div className="mt-5 flex-1" />
      {canSubscribe ? (
        <ChoosePackageButton packageId={pkg.id} label="Pilih Paket" />
      ) : (
        <p className="rounded-xl bg-gray-100 px-4 py-3 text-center text-xs font-medium text-gray-500">
          Login untuk memilih paket
        </p>
      )}
    </div>
  );
}
