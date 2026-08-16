/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Lint dijalankan terpisah; build fokus pada typecheck.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
