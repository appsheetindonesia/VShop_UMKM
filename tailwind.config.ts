import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Palet brand V Shop sesuai artifact: biru #1D4ED8, biru gelap #132C7A
        brand: {
          50: "#EFF4FF",
          100: "#E8EEFF",
          200: "#BED1F7",
          300: "#94B1EF",
          400: "#5F84E2",
          500: "#3361D9",
          600: "#1D4ED8",
          700: "#1842B0",
          800: "#132C7A",
          900: "#10234F",
        },
        // Oranye merchant #F97316
        accent: {
          50: "#FFEBD9",
          100: "#FFE3C7",
          200: "#FED7AA",
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316",
          600: "#EA580C",
          700: "#C2410C",
        },
      },
      fontFamily: {
        sans: [
          "Plus Jakarta Sans",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: ["DM Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
