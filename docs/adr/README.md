# ADR — V Shop (Architecture Decision Records)

Jejak alasan untuk keputusan arsitektur yang **kontroversial** (punya
trade-off nyata yang bisa diperdebatkan ulang). Konten ringkas + ringkasan
per-decision tetap di `CONTEXT.md`; ADR ini memuat konteks, alternatif yang
ditolak, dan konsekuensi lengkapnya.

Format: Michael Nygard (Status / Context / Decision / Consequences).
Status: `Proposed` → `Accepted` → `Deprecated` / `Superseded by ADR-xxx`.

## Daftar

| # | Keputusan | Status |
|---|---|---|
| [0001](0001-rls-berlapis-vs-service-role.md) | RLS berlapis vs reliance penuh pada service_role | Accepted |
| [0002](0002-write-through-per-koleksi.md) | Persistensi write-through per koleksi (dirty + koalesensi) | Accepted |
| [0003](0003-antrian-whatsapp-in-memory.md) | Antrian WhatsApp in-memory + retry backoff (bukan durable) | Accepted |
