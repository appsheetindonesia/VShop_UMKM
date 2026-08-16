"use client";

import { postJson, useSubmit } from "@/lib/client";

export default function ChoosePackageButton({
  packageId,
  label = "Pilih Paket",
}: {
  packageId: string;
  label?: string;
}) {
  const { run, loading } = useSubmit();

  return (
    <button
      type="button"
      disabled={loading}
      onClick={() =>
        run(() =>
          postJson("/api/checkout", {
            type: "package",
            packageId,
            address: undefined,
          })
        )
      }
      className="btn-primary w-full"
    >
      {loading ? "Menyiapkan..." : label}
    </button>
  );
}
