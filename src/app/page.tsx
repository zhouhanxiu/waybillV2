"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload, Loader2, CheckCircle2, FileSpreadsheet, Sparkles, Zap,
  AlertTriangle, ChevronDown, Cpu, BookOpen, Eye, X, ArrowRight, Bolt
} from "lucide-react";

type AnalysisResult = {
  source: string;
  name?: string;
  fileType: string;
  config?: any;
  confidence?: number;
  preview?: any;
};

type RuleItem = {
  id: string;
  name: string;
  description?: string;
  fileType: string;
  config: any;
};

type ImportMode = "ai" | "direct";

export default function ImportV4Page() {
  const router = useRouter();
  const [mode, setMode] = useState<ImportMode>("ai");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "analyzed" | "submitting" | "done">("idle");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chosenRuleId, setChosenRuleId] = useState<string>("");
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ taskId: string; totalRows: number; totalUnits: number; traceId: string; acceptedInMs: number } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 启动时拉取所有已有规则（失败也无所谓）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/rules");
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled && Array.isArray(data)) setRules(data);
      } catch { /* 静默 */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const reset = useCallback(() => {
    setPhase("idle");
    setFile(null);
    setFileName("");
    setAnalysis(null);
    setChosenRuleId("");
    setErr(null);
  }, []);

  // --- AI 模式：上传后自动分析 ---
  const analyzeAndPreview = useCallback(async (f: File) => {
    setErr(null);
    setFile(f);
    setFileName(f.name);
    setPhase("analyzing");
    setAnalysis(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || `分析失败 HTTP ${res.status}`);
      const a: AnalysisResult = {
        source: data?.source || "ai",
        name: data?.name || "AI 推断规则",
        fileType: data?.fileType || "excel",
        config: data?.config ?? {},
        confidence: data?.confidence,
        preview: data?.preview,
      };
      setAnalysis(a);
      const matched = rules.find((r) => r.name === a.name);
      setChosenRuleId(matched?.id || `new:${a.name || "新规则"}`);
      setPhase("analyzed");
    } catch (e: any) {
      setErr(e?.message || "分析失败");
      setPhase("idle");
    }
  }, [rules]);

  // --- 直接模式：上传文件不分析，等用户选规则后直接提交 ---
  const onFileDirect = useCallback((f: File) => {
    setErr(null);
    setFile(f);
    setFileName(f.name);
    setAnalysis(null);
    setPhase("analyzed"); // 复用 analyzed 状态，但无 analysis
  }, []);

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (phase === "analyzing" || phase === "submitting") return;
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    if (mode === "direct") onFileDirect(f);
    else analyzeAndPreview(f);
  };

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (mode === "direct") onFileDirect(f);
    else analyzeAndPreview(f);
  };

  const switchMode = (m: ImportMode) => {
    setMode(m);
    reset();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const submitImport = useCallback(async () => {
    if (!file) return;
    setErr(null);
    setPhase("submitting");
    const t0 = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (chosenRuleId && !chosenRuleId.startsWith("new:")) {
        fd.append("ruleId", chosenRuleId);
      }
      const res = await fetch("/api/import-tasks", { method: "POST", body: fd });
      let data: any = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error(data?.error || `提交失败 HTTP ${res.status}`);
      setResult({
        taskId: data?.taskId || data?.task_id || "",
        totalRows: data?.totalRows ?? data?.total_rows ?? 0,
        totalUnits: data?.totalUnits ?? data?.total_units ?? 0,
        traceId: data?.traceId ?? data?.trace_id ?? "",
        acceptedInMs: Date.now() - t0,
      });
      setPhase("done");
      const tid = data?.taskId || data?.task_id;
      if (tid) setTimeout(() => router.push(`/tasks/${tid}`), 1200);
    } catch (e: any) {
      setErr(e?.message || "提交失败");
      setPhase("analyzed");
    }
  }, [file, chosenRuleId, router]);

  // 渲染
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-6 h-6 text-jingtian" />
        <h1 className="text-2xl font-bold text-ink">V4 智能导入（AI 识别 · 已有规则复用 · ≤1秒返回）</h1>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        拖入 Excel/PDF/CSV → 自动 AI 识别列结构（命中已有规则可跳过 AI） → 选择规则 → 提交后 ≤1秒拿到 taskId，后台异步处理。
      </p>

      {err && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">操作失败</div>
            <div className="mt-0.5">{err}</div>
          </div>
          <button onClick={() => setErr(null)} aria-label="关闭" type="button">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {phase === "done" && result ? (
        <div className="bg-white rounded-2xl border border-green-200 p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-ink mb-2">任务已接收，异步处理中</h2>
          <div className="space-y-1.5 text-sm text-ink-soft mb-4">
            <div>任务ID：<span className="font-mono text-ink">{result.taskId.slice(0, 18)}…</span></div>
            <div>总行数：<span className="font-mono text-ink">{result.totalRows.toLocaleString()}</span></div>
            <div>处理单元：<span className="font-mono text-ink">{result.totalUnits}</span></div>
            <div>接收耗时：<span className={`font-mono font-semibold ${result.acceptedInMs <= 1000 ? "text-green-600" : "text-amber-600"}`}>{result.acceptedInMs}ms</span>（要求 ≤1000ms）</div>
            {result.traceId && <div>TraceID：<span className="font-mono text-ink">{result.traceId.slice(0, 18)}…</span></div>}
          </div>
          <button
            onClick={() => result.taskId && router.push(`/tasks/${result.taskId}`)}
            type="button"
            className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark"
          >
            立即查看任务进度
          </button>
          <p className="text-xs text-ink-soft mt-3">1.2 秒后自动跳转</p>
        </div>
      ) : phase === "analyzed" || phase === "submitting" ? (
        <div className="bg-white rounded-2xl border border-line p-6">
          {/* ---- 直接模式标题 ---- */}
          {mode === "direct" ? (
            <div className="flex items-center gap-2 mb-3">
              <Bolt className="w-5 h-5 text-amber-500" />
              <h2 className="text-lg font-bold text-ink">直接导入（使用已有规则）</h2>
              <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">跳过 AI 分析</span>
            </div>
          ) : (
            /* ---- AI 模式标题 ---- */
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-5 h-5 text-jingtian" />
              <h2 className="text-lg font-bold text-ink">AI 识别结果</h2>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                analysis?.source === "matched" ? "bg-green-100 text-green-700" :
                analysis?.source === "local" ? "bg-amber-100 text-amber-700" :
                "bg-jingtian-soft text-jingtian-dark"
              }`}>
                {analysis?.source === "matched" ? "命中已有规则" : analysis?.source === "local" ? "本地兜底规则" : "AI 推断"}
              </span>
            </div>
          )}

          {/* ---- 文件信息 ---- */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <Field label="文件名" value={fileName} />
            {mode === "ai" ? (
              <>
                <Field label="文件类型" value={(analysis?.fileType || "—").toString().toUpperCase()} />
                <Field label="建议规则名" value={analysis?.name || "—"} />
                <Field label="置信度" value={analysis?.confidence ? `${(analysis.confidence * 100).toFixed(0)}%` : "—"} />
              </>
            ) : (
              <Field label="文件大小" value={file ? `${(file.size / 1024).toFixed(0)} KB` : "—"} />
            )}
          </div>

          {/* ---- 规则选择 ---- */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-ink mb-1">
              {mode === "direct" ? "选择已有规则" : "使用规则"}
            </label>
            <div className="relative">
              <select
                value={chosenRuleId}
                onChange={(e) => setChosenRuleId(e.target.value)}
                disabled={phase === "submitting"}
                className="w-full appearance-none border border-line rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-jingtian"
              >
                {mode === "direct" ? (
                  <>
                    <option value="">-- 请选择已有规则 --</option>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        📋 {r.name}
                      </option>
                    ))}
                  </>
                ) : (
                  <>
                    <option value={`new:${analysis?.name || "新规则"}`}>
                      ✨ 使用 AI 推断的新规则（{analysis?.name || "未命名"}）
                    </option>
                    {rules.map((r) => (
                      <option key={r.id} value={r.id}>
                        📋 {r.name}{r.name === analysis?.name ? "（与 AI 推荐一致）" : ""}
                      </option>
                    ))}
                  </>
                )}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2 top-3 text-ink-soft pointer-events-none" />
            </div>
            <p className="text-xs text-ink-soft mt-1">
              {mode === "direct"
                ? chosenRuleId ? "✓ 已选规则，提交时直接复用" : "请先选择规则"
                : chosenRuleId && !chosenRuleId.startsWith("new:")
                  ? "✓ 已选历史规则，提交时直接复用（不重复 AI 分析）"
                  : "AI 推断的新规则会在第一次提交时自动写入规则库"}
            </p>
          </div>

          {/* ---- AI 模式专属：查看字段映射 ---- */}
          {mode === "ai" && analysis?.config && (
            <details className="mb-4 text-sm">
              <summary className="cursor-pointer text-ink-soft flex items-center gap-1">
                <Eye className="w-3 h-3" /> 查看字段映射
              </summary>
              <pre className="mt-2 bg-bg rounded p-2 text-xs overflow-auto max-h-40">
{JSON.stringify(analysis?.config?.fieldMappings || analysis?.config || {}, null, 2)}
              </pre>
            </details>
          )}

          {/* ---- 操作按钮 ---- */}
          <div className="flex gap-3">
            <button
              onClick={reset}
              disabled={phase === "submitting"}
              type="button"
              className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg text-sm disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={submitImport}
              disabled={phase === "submitting" || (mode === "direct" && !chosenRuleId)}
              type="button"
              className="flex-1 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
            >
              {phase === "submitting" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 提交中…</>
              ) : (
                <><Zap className="w-4 h-4" /> 提交导入（≤1秒返回）</>
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ---- 模式切换 ---- */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => switchMode("ai")}
              type="button"
              className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                mode === "ai"
                  ? "border-jingtian bg-jingtian-soft text-jingtian-dark"
                  : "border-line text-ink-soft hover:bg-bg"
              }`}
            >
              <Sparkles className="w-4 h-4" />
              AI 智能识别（推荐）
            </button>
            <button
              onClick={() => switchMode("direct")}
              type="button"
              className={`flex-1 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                mode === "direct"
                  ? "border-amber-400 bg-amber-50 text-amber-700"
                  : "border-line text-ink-soft hover:bg-bg"
              }`}
            >
              <Bolt className="w-4 h-4" />
              直接导入（选已有规则）
            </button>
          </div>

          {/* ---- 上传区域 ---- */}
          <div
            ref={dropRef}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={`bg-white rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
              phase === "analyzing" ? "border-jingtian bg-jingtian-soft" : "border-line hover:border-jingtian hover:bg-bg"
            }`}
          >
            {phase === "analyzing" ? (
              <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 text-jingtian animate-spin mb-4" />
                <p className="text-ink font-medium">AI 正在分析文件结构…</p>
                <p className="text-xs text-ink-soft mt-2">通常 1~3 秒</p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <Upload className="w-12 h-12 text-jingtian mb-4" />
                <p className="text-ink mb-2 font-medium">拖拽文件到此，或点击选择</p>
                <p className="text-sm text-ink-soft mb-1">
                  {mode === "direct"
                    ? "选择已有规则 → 上传文件 → 直接导入（无需 AI 分析）"
                    : "AI 自动识别列结构，命中已有规则可跳过分析"}
                </p>
                <p className="text-sm text-ink-soft mb-4">支持 xlsx / xls / csv / pdf，最大 50MB</p>
                <label className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4 inline mr-1" />
                  选择文件
                  <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onPick} className="hidden" />
                </label>
              </div>
            )}
          </div>
        </>
      )}

      {/* 流程说明 */}
      <div className="grid md:grid-cols-4 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">1</div>
          <div className="flex-1">
            <div className="flex items-center gap-1 font-semibold text-ink text-sm"><Upload className="w-4 h-4" />上传文件</div>
            <div className="text-xs text-ink-soft mt-0.5">xlsx / xls / csv / pdf</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">2</div>
          <div className="flex-1">
            <div className="flex items-center gap-1 font-semibold text-ink text-sm"><Cpu className="w-4 h-4" />AI 智能识别</div>
            <div className="text-xs text-ink-soft mt-0.5">自动推断列结构，命中已有规则可跳过</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">3</div>
          <div className="flex-1">
            <div className="flex items-center gap-1 font-semibold text-ink text-sm"><BookOpen className="w-4 h-4" />选择规则</div>
            <div className="text-xs text-ink-soft mt-0.5">用 AI 推断 或 直接复用已有</div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">4</div>
          <div className="flex-1">
            <div className="flex items-center gap-1 font-semibold text-ink text-sm"><Zap className="w-4 h-4" />≤1秒返回 taskId</div>
            <div className="text-xs text-ink-soft mt-0.5">异步处理，监控可观测</div>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 mt-6">
        <div className="font-semibold mb-1">📌 提交后您可以：</div>
        <ul className="list-disc list-inside space-y-0.5 text-blue-700">
          <li>在 <Link href="/tasks" className="underline">导入任务</Link> 跟踪所有任务进度</li>
          <li>在 <Link href="/monitor-v4" className="underline">监控看板</Link> 查看实时吞吐和阶段耗时</li>
          <li>在 <Link href="/traces" className="underline">Trace 检索</Link> 按任务ID查询完整调用链</li>
          <li>在 <Link href="/rules" className="underline">规则管理</Link> 编辑/复用历史规则</li>
        </ul>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg rounded-lg p-3">
      <div className="text-xs text-ink-soft">{label}</div>
      <div className="text-sm font-mono text-ink mt-0.5 truncate">{value}</div>
    </div>
  );
}
