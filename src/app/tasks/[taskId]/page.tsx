"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertCircle, CheckCircle2, Layers, GitBranch, RefreshCw } from "lucide-react";

type Summary = {
  total_rows: number;
  success_rows: number;
  failed_rows: number;
  processed_rows: number;
  error_records: number;
  by_status: Record<string, any>;
  perf: any;
};

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.taskId as string;
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<"batches" | "errors">("batches");
  const [batches, setBatches] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);
  const [errTotal, setErrTotal] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/import-tasks/${taskId}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const loadBatches = useCallback(async () => {
    const res = await fetch(`/api/import-tasks/${taskId}/batches?pageSize=50`);
    if (res.ok) { const d = await res.json(); setBatches(d.batches); }
  }, [taskId]);

  const loadErrors = useCallback(async () => {
    const res = await fetch(`/api/import-tasks/${taskId}/errors?pageSize=50`);
    if (res.ok) { const d = await res.json(); setErrors(d.errors); setErrTotal(d.total); }
  }, [taskId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (tab === "batches") loadBatches();
    else loadErrors();
  }, [tab, loadBatches, loadErrors]);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-jingtian" /></div>;
  }
  if (!data) return <div className="text-center py-20 text-ink-soft">任务不存在</div>;

  const s: Summary = data.summary;
  const task = data.task;
  const pct = s.total_rows ? Math.round((s.processed_rows / s.total_rows) * 100) : 0;
  const okPct = s.total_rows ? Math.round((s.success_rows / s.total_rows) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link href="/tasks" className="text-sm text-jingtian hover:underline">← 返回任务列表</Link>
          <h1 className="text-xl font-bold text-ink mt-1 truncate">{task.file_name}</h1>
          <p className="text-xs text-ink-soft font-mono mt-1">{taskId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/traces?taskId=${taskId}`} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-line text-sm text-ink-soft hover:bg-bg">
            <GitBranch className="w-4 h-4" /> Trace
          </Link>
          <button onClick={load} className="flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-line text-sm text-ink-soft hover:bg-bg">
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
        </div>
      </div>

      {/* 进度卡 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="总进度" value={`${pct}%`} icon={<Layers className="w-4 h-4" />} />
        <Stat label="成功行" value={`${s.success_rows}`} sub={`${okPct}%`} color="text-green-600" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Stat label="失败行" value={`${s.failed_rows}`} color="text-red-600" icon={<AlertCircle className="w-4 h-4" />} />
        <Stat label="错误明细" value={`${s.error_records}`} color="text-amber-600" icon={<AlertCircle className="w-4 h-4" />} />
      </div>

      {/* 进度条 */}
      <div className="bg-white rounded-xl border border-line p-4 mb-6">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-ink-soft">处理进度（{s.processed_rows}/{s.total_rows}）</span>
          <span className="font-medium text-ink">{pct}%</span>
        </div>
        <div className="w-full h-2.5 bg-bg rounded-full overflow-hidden">
          <div className="h-full bg-jingtian transition-all" style={{ width: `${pct}%` }}></div>
        </div>
        {s.perf && (
          <div className="mt-3 text-xs text-ink-soft grid grid-cols-2 md:grid-cols-4 gap-2">
            <span>单元数：{s.perf.units}</span>
            <span>平均耗时：{s.perf.avg_ms}ms</span>
            <span>P95：{s.perf.p95_ms ?? s.perf.max_ms}ms</span>
            <span>最大：{s.perf.max_ms}ms</span>
          </div>
        )}
      </div>

      {/* Tab */}
      <div className="flex gap-1 mb-4 border-b border-line">
        <button
          onClick={() => setTab("batches")}
          className={`px-4 py-2 text-sm font-medium ${tab === "batches" ? "text-jingtian border-b-2 border-jingtian" : "text-ink-soft"}`}
        >单元列表</button>
        <button
          onClick={() => setTab("errors")}
          className={`px-4 py-2 text-sm font-medium ${tab === "errors" ? "text-jingtian border-b-2 border-jingtian" : "text-ink-soft"}`}
        >错误明细 ({errTotal})</button>
      </div>

      {tab === "batches" ? (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">#</th>
              <th className="text-left px-4 py-2">状态</th>
              <th className="text-right px-4 py-2">行数</th>
              <th className="text-right px-4 py-2">成功</th>
              <th className="text-right px-4 py-2">失败</th>
              <th className="text-right px-4 py-2">重试</th>
            </tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-line">
                  <td className="px-4 py-2">{b.unit_index}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${b.status === 'completed' ? 'bg-green-100 text-green-700' : b.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{b.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.total_rows}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-green-600">{b.success_rows}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600">{b.failed_rows}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.attempt}</td>
                </tr>
              ))}
              {batches.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-ink-soft">暂无单元</td></tr>}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">行</th>
              <th className="text-left px-4 py-2">级别</th>
              <th className="text-left px-4 py-2">错误码</th>
              <th className="text-left px-4 py-2">消息</th>
              <th className="text-left px-4 py-2">收件人</th>
              <th className="text-left px-4 py-2">电话</th>
            </tr></thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="px-4 py-2 tabular-nums">{e.row_number}</td>
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${e.level === 'ERROR' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{e.level}</span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs">{e.error_code}</td>
                  <td className="px-4 py-2 max-w-[280px] truncate" title={e.error_message}>{e.error_message}</td>
                  <td className="px-4 py-2">{e.receiver_name || '-'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{e.receiver_phone_masked || '-'}</td>
                </tr>
              ))}
              {errors.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-ink-soft">无错误记录</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color?: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-center gap-2 text-ink-soft text-sm mb-1">{icon}{label}</div>
      <div className={`text-2xl font-bold ${color || "text-ink"}`}>{value}{sub && <span className="text-sm font-normal ml-1 text-ink-soft">{sub}</span>}</div>
    </div>
  );
}
