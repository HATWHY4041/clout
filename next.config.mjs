/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@anchor-lang/core"],
  webpack(config, { isServer }) {
    if (!isServer) config.resolve.fallback = { ...(config.resolve.fallback || {}), fs: false, path: false, os: false, crypto: false };
    return config;
  },
  async headers() {
    const cors = [
      { key: "Access-Control-Allow-Origin", value: "*" },
      { key: "Access-Control-Allow-Methods", value: "GET,POST,PUT,OPTIONS" },
      { key: "Access-Control-Allow-Headers", value: "Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids" },
      { key: "Access-Control-Expose-Headers", value: "X-Action-Version, X-Blockchain-Ids" },
    ];
    return [
      { source: "/actions.json", headers: cors },
      { source: "/api/actions/:path*", headers: cors },
    ];
  },
};
export default nextConfig;
