#!/usr/bin/env node
/**
 * Seed data demo V Shop ke Supabase (Auth + PostgreSQL).
 *
 * Prasyarat:
 * 1. Migration supabase/migrations/0001_init.sql sudah dijalankan.
 * 2. Kredensial tersedia — dari .env.local / .env atau environment:
 *      NEXT_PUBLIC_SUPABASE_URL
 *      SUPABASE_SERVICE_ROLE_KEY
 *
 * Jalankan:  node scripts/seed-supabase.mjs
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ---------- Muat .env.local / .env sederhana ----------
for (const file of [".env.local", ".env"]) {
  try {
    const txt = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    }
  } catch {
    // abaikan bila file tidak ada
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diatur.");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });
const now = new Date().toISOString();

const daysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString();
const newId = (prefix) =>
  `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
const hashPassword = (pw) =>
  crypto.createHash("sha256").update(`vshop-demo::${pw}`).digest("hex");

// Nomor lokal → E.164 (untuk Supabase Auth phone)
const toE164 = (phone) => {
  if (!phone) return null;
  let d = phone.replace(/[^0-9]/g, "");
  if (d.startsWith("0")) d = `62${d.slice(1)}`;
  else if (!d.startsWith("62")) d = `62${d}`;
  return `+${d}`;
};

// ---------- Akun demo ----------
// authPhone (E.164) melengkapi email: login via WhatsApp & email keduanya
// berfungsi. Admin tetap email-only.
const demoUsers = [
  { email: "admin@vshop.id", password: "admin123", name: "Admin Vshop", role: "admin", phone: null },
  { email: "customer@vshop.id", password: "customer123", name: "Siti Aminah", role: "customer", phone: "081234567890" },
  { email: "merchant@vshop.id", password: "merchant123", name: "Pak Budi", role: "merchant", phone: "081298765432" },
  { email: "kopi@vshop.id", password: "kopi123", name: "Rina", role: "merchant", phone: "081377766655" },
  { email: "elektronik@vshop.id", password: "elektronik123", name: "Hendra", role: "merchant", phone: "081555443322" },
];

async function ensureUser(u) {
  const { data: existing } = await sb
    .from("profiles")
    .select("id")
    .eq("email", u.email)
    .maybeSingle();

  let id = existing?.id;
  if (!id) {
    // Buat dengan phone (E.164) bila tersedia; kalau phone auth belum
    // diaktifkan di dashboard, retry tanpa phone agar seed tetap jalan.
    const base = {
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { name: u.name },
    };
    const authPhone = toE164(u.phone);
    let { data, error } = await sb.auth.admin.createUser({
      ...base,
      phone: authPhone,
      phone_confirm: true,
    });
    if (error && authPhone && /phone/i.test(error.message)) {
      console.warn(`  ! Phone auth belum aktif — user ${u.email} dibuat tanpa nomor.`);
      ({ data, error } = await sb.auth.admin.createUser(base));
    }
    if (error) {
      console.error(`✗ Gagal membuat user ${u.email}: ${error.message}`);
      process.exit(1);
    }
    id = data.user.id;
    console.log(`  + user auth ${u.email}`);
  } else {
    console.log(`  ~ user ${u.email} sudah ada`);
  }

  const { error: profileError } = await sb.from("profiles").upsert(
    {
      id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      password_hash: hashPassword(u.password),
      role: u.role,
      created_at: u.email === "admin@vshop.id" ? now : daysFromNow(-12),
    },
    { onConflict: "id" }
  );
  if (profileError) {
    console.error(`✗ Gagal upsert profil ${u.email}: ${profileError.message}`);
    process.exit(1);
  }
  return { id, ...u };
}

console.log("1/6 Membuat akun demo (Supabase Auth)...");
const [admin, customer, budi, kopi, hendra] = await Promise.all(demoUsers.map(ensureUser));

// ---------- Paket (id tetap = migration) ----------
const packages = [
  { id: "pkg_7hari", name: "Paket 7 Hari", days: 7, price: 7000, features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"], badge: null },
  { id: "pkg_14hari", name: "Paket 14 Hari", days: 14, price: 13000, features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"], badge: "TERPOPULER" },
  { id: "pkg_30hari", name: "Paket 30 Hari", days: 30, price: 25000, features: ["Akses promo & voucher", "Klaim setiap hari", "Hemat maksimal"], badge: "PALING HEMAT" },
];

// ---------- Merchant ----------
const merchants = [
  {
    id: newId("mch"), user_id: budi.id, nama_usaha: "Warung Nusantara", kategori_usaha: "Makanan & Minuman",
    no_wa_usaha: "081298765432", alamat_usaha: "Jl. Melati No. 12, Jakarta Selatan",
    google_maps_url: "https://maps.google.com/?q=Warung+Nusantara", foto_usaha: "🏪", logo_usaha: "🍛",
    nama_pemilik: "Budi Santoso", no_wa_pemilik: "081298765432", email: "merchant@vshop.id",
    deskripsi: "Warung makan rumahan dengan menu nusantara.", jam_operasional: "08.00 - 21.00",
    status: "approved", created_at: daysFromNow(-30),
  },
  {
    id: newId("mch"), user_id: kopi.id, nama_usaha: "Kopi Nusantara", kategori_usaha: "F&B - Kopi",
    no_wa_usaha: "081377766655", alamat_usaha: "Jl. Kenanga No. 3, Bandung",
    google_maps_url: "https://maps.google.com/?q=Kopi+Nusantara", foto_usaha: "☕", logo_usaha: "☕",
    nama_pemilik: "Rina Wijaya", no_wa_pemilik: "081377766655", email: "kopi@vshop.id",
    deskripsi: "Kedai kopi specialty lokal.", jam_operasional: "07.00 - 22.00",
    status: "approved", created_at: daysFromNow(-20),
  },
  {
    id: newId("mch"), user_id: hendra.id, nama_usaha: "Elektronik Jaya", kategori_usaha: "Elektronik",
    no_wa_usaha: "081555443322", alamat_usaha: "Jl. Merdeka No. 45, Surabaya",
    google_maps_url: "https://maps.google.com/?q=Elektronik+Jaya", foto_usaha: "🖥️", logo_usaha: "🔌",
    nama_pemilik: "Hendra Gunawan", no_wa_pemilik: "081555443322", email: "elektronik@vshop.id",
    deskripsi: "Toko elektronik dan aksesoris.", jam_operasional: "09.00 - 20.00",
    status: "pending", created_at: daysFromNow(-2),
  },
];

// ---------- Promo & voucher ----------
const promo1 = { id: newId("prm"), merchant_id: merchants[0].id, merchant_name: "Warung Nusantara", name: "Promo Ramadhan Hemat", jenis_voucher: "diskon", start_date: daysFromNow(-10), end_date: daysFromNow(10), jumlah: 200, created_at: daysFromNow(-10) };
const promo2 = { id: newId("prm"), merchant_id: merchants[0].id, merchant_name: "Warung Nusantara", name: "Weekend Cashback", jenis_voucher: "cashback", start_date: daysFromNow(-5), end_date: daysFromNow(5), jumlah: 150, created_at: daysFromNow(-5) };
const promo3 = { id: newId("prm"), merchant_id: merchants[1].id, merchant_name: "Kopi Nusantara", name: "Diskon Kopi Spesial", jenis_voucher: "diskon", start_date: daysFromNow(-3), end_date: daysFromNow(20), jumlah: 100, created_at: daysFromNow(-3) };
const promos = [promo1, promo2, promo3];

const vouchers = [
  { id: newId("vch"), merchant_id: merchants[0].id, merchant_name: "Warung Nusantara", promo_id: promo1.id, name: "Diskon 20% Makanan", jenis_voucher: "diskon", nilai: 20000, min_transaksi: 100000, kuota: 200, masa_berlaku: daysFromNow(10), maks_penggunaan: 2, syarat_ketentuan: "Berlaku untuk semua menu makanan. Tidak dapat digabung dengan promo lain.", jumlah: 200, status: "active", created_at: daysFromNow(-10) },
  { id: newId("vch"), merchant_id: merchants[0].id, merchant_name: "Warung Nusantara", promo_id: promo1.id, name: "Gratis Ongkir 25rb", jenis_voucher: "gratis-ongkir", nilai: 25000, min_transaksi: 50000, kuota: 150, masa_berlaku: daysFromNow(12), maks_penggunaan: 3, syarat_ketentuan: "Gratis ongkir untuk area Jabodetabek. Maksimal 3x per pelanggan.", jumlah: 150, status: "active", created_at: daysFromNow(-10) },
  { id: newId("vch"), merchant_id: merchants[0].id, merchant_name: "Warung Nusantara", promo_id: promo2.id, name: "Cashback 15rb", jenis_voucher: "cashback", nilai: 15000, min_transaksi: 50000, kuota: 150, masa_berlaku: daysFromNow(5), maks_penggunaan: 1, syarat_ketentuan: "Cashback diberikan setelah transaksi diverifikasi.", jumlah: 150, status: "active", created_at: daysFromNow(-5) },
  { id: newId("vch"), merchant_id: merchants[1].id, merchant_name: "Kopi Nusantara", promo_id: promo3.id, name: "Diskon 15% Kopi", jenis_voucher: "diskon", nilai: 15000, min_transaksi: 60000, kuota: 100, masa_berlaku: daysFromNow(20), maks_penggunaan: 2, syarat_ketentuan: "Berlaku untuk semua menu kopi. Take away maupun dine in.", jumlah: 100, status: "active", created_at: daysFromNow(-3) },
];

// ---------- Merchandise ----------
const merchandise = [
  { id: newId("mds"), name: "Kaos V Shop Premium", slug: "kaos-vshop-premium", description: "Kaos katun combed 30s dengan logo V Shop. Nyaman dipakai sehari-hari.", price: 99000, stock: 50, image: "👕", category: "Fashion", status: "active", created_at: daysFromNow(-20) },
  { id: newId("mds"), name: "Totebag V Shop", slug: "totebag-vshop", description: "Totebag kanvas tebal serbaguna untuk belanja hemat.", price: 45000, stock: 80, image: "👜", category: "Aksesoris", status: "active", created_at: daysFromNow(-20) },
  { id: newId("mds"), name: "Mug Keramik V Shop", slug: "mug-keramik-vshop", description: "Mug keramik 350ml dengan desain eksklusif V Shop.", price: 35000, stock: 60, image: "☕", category: "Rumah Tangga", status: "active", created_at: daysFromNow(-18) },
  { id: newId("mds"), name: "Hoodie V Shop", slug: "hoodie-vshop", description: "Hoodie fleece tebal, hangat dan stylish.", price: 150000, stock: 30, image: "🧥", category: "Fashion", status: "active", created_at: daysFromNow(-15) },
  { id: newId("mds"), name: "Botol Minum Stainless", slug: "botol-minum-stainless", description: "Botol minum stainless 500ml, tahan panas dan dingin.", price: 60000, stock: 40, image: "🍶", category: "Rumah Tangga", status: "active", created_at: daysFromNow(-12) },
  { id: newId("mds"), name: "Sticker Pack V Shop", slug: "sticker-pack-vshop", description: "Paket 10 stiker eksklusif V Shop untuk hiasan barang kesayanganmu.", price: 15000, stock: 200, image: "✨", category: "Aksesoris", status: "active", created_at: daysFromNow(-10) },
];

// ---------- Keanggotaan & dompet demo ----------
const memberships = [
  {
    id: newId("mbr"), user_id: customer.id, package_id: "pkg_30hari", package_name: "Paket 30 Hari",
    start_date: daysFromNow(-5), end_date: daysFromNow(25), status: "active", created_at: daysFromNow(-5),
  },
];

const wallets = [
  { user_id: customer.id, balance: 50000, updated_at: now },
];

// ---------- Order demo (paket 30 hari sudah dibayar) ----------
const orders = [
  {
    id: newId("ord"), order_number: "VS-20260811-0001", user_id: customer.id, type: "package",
    items: [{ name: "Paket 30 Hari", unitPrice: 25000, quantity: 1 }], total_amount: 25000,
    status: "paid", payment_status: "paid", payment_method: "QRIS", snap_token: "snap-demo-seeded",
    shipping_address: { nama: "Siti Aminah", phone: "081234567890", alamat: "Jl. Anggrek No. 7", kota: "Jakarta", kodePos: "12345" },
    metadata: { packageId: "pkg_30hari", packageName: "Paket 30 Hari", days: 30 },
    created_at: daysFromNow(-5), paid_at: daysFromNow(-5),
  },
];

// ---------- Tulis ke Supabase ----------
// IDEMPOTEN: akun & paket di-upsert (id tetap), sedangkan data demo
// (merchant/promo/voucher/order/dst. ber-id acak) di-DELETE dulu agar
// re-seed tidak menumpuk duplikat (mis. bentrok unique slug merchandise).
const CONTENT_TABLES = [
  "claimed_vouchers",
  "orders",
  "memberships",
  "vouchers",
  "promos",
  "merchandise",
  "merchants",
];

console.log("1.5/6 Membersihkan data demo lama (agar seed idempotent)...");
for (const table of CONTENT_TABLES) {
  const { error } = await sb.from(table).delete().neq("id", "");
  if (error) {
    console.error(`✗ Gagal membersihkan ${table}: ${error.message}`);
    process.exit(1);
  }
}

console.log("2/6 Menulis paket, merchant, promo & voucher...");
const upsert = async (table, rows, onConflict = "id") => {
  if (rows.length === 0) return;
  const { error } = await sb.from(table).upsert(rows, { onConflict });
  if (error) {
    console.error(`✗ Gagal menulis ${table}: ${error.message}`);
    process.exit(1);
  }
};

await upsert("packages", packages);
await upsert("merchants", merchants);
await upsert("promos", promos);
await upsert("vouchers", vouchers);

console.log("3/6 Menulis merchandise...");
await upsert("merchandise", merchandise);

console.log("4/6 Menulis memberships & dompet...");
await upsert("memberships", memberships);
await upsert("wallets", wallets, "user_id");

console.log("5/6 Menulis order demo...");
await upsert("orders", orders);

console.log("6/6 Selesai ✓");
console.log("\nAkun demo (login via aplikasi):");
for (const u of demoUsers) {
  console.log(`  ${u.email} / ${u.password}  (${u.role})`);
}
console.log("\nMulai aplikasi: pastikan env Supabase aktif lalu jalankan `npm run dev`.");
