/**
 * Enkripsi rahasia (refresh token Supabase) di penyimpanan server.
 *
 * - AES-256-GCM (authenticated encryption) lewat **Web Crypto API** sehingga
 *   berfungsi di runtime Node maupun Edge (middleware). Format payload tetap
 *   `v1:<iv(base64)>:<tag(base64)>:<ciphertext(base64)>` — kompatibel dengan
 *   payload lama (node:crypto) karena Web Crypto AES-GCM menghasilkan
 *   `ciphertext ‖ tag`, dan tag-nya kita pisahkan agar format tidak berubah.
 * - Kunci dari env `SESSION_ENCRYPTION_KEY` — 32 byte bila diberikan sebagai
 *   base64; jika bukan, di-derive SHA-256 dari teksnya.
 * - Tanpa kunci: `encryptSecret` melempar error; pemanggil (auth.ts)
 *   menurunkan perilaku ke cookie-only agar aplikasi tetap berjalan.
 */

const KEY_ENV = "SESSION_ENCRYPTION_KEY";
const VERSION = "v1";
const TAG_LEN = 16; // AES-GCM tag (byte)

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function getKey(): Promise<CryptoKey | null> {
  const raw = process.env[KEY_ENV];
  if (!raw) return null;
  let material: Uint8Array;
  try {
    const decoded = base64ToBytes(raw);
    if (decoded.length === 32) material = decoded;
    else material = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  } catch {
    material = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  }
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** True bila enkripsi terkonfigurasi (SESSION_ENCRYPTION_KEY terisi). */
export function isEncryptionConfigured(): boolean {
  return Boolean(process.env[KEY_ENV]);
}

/** Enkripsi string → payload `v1:iv:tag:ct`. Lempar bila kunci tidak ada. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey();
  if (!key) throw new Error(`${KEY_ENV} belum diatur`);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const out = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain))
  );
  const ct = out.slice(0, out.length - TAG_LEN);
  const tag = out.slice(out.length - TAG_LEN);
  return [VERSION, bytesToBase64(iv), bytesToBase64(tag), bytesToBase64(ct)].join(":");
}

/**
 * Dekripsi payload `v1:iv:tag:ct`. Mengembalikan null bila kunci hilang,
 * format salah, atau autentikasi gagal (token rusak / kunci berubah).
 */
export async function decryptSecret(payload: string): Promise<string | null> {
  const key = await getKey();
  if (!key) return null;
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = base64ToBytes(parts[1]);
    const tag = base64ToBytes(parts[2]);
    const ct = base64ToBytes(parts[3]);
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, combined);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
