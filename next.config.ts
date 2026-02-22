import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  trailingSlash: false,
  skipTrailingSlashRedirect: true,
  cacheComponents: true,
  output: "standalone",
  // Mark native modules as external for server components
  serverExternalPackages: [
    "@takumi-rs/core",
    "@takumi-rs/helpers",
    "@napi-rs/canvas",
  ],
  webpack: (config, { isServer }) => {
    // Required for loading .wasm files via new URL()
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
    };

    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
