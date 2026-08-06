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
    try {
      const params = new URLSearchParams();
      if (traceId) params.set("traceId", traceId);
      else if (errorCode) params.set("error_code", errorCode);
      else if (taskId) params.set("taskId", taskId);
      const res = await fetch(`/api/traces?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        if (traceId) setSpans(d.spans || []);
        else if (errorCode) setErrors(d.errors || []);
        else setTraces(d.traces || []);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, traceId, errorCode]);

  useEffect(() => {
    if (taskId || errorCode) search();
    else loadRecentTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openTask = (id: string) => {
    setTaskId(id);
    setTraceId("");
    setErrorCode("");
    const u = new URLSearchParams();
    u.set("taskId", id);
    router.replace(`/traces?${u.toString()}`);
  };

  const openTrace = async (id: string) => {
    setSelectedTrace(id);
    setLoading(true);
    try {
      const res = await fetch(`/api/traces?traceId=${id}`);
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
          <label className="block text-xs text-ink-soft mb-1">任务 ID</label>
          <input value={taskId} onChange={(e) => setTaskId(e.target.value)} placeholder="按任务列出 trace" className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-ink-soft mb-1">Trace ID</label>
          <input value={traceId} onChange={(e) => setTraceId(e.target.value)} placeholder="精确查看 span 链路" className="w-full px-3 py-2 rounded-lg border border-line text-sm" />
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
