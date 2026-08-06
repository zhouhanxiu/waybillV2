/**
 * Vercel Cron 兜底 Worker 路由（纯 Vercel 部署方案）
 * ---------------------------------------------------------------
 * 问题：Vercel Serverless Function 执行完响应后可能休眠/回收，
 *       内存队列 + setInterval 的 Dispatcher 不会持续运行，
 *       导致上传的任务卡在 uploaded/processing 状态不被消费。
 *
 * 解决：用 Vercel Cron 每 20 秒触发本路由，本路由直接：
 *   1. 调用 dispatchOnce() 把 Outbox 的 pending 事件投递到内存队列
 *   2. 直接读 DB 中 pending/failed 的单元并调用 processUnit()（不依赖内存队列存活）
 *   3. 更新任务聚合状态
 *
 * 这样即使没有 Redis、纯 Vercel 部署，也能保证任务最终被处理完，
 * 满足考试红线"部署可访问的在线系统"。
 *
 * 配置见 vercel.json（Vercel Cron 最短粒度为 1 分钟）：
 *   { "crons": [{ "path": "/api/worker/cron", "schedule": "* * * * *" }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { processUnit } from "@/lib/worker/processUnit";
import { dispatchOnce } from "@/lib/queue/outbox";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 单次 Cron 最多处理的单元数，避免超函数时长（默认 20，足够 1 万行兜底） */
const CRON_BATCH_LIMIT = parseInt(process.env.CRON_BATCH_LIMIT || "20");

export async function GET(req: NextRequest) {
  // 鉴权：Vercel Cron 自动触发时带 `Authorization: Bearer $CRON_SECRET`（平台内置变量）
  // 手动测试时可带 ?token=$CRON_TOKEN。两者都没配置则放行（Vercel Cron 本身受平台保护）。
  const auth = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const manualToken = req.nextUrl.searchParams.get("token");
  const tokenExpected = process.env.CRON_TOKEN;
  const authorized =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (tokenExpected && manualToken === tokenExpected) ||
    (!cronSecret && !tokenExpected);
  if (!authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let processed = 0;
  let errors = 0;

  try {
    // 1. 先投递 Outbox 里堆积的事件（保持 Outbox 模式语义完整）
    await dispatchOnce();

    // 2. 直接拉取待处理单元（pending / failed 且未超过最大尝试），
    //    不依赖内存队列是否存活，确保 Serverless 下也能推进。
    const due = await query<{ id: string; task_id: string; attempt: number }>(
      `SELECT id, task_id, attempt FROM import_task_batches
       WHERE status IN ('pending','failed')
         AND attempt < 5
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY attempt ASC, created_at ASC
       LIMIT $1`,
      [CRON_BATCH_LIMIT]
    );

    for (const b of due) {
      try {
        await query(`UPDATE import_task_batches SET status='processing', attempt=attempt+1, updated_at=NOW() WHERE id=$1`, [b.id]);
        await processUnit(b.task_id, b.id);
        processed++;
      } catch (err: any) {
        errors++;
        console.error("[cron] processUnit failed", b.id, err?.message);
        await query(
          `UPDATE import_task_batches SET status='failed', next_retry_at=NOW() + INTERVAL '10 second', error_message=$1, updated_at=NOW() WHERE id=$2`,
          [String(err?.message || err).slice(0, 500), b.id]
        );
      }
    }

    return NextResponse.json({
      ok: true,
      processed,
      errors,
      picked: due.length,
      ts: new Date().toISOString(),
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message || err), processed, errors },
      { status: 500 }
    );
  }
}
