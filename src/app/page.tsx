"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload, Loader2, CheckCircle2, FileSpreadsheet, Sparkles, Zap,
  AlertTriangle, ChevronDown, Cpu, BookOpen, Eye, X
} from "lucide-react";

type RuleItem = {
  id: string;
  name: string;
  description?: string;
  fileType: "excel" | "pdf";
  config: any;
};

type AnalysisResult = {
  source: "ai" | "local" | "matched";
  name: string;
  fileType: "excel" | "pdf";
  config: any;
  confidence?: number;
  preview?: any;
};

type SubmitState =
  | { phase: "idle" }
  | { phase: "analyzing"; fileName: string }
  | { phase: "analyzed"; fileName: string; file: File; analysis: AnalysisResult; chosenRuleId: string }
  | { phase: "submitting"; fileName: string; chosenRuleId: string }
  | { phase: "done"; taskId: string; totalRows: number; totalUnits: number; traceId: string; acceptedInMs: number };

/**
 * V4 智能导入（新版：保留智能分析 + 可选已有规则 + 提交≤1s）
 * 1. 拖文件 → 调 /api/analyze 智能识别（命中已有规则则跳过 AI）
 * 2. 弹"分析结果"卡片 + 规则下拉（可切换到任一历史规则）
 * 3. 点"提交" → 调 /api/import-tasks，≤1s 返回 taskId → 跳任务页
 */
