import type { Metadata } from "next";
import ForgotForm from "@/components/auth/ForgotForm";
import { redirectIfLoggedIn } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lupa Password",
};

export default function LupaPasswordPage() {
  redirectIfLoggedIn();

  return (
    <div>
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Lupa Password</h1>
        <p className="mt-1 text-sm text-gray-500">Atur ulang password akun Anda</p>
      </div>
      <ForgotForm />
    </div>
  );
}
