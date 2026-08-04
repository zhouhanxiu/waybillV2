"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Loader2, Activity, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function MonitorV4Page() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/import-monitor/summary");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-jingtian" /></div>;
  if (!data) return <div className="text-center py-20 text-ink-soft">无数据</div>;

  const t = data.tasks || {};
  const p = data.performance || {};
  const totalRows = t.total_rows || 0;
  const okRate = totalRows ? Math.round(((t.success_rows || 0) / totalRows) * 100) : 0;
  const errRate = totalRows ? Math.round(((t.failed_rows || 0) / totalRows) * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-6 h-6 text-jingtian" />
          <h1 className="text-xl font-bold text-ink">V4 异步导入监控</h1>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-line text-sm text-ink-soft hover:bg-bg">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="任务总数" value={t.total_tasks ?? 0} icon={<Activity className="w-4 h-4" />} />
        <Card label="处理中" value={t.processing ?? 0} color="text-amber-600" icon={<Clock className="w-4 h-4" />} />
        <Card label="已完成" value={t.completed ?? 0} color="text-green-600" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Card label="失败" value={t.failed ?? 0} color="text-red-600" icon={<XCircle className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="总行数" value={totalRows} />
        <Card label="成功率" value={`${okRate}%`} color="text-green-600" />
        <Card label="错误率" value={`${errRate}%`} color="text-red-600" />
        <Card label="已处理单元" value={p.units ?? 0} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="平均耗时/单元" value={`${p.avg_ms ?? 0}ms`} />
        <Card label="P95 耗时" value={`${p.p95_ms ?? 0}ms`} />
        <Card label="最大耗时" value={`${p.max_ms ?? 0}ms`} />
        <Card label="累计处理行" value={p.rows_processed ?? 0} />
      </div>

      <div className="bg-white rounded-xl border border-line p-4 mb-6">
        <h2 className="font-bold text-ink mb-3">最近任务</h2>
        <table className="w-full text-sm">
          <thead className="bg-bg text-ink-soft"><tr>
            <th className="text-left px-4 py-2">文件</th>
            <th className="text-left px-4 py-2">状态</th>
            <th className="text-right px-4 py-2">总</th>
            <th className="text-right px-4 py-2">成功</th>
            <th className="text-right px-4 py-2">失败</th>
            <th className="text-left px-4 py-2">创建</th>
            <th className="px-4 py-2"></th>
          </tr></thead>
          <tbody>
            {(data.recent_tasks || []).map((r: any) => (
              <tr key={r.id} className="border-t border-line">
                <td className="px-4 py-2 truncate max-w-[180px] font-medium">{r.file_name}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.total_rows}</td>
                <td className="px-4 py-2 text-right tabular-nums text-green-600">{r.success_rows}</td>
                <td className="px-4 py-2 text-right tabular-nums text-red-600">{r.failed_rows}</td>
                <td className="px-4 py-2 text-ink-soft">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-right"><Link href={`/tasks/${r.id}`} className="text-jingtian hover:underline">详情</Link></td>
              </tr>
            ))}
            {(data.recent_tasks || []).length === 0 && <tr><td colSpan={7} className="text-center py-8 text-ink-soft">暂无任务</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded-xl border border-line p-4">
        <h2 className="font-bold text-ink mb-3">近 24h 吞吐（按小时）</h2>
        <div className="flex items-end gap-1 h-32">
          {(data.throughput_by_hour || []).map((h: any) => {
            const max = Math.max(...(data.throughput_by_hour || [{ rows: 1 }]).map((x: any) => x.rows || 1), 1);
            const h2 = Math.max(4, Math.round(((h.rows || 0) / max) * 120));
            return (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end">
                <div className="w-full bg-jingtian rounded-t" style={{ height: `${h2}px` }} title={`${h.hour}时: ${h.rows}行`}></div>
                <span className="text-[10px] text-ink-soft mt-1">{h.hour}</span>
              </div>
            );
          })}
          {(data.throughput_by_hour || []).length === 0 && <div className="text-ink-soft text-sm">暂无数据</div>}
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, color, icon }: { label: string; value: any; color?: string; icon?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4">
      <div className="flex items-center gap-2 text-ink-soft text-sm mb-1">{icon}{label}</div>
      <div className={`text-2xl font-bold ${color || "text-ink"}`}>{value}</div>
    </div>
  );
}
