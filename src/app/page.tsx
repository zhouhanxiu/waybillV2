"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Upload, Loader2, CheckCircle2, FileSpreadsheet, Sparkles, Zap, AlertTriangle, TerminalSquare } from "lucide-react";

/**
 * V4 异步导入入口（考试要求：上传即返回 ≤1s / 行级错误收集 / 阶段耗时可观测）
 * - 文件上传 → POST /api/import-tasks → 立即返回 taskId
 * - 跳转任务页轮询进度（无需用户等待）
 * - 支持 .xlsx .xls .csv，最大 50MB
 */
export default function ImportV4Page() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ taskId: string; units: number; totalRows: number; traceId: string } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const onUpload = useCallback(async (f: File) => {
    if (!f) return;
    setFile(f);
    setBusy(true);
    setErr(null);
    setSuccess(null);
    setProgress(10);
    try {
      const fd = new FormData();
      fd.append("file", f);
      setProgress(30);
      const res = await fetch("/api/import-tasks", { method: "POST", body: fd });
      setProgress(85);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setProgress(100);
      setSuccess({
        taskId: d.taskId,
        units: d.units ?? 0,
        totalRows: d.totalRows ?? 0,
        traceId: d.traceId ?? "",
      });
      // 1.5s 后跳转到任务详情页
      setTimeout(() => router.push(`/tasks/${d.taskId}`), 1500);
    } catch (e: any) {
      setErr(e.message || "上传失败");
    } finally {
      setBusy(false);
    }
  }, [router]);

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) onUpload(f);
  };

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) onUpload(f);
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      {/* 顶部说明 */}
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-6 h-6 text-jingtian" />
        <h1 className="text-2xl font-bold text-ink">V4 异步导入（事件驱动 · 批量校验 · 全链路可观测）</h1>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        直接选择已有模型（xlsx/xls/csv）上传，提交后立即返回任务ID，结果在后台异步处理。
      </p>

      {/* 上传卡片 */}
      <div className="bg-white rounded-2xl border border-line p-8 mb-6">
        {success ? (
          <div className="flex flex-col items-center py-8">
            <CheckCircle2 className="w-16 h-16 text-green-500 mb-3" />
            <h2 className="text-xl font-bold text-ink mb-2">已提交任务，异步处理中</h2>
            <div className="space-y-2 text-sm text-ink-soft mb-4">
              <div>任务ID：<span className="font-mono text-ink">{success.taskId.slice(0, 16)}…</span></div>
              <div>拆分单元：<span className="font-mono text-ink">{success.units}</span></div>
              <div>总行数：<span className="font-mono text-ink">{success.totalRows}</span></div>
              {success.traceId && <div>TraceID：<span className="font-mono text-ink">{success.traceId.slice(0, 16)}…</span></div>}
            </div>
            <Link href={`/tasks/${success.taskId}`} className="px-4 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark">
              立即查看任务进度
            </Link>
            <p className="text-xs text-ink-soft mt-3">1.5 秒后自动跳转</p>
          </div>
        ) : (
          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${busy ? "border-jingtian bg-jingtian-soft" : "border-line hover:border-jingtian hover:bg-bg"}`}
          >
            {busy ? (
              <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-jingtian animate-spin mb-4" />
                <p className="text-ink mb-2 font-medium">{file?.name}</p>
                <p className="text-sm text-ink-soft mb-3">正在解析文件并创建异步任务…</p>
                <div className="w-64 h-2 bg-bg rounded-full overflow-hidden">
                  <div className="h-full bg-jingtian transition-all" style={{ width: `${progress}%` }}></div>
                </div>
                <p className="text-xs text-ink-soft mt-2">{progress}%</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Upload className="w-12 h-12 text-jingtian mb-4" />
                <p className="text-ink mb-2 font-medium">拖拽文件到此，或点击选择</p>
                <p className="text-sm text-ink-soft mb-4">支持 xlsx / xls / csv，最大 50MB</p>
                <label className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 inline mr-1" />
                  选择文件
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={onPick} className="hidden" />
                </label>
              </div>
            )}
          </div>
        )}

        {err && (
          <div className="mt-4 flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-semibold">上传失败</div>
              <div className="mt-0.5">{err}</div>
            </div>
          </div>
        )}
      </div>

      {/* 流程说明 */}
      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <FlowStep n={1} icon={<Upload className="w-4 h-4" />} title="上传即返回" desc="提交后 ≤1 秒拿到 taskId，立即离开" />
        <FlowStep n={2} icon={<Zap className="w-4 h-4" />} title="异步批量处理" desc="Outbox → 队列 → Worker 1000 行/批" />
        <FlowStep n={3} icon={<Sparkles className="w-4 h-4" />} title="全链路可观测" desc="trace_id / 阶段耗时 / 错误明细" />
      </div>

      {/* 提交后行为提示 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
        <div className="font-semibold mb-1">📌 提交后您可以：</div>
        <ul className="list-disc list-inside space-y-0.5 text-blue-700">
          <li>在 <Link href="/tasks" className="underline">导入任务</Link> 跟踪所有任务进度</li>
          <li>在 <Link href="/monitor-v4" className="underline">监控看板</Link> 查看实时吞吐和阶段耗时</li>
          <li>在 <Link href="/traces" className="underline">Trace 检索</Link> 按任务ID查询完整调用链</li>
        </ul>
      </div>

      {/* 旧版入口 */}
      <div className="mt-6 text-center text-xs text-ink-soft">
        💡 想用同步 4 步流程（带 AI 分析）？<Link href="/legacy" className="text-jingtian hover:underline">前往 V2 旧版</Link>
      </div>
    </div>
  );
}

function FlowStep({ n, icon, title, desc }: { n: number; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">{n}</div>
      <div className="flex-1">
        <div className="flex items-center gap-1 font-semibold text-ink text-sm">{icon}{title}</div>
        <div className="text-xs text-ink-soft mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
