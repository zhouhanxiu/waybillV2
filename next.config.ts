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
  // 强制把构建产物所有 chunks 纳入部署，规避 Turbopack 下共享 chunk(如 src_lib_parser) 丢失
  outputFileTracingIncludes: {
    "**/*": ["./.next/server/chunks/**", "./.next/server/**"],
  },
};

export default nextConfig;
