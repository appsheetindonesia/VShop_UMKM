/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output (produksi): memungkinkan deploy Docker/VPS ringan
  // (lihat Dockerfile). `next start` tetap berfungsi normal.
  output: "standalone",
  eslint: {
    // Lint dijalankan terpisah; build fokus pada typecheck.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
