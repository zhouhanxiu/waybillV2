"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Loader2, FileSpreadsheet, AlertTriangle, ArrowLeft, Trash2 } from "lucide-react";

/**
 * V2 旧版同步导入（4 步流程，向后兼容）
 * - 上传 → 选已有模型 → 同步解析 → 同步入库
 * - 不适合大批量；V4 异步是当前推荐路径
 */
export default function LegacyImportPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onUpload = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/batches", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok || !d.ok) throw new Error(d.error || `HTTP ${res.status}`);
      router.push(`/batches/${d.batchId ?? d.id}`);
    } catch (e: any) {
      setErr(e.message || "上传失败");
    } finally {
      setBusy(false);
    }
  }, [file, router]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-2">
        <Link href="/" className="text-ink-soft hover:text-jingtian text-sm flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> 返回 V4 入口
        </Link>
      </div>
      <h1 className="text-2xl font-bold text-ink mb-2">V2 旧版同步导入</h1>
      <p className="text-sm text-ink-soft mb-6">
        走 4 步同步流程（上传 → AI 分析 → 预览编辑 → 提交）。仅适合小批量（{'<'} 500 行），大量数据请使用 <Link href="/" className="text-jingtian underline">V4 异步导入</Link>。
      </p>

      <div className="bg-white rounded-2xl border border-line p-8">
        {file ? (
          <div className="flex items-center gap-3 p-4 rounded-xl border border-line bg-bg">
            <FileSpreadsheet className="w-8 h-8 text-jingtian" />
            <div className="flex-1">
              <div className="font-medium text-ink">{file.name}</div>
              <div className="text-xs text-ink-soft">{(file.size / 1024).toFixed(1)} KB</div>
            </div>
            <button onClick={() => setFile(null)} className="p-2 rounded-lg text-ink-soft hover:text-danger hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label className="block border-2 border-dashed border-line rounded-xl p-12 text-center cursor-pointer hover:border-jingtian hover:bg-bg">
            <Upload className="w-12 h-12 text-jingtian mx-auto mb-4" />
            <p className="text-ink font-medium mb-2">点击选择文件</p>
            <p className="text-sm text-ink-soft">支持 xlsx / xls / csv</p>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
        )}

        {err && (
          <div className="mt-4 flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>{err}</div>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <Link href="/" className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg text-center text-sm">
            取消
          </Link>
          <button
            onClick={onUpload}
            disabled={!file || busy}
            className="flex-1 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
          >
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> 上传中…</> : "上传并解析"}
          </button>
        </div>
      </div>
    </div>
  );
}
