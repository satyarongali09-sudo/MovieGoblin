import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "googleusercontent.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" }
    ]
  }
};

export default nextConfig;
