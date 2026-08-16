import Logo from "@/components/Logo";
import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-8">
      <div className="flex justify-center">
        <Link href="/" aria-label="Ke halaman utama">
          <Logo size={48} />
        </Link>
      </div>
      <div className="card mt-6 p-6">{children}</div>
    </main>
  );
}
