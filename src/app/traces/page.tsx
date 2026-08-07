"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, GitBranch, Search, ArrowLeft, RefreshCw, Clock, ChevronRight } from "lucide-react";

function TracesInner() {
  const sp = useSearchParams();
  const router = useRouter();
  const [taskId, setTaskId] = useState(sp.get("taskId") || "");
  const [traceId, setTraceId] = useState("");
  const [errorCode, setErrorCode] = useState(sp.get("error_code") || "");
  const [traces, setTraces] = useState<any[]>([]);
  const [spans, setSpans] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);
  const [recentTasks, setRecentTasks] = useState<any[]>([]);

  // 进入页面：拉取最近 10 个任务（默认没有任何 taskId 时的引导）
  const loadRecentTasks = useCallback(async () => {
    try {
      const r = await fetch("/api/import-tasks?limit=10");
      if (r.ok) {
        const d = await r.json();
        setRecentTasks(d.tasks || []);
      }
    } catch {}
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    setSelectedTrace(null);
    setSpans([]);
    setTraces([]);
    setErrors([]);
    setSearched(true);
    try {
      // 智能路由：trace- 前缀自动转 traceId 框；task- 前缀强制为 taskId
      let qTaskId = taskId.trim();
      let qTraceId = traceId.trim();
      if (qTaskId.startsWith("trace-") && !qTraceId) {
        qTraceId = qTaskId; qTaskId = "";
        setTraceId(qTraceId); setTaskId("");
      } else if (qTraceId.startsWith("task-") && !qTaskId) {
        qTaskId = qTraceId; qTraceId = "";
        setTaskId(qTaskId); setTraceId("");
      }
      const params = new URLSearchParams();
      if (qTraceId) params.set("traceId", qTraceId);
      else if (errorCode) params.set("error_code", errorCode);
      else if (qTaskId) params.set("taskId", qTaskId);
      const res = await fetch(`/api/traces?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        if (qTraceId) setSpans(d.spans || []);
        else if (errorCode) setErrors(d.errors || []);
        else setTraces(d.traces || []);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, traceId, errorCode]);

  // 仅在挂载时根据 URL 参数决定初始态：URL 带 taskId → 自动查；否则显示最近任务
  useEffect(() => {
    const urlTaskId = sp.get("taskId");
    const urlErr = sp.get("error_code");
    if (urlTaskId) {
      setSearched(true);
      // 直接走 fetch，避免依赖 search()
      (async () => {
        setLoading(true);
        try {
          const r = await fetch(`/api/traces?taskId=${encodeURIComponent(urlTaskId)}`);
          if (r.ok) {
            const d = await r.json();
            setTraces(d.traces || []);
            setTaskId(urlTaskId);
          }
        } finally { setLoading(false); }
      })();
    } else if (urlErr) {
      setSearched(true);
      (async () => {
        setLoading(true);
        try {
          const r = await fetch(`/api/traces?error_code=${encodeURIComponent(urlErr)}`);
          if (r.ok) {
            const d = await r.json();
            setErrors(d.errors || []);
            setErrorCode(urlErr);
          }
        } finally { setLoading(false); }
      })();
    } else {
      loadRecentTasks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTask = (id: string) => {
    setTaskId(id);
    setTraceId("");
    setErrorCode("");
    setSearched(true);
    const u = new URLSearchParams();
    u.set("taskId", id);
    router.replace(`/traces?${u.toString()}`);
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/traces?taskId=${encodeURIComponent(id)}`);
        if (r.ok) {
          const d = await r.json();
          setTraces(d.traces || []);
        }
      } finally { setLoading(false); }
    })();
  };

  const openTrace = async (id: string) => {
    setSelectedTrace(id);
    setLoading(true);
    try {
      const res = await fetch(`/api/traces?traceId=${encodeURIComponent(id)}`);
      if (res.ok) { const d = await res.json(); setSpans(d.spans || []); }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-2 mb-6">
        <GitBranch className="w-6 h-6 text-jingtian" />
        <h1 className="text-xl font-bold text-ink">Trace 检索</h1>
        <button onClick={() => { if (taskId || errorCode) search(); else loadRecentTasks(); }} className="ml-auto p-2 rounded-lg hover:bg-bg text-ink-soft" title="刷新">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="bg-white rounded-xl border border-line p-4 mb-6 flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-ink-soft mb-1">任务 ID <span className="text-[10px] text-ink-soft/70">（task- 开头）</span></label>
          <input value={taskId} onChange={(e) => setTaskId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="如 task-1786073173201-av8mhd" className="w-full px-3 py-2 rounded-lg border border-line text-sm font-mono" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-ink-soft mb-1">Trace ID <span className="text-[10px] text-ink-soft/70">（trace- 开头）</span></label>
          <input value={traceId} onChange={(e) => setTraceId(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} placeholder="如 trace-1786086753374-xfbob87c1" className="w-full px-3 py-2 rounded-lg border border-line text-sm font-mono" />
        </div>
        <button onClick={search} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-jingtian text-white text-sm hover:bg-jingtian-dark">
          <Search className="w-4 h-4" /> 查询
        </button>
      </div>

      {loading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-jingtian" /></div>}

      {errorCode && !selectedTrace ? (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-line">
            <span className="font-mono text-sm font-semibold text-red-600">{errorCode}</span>
            <span className="text-sm text-ink-soft">错误明细（共 {errors.length} 条）</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">任务</th>
              <th className="text-right px-4 py-2">行号</th>
              <th className="text-left px-4 py-2">错误信息</th>
              <th className="text-left px-4 py-2">原始行(脱敏)</th>
              <th className="text-left px-4 py-2">时间</th>
            </tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id} className="border-t border-line hover:bg-bg">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/traces?taskId=${e.task_id}`} className="text-jingtian hover:underline">{e.task_id.slice(0, 8)}</Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.row_index}</td>
                  <td className="px-4 py-2 text-red-600 max-w-[260px] truncate" title={e.error_message}>{e.error_message}</td>
                  <td className="px-4 py-2 text-ink-soft max-w-[220px] truncate">{e.raw_row}</td>
                  <td className="px-4 py-2 text-ink-soft text-xs">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {errors.length === 0 && !loading && <tr><td colSpan={5} className="text-center py-8 text-ink-soft">该错误码暂无记录</td></tr>}
            </tbody>
          </table>
        </div>
      ) : selectedTrace ? (
        <div className="bg-white rounded-xl border border-line p-4">
          <button onClick={() => { setSelectedTrace(null); setSpans([]); if (taskId) search(); }} className="flex items-center gap-1 text-sm text-jingtian hover:underline mb-3">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h2 className="font-bold text-ink mb-3">Span 链路：{selectedTrace}</h2>
          <div className="space-y-2">
            {spans.map((s, i) => (
              <div key={s.id} className="flex items-start gap-3 p-3 rounded-lg bg-bg">
                <span className="text-xs text-ink-soft mt-0.5">{i + 1}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${s.level === 'ERROR' ? 'bg-red-100 text-red-700' : s.level === 'WARN' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{s.level}</span>
                    <span className="font-medium text-ink">{s.span_name}</span>
                    <span className="text-xs text-ink-soft">{s.service}</span>
                  </div>
                  <p className="text-xs text-ink-soft mt-1">{s.message}</p>
                  {s.duration_ms != null && <p className="text-xs text-ink-soft">耗时：{s.duration_ms}ms</p>}
                  <p className="text-[10px] text-ink-soft font-mono">{new Date(s.timestamp).toISOString()}</p>
                </div>
              </div>
            ))}
            {spans.length === 0 && <div className="text-ink-soft text-sm">无 span</div>}
          </div>
        </div>
      ) : traces.length > 0 ? (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-line">
            <span className="text-sm font-semibold">任务 <span className="font-mono text-jingtian">{taskId.slice(0, 16)}</span> 的 Trace 链路</span>
            <span className="text-sm text-ink-soft">（{traces.length} 条）</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">Trace ID</th>
              <th className="text-left px-4 py-2">根 Span</th>
              <th className="text-right px-4 py-2">Spans</th>
              <th className="text-left px-4 py-2">状态</th>
              <th className="text-left px-4 py-2">开始</th>
              <th className="px-4 py-2"></th>
            </tr></thead>
            <tbody>
              {traces.map((tr) => (
                <tr key={tr.trace_id} className="border-t border-line hover:bg-bg cursor-pointer" onClick={() => openTrace(tr.trace_id)}>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[160px]">{tr.trace_id}</td>
                  <td className="px-4 py-2 truncate max-w-[160px]">{tr.span_name}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{tr.spans}</td>
                  <td className="px-4 py-2">
                    {tr.has_error ? <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">有错误</span>
                      : <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">正常</span>}
                  </td>
                  <td className="px-4 py-2 text-ink-soft text-xs">{new Date(tr.start_ts).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right text-jingtian">查看</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : searched ? (
        <div className="bg-white rounded-xl border border-line p-10 text-center">
          <div className="text-ink-soft text-sm">未找到匹配的 Trace</div>
          <div className="text-xs text-ink-soft mt-2">
            {taskId && <span>任务 ID：<span className="font-mono">{taskId}</span> 不存在或没有 trace 记录。</span>}
            {traceId && <span>Trace ID：<span className="font-mono">{traceId}</span> 不存在。</span>}
            {errorCode && <span>错误码：<span className="font-mono">{errorCode}</span> 暂无错误记录。</span>}
          </div>
          <button onClick={loadRecentTasks} className="mt-4 text-sm text-jingtian hover:underline">返回最近任务列表</button>
        </div>
      ) : (
        // 默认状态：显示最近 10 个任务，点一个进入该任务的 trace 列表
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <div className="px-4 py-3 flex items-center gap-2 border-b border-line">
            <Clock className="w-4 h-4 text-ink-soft" />
            <span className="text-sm font-semibold">最近导入任务</span>
            <span className="text-sm text-ink-soft">（点击查看该任务的 trace 链路）</span>
          </div>
          {recentTasks.length === 0 ? (
            <div className="text-center py-12 text-ink-soft text-sm">
              暂无任务。请先到 <Link href="/" className="text-jingtian underline">V4 智能导入</Link> 上传文件。
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-bg text-ink-soft"><tr>
                <th className="text-left px-4 py-2">任务 ID</th>
                <th className="text-left px-4 py-2">文件名</th>
                <th className="text-left px-4 py-2">状态</th>
                <th className="text-right px-4 py-2">总行数</th>
                <th className="text-right px-4 py-2">成功</th>
                <th className="text-right px-4 py-2">失败</th>
                <th className="text-left px-4 py-2">开始</th>
                <th className="px-4 py-2"></th>
              </tr></thead>
              <tbody>
                {recentTasks.map((t) => (
                  <tr key={t.id} className="border-t border-line hover:bg-bg cursor-pointer" onClick={() => openTask(t.id)}>
                    <td className="px-4 py-2 font-mono text-xs">{t.id.slice(0, 16)}…</td>
                    <td className="px-4 py-2 max-w-[220px] truncate">{t.file_name}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        t.status === 'completed' ? 'bg-green-100 text-green-700' :
                        t.status === 'failed' ? 'bg-red-100 text-red-700' :
                        t.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{t.total_rows?.toLocaleString() || 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-600">{t.success_rows?.toLocaleString() || 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-600">{t.error_rows?.toLocaleString() || 0}</td>
                    <td className="px-4 py-2 text-ink-soft text-xs">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right text-jingtian"><ChevronRight className="w-4 h-4" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default function TracesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-jingtian" /></div>}>
      <TracesInner />
    </Suspense>
  );
}
