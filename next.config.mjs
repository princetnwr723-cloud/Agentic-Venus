/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["@sparticuz/chromium", "playwright-core"],
    outputFileTracingIncludes: {
      "/api/browser": ["./node_modules/@sparticuz/chromium/**/*"],
    },
  },
};

export default nextConfig;