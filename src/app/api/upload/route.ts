import { NextResponse } from "next/server";
import { ensureHydrated } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase/server";

const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Upload gambar ke Supabase Storage (bucket `vshop-assets`, folder `usaha` /
 * `produk`). Wajib login; file divalidasi tipe & ukuran; akses storage lewat
 * service-role key (server-side), sehingga tidak ada kredensial di browser.
 */
export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Silakan login" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, message: "Supabase belum dikonfigurasi" },
      { status: 400 }
    );
  }
  const sb = getSupabaseAdmin();
  if (!sb) {
    return NextResponse.json(
      { ok: false, message: "Supabase belum dikonfigurasi" },
      { status: 400 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }

  const raw = form.get("file");
  if (!raw || typeof raw !== "object" || typeof (raw as File).arrayBuffer !== "function") {
    return NextResponse.json({ ok: false, message: "File gambar wajib diisi" }, { status: 400 });
  }
  const file = raw as File;

  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { ok: false, message: "Format gambar tidak didukung (JPG/PNG/WebP/GIF)" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ ok: false, message: "Ukuran gambar maksimal 2MB" }, { status: 400 });
  }

  const folderRaw = form.get("folder");
  const folder =
    typeof folderRaw === "string" && /^[a-z0-9-]+$/.test(folderRaw) ? folderRaw : "uploads";
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const key = `${folder}/${user.id}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}.${ext}`;

  const { error } = await sb.storage
    .from("vshop-assets")
    .upload(key, file, { contentType: file.type });

  if (error) {
    return NextResponse.json(
      { ok: false, message: `Upload gagal: ${error.message}` },
      { status: 400 }
    );
  }

  const { data } = sb.storage.from("vshop-assets").getPublicUrl(key);
  return NextResponse.json({ ok: true, url: data.publicUrl });
}
