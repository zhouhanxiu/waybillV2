import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 外部化所有大型服务端包，防止 Vercel 构建时内存超限挂起
  serverExternalPackages: [
    "pdf-parse",
    "postgres",
    "@ai-sdk/openai",
    "ai",
    "xlsx",
    "bullmq",
    "ioredis",
  ],
  // 强制使用 webpack 而非 Turbopack，规避 Vercel 上 Turbopack chunk 丢失问题
  turbopack: false,
};

export default nextConfig;
