# ADR-0003 — Antrian WhatsApp in-memory + retry backoff (bukan durable)

**Status**: Accepted — dengan risiko terdokumentasi
**Tanggal**: 2026-08-17
**Lingkup**: `src/lib/whatsapp.ts` (antrian di `globalThis.__vshopWaQueue`),
`src/lib/notif-log.ts`, `src/lib/cron.ts` (dedupe menunggu hasil)

## Context

Notifikasi pembayaran (sukses/gagal) dan pengingat voucher dikirim via
WhatsApp Cloud API. Tanpa antrian, ada dua godaan yang kontroversial:

1. **Kirim sinkron di jalur pembayaran** — request checkout/notifikasi
   menunggu round-trip HTTP ke Meta; puluhan notifikasi (retry massal admin,
   voucher H-1) membebani request; satu kegagalan jaringan = request gagal.
2. **Jangan antri sama sekali, biarkan API dipanggil langsung** — retry tidak
   ada, notifikasi hilang permanen pada 5xx/429 sementara.

Kontroversi utama: antrian **in-memory tidak durable** — pada deployment
serverless yang membekukan proses setelah response, kiriman yang masih
mengantre bisa hilang. Apakah ini bisa diterima untuk MVP, atau wajib
job broker sejak awal?

## Alternatif yang dipertimbangkan

- **A1 — Kirim sinkron di jalur pembayaran**: ditolak — request pembayaran
  jadi lambat & rapuh; puluhan kiriman (retry massal, pengingat H-1)
  mengantre di memori request yang akan mati.
- **A2 — Antrian durable (job broker / tabel DB + worker)**: ditunda —
  butuh infrastruktur tambahan; deployment saat ini lokal/Next.js monolitik;
  MVP belum punya worker terpisah. Bukan penolakan permanen.
- **A3 — DIPILIH — antrian in-memory di `globalThis`** (pola yang sama
  dengan cache db.ts, karena Next.js dev membuat satu instance modul per
  bundle): konkurrensi terbatas (`WA_QUEUE_CONCURRENCY`, default 3), retry
  otomatis untuk kegagalan sementara (network/5xx/429/tanpa message id)
  dengan exponential backoff + jitter (`WA_RETRY_BASE_MS` /
  `WA_RETRY_MAX_ATTEMPTS`), fire-and-forget dari jalur pembayaran
  (`enqueueLogged`), dan log tiap percobaan ke `notification_logs`.

## Decision

- **Jalur pembayaran tidak pernah menunggu kiriman** — `enqueueLogged`
  fire-and-forget; kegagalan antrean tidak menggagalkan pembayaran.
- **Cron expiry menunggu hasil job** (`await`) — agar dedupe
  `expiring_notified_at` akurat (job dianggap selesai hanya setelah
  kiriman sukses / gagal terminal).
- **Dokumentasi eksplisit** di README & CONTEXT: antrian tidak durable;
  pada serverless yang membekukan proses, kiriman mengantre bisa hilang.
- **Risiko ini diterima untuk MVP** dengan syarat: migrasi ke job broker
  adalah langkah pertama yang jelas bila deployment pindah ke serverless
  murni.

## Consequences

**Positif**
- Request pembayaran tetap cepat dan kebal terhadap lambat/gagalnya Meta.
- Kegagalan sementara (429 rate limit, 5xx, timeout) sembuh otomatis dengan
  backoff + jitter — tanpa kehilangan kiriman selama proses hidup.
- Konsisten dengan pola `globalThis` lain di proyek (cache db.ts, guard
  cron) sehingga perilaku dev = produksi.

**Negatif / risiko**
- **Tidak durable**: proses mati/beku (serverless freeze, deploy, crash)
  sebelum batch tuntas → kiriman mengantre hilang. Tidak ada replay dari
  disk. (Dimitigasi: `notification_logs` mencatat yang sudah dicoba, tapi
  tidak meng-queue ulang yang gagal karena proses mati.)
- Konkurensi & retry menambah state proses yang tidak bisa di-share antar
  instance (multi-instance = duplikat atau terlewat).
- Cron `await` berarti job expiry bisa melambat bila Meta sedang 5xx
  berkepanjangan (retry beruntun) — dibatasi `WA_RETRY_MAX_ATTEMPTS`.

**Bila ditinjau ulang**: ganti dengan antrian berbasis tabel
(`pending_wa_messages` + worker/service poller) saat deployment pindah ke
serverless murni atau notifikasi menjadi SLA bisnis; pertahankan antarmuka
`enqueueLogged` agar pemanggil tidak berubah.
