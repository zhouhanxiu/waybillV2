"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, GitBranch, Search, ArrowLeft } from "lucide-react";

function TracesInner() {
  const sp = useSearchParams();
  const [taskId, setTaskId] = useState(sp.get("taskId") || "");
  const [traceId, setTraceId] = useState("");
  const [traces, setTraces] = useState<any[]>([]);
  const [spans, setSpans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<string | null>(null);

  const search = useCallback(async () => {
    setLoading(true);
    setSelectedTrace(null);
    setSpans([]);
    try {
      const params = new URLSearchParams();
      if (traceId) params.set("traceId", traceId);
      else if (taskId) params.set("taskId", taskId);
      const res = await fetch(`/api/traces?${params.toString()}`);
      if (res.ok) {
        const d = await res.json();
        if (traceId) setSpans(d.spans || []);
        else setTraces(d.traces || []);
      }
    } finally {
      setLoading(false);
    }
  }, [taskId, traceId]);

  useEffect(() => {
    if (taskId) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      {selectedTrace ? (
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
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
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
              {traces.length === 0 && !loading && <tr><td colSpan={6} className="text-center py-8 text-ink-soft">按任务 ID 或 Trace ID 查询</td></tr>}
            </tbody>
          </table>
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
