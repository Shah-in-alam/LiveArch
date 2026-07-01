/** @type {import('next').NextConfig} */
const nextConfig = {
  // The viewer reuses ../lib/template.js from the parent LiveArch package,
  // which lives outside this app directory.
  experimental: { externalDir: true },
};

export default nextConfig;