export default function ImportV4Page() {
  const router = useRouter();
  const [state, setState] = useState<SubmitState>({ phase: "idle" });
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number>(0);
  const [rules, setRules] = useState<RuleItem[]>([]);
  const dropRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<number>(0);

  // 启动时拉取所有已有规则
  useEffect(() => {
    fetch("/api/rules").then(r => r.ok ? r.json() : []).then((data: any) => {
      if (Array.isArray(data)) setRules(data);
    }).catch(() => {});
  }, []);

  const reset = useCallback(() => {
    setState({ phase: "idle" });
    setErr(null);
    setElapsed(0);
  }, []);

  const analyzeAndPreview = useCallback(async (file: File) => {
    setErr(null);
    startRef.current = Date.now();
    setState({ phase: "analyzing", fileName: file.name });
    try {
      // 1) 调 AI 分析
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "分析失败");
      const analysis: AnalysisResult = {
        source: data.source || "ai",
        name: data.name || "AI 推断规则",
        fileType: data.fileType || "excel",
        config: data.config,
        confidence: data.confidence,
        preview: data.preview,
      };
      // 2) 检查是否有重名已有规则，自动选中
      const matched = rules.find(r => r.name === analysis.name);
      const chosenId = matched?.id || `new:${analysis.name}`;
      setElapsed(Date.now() - startRef.current);
      setState({ phase: "analyzed", fileName: file.name, file, analysis, chosenRuleId: chosenId });
    } catch (e: any) {
      setErr(e.message || "分析失败");
      setState({ phase: "idle" });
    }
  }, [rules]);

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (state.phase === "analyzing" || state.phase === "submitting") return;
    const f = e.dataTransfer.files?.[0];
    if (f) analyzeAndPreview(f);
  };

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) analyzeAndPreview(f);
  };

  const submitImport = useCallback(async () => {
    if (state.phase !== "analyzed" && state.phase !== "submitting") return;
    const file = state.phase === "analyzed" ? state.file : null;
    const chosenRuleId = state.phase === "analyzed" ? state.chosenRuleId : (state as any).chosenRuleId;
    if (!file) return;
    setState({ phase: "submitting", fileName: file.name, chosenRuleId });
    setErr(null);
    const t0 = Date.now();
    try {
      const fd = new FormData();
      fd.append("file", file);
      // 选了已有规则 → 传 ruleId；选"AI 推断的新规则" → 不传（API 会用 default）
      const isExisting = chosenRuleId && !chosenRuleId.startsWith("new:");
      if (isExisting) fd.append("ruleId", chosenRuleId);
      const res = await fetch("/api/import-tasks", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setState({
        phase: "done",
        taskId: data.taskId,
        totalRows: data.totalRows ?? 0,
        totalUnits: data.totalUnits ?? 0,
        traceId: data.traceId ?? "",
        acceptedInMs: Date.now() - t0,
      });
      setTimeout(() => router.push(`/tasks/${data.taskId}`), 1200);
    } catch (e: any) {
      setErr(e.message || "提交失败");
      // 回退到 analyzed 状态允许重试
      setState({ phase: "analyzed", fileName: file.name, file, analysis: (state as any).analysis ?? {}, chosenRuleId });
    }
  }, [state, router]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-6 h-6 text-jingtian" />
        <h1 className="text-2xl font-bold text-ink">V4 智能导入（AI 识别 · 已有规则复用 · ≤1秒返回）</h1>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        拖入 Excel/PDF/CSV → 自动 AI 识别列结构（命中已有规则可跳过 AI） → 选择规则 → 提交后 ≤1秒拿到 taskId，后台异步处理。
      </p>

      {/* 错误条 */}
      {err && (
        <div className="mb-4 flex items-start gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="font-semibold">操作失败</div>
            <div className="mt-0.5">{err}</div>
          </div>
          <button onClick={() => setErr(null)}><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* 状态机渲染 */}
      {state.phase === "done" ? (
        <DoneCard state={state} onView={() => router.push(`/tasks/${state.taskId}`)} />
      ) : state.phase === "analyzed" || state.phase === "submitting" ? (
        <AnalyzedCard
          state={state}
          rules={rules}
          onChangeRule={(id) => setState({ ...state, chosenRuleId: id } as any)}
          onSubmit={submitImport}
          onReset={reset}
        />
      ) : (
        <UploadDropZone
          dropRef={dropRef}
          onDrop={onDrop}
          onPick={onPick}
          busy={state.phase === "analyzing"}
        />
      )}

      {/* 流程说明 */}
      <div className="grid md:grid-cols-4 gap-4 mt-6">
        <FlowStep n={1} icon={<Upload className="w-4 h-4" />} title="上传文件" desc="xlsx / xls / csv / pdf" />
        <FlowStep n={2} icon={<Cpu className="w-4 h-4" />} title="AI 智能识别" desc="自动推断列结构，命中已有规则可跳过" />
        <FlowStep n={3} icon={<BookOpen className="w-4 h-4" />} title="选择规则" desc="用 AI 推断 或 直接复用已有" />
        <FlowStep n={4} icon={<Zap className="w-4 h-4" />} title="≤1秒返回 taskId" desc="异步处理，监控可观测" />
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

function UploadDropZone({ dropRef, onDrop, onPick, busy }: any) {
  return (
    <div
      ref={dropRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className={`bg-white rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
        busy ? "border-jingtian bg-jingtian-soft" : "border-line hover:border-jingtian hover:bg-bg"
      }`}
    >
      {busy ? (
        <div className="flex flex-col items-center">
          <Loader2 className="w-12 h-12 text-jingtian animate-spin mb-4" />
          <p className="text-ink font-medium">AI 正在分析文件结构…</p>
          <p className="text-xs text-ink-soft mt-2">通常 1~3 秒</p>
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <Upload className="w-12 h-12 text-jingtian mb-4" />
          <p className="text-ink mb-2 font-medium">拖拽文件到此，或点击选择</p>
          <p className="text-sm text-ink-soft mb-4">支持 xlsx / xls / csv / pdf，最大 50MB</p>
          <label className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark cursor-pointer">
            <FileSpreadsheet className="w-4 h-4 inline mr-1" />
            选择文件
            <input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onPick} className="hidden" />
          </label>
        </div>
      )}
    </div>
  );
}

function AnalyzedCard({ state, rules, onChangeRule, onSubmit, onReset }: any) {
  if (state.phase !== "analyzed" && state.phase !== "submitting") return null;
  const { fileName, analysis, chosenRuleId } = state;
  const isExisting = chosenRuleId && !chosenRuleId.startsWith("new:");
  return (
    <div className="bg-white rounded-2xl border border-line p-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-5 h-5 text-jingtian" />
        <h2 className="text-lg font-bold text-ink">AI 识别结果</h2>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          analysis.source === "matched" ? "bg-green-100 text-green-700" :
          analysis.source === "local" ? "bg-amber-100 text-amber-700" :
          "bg-jingtian-soft text-jingtian-dark"
        }`}>
          {analysis.source === "matched" ? "命中已有规则" : analysis.source === "local" ? "本地兜底规则" : "AI 推断"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <Field label="文件名" value={fileName} />
        <Field label="文件类型" value={analysis.fileType?.toUpperCase() || "—"} />
        <Field label="建议规则名" value={analysis.name || "—"} />
        <Field label="置信度" value={analysis.confidence ? `${(analysis.confidence * 100).toFixed(0)}%` : "—"} />
      </div>

      <div className="mb-4">
        <label className="block text-xs font-semibold text-ink mb-1">使用规则</label>
        <div className="relative">
          <select
            value={chosenRuleId}
            onChange={(e) => onChangeRule(e.target.value)}
            disabled={state.phase === "submitting"}
            className="w-full appearance-none border border-line rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-jingtian"
          >
            <option value={`new:${analysis.name || "AI 推断规则"}`}>
              ✨ 使用 AI 推断的新规则（{analysis.name || "未命名"}）
            </option>
            {rules.map((r: RuleItem) => (
              <option key={r.id} value={r.id}>
                📋 {r.name}{r.name === analysis.name ? "（与 AI 推荐一致）" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 absolute right-2 top-3 text-ink-soft pointer-events-none" />
        </div>
        <p className="text-xs text-ink-soft mt-1">
          {isExisting
            ? "✓ 已选历史规则，提交时直接复用（不重复 AI 分析）"
            : "AI 推断的新规则会在第一次提交时自动写入规则库"}
        </p>
      </div>

      {/* 字段映射预览（可折叠） */}
      <details className="mb-4 text-sm">
        <summary className="cursor-pointer text-ink-soft flex items-center gap-1">
          <Eye className="w-3 h-3" /> 查看字段映射
        </summary>
        <pre className="mt-2 bg-bg rounded p-2 text-xs overflow-auto max-h-40">
{JSON.stringify(analysis.config?.fieldMappings || analysis.config || {}, null, 2)}
        </pre>
      </details>

      <div className="flex gap-3">
        <button
          onClick={onReset}
          disabled={state.phase === "submitting"}
          className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg text-sm disabled:opacity-50"
        >
          取消
        </button>
        <button
          onClick={onSubmit}
          disabled={state.phase === "submitting"}
          className="flex-1 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
        >
          {state.phase === "submitting" ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> 提交中…</>
          ) : (
            <><Zap className="w-4 h-4" /> 提交导入（≤1秒返回）</>
          )}
        </button>
      </div>
    </div>
  );
}

function DoneCard({ state, onView }: { state: any; onView: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-green-200 p-8 text-center">
      <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-3" />
      <h2 className="text-xl font-bold text-ink mb-2">任务已接收，异步处理中</h2>
      <div className="space-y-1.5 text-sm text-ink-soft mb-4">
        <div>任务ID：<span className="font-mono text-ink">{state.taskId.slice(0, 18)}…</span></div>
        <div>总行数：<span className="font-mono text-ink">{state.totalRows.toLocaleString()}</span></div>
        <div>处理单元：<span className="font-mono text-ink">{state.totalUnits}</span></div>
        <div>接收耗时：<span className="font-mono text-green-600 font-semibold">{state.acceptedInMs}ms</span>（要求 ≤1000ms）</div>
        {state.traceId && <div>TraceID：<span className="font-mono text-ink">{state.traceId.slice(0, 18)}…</span></div>}
      </div>
      <button onClick={onView} className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark">
        立即查看任务进度
      </button>
      <p className="text-xs text-ink-soft mt-3">1.2 秒后自动跳转</p>
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

function FlowStep({ n, icon, title, desc }: any) {
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
