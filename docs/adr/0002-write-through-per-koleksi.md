# ADR-0002 — Persistensi write-through per koleksi (dirty tracking + koalesensi)

**Status**: Accepted
**Tanggal**: 2026-08-17
**Lingkup**: `src/lib/db.ts` (mutate / writeDirty / persistChain / flushNow /
drain), `scripts/persist-chain.test.ts`, `src/lib/db.test.ts`

## Context

`db.ts` adalah store hibrida: mode **Supabase** (hydrate dari Postgres,
persist write-through) dan mode **demo** (file JSON). Masalah awal: pola
tulis naif punya dua ekstrem buruk —

1. **Tulis seluruh koleksi per mutasi**: satu `mutate()` kecil (mis. ubah
   satu field) memicu serialisasi + upsert seluruh isi koleksi. O(n) I/O
   setiap mutasi; alur checkout/klaim yang melakukan banyak `mutate()`
   berurutan menjadi sangat boros.
2. **Tulis per baris langsung ke Postgres**: banyak round-trip per alur,
   mengalahkan cache in-memory yang justru menjadi alasan `db.ts` ada.

Kontroversi: koalesensi (menunda & menggabungkan tulis) menambah kompleksitas
— ada risiko state hilang bila proses mati di antara mutasi dan flush, dan
dirty tracking yang salah bisa menulis snapshot basi atau tidak menulis sama
sekali.

## Alternatif yang dipertimbangkan

- **A1 — Tulis seluruh DB per mutasi** (paling sederhana): ditolak karena
  I/O O(n) per mutasi dan race antar-write pada alur beruntun.
- **A2 — Per baris, langsung ke Postgres**: ditolak karena banyak round-trip
  dan kehilangan manfaat cache; mode demo tetap butuh file.
- **A3 — DIPILIH — write-through per koleksi**: `mutate()` membandingkan
  snapshot JSON per koleksi (`captureCollections`), mengantre hanya koleksi
  yang **berubah** (`writeDirty`), lalu `enqueueWrite` menggabungkan batch
  lewat `persistChain` — koleksi yang sama menunggu **hanya ditulis sekali
  dengan snapshot terbaru** (upsert idempotent per PK); urutan antar batch
  terjaga (rantai promise).

## Decision

- **Dirty tracking**: tulis hanya koleksi yang berubah per mutasi.
- **Koalesensi**: dalam satu batch, satu koleksi ditulis sekali dengan
  snapshot terakhir (dedupe per koleksi) — state intermediate tidak pernah
  ter-persist.
- **Flush & shutdown**: `flushNow(maxWaitMs)` memaksa tuntas batch dengan
  batas waktu; drain SIGTERM memanggil `flushNow` sebelum `process.exit`
  agar snapshot terbaru tidak hilang.
- **Mode demo** memakai mekanisme yang sama: tulis file JSON di-debounce
  (maks 1 tulis per tick) + `flushNow` yang sama.
- Unit test wajib: round-trip hydrate→mutate→hydrate (kolom nullable),
  koalesensi & urutan batch (`scripts/persist-chain.test.ts`), fallback ke
  mode demo saat Supabase gagal, dan pengukuran tulis sebelum/sesudah
  (dicatat di README).

## Consequences

**Positif**
- Jumlah tulis nyata turun drastis pada alur yang banyak `mutate()` berurutan
  (klaim voucher & checkout — diukur & didokumentasikan di README).
- Snapshot terbaru selalu yang menang; tidak ada state antara yang bocor ke
  disk/Postgres.
- `flushNow` + drain SIGTERM menjamin tidak ada data hilang saat shutdown
  normal; mode demo mendapat perilaku identik.

**Negatif / risiko**
- Kompleksitas dirty tracking: harus benar-benar benar (ditutup unit test
  round-trip); bug di sini = data basi atau tulis hilang diam-diam.
- Koalesensi = tulis **tertunda** (debounce/batch): crash keras (kill -9,
  listrik) di antara mutasi dan flush bisa menghilangkan mutasi terakhir —
  dimitigasi drain SIGTERM, tidak bisa menutup kill paksa.
- Urutan antar batch jadi kontrak implisit (rantai promise) — test wajib.

**Bila ditinjau ulang**: ganti dengan per-baris langsung hanya bila beban
tulis nyata jauh melebihi kapasitas batch (lihat pengukuran di README), atau
pindah ke pola event-sourcing bila riwayat mutasi dibutuhkan.
