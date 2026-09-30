// SAVE AS: next.config.mjs
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Keep the Daytona SDK out of the webpack bundle; it runs server-side only.
    serverComponentsExternalPackages: ["@e2b/desktop"],
  },
};

export default nextConfig;
