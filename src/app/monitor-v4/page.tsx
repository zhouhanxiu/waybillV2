"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Loader2, Activity, RefreshCw, CheckCircle2, XCircle, Clock, AlertTriangle, Gauge, ListTree, BarChart3 } from "lucide-react";

// 阶段中文映射（考试模块八：解析/规则/校验/写入）
const PHASE_LABELS: Record<string, string> = {
  parse: "文件解析",
  parse_read: "解析-读表",
  rule: "规则引擎",
  sku_validate: "数据校验",
  db_upsert: "批量写库",
};
const PHASE_ORDER = ["parse", "parse_read", "rule", "sku_validate", "db_upsert"];

const ERROR_LABELS: Record<string, string> = {
  E001: "SKU不存在",
  E002: "必填缺失",
  E003: "电话格式",
  E004: "数量非正",
  E005: "外部编码重复",
  E006: "规则映射失败",
  E007: "数据库写入失败",
  E008: "文件格式不支持",
};

export default function MonitorV4Page() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [phase, setPhase] = useState<any>(null);
  const [tab, setTab] = useState<"overview" | "phase" | "queue" | "errors" | "slow">("phase");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/import-monitor/summary").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/import-monitor/phase").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (r1) setData(r1);
      if (r2) setPhase(r2);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const hasData = !!(data || phase);
  const t = data?.tasks || {};
  const p = data?.performance || {};
  const totalRows = t.total_rows || 0;
  const okRate = totalRows ? Math.round(((t.success_rows || 0) / totalRows) * 100) : 0;
  const errRate = totalRows ? Math.round(((t.error_rows || 0) / totalRows) * 100) : 0;

  const backlog = phase?.backlog || {};
  const pendingRows = (backlog.batches_pending || 0) * 1000; // 估算积压行数
  const queueDanger = pendingRows >= 5000; // 模块八阈值

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Activity className="w-6 h-6 text-jingtian" />
          <h1 className="text-xl font-bold text-ink">V4 异步导入监控看板</h1>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-line text-sm text-ink-soft hover:bg-bg">
          <RefreshCw className="w-4 h-4" /> 刷新
        </button>
      </div>

      {/* 总览卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="任务总数" value={t.total_tasks ?? 0} icon={<Activity className="w-4 h-4" />} />
        <Card label="处理中" value={t.processing ?? 0} color="text-amber-600" icon={<Clock className="w-4 h-4" />} />
        <Card label="已完成" value={t.completed ?? 0} color="text-green-600" icon={<CheckCircle2 className="w-4 h-4" />} />
        <Card label="失败" value={t.failed ?? 0} color="text-red-600" icon={<XCircle className="w-4 h-4" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card label="成功率" value={`${okRate}%`} color="text-green-600" />
        <Card label="错误率" value={`${errRate}%`} color="text-red-600" />
        <Card label="已处理单元" value={p.units ?? 0} />
        <Card label="累计处理行" value={p.rows_processed ?? 0} />
      </div>

      {loading && (
        <div className="flex items-center gap-2 mb-4 text-sm text-ink-soft">
          <Loader2 className="w-4 h-4 animate-spin text-jingtian" /> 加载中…
        </div>
      )}
      {!loading && !hasData && (
        <div className="mb-4 rounded-lg border border-dashed border-line bg-bg/50 px-4 py-3 text-sm text-ink-soft">
          暂无监控数据。请先上传 Excel 运行一次导入任务，QStash 队列消费完成后此处会展示实时指标。
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex gap-2 mb-4 border-b border-line flex-wrap">
        <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} icon={<Gauge className="w-4 h-4" />} label="概览" />
        <TabBtn active={tab === "phase"} onClick={() => setTab("phase")} icon={<BarChart3 className="w-4 h-4" />} label="阶段耗时" />
        <TabBtn active={tab === "queue"} onClick={() => setTab("queue")} icon={<ListTree className="w-4 h-4" />} label="队列积压" />
        <TabBtn active={tab === "errors"} onClick={() => setTab("errors")} icon={<AlertTriangle className="w-4 h-4" />} label="错误分布" />
        <TabBtn active={tab === "slow"} onClick={() => setTab("slow")} icon={<Clock className="w-4 h-4" />} label="慢批次TOP10" />
      </div>

      {tab === "overview" && (
        <>
          {/* 区域1：实时吞吐量（过去5分钟每分钟） */}
          <Section title="实时吞吐量（过去 5 分钟每分钟成功入库行数）" icon={<Activity className="w-4 h-4" />}>
            {((phase?.throughput_5m || []) as any[]).length > 0 ? (
              <div className="flex items-end gap-2 h-36">
                {(phase.throughput_5m as any[]).map((m: any) => {
                  const max = Math.max(...(phase.throughput_5m as any[]).map((x: any) => x.rows || 1), 1);
                  const h2 = Math.max(4, Math.round(((m.rows || 0) / max) * 130));
                  return (
                    <div key={m.minute} className="flex-1 flex flex-col items-center justify-end">
                      <div className="w-full bg-jingtian rounded-t" style={{ height: `${h2}px` }} title={`${m.minute}: ${m.rows}行`}></div>
                      <span className="text-[10px] text-ink-soft mt-1">{m.minute}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-36 flex items-center justify-center text-ink-soft text-sm">
                暂无近期吞吐量数据，请先上传文件触发导入
              </div>
            )}
            <div className="flex gap-4 mt-3 text-sm text-ink-soft">
              <span>5min: {phase?.throughput?.rows_5m ?? 0} 行</span>
              <span>15min: {phase?.throughput?.rows_15m ?? 0} 行</span>
              <span>60min: {phase?.throughput?.rows_60m ?? 0} 行</span>
              <span>5min新增任务: {phase?.throughput?.tasks_5m ?? 0}</span>
            </div>
          </Section>

          {/* 最近任务 */}
          <Section title="最近任务" icon={<Clock className="w-4 h-4" />}>
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
                {(data?.recent_tasks || []).map((r: any) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="px-4 py-2 truncate max-w-[180px] font-medium">{r.file_name}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${r.status === 'completed' ? 'bg-green-100 text-green-700' : r.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.total_rows}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-green-600">{r.success_rows}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-600">{r.error_rows}</td>
                    <td className="px-4 py-2 text-ink-soft">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="px-4 py-2 text-right"><Link href={`/tasks/${r.id}`} className="text-jingtian hover:underline">详情</Link></td>
                  </tr>
                ))}
                {(data?.recent_tasks || []).length === 0 && <tr><td colSpan={7} className="text-center py-8 text-ink-soft">暂无任务</td></tr>}
              </tbody>
            </table>
          </Section>
        </>
      )}

      {tab === "phase" && (
        <Section title="阶段耗时分布（P50 / P95 / P99，单位 ms）" icon={<BarChart3 className="w-4 h-4" />}>
          <p className="text-xs text-ink-soft mb-3">用于判断瓶颈在文件解析、规则引擎、数据库校验还是写入。数据来自 batch_performance_log。</p>
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">阶段</th>
              <th className="text-right px-4 py-2">样本</th>
              <th className="text-right px-4 py-2">总行数</th>
              <th className="text-right px-4 py-2">最小</th>
              <th className="text-right px-4 py-2">平均</th>
              <th className="text-right px-4 py-2">P50</th>
              <th className="text-right px-4 py-2">P95</th>
              <th className="text-right px-4 py-2">P99</th>
              <th className="text-right px-4 py-2">最大</th>
            </tr></thead>
            <tbody>
              {((phase?.phase_stats || phase?.phases || []) as any[])
                .filter((x: any) => PHASE_ORDER.includes(x.phase))
                .sort((a: any, b: any) => PHASE_ORDER.indexOf(a.phase) - PHASE_ORDER.indexOf(b.phase))
                .map((s: any) => (
                  <tr key={s.phase} className="border-t border-line">
                    <td className="px-4 py-2 font-medium">{PHASE_LABELS[s.phase] || s.phase}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.samples}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.total_rows ?? s.totalRows ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.min_ms ?? s.min ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.avg_ms ?? s.avg ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-jingtian font-semibold">{s.p50_ms ?? s.p50 ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600">{s.p95_ms ?? s.p95 ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-red-600">{s.p99_ms ?? s.p99 ?? 0}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.max_ms ?? s.max ?? 0}</td>
                  </tr>
                ))}
              {((phase?.phase_stats || phase?.phases || []) as any[]).length === 0 && <tr><td colSpan={9} className="text-center py-8 text-ink-soft">暂无阶段耗时数据，请先上传文件触发导入</td></tr>}
            </tbody>
          </table>
        </Section>
      )}

      {tab === "queue" && (
        <Section title="队列积压深度" icon={<ListTree className="w-4 h-4" />}>
          {queueDanger && (
            <div className="mb-3 px-3 py-2 rounded-lg bg-amber-100 text-amber-800 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> 积压超过 5000 行阈值，请关注 Worker 消费速度
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <BacklogCard label="Outbox 待投递" value={backlog.outbox_pending ?? 0} danger={(backlog.outbox_pending ?? 0) > 100} />
            <BacklogCard label="Outbox 已失败" value={backlog.outbox_failed ?? 0} danger={(backlog.outbox_failed ?? 0) > 0} />
            <BacklogCard label="批次待处理" value={backlog.batches_pending ?? 0} danger={queueDanger} />
            <BacklogCard label="批次处理中" value={backlog.batches_processing ?? 0} />
            <BacklogCard label="批次失败" value={backlog.batches_failed ?? 0} danger={(backlog.batches_failed ?? 0) > 0} />
            <BacklogCard label="批次完成" value={backlog.batches_done ?? 0} color="text-green-600" />
            <BacklogCard label="Outbox 已发送" value={backlog.outbox_sent ?? 0} color="text-green-600" />
          </div>
        </Section>
      )}

      {tab === "errors" && (
        <Section title="错误类型分布（点击查看明细）" icon={<AlertTriangle className="w-4 h-4" />}>
          <div className="flex flex-col gap-2">
            {(phase?.error_codes || []).map((e: any) => {
              const total = (phase.error_codes || []).reduce((s: number, x: any) => s + x.cnt, 0) || 1;
              const pct = Math.round((e.cnt / total) * 100);
              return (
                <Link key={e.error_code} href={`/traces?error_code=${e.error_code}`} className="flex items-center gap-3 hover:bg-bg p-2 rounded-lg">
                  <span className="w-24 font-mono text-sm font-semibold">{e.error_code}</span>
                  <span className="w-20 text-xs text-ink-soft">{ERROR_LABELS[e.error_code] || ""}</span>
                  <div className="flex-1 h-4 bg-bg rounded overflow-hidden">
                    <div className="h-full bg-red-400" style={{ width: `${pct}%` }}></div>
                  </div>
                  <span className="w-16 text-right tabular-nums text-sm">{e.cnt} ({pct}%)</span>
                </Link>
              );
            })}
            {(phase?.error_codes || []).length === 0 && <div className="text-ink-soft text-sm py-6 text-center">暂无错误记录</div>}
          </div>
        </Section>
      )}

      {tab === "slow" && (
        <Section title="慢批次 TOP 10（按单元整体耗时降序）" icon={<Clock className="w-4 h-4" />}>
          <table className="w-full text-sm">
            <thead className="bg-bg text-ink-soft"><tr>
              <th className="text-left px-4 py-2">单元ID</th>
              <th className="text-left px-4 py-2">任务</th>
              <th className="text-right px-4 py-2">批次序</th>
              <th className="text-right px-4 py-2">行数</th>
              <th className="text-right px-4 py-2">耗时(ms)</th>
              <th className="text-left px-4 py-2">状态</th>
            </tr></thead>
            <tbody>
              {(phase?.slow_batches || []).map((b: any) => (
                <tr key={b.unit_id} className="border-t border-line">
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[160px]"><Link href={`/tasks/${b.task_id}`} className="text-jingtian hover:underline">{b.unit_id}</Link></td>
                  <td className="px-4 py-2 font-mono text-xs truncate max-w-[120px]">{b.task_id}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.unit_index}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{b.rows_processed_total}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-600 font-semibold">{b.duration_ms}</td>
                  <td className="px-4 py-2"><span className={`px-2 py-0.5 rounded-full text-xs ${b.status === 'done' ? 'bg-green-100 text-green-700' : b.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{b.status}</span></td>
                </tr>
              ))}
              {(phase?.slow_batches || []).length === 0 && <tr><td colSpan={6} className="text-center py-8 text-ink-soft">暂无批次耗时数据</td></tr>}
            </tbody>
          </table>
        </Section>
      )}
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

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-line p-4 mb-6">
      <h2 className="font-bold text-ink mb-3 flex items-center gap-2">{icon}{title}</h2>
      {children}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 ${active ? "border-jingtian text-jingtian font-semibold" : "border-transparent text-ink-soft hover:text-ink"}`}
    >
      {icon}{label}
    </button>
  );
}

function BacklogCard({ label, value, color, danger }: { label: string; value: number; color?: string; danger?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${danger ? "border-red-300 bg-red-50" : "border-line bg-white"}`}>
      <div className="text-ink-soft text-sm mb-1">{label}</div>
      <div className={`text-2xl font-bold ${danger ? "text-red-600" : color || "text-ink"}`}>{value}</div>
    </div>
  );
}
