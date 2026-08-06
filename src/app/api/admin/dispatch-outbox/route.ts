/**
 * Admin: 手动重发 / 消费 event_outbox 堆积的 pending 事件
 * ---------------------------------------------------------------
 * 场景：QStash 投递失败 / 网络抖动 / worker 路由被砍后，
 * event_outbox 里仍有 status='pending' 的事件，没人消费。
 * 监控看板看到任务停在 uploaded 时，点这个端点手动推进。
 *
 * 行为：
 *   1. 把所有 next_retry_at <= NOW() 的 pending 事件按 unitIndex 顺序取出
 *   2. 按 backend 重新入队（qstash 重新 publish；memory 直接 processUnit）
 *   3. 失败的事件按指数退避重试（next_retry_at += 2^retry * 1s，最多 30s）
 *   4. 返回本次发送/失败/剩余堆积数
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb, query, withTx } from "@/lib/db";
import { processUnit } from "@/lib/worker/processUnit";
import { enqueueUnit } from "@/lib/queue";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  await getDb();
  const t0 = Date.now();
  let sent = 0;
  let failed = 0;

  // 一次最多处理 200 条（防止单次请求超时）
  const pending = await query<{
    id: number;
    payload: { taskId: string; unitId: string; unitIndex: number };
  }>(
    `SELECT id, payload FROM event_outbox
     WHERE status='pending' AND next_retry_at <= NOW()
     ORDER BY created_at ASC LIMIT 200`
  );

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, remaining: 0, message: "no pending events" });
  }

  // 清理 BOM/不可见字符（Vercel 配置偶发 \uFEFF 前缀，导致 "qstash" 判定失败）
  const backend = (process.env.QUEUE_BACKEND || "memory").replace(
    /^[\uFEFF\u200B\u200C\u200D\s\u00A0]+|[\uFEFF\u200B\u200C\u200D\s\u00A0]+$/g,
    ""
  );

  for (const ev of pending) {
    const p = ev.payload;
    if (!p?.taskId || !p?.unitId) {
      await query(`UPDATE event_outbox SET status='failed', updated_at=NOW() WHERE id=$1`, [ev.id]);
      failed++;
      continue;
    }
    try {
      if (backend === "qstash") {
        // qstash 模式：重新 publish（messageId=unitId 幂等，QStash 不会重复消费）
        await enqueueUnit({ taskId: p.taskId, unitId: p.unitId, unitIndex: p.unitIndex });
      } else {
        // memory / redis 模式：直接同步跑（admin 操作，单次 < 60s）
        await processUnit(p.taskId, p.unitId);
      }
      await query(`UPDATE event_outbox SET status='sent', updated_at=NOW() WHERE id=$1`, [ev.id]);
      sent++;
    } catch (err: any) {
      failed++;
      console.error("[admin/dispatch-outbox] failed", p?.unitId, err?.message, err?.stack?.split("\n").slice(0, 5).join(" | "));
      const cur = (await query<{ c: number }>(`SELECT retry_count AS c FROM event_outbox WHERE id=$1`, [ev.id]))[0]?.c ?? 0;
      const backoff = Math.min(30000, 1000 * 2 ** cur);
      await query(
        `UPDATE event_outbox SET retry_count=$1, next_retry_at=NOW()+$2 * INTERVAL '1 millisecond', updated_at=NOW() WHERE id=$3`,
        [cur + 1, backoff, ev.id]
      );
    }
  }

  const remaining = (await query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM event_outbox WHERE status='pending' AND next_retry_at <= NOW()`
  ))[0]?.c ?? 0;

  return NextResponse.json({
    ok: true,
    backend,
    sent,
    failed,
    remaining,
    durationMs: Date.now() - t0,
    message: `dispatched ${sent} ok, ${failed} failed, ${remaining} still pending`,
  });
}

export async function GET() {
  // GET 用来查询堆积情况，不消费
  await getDb();
  const total = (await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM event_outbox`))[0]?.c ?? 0;
  const pending = (await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM event_outbox WHERE status='pending'`))[0]?.c ?? 0;
  const due = (await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM event_outbox WHERE status='pending' AND next_retry_at <= NOW()`))[0]?.c ?? 0;
  const sent = (await query<{ c: number }>(`SELECT COUNT(*)::int AS c FROM event_outbox WHERE status='sent'`))[0]?.c ?? 0;
  return NextResponse.json({ total, pending, due, sent });
}
