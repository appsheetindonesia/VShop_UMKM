/**
 * Helpers pagination untuk halaman daftar (server component) — parse nomor
 * halaman dari `searchParams` dengan aman + membangun href yang mempertahankan
 * filter (status/q). Murni & sinkron — mudah diuji.
 */

/** Ukuran halaman default daftar riwayat. */
export const DEFAULT_PAGE_SIZE = 20;

/**
 * Parse `page` dari searchParams: bukan bilangan bulat positif → 1; nilai
 * lebih besar dari jumlah halaman di-clamp ke halaman terakhir.
 */
export function parsePageNumber(
  raw: string | undefined | null,
  totalItems: number,
  pageSize: number = DEFAULT_PAGE_SIZE
): number {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, totalPages);
}

/**
 * Bangun href halaman list dengan mempertahankan filter (status/q/type) dan
 * nomor halaman. `page` 1 dihilangkan agar URL tetap bersih.
 */
export function buildListHref(
  basePath: string,
  params: { status?: string; q?: string; type?: string; page?: number }
): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.type) sp.set("type", params.type);
  if (params.page && params.page > 1) sp.set("page", String(params.page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}
