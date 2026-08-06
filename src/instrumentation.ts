/**
 * Next.js Instrumentation：在应用启动时执行一次
 * 1. 执行 V4 数据库迁移（幂等）
 * 2. 启动 Worker（消费处理单元队列）
 * 3. 启动 Outbox Dispatcher（把 pending 事件可靠投递到队列，进程重启可恢复）
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 避免 dev 模式热重载重复启动
  if ((globalThis as any).__v4_booted) return;
  (globalThis as any).__v4_booted = true;

  try {
    const { migrateV4 } = await import("@/lib/db/migrate-v4");
    await migrateV4();
    console.log("[instrumentation] V4 migration done");
  } catch (err) {
    console.error("[instrumentation] V4 migration failed", err);
  }

  try {
    // WORKER_MODE=cron：纯 Vercel 生产，不启动内存 pump，消费交给 /api/worker/cron（Vercel Cron 触发）
    // WORKER_MODE=qstash：消费由 /api/worker/qstash 回调完成，startWorker 仅登记 worker 函数
    // 其他（默认/auto）：启动内存 pump 即时消费（本地开发、Railway 常驻）
    // 清理可能携带的 BOM/不可见字符（Vercel 配置偶发 \uFEFF 前缀）
    const workerMode = (process.env.WORKER_MODE || "auto").replace(
      /^[\uFEFF\u200B\u200C\u200D\s\u00A0]+|[\uFEFF\u200B\u200C\u200D\s\u00A0]+$/g,
      ""
    );
    const { startWorker } = await import("@/lib/queue");
    const { processUnit } = await import("@/lib/worker/processUnit");
    const workerFn = async (job: { taskId: string; unitId: string }) => {
      await processUnit(job.taskId, job.unitId);
    };
    if (workerMode === "cron") {
      console.log("[instrumentation] V4 worker mode=cron, skip memory pump (Cron route consumes)");
    } else {
      await startWorker(workerFn);
      if (workerMode === "qstash") {
        console.log("[instrumentation] V4 worker mode=qstash, registered for /api/worker/qstash callback");
      } else {
        console.log("[instrumentation] V4 worker started (memory pump)");
      }
    }
  } catch (err) {
    console.error("[instrumentation] V4 worker start failed", err);
  }

  try {
    const { startOutboxDispatcher } = await import("@/lib/queue/outbox");
    await startOutboxDispatcher();
    console.log("[instrumentation] V4 outbox dispatcher started");
  } catch (err) {
    console.error("[instrumentation] V4 outbox dispatcher failed", err);
  }
}
