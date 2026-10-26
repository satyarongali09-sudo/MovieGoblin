import type { NextConfig } from "next";

const backendUrl = (
  process.env.BACKEND_INTERNAL_URL ||
  process.env.BACKEND_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:4000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  experimental: {
    cpus: 1
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "googleusercontent.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" }
    ]
  },
  async rewrites() {
    return [
      {
        source: "/classrooms/:path*",
        destination: `${backendUrl}/classrooms/:path*`
      },
      {
        source: "/sessions/:path*",
        destination: `${backendUrl}/sessions/:path*`
      },
      {
        source: "/materials/:path*",
        destination: `${backendUrl}/materials/:path*`
      },
      {
        source: "/polls/:path*",
        destination: `${backendUrl}/polls/:path*`
      },
      {
        source: "/questions/:path*",
        destination: `${backendUrl}/questions/:path*`
      },
      {
        source: "/attendance/:path*",
        destination: `${backendUrl}/attendance/:path*`
      },
      {
        source: "/media/:path*",
        destination: `${backendUrl}/media/:path*`
      },
      {
        source: "/health/:path*",
        destination: `${backendUrl}/health/:path*`
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`
      }
    ];
  }
};

export default nextConfig;
