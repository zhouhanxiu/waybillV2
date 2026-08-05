"use client";

import { useState, useRef, useCallback } from "react";
import { Gauge, Play, Loader2, CheckCircle2, XCircle } from "lucide-react";

type RunState = "idle" | "starting" | "polling" | "done" | "fail";

export default function LoadTestPage() {
  const [state, setState] = useState<RunState>("idle");
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [uploadMs, setUploadMs] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const append = (s: string) => setLog((l) => [...l, s]);

  const start = useCallback(async () => {
    setState("starting");
    setLog([]);
    setResult(null);
    setReport(null);
    setUploadMs(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/loadtest");
      const accepted = Date.now() - t0;
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        append(`❌ 压测触发失败: ${res.status} ${e.error || ""}`);
        setState("fail");
        return;
      }
      const body = await res.json();
      setUploadMs(accepted);
      append(`✅ 任务已创建 taskId=${body.taskId}`);
      append(`   上传返回耗时=${accepted}ms ${accepted <= 1000 ? "(≤1s 达标)" : "(>1s)"}`);
      append(`   总行数=${body.totalRows} 单元数=${body.totalUnits}`);
      append(`   数据来源=${body.fixture}`);
      setState("polling");

      const startPoll = Date.now();
      timer.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/import-tasks?taskId=${body.taskId}`);
          const task = await r.json();
          append(
            `   进度 ${task.progress ?? 0}% 成功=${task.success_rows} 错误=${task.error_rows} 状态=${task.status}`
          );
          if (task.status === "completed" || task.status === "failed") {
            if (timer.current) clearInterval(timer.current);
            const totalMs = Date.now() - startPoll;
            const pass = totalMs <= 60000;
            setResult({ ...task, totalMs, pass });
            append(`──── 压测结论 ────`);
            append(`端到端耗时=${totalMs}ms ${pass ? "✅ ≤60s（红线达标）" : "❌ 超限"}`);
            append(`成功行=${task.success_rows} 错误行=${task.error_rows} 吞吐=${task.throughput_rps}行/秒`);
            setState("done");
            // 拉取自动生成的压测报告
            try {
              const rr = await fetch(`/api/loadtest/report?taskId=${body.taskId}`);
              if (!rr.ok) {
                append(`报告接口 HTTP ${rr.status}：${(await rr.text()).slice(0, 200)}`);
              } else {
                const rd = await rr.json();
                setReport(rd);
                append(`📄 压测报告已生成：阶段耗时 ${rd.phases?.length} 项、错误码 ${rd.errorDist?.length} 类`);
              }
            } catch (e: any) {
              append(`报告生成异常: ${e.message}`);
            }
          }
        } catch (e: any) {
          append(`轮询异常: ${e.message}`);
        }
      }, 1000);
    } catch (e: any) {
      append(`❌ 请求异常: ${e.message}`);
      setState("fail");
    }
  }, []);

  return (
    <div className="p-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-2">
        <Gauge className="w-7 h-7 text-jingtian" />
        <h1 className="text-2xl font-bold text-ink">压测验证（考试红线）</h1>
      </div>
      <p className="text-ink-soft mb-6">
        点击「开始压测」将上传 <code>test-data/10000-orders.xlsx</code>（1万行）到导入流水线，
        自动轮询直到完成。验证目标：上传返回 ≤1s、端到端 ≤60s、成功行≈9500（5% 非法 SKU）。
      </p>

      <button
        onClick={start}
        disabled={state === "starting" || state === "polling"}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-jingtian text-white font-medium disabled:opacity-50 hover:bg-jingtian-dark transition"
      >
        {(state === "starting" || state === "polling") ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {state === "polling" ? "压测中…" : "开始压测"}
      </button>

      {result && (
        <div
          className={`mt-6 p-5 rounded-xl border ${
            result.pass ? "border-green-300 bg-green-50" : "border-red-300 bg-red-50"
          }`}
        >
          <div className="flex items-center gap-2 mb-3">
            {result.pass ? (
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            ) : (
              <XCircle className="w-6 h-6 text-red-600" />
            )}
            <span className="text-lg font-bold">
              {result.pass ? "✅ 通过：≤60s" : "❌ 未通过：>60s"}
            </span>
          </div>
          <ul className="space-y-1 text-sm text-ink-soft">
            <li>上传返回耗时：{uploadMs} ms</li>
            <li>端到端耗时：{result.totalMs} ms</li>
            <li>成功行数：{result.success_rows}</li>
            <li>错误行数：{result.error_rows}</li>
            <li>吞吐：{result.throughput_rps} 行/秒</li>
            <li>降级（SKU校验不可用）：{result.degraded ? "是" : "否"}</li>
          </ul>
        </div>
      )}

      {report && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-ink">压测报告（自动生成）</h2>
            <a
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(report.reportMarkdown)}`}
              download="PERF-REPORT.md"
              className="px-3 py-1.5 text-sm rounded-lg border border-jingtian text-jingtian hover:bg-jingtian/5"
            >
              下载报告 .md
            </a>
          </div>
          <pre className="p-4 bg-bg rounded-lg text-xs leading-relaxed text-ink-soft overflow-auto max-h-[28rem] whitespace-pre-wrap">
            {report.reportMarkdown}
          </pre>
        </div>
      )}

      {log.length > 0 && (
        <pre className="mt-6 p-4 bg-bg rounded-lg text-xs leading-relaxed text-ink-soft overflow-auto max-h-96 whitespace-pre-wrap">
          {log.join("\n")}
        </pre>
      )}
    </div>
  );
}
