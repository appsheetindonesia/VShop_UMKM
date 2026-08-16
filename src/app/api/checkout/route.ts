import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth";
import { ensureHydrated, getDB } from "@/lib/db";
import { createOrder, getCart } from "@/lib/service";
import { checkoutSchema } from "@/lib/validation";

const bodySchema = checkoutSchema.extend({
  type: z.enum(["package", "topup", "merchandise"]),
});

export async function POST(req: Request) {
  await ensureHydrated();
  const user = getSessionUser();
  if (!user || user.role !== "customer") {
    return NextResponse.json({ ok: false, message: "Silakan login sebagai pelanggan" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Payload tidak valid" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Data tidak valid" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  try {
    const db = getDB();

    if (data.type === "package") {
      if (!data.packageId) {
        return NextResponse.json({ ok: false, message: "Paket belum dipilih" }, { status: 400 });
      }
      const pkg = db.packages.find((p) => p.id === data.packageId);
      if (!pkg) {
        return NextResponse.json({ ok: false, message: "Paket tidak ditemukan" }, { status: 404 });
      }
      const { order } = await createOrder({
        userId: user.id,
        type: "package",
        items: [{ name: pkg.name, unitPrice: pkg.price, quantity: 1 }],
        totalAmount: pkg.price, // harga dari server, bukan client
        address: data.address,
        metadata: { packageId: pkg.id, packageName: pkg.name, days: pkg.days },
      });
      return NextResponse.json({ ok: true, orderId: order.id, redirect: `/bayar/${order.id}` });
    }

    if (data.type === "topup") {
      const amount = data.amount ?? 0;
      if (amount < 10000) {
        return NextResponse.json({ ok: false, message: "Minimal top up Rp10.000" }, { status: 400 });
      }
      const { order } = await createOrder({
        userId: user.id,
        type: "topup",
        items: [{ name: "Top Up Saldo V Shop", unitPrice: amount, quantity: 1 }],
        totalAmount: amount,
        address: data.address,
        metadata: { topup: true },
      });
      return NextResponse.json({ ok: true, orderId: order.id, redirect: `/bayar/${order.id}` });
    }

    // type === "merchandise" — hitung dari keranjang server (SEC-04)
    const cart = getCart(user.id);
    if (cart.length === 0) {
      return NextResponse.json({ ok: false, message: "Keranjang masih kosong" }, { status: 400 });
    }
    const items = cart.map((c) => {
      const product = db.merchandise.find((m) => m.id === c.productId && m.status === "active");
      if (!product) throw new Error("Ada produk yang tidak tersedia, periksa kembali keranjang");
      if (product.stock < c.quantity) {
        throw new Error(`Stok ${product.name} hanya tersisa ${product.stock}`);
      }
      return { productId: product.id, name: product.name, unitPrice: product.price, quantity: c.quantity };
    });
    const total = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    const { order } = await createOrder({
      userId: user.id,
      type: "merchandise",
      items,
      totalAmount: total,
      address: data.address,
      metadata: { merchandise: true },
    });
    return NextResponse.json({ ok: true, orderId: order.id, redirect: `/bayar/${order.id}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
