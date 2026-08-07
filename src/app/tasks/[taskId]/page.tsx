"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Activity, CheckCircle2, XCircle, Loader2, Clock, Database, AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";

type TaskStatus = "pending" | "running" | "completed" | "failed" | "processing" | "degraded";

type TaskInfo = {
  id: string;
  task_id: string;
  filename?: string;
  status: TaskStatus | string;
  total_units?: number;
  processed_units?: number;
  total_rows?: number;
  processed_rows?: number;
  error_rows?: number;
  units?: number;
  started_at?: string;
  finished_at?: string;
  trace_id?: string;
  degraded?: boolean;
  error_summary?: string;
};

type PhaseStats = {
  phase: string;
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  totalRows: number;
};

const PHASE_LABEL: Record<string, string> = {
  parse: "解析",
  validate_sku: "SKU校验",
  upsert: "入库",
  total: "总耗时",
  dispatch: "派发",
  process: "处理",
};

export default function TaskDetailPage() {
  const params = useParams<{ taskId: string }>();
  const taskId = params?.taskId;
  const [task, setTask] = useState<TaskInfo | null>(null);
  const [errors, setErrors] = useState<any[]>([]);
  const [phase, setPhase] = useState<PhaseStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const fetchAll = useCallback(async () => {
    if (!taskId) return;
    try {
      const [taskRes, errRes, phaseRes] = await Promise.all([
        fetch(`/api/import-tasks/${taskId}`, { cache: "no-store" }),
        fetch(`/api/import-tasks/${taskId}/errors`, { cache: "no-store" }),
        fetch(`/api/import-monitor/phase?taskId=${encodeURIComponent(taskId)}`, { cache: "no-store" }),
      ]);
      const taskData = await taskRes.json();
      if (!taskRes.ok) throw new Error(taskData.error || `HTTP ${taskRes.status}`);
      setTask(taskData);
      if (errRes.ok) {
        const errData = await errRes.json();
        setErrors(errData.errors || errData.items || []);
      }
      if (phaseRes.ok) {
        const phaseData = await phaseRes.json();
        setPhase(phaseData.phases || []);
      }
      setErr(null);
    } catch (e: any) {
      setErr(e.message || "查询失败");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // 1.5s 自动轮询（任务未完成时）
  useEffect(() => {
    if (!task) return;
    const s = task.status;
    if (s === "completed" || s === "failed") return;
    const t = setInterval(() => setTick((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [task?.status]);

  useEffect(() => {
    if (tick > 0) fetchAll();
  }, [tick, fetchAll]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6 flex items-center gap-3 text-ink-soft">
        <Loader2 className="w-5 h-5 animate-spin" /> 加载任务详情…
      </div>
    );
  }

  if (err || !task) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertTriangle className="w-4 h-4" /> 加载失败：{err || "任务不存在"}
        </div>
        <Link href="/" className="mt-4 inline-block text-sm text-jingtian hover:underline">← 回到上传</Link>
      </div>
    );
  }

  const status = task.status;
  const total = task.total_units ?? task.units ?? 0;
  const processed = task.processed_units ?? 0;
  const totalRows = task.total_rows ?? 0;
  const procRows = task.processed_rows ?? 0;
  const errRows = task.error_rows ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const isDone = status === "completed" || status === "failed";

  return (
    <div className="max-w-5xl mx-auto p-6">
      {/* 顶部：任务ID + 状态 + 操作 */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {statusBadge(status)}
            {task.degraded && (
              <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs">降级模式</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-ink">{task.filename || task.task_id || taskId}</h1>
          <div className="text-xs text-ink-soft mt-1 font-mono break-all">
            {taskId}{task.trace_id && <span className="ml-3">trace: {task.trace_id}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchAll} className="px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-bg flex items-center gap-1">
            <RefreshCw className="w-3.5 h-3.5" /> 刷新
          </button>
          <Link href="/traces" className="px-3 py-1.5 rounded-lg border border-line text-sm text-ink-soft hover:bg-bg flex items-center gap-1">
            <ExternalLink className="w-3.5 h-3.5" /> Trace 检索
          </Link>
        </div>
      </div>

      {/* 进度 */}
      <div className="bg-white rounded-2xl border border-line p-6 mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-ink-soft">
            {isDone ? "已完成" : "处理中…"}
          </span>
          <span className="text-sm font-medium text-ink">{processed} / {total} 单元</span>
        </div>
        <div className="w-full h-3 bg-bg rounded-full overflow-hidden">
          <div className={`h-full transition-all duration-500 ${isDone ? "bg-jingtian" : "bg-jingtian animate-pulse"}`} style={{ width: `${pct}%` }}></div>
        </div>
        <div className="grid grid-cols-4 gap-4 mt-4 text-center">
          <Stat icon={<Database className="w-4 h-4" />} label="总行数" value={totalRows} />
          <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="已处理" value={procRows} />
          <Stat icon={<AlertTriangle className="w-4 h-4" />} label="错误行" value={errRows} highlight={errRows > 0} />
          <Stat icon={<Clock className="w-4 h-4" />} label="耗时" value={fmtDuration(task.started_at, task.finished_at)} />
        </div>
      </div>

      {/* 阶段耗时 */}
      <div className="bg-white rounded-2xl border border-line p-6 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1"><Activity className="w-4 h-4" /> 阶段耗时</h2>
        {phase.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-soft">
                <tr>
                  <th className="text-left py-2">阶段</th>
                  <th className="text-right py-2">样本</th>
                  <th className="text-right py-2">P50</th>
                  <th className="text-right py-2">P95</th>
                  <th className="text-right py-2">P99</th>
                  <th className="text-right py-2">最大</th>
                </tr>
              </thead>
              <tbody>
                {phase.map((p) => (
                  <tr key={p.phase} className="border-t border-line">
                    <td className="py-2 font-medium">{PHASE_LABEL[p.phase] || p.phase}</td>
                    <td className="text-right py-2 text-ink-soft">{p.samples}</td>
                    <td className="text-right py-2">{p.p50}ms</td>
                    <td className="text-right py-2">{p.p95}ms</td>
                    <td className="text-right py-2">{p.p99}ms</td>
                    <td className="text-right py-2 text-ink-soft">{p.max}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">暂无阶段耗时数据（任务还在跑或单元尚未完成）</p>
        )}
      </div>

      {/* 错误明细 */}
      {errors.length > 0 && (
        <div className="bg-white rounded-2xl border border-line p-6">
          <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1">
            <AlertTriangle className="w-4 h-4 text-amber-500" /> 错误明细（{errors.length} 行）
          </h2>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-soft sticky top-0 bg-white">
                <tr>
                  <th className="text-left py-2">行号</th>
                  <th className="text-left py-2">错误码</th>
                  <th className="text-left py-2">字段</th>
                  <th className="text-left py-2">说明</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((e, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-2 font-mono">{e.row_index ?? e.rowIndex ?? "—"}</td>
                    <td className="py-2"><code className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 text-xs">{e.error_code || e.code || "—"}</code></td>
                    <td className="py-2 text-ink-soft">{e.field || "—"}</td>
                    <td className="py-2">{e.message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 提示 */}
      <div className="mt-4 text-xs text-ink-soft text-center">
        {isDone ? "✓ 任务已结束" : "每 1.5 秒自动刷新 · 您可关闭页面，在 <Link href=\"/tasks\" className=\"text-jingtian\">导入任务</Link> 中查看历史"}
      </div>
    </div>
  );
}

function statusBadge(s: string) {
  const map: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
    pending: { color: "bg-bg text-ink-soft", icon: <Clock className="w-3.5 h-3.5" />, text: "等待中" },
    running: { color: "bg-blue-50 text-blue-700", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "处理中" },
    processing: { color: "bg-blue-50 text-blue-700", icon: <Loader2 className="w-3.5 h-3.5 animate-spin" />, text: "处理中" },
    completed: { color: "bg-green-50 text-green-700", icon: <CheckCircle2 className="w-3.5 h-3.5" />, text: "已完成" },
    failed: { color: "bg-red-50 text-red-700", icon: <XCircle className="w-3.5 h-3.5" />, text: "失败" },
    degraded: { color: "bg-amber-50 text-amber-700", icon: <AlertTriangle className="w-3.5 h-3.5" />, text: "降级" },
  };
  const cfg = map[s] || map.pending;
  return <span className={`px-2 py-0.5 rounded-md ${cfg.color} text-xs flex items-center gap-1 inline-flex`}>{cfg.icon}{cfg.text}</span>;
}

function Stat({ icon, label, value, highlight }: { icon: React.ReactNode; label: string; value: any; highlight?: boolean }) {
  return (
    <div className="bg-bg rounded-xl p-3">
      <div className="flex items-center justify-center gap-1 text-xs text-ink-soft mb-1">{icon}{label}</div>
      <div className={`text-lg font-semibold ${highlight ? "text-red-600" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function fmtDuration(start?: string, end?: string) {
  if (!start) return "—";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, e - s);
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}
