import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { getSessionUser } from "@/lib/auth";

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const user = getSessionUser();

  return (
    <div className="min-h-screen">
      <Header user={user} />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-12">{children}</main>
      <BottomNav />
    </div>
  );
}
