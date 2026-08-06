"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("页面渲染错误:", error);
  }, [error]);

  return (
    <div className="max-w-2xl mx-auto p-6 mt-12">
      <div className="bg-white rounded-2xl border border-red-200 p-8 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-3" />
        <h1 className="text-xl font-bold text-ink mb-2">页面加载出错</h1>
        <p className="text-sm text-ink-soft mb-1">
          {error.message || "未知错误，请重试或返回首页"}
        </p>
        {error.digest && (
          <p className="text-xs text-ink-faint font-mono mb-4">错误 ID: {error.digest}</p>
        )}
        <div className="flex gap-2 justify-center mt-4">
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark flex items-center gap-1"
          >
            <RefreshCw className="w-4 h-4" /> 重试
          </button>
          <Link
            href="/"
            className="px-4 py-2 rounded-lg border border-line text-ink text-sm hover:bg-bg flex items-center gap-1"
          >
            <Home className="w-4 h-4" /> 回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
