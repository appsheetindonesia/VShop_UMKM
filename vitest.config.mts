import { defineConfig } from "vitest/config";

/**
 * Konfigurasi vitest — coverage v8 terfokus ke modul bisnis `src/lib`
 * (unit test), dengan ambang minimum sebagai GATE:
 *
 *   npm run test:coverage   # gagal (exit ≠ 0) bila di bawah ambang → CI merah
 *
 * Catatan: test yang menyalakan mock HTTP sungguhan (scripts/*.test.ts)
 * tetap ikut dijalankan `npm test`, tapi TIDAK dihitung coverage-nya
 * (include hanya `src/lib`).
 */
export default defineConfig({
  // Alias tsconfig `@/*` → src/* — dipakai route handler (src/app/api/**) yang
  // di-import test (mis. route.test.ts webhook Midtrans); Vite tidak membaca
  // tsconfig paths secara otomatis.
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
  // tsconfig memakai `jsx: "preserve"` (standar Next.js) — Vite/import-analysis
  // gagal mem-parsing JSX pada modul .tsx yang di-import test (mis.
  // src/components/Badge.tsx). Vitest v4 memakai transformer oxc — transform
  // JSX eksplisit di sini agar pure helper bisa di-import tanpa merender komponen.
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "react",
    },
  },
  test: {
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/**/*.test.ts",
        "src/lib/**/*.test.tsx",
        "src/lib/**/*.d.ts",
      ],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
