/** @type {import('next').NextConfig} */
const nextConfig = {
  // The viewer reuses ../lib/template.js from the parent LiveArch package,
  // which lives outside this app directory.
  experimental: {
    externalDir: true,
    // Treat optional native deps as externals so their lazy `require(...)` is
    // resolved at runtime (Node), not bundled at build time. `stripe` is only
    // installed when Stripe billing is used; without this, webpack fails to
    // bundle the billing module even in the default (no-Stripe) mode.
    serverComponentsExternalPackages: ['stripe', '@neondatabase/serverless'],
  },
};

export default nextConfig;
