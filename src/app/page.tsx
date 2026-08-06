"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Upload, Loader2, CheckCircle2, FileSpreadsheet, Sparkles, Zap,
  AlertTriangle, ChevronDown, Cpu, BookOpen, Eye, X
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

export default function ImportV4Page() {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "analyzing" | "analyzed" | "submitting" | "done">("idle");
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chosenRuleId, setChosenRuleId] = useState<string>("");
  const [rules, setRules] = useState<RuleItem[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ taskId: string; totalRows: number; totalUnits: number; traceId: string; acceptedInMs: number } | null>(null);
  const [showRuleSelector, setShowRuleSelector] = useState(false);
  const [presetRuleId, setPresetRuleId] = useState<string>("");
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 启动时拉取所有已有规则
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // 上传文件 → AI 自动分析
  const handleFile = useCallback(async (f: File) => {
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

  const onDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (phase === "analyzing" || phase === "submitting") return;
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const onPick: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  // 直接导入：上传文件 + 已有 ruleId，跳过 AI 直接提交
  const handleDirectFile = useCallback(async (f: File, ruleId: string) => {
    if (!ruleId) {
      setErr("请先选择规则");
      return;
    }
    setErr(null);
    setFile(f);
    setFileName(f.name);
    setChosenRuleId(ruleId);
    // 跳过 AI 分析，直接进入 analyzed 阶段，让用户确认后提交
    setAnalysis(null);
    setPhase("analyzed");
  }, []);

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
      } else if (chosenRuleId?.startsWith("new:") && analysis?.config) {
        // 第一次提交"AI 推断的新规则"时，连同规则配置一起发给后端，
        // 后端会在 import_rules 表里落库（替代旧的"永不入库"问题）
        try {
          fd.append(
            "newRule",
            JSON.stringify({
              name: analysis.name || "AI 推断规则",
              description: `AI 自动推断 · 置信度 ${analysis.confidence ?? "—"} · ${analysis.source}`,
              fileType: analysis.fileType,
              config: analysis.config,
            })
          );
        } catch { /* 序列化失败时静默，后端会回落到 defaultRule */ }
      }
      // 90秒超时（Vercel Serverless 冷启动可能慢，但最多 60s，超时给更宽容的边界）
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 90000);
      let res: Response;
      try {
        res = await fetch("/api/import-tasks", { method: "POST", body: fd, signal: ctrl.signal });
      } finally {
        clearTimeout(timeout);
      }
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
      if (e?.name === "AbortError") {
        setErr("请求超时（>90秒）。服务器可能正在冷启动，请稍后到「导入任务」查看是否已创建。");
      } else {
        setErr(e?.message || "提交失败");
      }
      setPhase("analyzed");
    }
  }, [file, chosenRuleId, router]);

  // 是否选了已有规则（非 AI 新规则）
  const isExistingRule = chosenRuleId && !chosenRuleId.startsWith("new:");

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-2">
        <Zap className="w-6 h-6 text-jingtian" />
        <h1 className="text-2xl font-bold text-ink">V4 智能导入（AI 识别 · 选已有规则跳过 · ≤1秒返回）</h1>
      </div>
      <p className="text-sm text-ink-soft mb-6">
        上传文件 → AI 自动识别列结构 → 可选已有规则（跳过AI）→ 提交后 ≤1秒拿到 taskId，后台异步处理
      </p>

      {/* 错误提示 */}
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

      {/* ---- 提交成功 ---- */}
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
        /* ---- 分析结果 + 规则选择 + 提交 ---- */
        <div className="bg-white rounded-2xl border border-line p-6">
          {/* 标题行 */}
          <div className="flex items-center gap-2 mb-3">
            {analysis ? (
              <>
                <Sparkles className="w-5 h-5 text-jingtian" />
                <h2 className="text-lg font-bold text-ink">AI 识别结果</h2>
                {isExistingRule ? (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                    已选已有规则 · 跳过 AI
                  </span>
                ) : (
                  <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
                    analysis?.source === "matched" ? "bg-green-100 text-green-700" :
                    analysis?.source === "local" ? "bg-amber-100 text-amber-700" :
                    "bg-jingtian-soft text-jingtian-dark"
                  }`}>
                    {analysis?.source === "matched" ? "命中已有规则" : analysis?.source === "local" ? "本地兜底规则" : "AI 推断"}
                  </span>
                )}
              </>
            ) : (
              <>
                <BookOpen className="w-5 h-5 text-amber-500" />
                <h2 className="text-lg font-bold text-ink">直接导入</h2>
                <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                  跳过 AI 分析
                </span>
              </>
            )}
          </div>

          {/* 文件信息（直接导入模式不显示 AI 推荐信息） */}
          <div className={`grid ${analysis ? "grid-cols-2" : "grid-cols-1"} gap-3 mb-4`}>
            <Field label="文件名" value={fileName} />
            {analysis ? (
              <>
                <Field label="文件类型" value={(analysis.fileType || "—").toString().toUpperCase()} />
                <Field label="建议规则名" value={analysis.name || "—"} />
                <Field label="置信度" value={analysis.confidence ? `${(analysis.confidence * 100).toFixed(0)}%` : "—"} />
              </>
            ) : (
              <Field label="选定规则" value={rules.find(r => r.id === chosenRuleId)?.name || "—"} />
            )}
          </div>

          {/* 规则选择下拉框 */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-ink mb-1">
              使用规则
            </label>
            <div className="relative">
              <select
                value={chosenRuleId}
                onChange={(e) => setChosenRuleId(e.target.value)}
                disabled={phase === "submitting"}
                className="w-full appearance-none border border-line rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-jingtian"
              >
                {analysis ? (
                  <>
                    <option value={`new:${analysis.name || "新规则"}`}>
                      ✨ AI 推断的新规则（{analysis.name || "未命名"}）
                    </option>
                    <option disabled>──────────────</option>
                  </>
                ) : null}
                {rules.map((r) => (
                  <option key={r.id} value={r.id}>
                    📋 {r.name}{analysis && r.name === analysis.name ? " （与 AI 推荐一致）" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 absolute right-2 top-3 text-ink-soft pointer-events-none" />
            </div>
            <p className="text-xs text-ink-soft mt-1">
              {isExistingRule
                ? "✅ 已选已有规则，提交时直接复用，无需重复 AI 分析"
                : "AI 推断的新规则会在第一次提交时自动写入规则库"}
            </p>
          </div>

          {/* 字段映射预览（仅 AI 新规则时显示） */}
          {analysis && !isExistingRule && analysis?.config && (
            <details className="mb-4 text-sm">
              <summary className="cursor-pointer text-ink-soft flex items-center gap-1">
                <Eye className="w-3 h-3" /> 查看 AI 推断的字段映射
              </summary>
              <pre className="mt-2 bg-bg rounded p-2 text-xs overflow-auto max-h-40">
{JSON.stringify(analysis?.config?.fieldMappings || analysis?.config || {}, null, 2)}
              </pre>
            </details>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-3">
            <button
              onClick={reset}
              disabled={phase === "submitting"}
              type="button"
              className="flex-1 py-2.5 rounded-xl border border-line text-ink-soft hover:bg-bg text-sm disabled:opacity-50"
            >
              重新选择文件
            </button>
            <button
              onClick={submitImport}
              disabled={phase === "submitting"}
              type="button"
              className="flex-1 py-2.5 rounded-xl bg-jingtian text-white font-medium hover:bg-jingtian-dark disabled:opacity-50 flex items-center justify-center gap-1 text-sm"
            >
              {phase === "submitting" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> 提交中…</>
              ) : isExistingRule ? (
                <><Zap className="w-4 h-4" /> 直接导入（≤1秒返回）</>
              ) : (
                <><Sparkles className="w-4 h-4" /> 使用 AI 规则导入（≤1秒返回）</>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* ---- 入口区：先选规则 或 直接上传 ---- */
        <div className="space-y-4">
          {/* 选项卡：先选已有规则 / AI 智能识别 */}
          <div className="flex gap-2">
            <button
              onClick={() => setShowRuleSelector(true)}
              type="button"
              className="flex-1 py-3 rounded-xl border border-line bg-white hover:bg-bg text-left px-4 transition-colors"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-jingtian" />
                <div>
                  <div className="font-semibold text-ink text-sm">先选已有规则</div>
                  <div className="text-xs text-ink-soft">跳过 AI，直接导入 ≤1秒</div>
                </div>
              </div>
            </button>
            <button
              onClick={() => setShowRuleSelector(false)}
              type="button"
              className="flex-1 py-3 rounded-xl border border-line bg-white hover:bg-bg text-left px-4 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-jingtian" />
                <div>
                  <div className="font-semibold text-ink text-sm">AI 智能识别</div>
                  <div className="text-xs text-ink-soft">上传后自动分析</div>
                </div>
              </div>
            </button>
          </div>

          {/* 模式 A：先选规则 */}
          {showRuleSelector ? (
            <div className="bg-white rounded-2xl border border-line p-6">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-5 h-5 text-jingtian" />
                <h2 className="text-lg font-bold text-ink">先选已有规则（跳过 AI）</h2>
              </div>
              <p className="text-sm text-ink-soft mb-4">选好规则后上传文件，提交将直接走该规则，≤1秒返回 taskId</p>

              <label className="block text-xs font-semibold text-ink mb-1">选择规则</label>
              <div className="relative mb-3">
                <select
                  value={presetRuleId}
                  onChange={(e) => setPresetRuleId(e.target.value)}
                  className="w-full appearance-none border border-line rounded-lg px-3 py-2 pr-8 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-jingtian"
                >
                  <option value="">-- 请选择已有规则 --</option>
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      📋 {r.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 absolute right-2 top-3 text-ink-soft pointer-events-none" />
              </div>

              {presetRuleId && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 mb-4">
                  ✅ 已选规则：<span className="font-mono">{rules.find(r => r.id === presetRuleId)?.name}</span>
                </div>
              )}

              <label className={`w-full block px-5 py-3 rounded-xl text-center text-sm font-medium transition-colors ${
                presetRuleId
                  ? "bg-jingtian text-white hover:bg-jingtian-dark cursor-pointer"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}>
                <Upload className="w-4 h-4 inline mr-1" />
                {presetRuleId ? "选择文件并直接导入（≤1秒）" : "请先选择规则"}
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f && presetRuleId) {
                      handleDirectFile(f, presetRuleId);
                    }
                  }}
                  disabled={!presetRuleId}
                  className="hidden"
                />
              </label>
            </div>
          ) : (
            /* 模式 B：上传触发 AI */
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
                  <p className="text-sm text-ink-soft mb-1">上传后 AI 自动识别，下拉框可切换已有规则</p>
                  <p className="text-sm text-ink-soft mb-4">支持 xlsx / xls / csv / pdf，最大 50MB</p>
                  <label className="px-5 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark cursor-pointer">
                    <FileSpreadsheet className="w-4 h-4 inline mr-1" />
                    选择文件
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={onPick} className="hidden" />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 流程说明 */}
      <div className="grid md:grid-cols-4 gap-4 mt-6">
        <StepCard num={1} icon={<Upload className="w-4 h-4" />} title="上传文件" desc="xlsx / xls / csv / pdf" />
        <StepCard num={2} icon={<Cpu className="w-4 h-4" />} title="AI 智能识别" desc="自动推断列结构" />
        <StepCard num={3} icon={<BookOpen className="w-4 h-4" />} title="选已有规则" desc="下拉选已有规则，跳过 AI" />
        <StepCard num={4} icon={<Zap className="w-4 h-4" />} title="≤1秒返回" desc="拿到 taskId，异步处理" />
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 mt-6">
        <div className="font-semibold mb-1">提交后您可以：</div>
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

function StepCard({ num, icon, title, desc }: { num: number; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-jingtian-soft text-jingtian-dark flex items-center justify-center font-semibold text-sm shrink-0">{num}</div>
      <div className="flex-1">
        <div className="flex items-center gap-1 font-semibold text-ink text-sm">{icon}{title}</div>
        <div className="text-xs text-ink-soft mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
